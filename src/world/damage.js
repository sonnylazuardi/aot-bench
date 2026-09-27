// WORLD damage: building collapse (GPU-driven: a per-building state texel squashes / leans / dissolves the merged
// house geometry in the vertex + fragment shaders, so a collapse costs one texel write), ruins (jagged wall stumps,
// rubble mound, broken beams, fallen roof slab) appended into a preallocated dynamic mesh, wall-top bites and breach
// widening (wall.js hero section), falling wall chunks as fx projectiles.
import * as THREE from 'three';
import { GB, rot3 } from './geom.js';
import { Rng, lin, mixc, scalec } from './util.js';
import { WALL } from './wall.js';

const _v = new THREE.Vector3();

// preallocated, append-only geometry sharing the GB vertex layout
export class DynGeo {
  constructor(capV, capI) {
    this.g = new THREE.BufferGeometry();
    const mk = (n, k) => { const a = new THREE.BufferAttribute(new Float32Array(n * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.g.setAttribute('position', mk(capV, 3)); this.g.setAttribute('normal', mk(capV, 3)); this.g.setAttribute('color', mk(capV, 3));
    this.g.setAttribute('aUV', mk(capV, 4)); this.g.setAttribute('aMat', mk(capV, 4));
    const I = new THREE.BufferAttribute(new Uint32Array(capI), 1); I.setUsage(THREE.DynamicDrawUsage);
    this.g.setIndex(I);
    this.g.setDrawRange(0, 0);
    this.nv = 0; this.ni = 0; this.capV = capV; this.capI = capI;
    this.g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 5000);
  }
  append(gb) {
    const nv = gb.v, ni = gb.I.n;
    if (this.nv + nv > this.capV || this.ni + ni > this.capI) return false;
    const A = this.g.attributes;
    const put = (attr, src, k) => { attr.array.set(src.a.subarray(0, nv * k), this.nv * k); attr.addUpdateRange(this.nv * k, nv * k); attr.needsUpdate = true; };
    put(A.position, gb.P, 3); put(A.normal, gb.N, 3); put(A.color, gb.C, 3); put(A.aUV, gb.U, 4); put(A.aMat, gb.M, 4);
    const I = this.g.index;
    for (let i = 0; i < ni; i++) I.array[this.ni + i] = gb.I.a[i] + this.nv;
    I.addUpdateRange(this.ni, ni); I.needsUpdate = true;
    this.nv += nv; this.ni += ni;
    this.g.setDrawRange(0, this.ni);
    return true;
  }
}

export function createDamage(ctx, W) {
  const { solids, buildings, shared, wall } = W;
  const state = shared.state; // DataTexture RGBA8 256 x N
  const sdata = state.image.data;
  const collapsing = [];
  const ruins = new DynGeo(260000, 520000);
  let callId = 0;
  const ruinMesh = new THREE.Mesh(ruins.g, shared.buildingMat);
  ruinMesh.castShadow = true; ruinMesh.receiveShadow = true; ruinMesh.name = 'ruins'; ruinMesh.frustumCulled = false;
  ctx.scene.add(ruinMesh);
  let stateDirty = false;
  const wallChunkGeo = makeBlockGeo();
  const blocks = new THREE.InstancedMesh(wallChunkGeo, shared.wallMat, 900);
  blocks.count = 0; blocks.castShadow = true; blocks.receiveShadow = true; blocks.name = 'wall-blocks';
  blocks.frustumCulled = false;
  ctx.scene.add(blocks);
  const piles = []; // rubble mounds {x,z,r,h}
  const pending = []; // fallback impacts if fx.projectile never calls back
  let lastWallRebuild = 0;
  const rng = new Rng(31337);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s4 = new THREE.Vector3(), p4 = new THREE.Vector3(), e4 = new THREE.Euler();

  function setTexel(id, r, g, b, a) {
    const o = id * 4;
    sdata[o] = r; sdata[o + 1] = g; sdata[o + 2] = b; sdata[o + 3] = a;
    stateDirty = true;
  }

  function addBlock(x, y, z, s, yaw = rng.range(0, 6.28), tilt = 0.4) {
    if (blocks.count >= blocks.instanceMatrix.count) return;
    e4.set(rng.range(-tilt, tilt), yaw, rng.range(-tilt, tilt));
    q4.setFromEuler(e4);
    s4.set(s * rng.range(0.8, 1.4), s * rng.range(0.6, 1.0), s * rng.range(0.8, 1.6));
    p4.set(x, y, z);
    m4.compose(p4, q4, s4);
    blocks.setMatrixAt(blocks.count++, m4);
    blocks.instanceMatrix.needsUpdate = true;
    blocks.instanceMatrix.addUpdateRange?.(0, blocks.count * 16);
  }

  // ---------------- buildings ----------------
  function collapse(b, from) {
    if (b.destroyed) return;
    b.destroyed = true;
    let lx = b.center.x - from.x, lz = b.center.z - from.z;
    const L = Math.hypot(lx, lz) || 1; lx /= L; lz /= L;
    collapsing.push({ b, t: 0, dur: rng.range(1.7, 2.6) * (b.tough ? 1.4 : 1), lx, lz, ruin: false });
    setTexel(b.id, 1, Math.round((lx * 0.5 + 0.5) * 255), Math.round((lz * 0.5 + 0.5) * 255), 0);
    for (const i of b.solids) solids.remove(i);
    b.solids.length = 0;
    const pos = new THREE.Vector3(b.lot.x, 2, b.lot.z);
    const size = Math.max(b.lot.w, b.lot.d);
    ctx.fx?.dust?.(pos, size * 1.4, { color: 0xb8a58a, duration: 4 });
    ctx.fx?.debris?.(new THREE.Vector3(b.lot.x, (b.eaveY || 8) * 0.7, b.lot.z), Math.round(10 + size), 9, { color: 0x6a4a36 });
    ctx.shake?.(0.45, { at: pos, radius: 160 });
    ctx.audio?.play?.('rubble', { position: pos, volume: 1 });
    ctx.events?.emit('building:collapse', { building: b, position: pos });
  }

  function damageBuildings(p, radius, force) {
    let n = 0;
    const stamp = ++callId;
    const R = radius + 12;
    solids.query(p.x - R, p.z - R, p.x + R, p.z + R, (i) => {
      const b = solids.ref[i];
      if (!b || !b.lot || b.destroyed || b._dmgStamp === stamp) return;
      b._dmgStamp = stamp;
      const d = Math.hypot(b.center.x - p.x, b.center.z - p.z);
      const reach = radius + b.radius * 0.55;
      if (d > reach) return;
      if (p.y > (b.ridgeY || b.height) + radius) return;
      const k = Math.min(1, 1 - (d - b.radius * 0.35) / reach) * force / (b.tough || 1);
      if (k < 0.12) return;
      b.hp -= k;
      n++;
      if (b.hp <= 0) collapse(b, p);
      else {
        // partial: puff of dust + a few tiles
        ctx.fx?.debris?.(new THREE.Vector3(b.center.x, b.eaveY || 6, b.center.z), 6, 6, { color: 0x7a3a2a });
      }
    });
    return n;
  }

  // ---------------- ruins ----------------
  function buildRuin(b) {
    const gb = new GB(3000);
    const r = new Rng(b.id * 977 + 5);
    const l = b.lot;
    gb.frame(l.x, 0, l.z, l.a);
    gb.set({ id: 0 });
    const hw = l.w / 2 - 0.15, hd = l.d / 2 - 0.15;
    const plaster = b.plaster || lin(0xd8c8a8), roof = b.roofTint || lin(0x7c3f2a);
    const big = b.tough ? 1.6 : 1;
    // jagged wall stumps (outer face with facade pattern, inner face plain)
    const walls = [[-hw, hd, hw, hd], [hw, -hd, -hw, -hd], [hw, hd, hw, -hd], [-hw, -hd, -hw, hd]];
    for (const [x0, z0, x1, z1] of walls) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(2, Math.round(len / 1.3));
      const hs = []; for (let k = 0; k <= n; k++) hs.push(Math.max(0.4, r.range(0.3, 1) * r.range(0.3, 1) * 5.5 * big + (k === 0 || k === n ? r.range(0.5, 3) : 0)));
      if (r.chance(0.3)) for (let k = 0; k <= n; k++) hs[k] = Math.min(hs[k], r.range(0.3, 1.2));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const ax = x0 + (x1 - x0) * t0, az = z0 + (z1 - z0) * t0, bx = x0 + (x1 - x0) * t1, bz = z0 + (z1 - z0) * t1;
        gb.set({ mat: 0, p0: len, p1: 3.5, p2: len / Math.max(1, Math.round(len / 2.4)), p3: 0 + 8 * (b.timber ? 1 : 0) + 64 * (b.wst || 0), col: plaster });
        gb.uOff = len * t0;
        gb.poly([[ax, 0, az], [bx, 0, bz], [bx, hs[k + 1], bz], [ax, hs[k], az]]);
        gb.uOff = 0;
        gb.set({ mat: 6, col: scalec(plaster, 0.7) });
        gb.poly([[bx, 0, bz], [ax, 0, az], [ax, hs[k], az], [bx, hs[k + 1], bz]]);
      }
    }
    // rubble mound (5x5 grid)
    const N = 5, mh = Math.min(3.2, 0.9 + (b.eaveY || 7) * 0.16) * big;
    const H = [];
    for (let i = 0; i <= N; i++) { H.push([]); for (let k = 0; k <= N; k++) { const u = i / N * 2 - 1, v = k / N * 2 - 1; const e = Math.max(0, 1 - Math.max(u * u, v * v)); H[i].push(e > 0 ? mh * Math.pow(e, 0.6) * r.range(0.6, 1.2) : r.range(0, 0.3)); } }
    const cols = [mixc(plaster, lin(0x6e6258), 0.4), roof, lin(0x5a5048)];
    for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) {
      const x0 = -hw - 1 + (2 * hw + 2) * (i / N), x1 = -hw - 1 + (2 * hw + 2) * ((i + 1) / N);
      const z0 = -hd - 1 + (2 * hd + 2) * (k / N), z1 = -hd - 1 + (2 * hd + 2) * ((k + 1) / N);
      gb.set({ mat: 6, col: r.pick(cols) });
      const P = [[x0, H[i][k], z0], [x0, H[i][k + 1], z1], [x1, H[i + 1][k + 1], z1], [x1, H[i + 1][k], z0]];
      gb.poly(P);
    }
    // broken beams
    gb.set({ mat: 2, p3: 0, col: lin(0x3a2416) });
    const nb = r.int(3, 7);
    for (let i = 0; i < nb; i++) {
      const L = r.range(2.5, 6);
      gb.obox(r.range(-hw, hw) * 0.7, mh * r.range(0.4, 0.9), r.range(-hd, hd) * 0.7, 0.13, 0.15, L / 2, rot3(r.range(0, 6.28), r.range(-0.9, 0.9), r.range(-0.3, 0.3)));
    }
    // fallen roof slab + tile chunks
    gb.set({ mat: 1, p3: 0, col: roof });
    const sw = Math.min(hw, hd) * 1.2;
    gb.obox(r.range(-1, 1), mh * 0.9, r.range(-1, 1), sw * 0.7, 0.12, sw * 0.5, rot3(r.range(0, 6.28), r.range(0.3, 0.7), r.range(-0.2, 0.2)));
    gb.set({ mat: 4, p2: 0.3, col: lin(0x8a8070) });
    for (let i = 0; i < 6; i++) gb.obox(r.range(-hw, hw), mh * r.range(0.2, 0.9), r.range(-hd, hd), r.range(0.3, 0.7), r.range(0.2, 0.45), r.range(0.3, 0.8), rot3(r.range(0, 6.28), r.range(-0.5, 0.5), r.range(-0.5, 0.5)));
    gb.frame();
    if (!ruins.append(gb)) console.warn('[world] ruins buffer full');
    // collision: low box over the rubble
    const fa = l.a;
    b.solids.push(solids.addBox(l.x, mh * 0.35, l.z, hw + 0.5, mh * 0.35, hd + 0.5, fa, 'building', b));
  }

  // ---------------- the wall ----------------
  function wallChunks(p, n, spread, speedOut) {
    const r = Math.hypot(p.x, p.z);
    const ox = p.x / r, oz = p.z / r;
    for (let i = 0; i < n; i++) {
      const pos = new THREE.Vector3(p.x + rng.range(-spread, spread), p.y + rng.range(-2, 2), p.z + rng.range(-spread, spread));
      const inward = rng.chance(0.7) ? -1 : 1;
      const sp = rng.range(4, speedOut);
      const vel = new THREE.Vector3(ox * inward * sp + rng.range(-4, 4), rng.range(-2, 8), oz * inward * sp + rng.range(-4, 4));
      const size = rng.range(1.2, 3.2);
      launch(pos, vel, size, 8 + size * 2, 1.2);
    }
  }
  function launch(pos, vel, size, dmgR, dmgF) {
    // ballistic landing estimate (ground y ~ 0) for the fallback
    const g = 9.81 * 1.6;
    const a = 0.5 * g, bq = -vel.y, c = -(pos.y - 0.5);
    const tLand = (-bq + Math.sqrt(Math.max(0, bq * bq - 4 * a * c))) / (2 * a);
    const land = new THREE.Vector3(pos.x + vel.x * tLand, 0, pos.z + vel.z * tLand);
    const rec = { at: ctx.clock.time + tLand + 0.6, point: land, done: false, size, dmgR, dmgF };
    pending.push(rec);
    const onImpact = (pt) => {
      if (rec.done) return; rec.done = true;
      impact(pt || land, size, dmgR, dmgF);
    };
    try { ctx.fx?.projectile?.({ pos: pos.clone(), vel: vel.clone(), size, onImpact }); } catch (e) { void e; }
  }
  function impact(pt, size, dmgR, dmgF) {
    const p = pt.clone ? pt.clone() : new THREE.Vector3(pt.x, pt.y, pt.z);
    damageBuildings(p, dmgR, dmgF);
    ctx.fx?.dust?.(p, 6 + size * 3, { color: 0xb0a08a });
    ctx.audio?.play?.('rubble', { position: p, volume: 0.8 });
    ctx.shake?.(0.35, { at: p, radius: 120 });
    const gh = W.groundHeightBase(p.x, p.z);
    if (Math.hypot(p.x, p.z) < WALL.R - 2) addBlock(p.x, gh + size * 0.3, p.z, size * 0.9);
  }

  function damage(p, radius = 6, force = 1) {
    if (!p) return 0;
    let n = 0;
    const r = Math.hypot(p.x, p.z);
    // wall top / face
    if (r > WALL.R - radius - 3 && r < WALL.RO + WALL.BATTER + radius + 3) {
      const bit = wall.bite(p, radius, force);
      const wid = wall.widen(p, radius, force);
      if (bit > 0 || wid > 0) {
        n++;
        ctx.fx?.dust?.(p.clone(), radius * 2.2, { color: 0xb5a78f });
        ctx.fx?.debris?.(p.clone(), 20 + Math.round(radius * 2), 14, { color: 0x9a9080 });
        ctx.audio?.play?.('wall_break', { position: p });
        ctx.shake?.(0.6, { at: p, radius: 250 });
        wallChunks(p, Math.min(8, 2 + Math.round((bit + wid * 3) / 6)), radius * 0.5, 12);
      } else if (p.y < WALL.H + 3) {
        ctx.fx?.dust?.(p.clone(), radius, { color: 0xb5a78f });
      }
    }
    n += damageBuildings(p, radius, force);
    return n;
  }

  // ---------------- the breach ----------------
  function breach() {
    wall.setBreached(true);
    wall.rebuild();
    const c = new THREE.Vector3(0, 12, WALL.R + 7);
    // rubble mounds spilling into the town and a little outside
    piles.push({ x: 0, z: WALL.R + 3, r: 30, h: 7.5 }, { x: -9, z: WALL.R - 16, r: 22, h: 4.2 }, { x: 10, z: WALL.R - 24, r: 17, h: 3 },
      { x: -2, z: WALL.R - 38, r: 14, h: 1.8 }, { x: 4, z: WALL.R + 22, r: 18, h: 3.2 }, { x: -18, z: WALL.R + 2, r: 12, h: 4 }, { x: 18, z: WALL.R - 2, r: 12, h: 4.5 });
    W.buildMound(piles);
    for (let i = 0; i < 70; i++) {
      const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * 34;
      const x = Math.cos(a) * d * 0.9, z = WALL.R - 8 + Math.sin(a) * d * 1.2;
      addBlock(x, W.groundHeightBase(x, z) + 0.3, z, rng.range(0.9, 2.6));
    }
    // flying chunks over the town
    for (let i = 0; i < 16; i++) {
      const pos = new THREE.Vector3(rng.range(-16, 16), rng.range(4, 30), WALL.R + rng.range(2, 10));
      const vel = new THREE.Vector3(rng.range(-14, 14), rng.range(8, 26), -rng.range(35, 85));
      const size = rng.range(2, 5);
      launch(pos, vel, size, 9 + size * 2.5, 1.6);
    }
    ctx.fx?.dust?.(c, 70, { color: 0xc0b098, duration: 8 });
    ctx.fx?.debris?.(c, 160, 40, { color: 0x9a9080 });
    ctx.fx?.explosion?.(c, 20);
    ctx.shake?.(1.3, { at: c, radius: 900, duration: 1.6 });
    ctx.audio?.play?.('wall_break', { position: c, volume: 1 });
    ctx.audio?.play?.('boom', { position: c, volume: 1 });
    ctx.events?.emit('wall:breached', { position: c });
  }

  function update(dt) {
    const t = ctx.clock.time;
    for (let i = collapsing.length - 1; i >= 0; i--) {
      const c = collapsing[i];
      c.t += dt;
      const p = Math.min(1, c.t / c.dur);
      const e = p * p * (3 - 2 * p);
      if (!c.ruin && p > 0.35) { c.ruin = true; buildRuin(c.b); }
      if (p >= 1) { setTexel(c.b.id, 255, 128, 128, 255); collapsing.splice(i, 1); continue; }
      setTexel(c.b.id, Math.max(1, Math.round(e * 255)), Math.round((c.lx * 0.5 + 0.5) * 255), Math.round((c.lz * 0.5 + 0.5) * 255), 0);
      if (Math.random() < dt * 6) ctx.fx?.dust?.(new THREE.Vector3(c.b.lot.x + (Math.random() - 0.5) * c.b.lot.w, 1 + Math.random() * 4, c.b.lot.z + (Math.random() - 0.5) * c.b.lot.d), 6 + Math.random() * 6, { color: 0xb8a58a });
    }
    if (stateDirty) { state.needsUpdate = true; stateDirty = false; }
    for (let i = pending.length - 1; i >= 0; i--) {
      const r = pending[i];
      if (r.done) { pending.splice(i, 1); continue; }
      if (t > r.at) { r.done = true; impact(r.point, r.size, r.dmgR, r.dmgF); pending.splice(i, 1); }
    }
    if (wall.hero.dirty && t - lastWallRebuild > 0.08) { lastWallRebuild = t; wall.rebuild(); }
    void _v;
  }

  return { damage, breach, update, collapse, addBlock, piles, ruinMesh, blocks, launch };
}

function makeBlockGeo() {
  const gb = new GB(64);
  const r = new Rng(3);
  const c = [];
  for (let i = 0; i < 8; i++) c.push([(i & 1 ? 0.5 : -0.5) + r.range(-0.08, 0.08), (i & 2 ? 0.5 : -0.5) + r.range(-0.08, 0.08), (i & 4 ? 0.5 : -0.5) + r.range(-0.08, 0.08)]);
  gb.set({ mat: 5, col: lin(0xb3a68f), p0: 1.0, p1: 0.3 });
  const F = [[1, 3, 7, 5], [0, 4, 6, 2], [2, 6, 7, 3], [0, 1, 5, 4], [4, 5, 7, 6], [0, 2, 3, 1]];
  for (const f of F) gb.poly(f.map((k) => c[k]));
  return gb.build();
}
