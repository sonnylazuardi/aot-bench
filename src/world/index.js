// WORLD system (ctx.world): Shiganshina — the great wall with its gatehouses and hero breach section, the
// timber-framed town, canal and bridges, farmland / hills / mountains outside, collision, destruction.
//
// API (CONTRACT + extras):
//   groundHeight(x, z)            terrain / town floor / canal bed / breach rubble (no buildings)
//   surfaceHeight(x, z, yMax?)    highest solid top below yMax incl. buildings, wall, props
//   damage(point, radius, force)  collapse houses, bite the wall top, widen the breach
//   breach()  breached  buildings  wallTopAt(angle)  wallWalkway(angle, out?) -> Vector3 on the walkway centre line
//   raycast via ctx.physics 'world' (kinds: ground | building | wall | prop | tree)
import * as THREE from 'three';
import { LAYOUT } from '../core/layout.js';
import { makeNoiseTexture } from './noise.js';
import { makeProcMaterial, makeCollapseDepthMaterial } from './shaders.js';
import { makePlan } from './plan.js';
import { GB } from './geom.js';
import { Solids } from './collide.js';
import { buildLot } from './houses.js';
import { buildWall, WALL, WALL_GLSL, WMAT } from './wall.js';
import { buildGround, GROUND_GLSL, terrainHeight } from './ground.js';
import { rayWall, collideWall } from './wallphys.js';
import { createDamage } from './damage.js';
import { buildPropsGen, SUPPLY } from './props.js';
import { buildTreesGen, makeFoliageMaterial } from './trees.js';
import { smooth } from './util.js';

// Time-sliced job runner: generators are stepped for at most `budget` ms per slice; slices run back to back on a
// MessageChannel (yielding to rendering / input between them) and also get a budget inside world.update().
function createJobs(budgetFn) {
  const q = [];
  let scheduled = false, t0 = performance.now(), total = 0;
  const ch = new MessageChannel();
  const runFor = (ms) => {
    const t = performance.now();
    while (q.length && performance.now() - t < ms) {
      const j = q[0];
      let r;
      try { r = j.it.next(); } catch (e) { console.error('[world] job ' + j.name, e); r = { done: true }; }
      if (r.done) { q.shift(); j.resolve(); console.log(`[world] +${j.name} at ${(performance.now() - t0).toFixed(0)} ms`); }
    }
    total += performance.now() - t;
  };
  ch.port1.onmessage = () => { scheduled = false; runFor(budgetFn()); if (q.length) kick(); };
  const kick = () => { if (!scheduled && q.length) { scheduled = true; ch.port2.postMessage(0); } };
  return {
    add(name, it) { return new Promise((resolve) => { q.push({ name, it, resolve }); kick(); }); },
    // run everything now, synchronously (chained jobs are added in promise callbacks: callers await between drains)
    drain() { runFor(1e9); },
    step(ms) { if (q.length) runFor(ms); },
    get pending() { return q.length; },
    get cpuMs() { return total; },
    start() { t0 = performance.now(); },
  };
}

export async function create(ctx) {
  const t0 = performance.now();
  const T = (label) => console.log(`[world] ${label} ${(performance.now() - t0).toFixed(0)} ms`);
  // 7 ms slices while loading / on the title, 2 ms once the player is in control
  const jobs = createJobs(() => (ctx.mode === 'play' || ctx.mode === 'intro' ? 2 : 7));
  jobs.start();
  const shared = {
    noise: makeNoiseTexture(256),
    uSkyTop: { value: new THREE.Color(0.32, 0.42, 0.58) },
    uSkyHor: { value: new THREE.Color(0.62, 0.62, 0.6) },
    uTime: { value: 0 },
  };
  // building state texture (collapse)
  const SW = 256, SH = 32;
  shared.state = new THREE.DataTexture(new Uint8Array(SW * SH * 4), SW, SH, THREE.RGBAFormat);
  shared.state.magFilter = shared.state.minFilter = THREE.NearestFilter; shared.state.generateMipmaps = false; shared.state.needsUpdate = true;
  shared.buildingMat = makeProcMaterial('building', shared);
  shared.wallMat = makeProcMaterial('wall', shared, WALL_GLSL);
  shared.groundUniforms = { tMap: { value: null }, tAO: { value: null }, tLand: { value: null }, tLandD: { value: null } };
  shared.groundMat = makeProcMaterial('ground', shared, GROUND_GLSL, shared.groundUniforms);
  shared.depthMat = makeCollapseDepthMaterial(shared);
  shared.foliageMat = makeFoliageMaterial(shared);
  // shader warm-up stand-ins: every program variant that later (time-sliced) meshes use is present now, so the
  // loader's compileAsync links it up front (instanced building / foliage)
  const warm = new THREE.Group(); warm.name = 'world-warm';
  {
    const g = new GB(8); g.set({ mat: 2, col: [1, 1, 1] }); g.box(-0.01, -50, -0.01, 0.01, -49.99, 0.01, 4); const geo = g.build();
    for (const m of [shared.buildingMat, shared.foliageMat]) { const im = new THREE.InstancedMesh(geo, m, 1); im.setMatrixAt(0, new THREE.Matrix4()); im.frustumCulled = false; im.castShadow = true; warm.add(im); }
    ctx.scene.add(warm);
  }
  T('materials');

  const plan = makePlan();
  T('plan');
  const solids = new Solids();

  // ---------------- town (chunked, hero area first; the rest is time-sliced) ----------------
  const CH = 100;
  const HERO = new THREE.Vector2(0, 300);
  const buildings = [];
  buildings.decor = { flowers: [], lanterns: [] };
  const townGroup = new THREE.Group(); townGroup.name = 'town';
  ctx.scene.add(townGroup);
  const chunkLots = new Map();
  for (const lot of plan.lots) {
    const k = Math.floor((lot.x + 400) / CH) + ',' + Math.floor((lot.z + 400) / CH);
    if (!chunkLots.has(k)) chunkLots.set(k, []);
    chunkLots.get(k).push(lot);
  }
  const chunkOrder = [...chunkLots.keys()].map((k) => {
    const [i, j] = k.split(',').map(Number);
    return { k, d: Math.hypot((i + 0.5) * CH - 400 - HERO.x, (j + 0.5) * CH - 400 - HERO.y) };
  }).sort((a, b) => a.d - b.d);
  function* chunkGen(k) {
    const gb = new GB(8000);
    let n = 0;
    for (const lot of chunkLots.get(k)) {
      buildings.push(buildLot(plan, lot, gb, solids, buildings.decor));
      if (++n % 6 === 0) yield;
    }
    if (!gb.count) return;
    const m = new THREE.Mesh(gb.build(), shared.buildingMat);
    m.castShadow = true; m.receiveShadow = true; m.name = 'houses ' + k;
    m.customDepthMaterial = shared.depthMat;
    townGroup.add(m);
  }
  // ground floor + its town map first (the streets are the most visible thing from ODM height)
  const ground = buildGround(ctx, shared, plan, solids);
  const mapDone = jobs.add('town map', ground.mapJob());
  const SYNC_R = 175; // chunks around the gate / hero area built before create() returns
  const townDone = [];
  for (const { k, d } of chunkOrder) {
    if (d < SYNC_R) { for (const _ of chunkGen(k)) { /* run to completion */ } }
    else townDone.push(jobs.add('town ' + k, chunkGen(k)));
  }
  T(`town hero chunks (${buildings.length} buildings now, ${plan.lots.length} total)`);

  // ---------------- wall ----------------
  const wall = buildWall(ctx, shared, solids);
  T('wall');

  // ---------------- ground: town floor now, maps / terrain / mountains sliced ----------------
  const groundDone = jobs.add('ground', ground.jobs());
  const fieldDone = groundDone.then(() => jobs.add('terrain field', terrainFieldJob()));
  T('ground floor');

  // ---------------- props & trees (sliced, after the town / landmap) ----------------
  const props = { group: null, supply: SUPPLY };
  const trees = { group: null };
  const propsDone = Promise.all(townDone).then(() => jobs.add('props', buildPropsGen(ctx, shared, plan, buildings, solids, props)));
  const treesDone = groundDone.then(() => jobs.add('trees', buildTreesGen(ctx, shared, shared.foliageMat, plan, ground.land, solids, trees)));
  const allDone = Promise.all([mapDone, propsDone, treesDone, groundDone, fieldDone, ...townDone]).then(() => {
    warm.removeFromParent();
    console.log(`[world] all content ready at ${(performance.now() - t0).toFixed(0)} ms (sliced cpu ${jobs.cpuMs.toFixed(0)} ms)`);
    ctx.events?.emit('world:ready', ctx.world);
  });

  // ---------------- ground height ----------------
  const canal = plan.canal;
  const piles = [];
  function pileHeightAnalytic(x, z) {
    let h = 0;
    for (const p of piles) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d >= p.r) continue;
      const e = 1 - (d / p.r) * (d / p.r);
      h = Math.max(h, p.h * e * e * (0.85 + 0.3 * Math.sin(x * 0.7 + z * 0.9) * Math.cos(z * 0.5 - x * 0.3)));
    }
    return h;
  }
  // rubble heightfield (1 m, bilinear) rasterised whenever the piles change
  const PF = { x0: -90, z0: WALL.R - 100, n: 0, nx: 181, nz: 171, res: 1, h: null };
  function rasterPiles() {
    const h = new Float32Array(PF.nx * PF.nz);
    for (let k = 0; k < PF.nz; k++) for (let i = 0; i < PF.nx; i++) h[k * PF.nx + i] = pileHeightAnalytic(PF.x0 + i, PF.z0 + k);
    PF.h = h;
  }
  function pileHeight(x, z) {
    const h = PF.h; if (!h) return 0;
    const fx = x - PF.x0, fz = z - PF.z0;
    if (fx < 0 || fz < 0 || fx >= PF.nx - 1 || fz >= PF.nz - 1) return 0;
    const i = fx | 0, k = fz | 0, tx = fx - i, tz = fz - k, o = k * PF.nx + i;
    return (h[o] * (1 - tx) + h[o + 1] * tx) * (1 - tz) + (h[o + PF.nx] * (1 - tx) + h[o + PF.nx + 1] * tx) * tz;
  }
  // terrain heightfield (5 m, bilinear) filled by a background job; analytic until then / beyond it
  const TF = { ext: 1600, res: 5, n: 641, h: null };
  function* terrainFieldJob() {
    const h = new Float32Array(TF.n * TF.n);
    for (let k = 0; k < TF.n; k++) {
      const z = -TF.ext + k * TF.res;
      for (let i = 0; i < TF.n; i++) { const x = -TF.ext + i * TF.res; h[k * TF.n + i] = x * x + z * z < 395 * 395 ? 0 : terrainHeight(x, z); }
      if (k % 16 === 15) yield;
    }
    TF.h = h;
  }
  function terrainH(x, z) {
    const h = TF.h;
    if (h) {
      const fx = (x + TF.ext) / TF.res, fz = (z + TF.ext) / TF.res;
      if (fx >= 0 && fz >= 0 && fx < TF.n - 1 && fz < TF.n - 1) {
        const i = fx | 0, k = fz | 0, tx = fx - i, tz = fz - k, o = k * TF.n + i;
        return (h[o] * (1 - tx) + h[o + 1] * tx) * (1 - tz) + (h[o + TF.n] * (1 - tx) + h[o + TF.n + 1] * tx) * tz;
      }
    }
    return terrainHeight(x, z);
  }
  function groundHeightBase(x, z) {
    const r2 = x * x + z * z;
    if (r2 >= 160000) return terrainH(x, z);
    const c = plan.cellIdx(x, z);
    if (c >= 0 && plan.street[c] === 3) return canal.bedY;
    return 0;
  }
  function groundHeight(x, z) {
    const b = groundHeightBase(x, z);
    if (!PF.h) return b;
    const p = pileHeight(x, z);
    return p > b ? p : b;
  }

  // breach rubble mound mesh
  let moundMesh = null;
  function buildMound(P) {
    piles.length = 0; piles.push(...P);
    rasterPiles();
    const gb = new GB(20000);
    gb.set({ mat: WMAT.RUBBLE, col: [0.36, 0.33, 0.29], p0: 0, p1: 0 });
    const x0 = -60, x1 = 60, z0 = WALL.R - 70, z1 = WALL.R + 45, st = 1.6;
    const nx = Math.round((x1 - x0) / st), nz = Math.round((z1 - z0) / st);
    const H = (x, z) => pileHeight(x, z);
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      const xa = x0 + i * st, xb = xa + st, za = z0 + k * st, zb = za + st;
      const h00 = H(xa, za), h10 = H(xb, za), h01 = H(xa, zb), h11 = H(xb, zb);
      if (Math.max(h00, h10, h01, h11) < 0.05) continue;
      const y = (x, z, h) => h + groundHeightBase(x, z) + 0.04 - (h < 0.05 ? 0.1 : 0);
      gb.poly([[xa, y(xa, za, h00), za], [xa, y(xa, zb, h01), zb], [xb, y(xb, zb, h11), zb], [xb, y(xb, za, h10), za]]);
    }
    const g = gb.build();
    // smooth normals for the mound
    g.computeVertexNormals?.();
    if (moundMesh) { moundMesh.geometry.dispose(); moundMesh.geometry = g; }
    else { moundMesh = new THREE.Mesh(g, shared.wallMat); moundMesh.receiveShadow = true; moundMesh.castShadow = true; moundMesh.name = 'breach-mound'; ctx.scene.add(moundMesh); }
  }

  // ---------------- physics ----------------
  const isAnalytic = (a) => wall.isAnalytic(a);
  function rayGround(o, d, maxT) {
    // flat town / canal
    let best = null;
    if (d.y < -1e-6) {
      const t = -o.y / d.y;
      if (t > 0 && t < maxT) {
        const x = o.x + d.x * t, z = o.z + d.z * t;
        if (Math.hypot(x, z) < 400) {
          const c = plan.cellIdx(x, z);
          if (c >= 0 && plan.street[c] === 3) {
            const tw = (canal.waterY - o.y) / d.y;
            if (tw < maxT) best = { t: tw, n: [0, 1, 0], water: true };
          } else best = { t, n: [0, 1, 0] };
        }
      }
    }
    // rubble mounds: march inside their bounds
    if (piles.length) {
      const lim = best ? best.t : maxT;
      const cx = 0, cz = WALL.R - 5, rr = 60;
      const ox = o.x - cx, oz = o.z - cz;
      const a = d.x * d.x + d.z * d.z, b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - rr * rr;
      const disc = b * b - 4 * a * c;
      if (a > 1e-9 && disc > 0 && o.y + Math.min(0, d.y * lim) < 9) {
        const sq = Math.sqrt(disc);
        let ta = Math.max(0, (-b - sq) / (2 * a)), tb = Math.min(lim, (-b + sq) / (2 * a));
        let prev = ta;
        for (let t = ta; t <= tb; t += 0.7) {
          const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
          if (y < pileHeight(x, z) + groundHeightBase(x, z) - 0.02) {
            let lo = prev, hi = t;
            for (let q = 0; q < 10; q++) { const m = (lo + hi) / 2; const X = o.x + d.x * m, Y = o.y + d.y * m, Z = o.z + d.z * m; if (Y < pileHeight(X, Z) + groundHeightBase(X, Z)) hi = m; else lo = m; }
            const X = o.x + d.x * hi, Z = o.z + d.z * hi, e = 0.5;
            const hx = groundHeight(X + e, Z) - groundHeight(X - e, Z), hz = groundHeight(X, Z + e) - groundHeight(X, Z - e);
            const l = Math.hypot(hx, 2 * e, hz);
            if (!best || hi < best.t) best = { t: hi, n: [-hx / l, (2 * e) / l, -hz / l] };
            break;
          }
          prev = t;
        }
      }
    }
    // terrain outside the wall: adaptive march
    {
      const lim = best ? best.t : maxT;
      // parameter range where r >= 400
      let tStart = 0;
      const a = d.x * d.x + d.z * d.z, b = 2 * (o.x * d.x + o.z * d.z), c = o.x * o.x + o.z * o.z - 400 * 400;
      if (c < 0) { if (a < 1e-12) return best; tStart = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a); }
      if (tStart < lim) {
        let t = tStart, prev = t;
        for (let it = 0; it < 160 && t < lim; it++) {
          const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
          const h = terrainH(x, z);
          if (y < h) {
            let lo = prev, hi = t;
            for (let q = 0; q < 12; q++) { const m = (lo + hi) / 2; const X = o.x + d.x * m, Y = o.y + d.y * m, Z = o.z + d.z * m; if (Y < terrainH(X, Z)) hi = m; else lo = m; }
            const X = o.x + d.x * hi, Z = o.z + d.z * hi, e = 2.5;
            const hx = terrainH(X + e, Z) - terrainH(X - e, Z), hz = terrainH(X, Z + e) - terrainH(X, Z - e);
            const l = Math.hypot(hx, 2 * e, hz);
            best = { t: hi, n: [-hx / l, (2 * e) / l, -hz / l] };
            break;
          }
          prev = t;
          t += Math.max(1.5, Math.min(60, (y - h) * 0.7));
          if (y > 1600 && d.y >= 0) break;
        }
      }
    }
    return best;
  }

  // cheapest-first: convex grid (buildings / wall blocks / props), analytic wall, then ground (terrain march last,
  // limited by the nearest hit so far). Allocates only the returned hit.
  ctx.physics.addRaycaster('world', (o, d, maxT = 1000) => {
    let t = maxT, kind = null, ref = null, nx = 0, ny = 1, nz = 0;
    const s = solids.raycast(o.x, o.y, o.z, d.x, d.y, d.z, t);
    if (s) { t = s.t; kind = solids.kind[s.i]; ref = solids.ref[s.i]; nx = s.nx; ny = s.ny; nz = s.nz; }
    const w = rayWall(o.x, o.y, o.z, d.x, d.y, d.z, t, isAnalytic);
    if (w) { t = w.t; kind = 'wall'; ref = 'wall'; nx = w.nx; ny = w.ny; nz = w.nz; }
    const g = rayGround(o, d, t);
    if (g && g.t < t) { t = g.t; kind = 'ground'; ref = g.water ? 'water' : null; [nx, ny, nz] = g.n; }
    if (!kind) return null;
    return { point: new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t), normal: new THREE.Vector3(nx, ny, nz), distance: t, kind, ref };
  });
  const mkV = (x, y, z) => new THREE.Vector3(x, y, z);
  ctx.physics.addCollider('world', (c, r, out) => {
    const gh = groundHeight(c.x, c.z);
    if (c.y - r < gh) out.push({ normal: new THREE.Vector3(0, 1, 0), depth: gh - (c.y - r), kind: 'ground' });
    collideWall(c.x, c.y, c.z, r, out, isAnalytic, mkV);
    solids.collide(c.x, c.y, c.z, r, out);
  });

  // ---------------- damage ----------------
  // houses never collapse (user direction); the wall still breaks. Flip to false to re-enable collapses/ruins.
  const W = { solids, buildings, shared, wall, groundHeightBase, buildMound, housesIndestructible: true };
  const dmg = createDamage(ctx, W);

  // sky colours for the fake glass reflections
  const tmpC = new THREE.Color();
  function syncSky() {
    const f = ctx.scene.fog;
    if (f && f.color) {
      tmpC.copy(f.color);
      shared.uSkyHor.value.copy(tmpC);
      shared.uSkyTop.value.copy(tmpC).multiplyScalar(0.75).lerp(new THREE.Color(0.25, 0.35, 0.55), 0.35);
    }
  }

  const world = {
    plan, buildings, solids, wall, shared, props, trees, ground,
    breached: false,
    groundHeight,
    surfaceHeight(x, z, yMax = 200) {
      const r = solids.raycast(x, yMax, z, 0, -1, 0, yMax + 20);
      const g = groundHeight(x, z);
      const w = rayWall(x, yMax, z, 0, -1, 0, yMax + 20, isAnalytic);
      let h = g;
      if (r) h = Math.max(h, yMax - r.t);
      if (w) h = Math.max(h, yMax - w.t);
      return h;
    },
    damage(point, radius = 6, force = 1) { return dmg.damage(point, radius, force); },
    breach() {
      if (world.breached) return;
      world.breached = true;
      dmg.breach();
    },
    wallTopAt(angle) { return wall.wallTopAt(angle); },
    wallWalkway(angle, out = new THREE.Vector3()) {
      const r = WALL.R + 3.5;
      return out.set(Math.cos(angle) * r, wall.wallTopAt(angle), Math.sin(angle) * r);
    },
    // hero bell tower etc. for other systems (cinematics)
    landmarks: {},
    ready: allDone,
    get loading() { return jobs.pending; },
    update(dt, time) {
      if (jobs.pending) jobs.step(ctx.mode === 'play' || ctx.mode === 'intro' ? 1 : 4);
      shared.uTime.value = time;
      syncSky();
      dmg.update(dt);
    },
  };
  // flat vantage perches (fight start / respawn): centre of each walkable roof terrace / tower platform, facing the gate
  world.vantagePoints = (plan.vantage || []).map((l) => {
    const gate = LAYOUT.outerGate;
    const pos = new THREE.Vector3(l.x, l.top, l.z);
    const dir = new THREE.Vector3(gate.x - l.x, 0, gate.z - l.z).normalize();
    // stand a little towards the gate side of the platform (clear sightline over the parapet)
    const inset = Math.min(l.w, l.d) * 0.18;
    pos.addScaledVector(dir, inset);
    return { position: pos, facing: Math.atan2(dir.x, dir.z), dir, size: Math.min(l.w, l.d) - 1, kind: l.kind, height: l.top, distanceToGate: Math.hypot(gate.x - l.x, gate.z - l.z) };
  });
  world.landmarks.vantage = world.vantagePoints;
  // resupply spots for the director: garrison depot inside the outer gate + the walkway 60 m west of the gate
  world.supplyPoints = [SUPPLY.clone(), world.wallWalkway(Math.PI / 2 + 60 / WALL.R)];
  Object.defineProperties(world.landmarks, {
    church: { get: () => buildings.find((b) => b.kind === 'church')?.spireTop, enumerable: true },
    bellTower: { get: () => buildings.find((b) => b.kind === 'gatechurch')?.spireTop, enumerable: true },
  });
  // player start on the ground
  LAYOUT.playerStart.y = groundHeight(LAYOUT.playerStart.x, LAYOUT.playerStart.z);
  T('done');
  if (ctx.params?.breach) setTimeout(() => world.breach(), 0);
  // headless screenshots: build everything before returning so shots are complete (?lazy=1 keeps the slicing).
  // Must stay after every const / function the job generators reach (temporal dead zone).
  if (ctx.params?.shot && !ctx.params?.lazy) {
    for (let k = 0; k < 10; k++) { jobs.drain(); await new Promise((r) => setTimeout(r, 0)); if (!jobs.pending && k > 2) break; }
    T('shot mode: all content built');
  }
  return world;
}
