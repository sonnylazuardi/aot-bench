// Fleeing townspeople (ctx.titans.civilians): instanced rigid-part figures (≈13 draw calls for the whole crowd)
// with procedural run / cower / wave-for-help / flail-in-hand animations.
// API: list, nearest(pos, maxDist), pickUp(civ, hand), eaten(civ), release(civ), crush(pos, r), spawnCrowd(count, area)
// Events: 'civilian:grabbed' {civ}, 'civilian:eaten' {civ}
import * as THREE from 'three';

const MAX = 160;
const clamp = THREE.MathUtils.clamp;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const col = (h) => new THREE.Color(h);

const SKIN = ['#f0cdb0', '#e8c0a0', '#dcae8e', '#caa07e', '#f3d6bf'];
const TOP = ['#8a3b2e', '#3c5a7a', '#6b7a3a', '#a8894e', '#e4dccb', '#5a4a6a', '#7a5238', '#2f4a3a', '#9a4a2a', '#b8a888', '#44506a'];
const SKIRT = ['#5a3a2a', '#3a3a5a', '#7a2e2a', '#6a6a4a', '#4a5a6a', '#2e3a2e', '#6e4a5e'];
const PANTS = ['#4a3b2e', '#5a5a4a', '#3a3a3a', '#6a5a44', '#3e4550'];
const APRON = ['#ece6d8', '#ddd4bf', '#e6e0d0'];
const HAIR = ['#2a1a10', '#4a3020', '#7a5a30', '#161210', '#8a6a4a', '#a0a0a0', '#5a3a1e'];
const SCARF = ['#e6dece', '#8a3b2e', '#3c5a7a', '#c8b070', '#6b7a3a'];

// ---------------------------------------------------------------- geometry
function withColor(g, fn) {
  const p = g.attributes.position, n = p.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = fn ? fn(p.getX(i), p.getY(i), p.getZ(i)) : 1;
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
// capsule hanging down from the origin (pivot at top), length l
function limb(r0, r1, l, seg = 8) {
  const g = new THREE.CylinderGeometry(r0, r1, l, seg, 1, false);
  g.translate(0, -l / 2, 0);
  const top = new THREE.SphereGeometry(r0, seg, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const bot = new THREE.SphereGeometry(r1, seg, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); bot.translate(0, -l, 0);
  return merge([g, top, bot]);
}
function merge(gs) {
  const out = [];
  for (const g of gs) out.push(g.index ? g.toNonIndexed() : g);
  let n = 0; for (const g of out) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  let o = 0;
  for (const g of out) {
    pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return m;
}
function makeParts() {
  const P = {};
  P.pelvis = withColor(new THREE.SphereGeometry(0.17, 10, 6).scale(1.05, 0.75, 0.75));
  // torso: slightly tapered, pivot at the waist
  const torso = new THREE.CylinderGeometry(0.17, 0.15, 0.5, 10, 1).translate(0, 0.25, 0);
  const chest = new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.05, 0.5, 1).translate(0, 0.5, 0);
  P.torso = withColor(merge([torso, chest]).scale(1, 1, 0.7));
  // skirt / tunic hem: cone from the waist down (scaled per instance)
  P.skirt = withColor(new THREE.CylinderGeometry(0.19, 0.34, 1, 12, 1, true).translate(0, -0.5, 0));
  P.skirt.attributes.normal.array.forEach((v, i, a) => { if (i % 3 === 1) a[i] = 0.25; });
  // head + neck with painted face (vertex colours: eyes, brows, screaming mouth)
  const head = new THREE.SphereGeometry(0.105, 16, 12).scale(0.92, 1.12, 1.0).translate(0, 0.13, 0.005);
  const neck = new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8).translate(0, 0.03, 0);
  const nose = new THREE.ConeGeometry(0.018, 0.04, 6).rotateX(Math.PI / 2).translate(0, 0.125, 0.105);
  P.head = withColor(merge([head, neck, nose]), (x, y, z) => {
    if (z < 0.05) return 1;
    const ex = Math.abs(x) - 0.036, ey = y - 0.155;
    if (ex * ex / 0.00022 + ey * ey / 0.00012 < 1) return 0.12;       // eyes
    const bx = Math.abs(x) - 0.038, by = y - 0.185;
    if (bx * bx / 0.0006 + by * by / 0.00005 < 1) return 0.35;        // brows
    const my = y - 0.075;
    if (x * x / 0.0006 + my * my / 0.0005 < 1) return 0.06;           // screaming mouth
    return 1;
  });
  P.hair = withColor(new THREE.SphereGeometry(0.115, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(0.95, 1.1, 1.08).translate(0, 0.145, -0.012));
  // headscarf: cap + fall at the back
  const sc = new THREE.SphereGeometry(0.122, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.72).scale(0.98, 1.1, 1.08).translate(0, 0.135, -0.01);
  const fall = new THREE.CylinderGeometry(0.1, 0.13, 0.2, 10, 1, true, Math.PI * 0.5, Math.PI).translate(0, 0.03, -0.015);
  P.scarf = withColor(merge([sc, fall]));
  P.apron = withColor(new THREE.BoxGeometry(0.3, 0.62, 0.02).translate(0, -0.3, 0.21));
  P.upperArm = withColor(limb(0.052, 0.045, 0.28));
  P.foreArm = withColor(merge([limb(0.043, 0.036, 0.24), new THREE.SphereGeometry(0.045, 8, 6).scale(0.8, 1.2, 0.5).translate(0, -0.3, 0)]));
  P.thigh = withColor(limb(0.072, 0.058, 0.43));
  P.shin = withColor(limb(0.056, 0.045, 0.41));
  P.foot = withColor(new THREE.BoxGeometry(0.1, 0.07, 0.24).translate(0, -0.035, 0.06));
  return P;
}

// ---------------------------------------------------------------- system
export function createCivilians(ctx) {
  const parts = makeParts();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const matSkin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
  // [name, count per civ]
  const DEF = [['pelvis', 1], ['torso', 1], ['skirt', 1], ['head', 1, matSkin], ['hair', 1], ['scarf', 1], ['apron', 1],
    ['upperArm', 2], ['foreArm', 2], ['thigh', 2], ['shin', 2], ['foot', 2]];
  const IM = {};
  const group = new THREE.Group(); group.name = 'civilians';
  for (const [name, n, m] of DEF) {
    const im = new THREE.InstancedMesh(parts[name], m || mat, MAX * n);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
    im.count = 0;
    for (let i = 0; i < MAX * n; i++) im.setColorAt(i, col('#ffffff'));
    IM[name] = im;
    group.add(im);
  }
  ctx.scene.add(group);

  const list = [];
  const slots = [];
  for (let i = MAX - 1; i >= 0; i--) slots.push(i);
  let nextId = 1;
  const ground = (x, z) => ctx.world?.groundHeight?.(x, z) ?? 0;
  const L = ctx.LAYOUT;

  // ---- building index for cheap avoidance ----
  let bIndex = null, bCount = -1;
  const CELL = 24;
  function buildingsNear(x, z) {
    const bs = ctx.world?.buildings;
    if (!bs || !bs.length) return null;
    if (!bIndex || bCount !== bs.length) {
      bIndex = new Map(); bCount = bs.length;
      for (const b of bs) {
        if (!b.box) continue;
        const x0 = Math.floor(b.box.min.x / CELL), x1 = Math.floor(b.box.max.x / CELL), z0 = Math.floor(b.box.min.z / CELL), z1 = Math.floor(b.box.max.z / CELL);
        for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
          const k = i * 10007 + j;
          if (!bIndex.has(k)) bIndex.set(k, []);
          bIndex.get(k).push(b);
        }
      }
    }
    return bIndex.get(Math.floor(x / CELL) * 10007 + Math.floor(z / CELL)) || null;
  }

  function dress(c) {
    const female = Math.random() < 0.5;
    c.female = female;
    c.kid = Math.random() < 0.12;
    c.scale = c.kid ? rnd(0.6, 0.75) : rnd(0.92, 1.08) * (female ? 0.95 : 1);
    c.col = {
      skin: col(pick(SKIN)), top: col(pick(TOP)), skirt: col(pick(SKIRT)), pants: col(pick(PANTS)),
      apron: col(pick(APRON)), hair: col(pick(HAIR)), scarf: col(pick(SCARF)), shoe: col('#2a2018'),
    };
    c.hasSkirt = female ? 1 : (Math.random() < 0.6 ? 0.36 : 0.0); // tunic hem for some men
    c.hasApron = female ? Math.random() < 0.5 : Math.random() < 0.15;
    c.hasScarf = female && Math.random() < 0.55;
    c.sleeve = Math.random() < 0.7; // long sleeves
  }

  function spawnOne(pos, o = {}) {
    if (!slots.length) return null;
    const slot = slots.pop();
    const c = {
      id: nextId++, slot, position: pos.clone(), alive: true, state: o.state || 'flee', object: null,
      yaw: rnd(-Math.PI, Math.PI), speed: 0, maxSpeed: rnd(3.6, 6.2), phase: Math.random(), t: 0,
      goal: new THREE.Vector3(), goalT: 0, hand: null, holdOff: new THREE.Vector3(), screamT: rnd(0.5, 4), stumble: 0,
      fall: null, cowerK: 0, waveK: 0, seed: Math.random() * 100, roof: !!o.roof,
      home: pos.clone(), idle: rnd(0, 3), lookAt: null, lookFor: 0, point: false,
    };
    dress(c);
    // a proxy Object3D so other systems can parent / read transforms
    c.object = new THREE.Object3D();
    c.object.position.copy(c.position);
    if (c.kid) c.maxSpeed *= 0.8;
    list.push(c);
    colorize(c);
    return c;
  }
  function colorize(c) {
    const s = c.slot, C = c.col;
    const top = C.top;
    IM.pelvis.setColorAt(s, c.hasSkirt > 0.5 ? C.skirt : C.pants);
    IM.torso.setColorAt(s, top);
    IM.skirt.setColorAt(s, c.female ? C.skirt : top);
    IM.head.setColorAt(s, C.skin);
    IM.hair.setColorAt(s, C.hair);
    IM.scarf.setColorAt(s, C.scarf);
    IM.apron.setColorAt(s, C.apron);
    for (let k = 0; k < 2; k++) {
      IM.upperArm.setColorAt(s * 2 + k, top);
      IM.foreArm.setColorAt(s * 2 + k, C.skin); // rolled sleeves, bare forearms
      IM.thigh.setColorAt(s * 2 + k, C.pants);
      IM.shin.setColorAt(s * 2 + k, c.female ? C.skin.clone().multiplyScalar(0.92) : C.pants);
      IM.foot.setColorAt(s * 2 + k, C.shoe);
    }
    for (const k in IM) if (IM[k].instanceColor) IM[k].instanceColor.needsUpdate = true;
  }

  // spawnCrowd(count, area): area = {center:Vector3, radius} | {min:Vector3, max:Vector3}; opts.roofFrac
  function spawnCrowd(count = 60, area = null, opts = {}) {
    const center = area?.center || new THREE.Vector3(0, 0, 300);
    const radius = area?.radius ?? 70;
    const roofFrac = opts.roofFrac ?? 0.12;
    const out = [];
    const bs = ctx.world?.buildings || [];
    const roofCands = bs.filter((b) => b.box && !b.destroyed && b.center && b.center.distanceTo?.(center) < radius * 1.2 && b.height > 5 && b.height < 22);
    for (let i = 0; i < count; i++) {
      let p = null, roof = false;
      if (roofCands.length && Math.random() < roofFrac) {
        const b = pick(roofCands);
        p = new THREE.Vector3(rnd(b.box.min.x + 1, b.box.max.x - 1), b.box.max.y - 0.3, rnd(b.box.min.z + 1, b.box.max.z - 1));
        roof = true;
      } else {
        for (let k = 0; k < 12; k++) {
          const q = area?.min ? new THREE.Vector3(rnd(area.min.x, area.max.x), 0, rnd(area.min.z, area.max.z))
            : new THREE.Vector3(center.x + rnd(-1, 1) * radius, 0, center.z + rnd(-1, 1) * radius);
          if (q.x * q.x + q.z * q.z > (L.townRadius - 4) ** 2) continue;
          if (insideBuilding(q.x, q.z, 0.4)) continue;
          p = q; break;
        }
        if (!p) continue;
        p.y = ground(p.x, p.z);
      }
      const c = spawnOne(p, { state: roof ? 'trapped' : (opts.state || 'flee'), roof });
      if (c) out.push(c);
    }
    return out;
  }

  function insideBuilding(x, z, pad = 0) {
    const bl = buildingsNear(x, z);
    if (!bl) return null;
    for (const b of bl) {
      if (b.destroyed) continue;
      if (x > b.box.min.x - pad && x < b.box.max.x + pad && z > b.box.min.z - pad && z < b.box.max.z + pad) return b;
    }
    return null;
  }

  function nearest(pos, maxDist = Infinity) {
    let best = null, bd = maxDist;
    for (const c of list) {
      if (!c.alive || c.state === 'grabbed') continue;
      const d = c.position.distanceTo(pos);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  function pickUp(c, hand) {
    if (!c || !c.alive) return false;
    c.state = 'grabbed'; c.hand = hand; c.t = 0;
    c.holdOff.set(rnd(-0.3, 0.3), rnd(-0.2, 0.3), rnd(-0.3, 0.3));
    ctx.audio?.play?.('scream', { position: c.position, volume: 1, rate: c.female || c.kid ? rnd(1.05, 1.3) : rnd(0.85, 1.05) });
    ctx.events.emit('civilian:grabbed', { civ: c });
    return true;
  }
  function release(c) {
    if (!c || c.state !== 'grabbed') return;
    c.state = 'falling'; c.hand = null; c.vel = new THREE.Vector3(0, 0, 0);
  }
  function kill(c, burst = 1) {
    if (!c.alive) return;
    c.alive = false; c.state = 'dead';
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 2 + burst; i++) ctx.fx?.blood?.(c.position.clone().add(new THREE.Vector3(rnd(-0.3, 0.3), 1 + rnd(-0.3, 0.3), rnd(-0.3, 0.3))), up.clone().add(new THREE.Vector3(rnd(-1, 1), rnd(0, 1), rnd(-1, 1))).normalize());
    hide(c);
    const i = list.indexOf(c); if (i >= 0) list.splice(i, 1);
    slots.push(c.slot);
  }
  function eaten(c) {
    if (!c || !c.alive) return;
    ctx.audio?.play?.('crunch', { position: c.position, volume: 1 });
    kill(c, 3);
    ctx.events.emit('civilian:eaten', { civ: c });
  }
  function crush(pos, r) {
    let n = 0;
    for (const c of list.slice()) if (c.alive && c.state !== 'grabbed' && c.position.distanceTo(pos) < r) { kill(c, 1); n++; }
    return n;
  }
  const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
  function hide(c) {
    const s = c.slot;
    for (const [name, n] of DEF) for (let k = 0; k < n; k++) IM[name].setMatrixAt(s * n + k, _zero);
  }

  // ---------------------------------------------------------------- simulation
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _gp = new THREE.Vector3();
  function giantPos() {
    const G = ctx.colossal;
    if (G && G.active && G.object) return G.object.getWorldPosition ? G.object.getWorldPosition(_gp) : G.object.position;
    return null;
  }
  function steer(c, dt) {
    const G = giantPos();
    const p = c.position;
    // flee: away from the giant, generally north toward the inner gate, drifting to the avenue
    c.goalT -= dt;
    if (c.goalT <= 0) {
      c.goalT = rnd(1.5, 3.5);
      _v.set(clamp(p.x * 0.6, -40, 40) + rnd(-12, 12), 0, p.z - 50);
      if (G) {
        _v2.set(p.x - G.x, 0, p.z - G.z);
        const d = _v2.length();
        if (d < 160) { _v2.normalize().multiplyScalar(40 * (1 - d / 160)); _v.add(_v2); }
      }
      c.goal.copy(_v);
    }
    const want = Math.atan2(c.goal.x - p.x, c.goal.z - p.z);
    let dh = want - c.yaw; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    c.yaw += clamp(dh, -4 * dt, 4 * dt);
    c.speed = THREE.MathUtils.damp(c.speed, c.maxSpeed * (c.stumble > 0 ? 0.2 : 1), 3, dt);
    let nx = p.x + Math.sin(c.yaw) * c.speed * dt, nz = p.z + Math.cos(c.yaw) * c.speed * dt;
    const b = insideBuilding(nx, nz, 0.35);
    if (b) {
      // slide along the building: pick the tangent closest to the heading
      const cx = (b.box.min.x + b.box.max.x) / 2, cz = (b.box.min.z + b.box.max.z) / 2;
      const hx = (b.box.max.x - b.box.min.x) / 2, hz = (b.box.max.z - b.box.min.z) / 2;
      const ox = (p.x - cx) / hx, oz = (p.z - cz) / hz;
      if (Math.abs(ox) > Math.abs(oz)) { nx = p.x; c.yaw = Math.sin(c.yaw) * 0 + (Math.cos(c.yaw) >= 0 ? 0 : Math.PI); }
      else { nz = p.z; c.yaw = Math.sin(c.yaw) >= 0 ? Math.PI / 2 : -Math.PI / 2; }
      if (insideBuilding(nx, nz, 0.3)) { nx = p.x; nz = p.z; c.goalT = 0; }
    }
    // stay inside the town
    const rr = Math.hypot(nx, nz);
    if (rr > L.townRadius) { nx *= L.townRadius / rr; nz *= L.townRadius / rr; }
    p.x = nx; p.z = nz;
    p.y = THREE.MathUtils.damp(p.y, ground(p.x, p.z), 12, dt);
    if (Math.random() < dt * 0.02) c.stumble = rnd(0.5, 1.1);
    c.stumble = Math.max(0, c.stumble - dt);
    // separation
  }

  // ---------------------------------------------------------------- posing
  const M = new THREE.Matrix4(), Mroot = new THREE.Matrix4(), Mp = new THREE.Matrix4(), Mt = new THREE.Matrix4(), Ma = new THREE.Matrix4(), Mb = new THREE.Matrix4();
  const Q = new THREE.Quaternion(), E = new THREE.Euler(), S1 = new THREE.Vector3(1, 1, 1), T = new THREE.Vector3(), SC = new THREE.Vector3();
  const local = (x, y, z, rx, ry, rz, out, sx = 1, sy = 1, sz = 1) => out.compose(T.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz, 'YXZ')), SC.set(sx, sy, sz));

  function pose(c, time) {
    const s = c.slot;
    const st = c.state;
    const run = st === 'flee' ? clamp(c.speed / 4, 0, 1.3) : st === 'calm' ? clamp(c.speed / 4, 0, 0.35) : 0;
    const ph = c.phase * Math.PI * 2;
    const flail = st === 'grabbed' || st === 'falling' ? 1 : 0;
    const cower = c.cowerK, wave = c.waveK;
    const tt = time * 1 + c.seed;
    // pose parameters
    let lean = run * 0.32 + cower * 0.5, bob = Math.abs(Math.sin(ph)) * 0.06 * run, hipsY = 0.95 - cower * 0.42 + bob;
    let twist = Math.sin(ph) * 0.25 * run + flail * Math.sin(tt * 7) * 0.4;
    let legL = Math.sin(ph) * 0.85 * run, legR = -Math.sin(ph) * 0.85 * run;
    let kneeL = (0.2 + Math.max(0, -Math.cos(ph)) * 1.3) * run, kneeR = (0.2 + Math.max(0, Math.cos(ph)) * 1.3) * run;
    let armL = legL * 0.9, armR = legR * 0.9, elbL = 1.3 * run + 0.2, elbR = 1.3 * run + 0.2, spreadL = 0.15, spreadR = 0.15;
    let headP = -lean * 0.6 + flail * -0.4 + Math.sin(tt * 1.7) * 0.05, headY = Math.sin(tt * 0.9) * 0.3 * (1 - run);
    if (cower > 0.01) {
      legL = legL * (1 - cower) + cower * -1.4; legR = legR * (1 - cower) + cower * -1.2;
      kneeL = kneeL * (1 - cower) + cower * 2.3; kneeR = kneeR * (1 - cower) + cower * 2.2;
      armL = armL * (1 - cower) + cower * -2.6; armR = armR * (1 - cower) + cower * -2.6;
      elbL = elbL * (1 - cower) + cower * 2.2; elbR = elbR * (1 - cower) + cower * 2.2;
      spreadL = spreadR = 0.3 * cower + 0.15;
      headP += cower * 0.6;
      twist += Math.sin(tt * 30) * 0.02 * cower; // trembling
    }
    if (wave > 0.01) {
      armL = armL * (1 - wave) + wave * (-2.7 + Math.sin(tt * 6) * 0.35);
      armR = armR * (1 - wave) + wave * (-2.7 + Math.sin(tt * 6 + 2) * 0.35);
      elbL = elbL * (1 - wave) + wave * 0.3; elbR = elbR * (1 - wave) + wave * 0.3;
      spreadL = spreadR = 0.5 * wave + 0.15;
      headP -= wave * 0.35;
    }
    if (flail) {
      legL = Math.sin(tt * 11) * 0.9; legR = Math.sin(tt * 11 + 2.4) * 0.9;
      kneeL = 0.6 + Math.sin(tt * 11 + 1) * 0.6; kneeR = 0.6 + Math.sin(tt * 11 + 3.4) * 0.6;
      armL = -2.2 + Math.sin(tt * 8) * 1.0; armR = -1.8 + Math.sin(tt * 9 + 1.3) * 1.0;
      elbL = 0.6 + Math.sin(tt * 10) * 0.5; elbR = 0.8 + Math.sin(tt * 9.5 + 2) * 0.5;
      spreadL = 0.6 + Math.sin(tt * 6) * 0.4; spreadR = 0.6 + Math.sin(tt * 7 + 1) * 0.4;
      lean = -0.2 + Math.sin(tt * 5) * 0.25; hipsY = 0.95;
    }
    if (st === 'dying') { lean = 1.5; hipsY = 0.3; }
    // root
    const sc = c.scale;
    Mroot.compose(c.position, Q.setFromEuler(E.set(0, c.yaw, 0)), SC.set(sc, sc, sc));
    if (flail && c.hand) {
      // hanging from the giant's fist: upright-ish, swinging
      Mroot.compose(c.position, Q.setFromEuler(E.set(Math.sin(tt * 3) * 0.3, c.yaw, Math.sin(tt * 2.3) * 0.35)), SC.set(sc, sc, sc));
    }
    // pelvis
    local(0, hipsY, 0, lean * 0.3, twist * 0.5, 0, M); Mp.multiplyMatrices(Mroot, M);
    IM.pelvis.setMatrixAt(s, Mp);
    // skirt / hem (scaled by type)
    if (c.hasSkirt > 0) {
      const len = c.female ? 0.82 : c.hasSkirt;
      local(0, 0.04, 0, -lean * 0.3 + run * 0.1, 0, 0, M, 1 + run * 0.15, len, 1 + run * 0.2); Mt.multiplyMatrices(Mp, M);
      IM.skirt.setMatrixAt(s, Mt);
    } else IM.skirt.setMatrixAt(s, _zero);
    if (c.hasApron) { local(0, 0.08, 0.0, -lean * 0.2, 0, 0, M, 1, c.female ? 1 : 0.7, 1); Mt.multiplyMatrices(Mp, M); IM.apron.setMatrixAt(s, Mt); }
    else IM.apron.setMatrixAt(s, _zero);
    // torso
    local(0, 0.07, 0, lean * 0.7, twist, Math.sin(ph) * 0.05 * run, M); Mt.multiplyMatrices(Mp, M);
    IM.torso.setMatrixAt(s, Mt);
    // head
    local(0, 0.55, 0.0, headP, headY - twist * 0.5, 0, M); Ma.multiplyMatrices(Mt, M);
    IM.head.setMatrixAt(s, Ma);
    IM.hair.setMatrixAt(s, c.hasScarf ? _zero : Ma);
    IM.scarf.setMatrixAt(s, c.hasScarf ? Ma : _zero);
    // arms
    for (let k = 0; k < 2; k++) {
      const sx = k === 0 ? 1 : -1;
      const a = k === 0 ? armL : armR, e = k === 0 ? elbL : elbR, sp = k === 0 ? spreadL : spreadR;
      local(sx * 0.2, 0.47, 0, a, 0, sx * sp, M); Ma.multiplyMatrices(Mt, M);
      IM.upperArm.setMatrixAt(s * 2 + k, Ma);
      local(0, -0.28, 0, -e, 0, 0, M); Mb.multiplyMatrices(Ma, M);
      IM.foreArm.setMatrixAt(s * 2 + k, Mb);
    }
    // legs
    for (let k = 0; k < 2; k++) {
      const sx = k === 0 ? 1 : -1;
      const lg = k === 0 ? legL : legR, kn = k === 0 ? kneeL : kneeR;
      local(sx * 0.095, -0.02, 0, -lg - lean * 0.3, 0, sx * (0.04 + flail * 0.2), M); Ma.multiplyMatrices(Mp, M);
      IM.thigh.setMatrixAt(s * 2 + k, Ma);
      local(0, -0.43, 0, kn, 0, 0, M); Mb.multiplyMatrices(Ma, M);
      IM.shin.setMatrixAt(s * 2 + k, Mb);
      local(0, -0.41, 0, -kn * 0.5 + lg * 0.3 + (flail ? 0.4 : 0), 0, 0, M); M.premultiply(Mb);
      IM.foot.setMatrixAt(s * 2 + k, M);
    }
    c.object.position.copy(c.position);
  }

  function update(dt, time) {
    const G = giantPos();
    let maxIdx = 0;
    for (const c of list) {
      c.t += dt;
      if (c.state === 'calm') {
        // strolling townsfolk (before the attack)
        c.goalT -= dt;
        if (c.goalT <= 0 || c.position.distanceTo(c.goal) < 1.5) {
          c.goalT = rnd(4, 9);
          c.goal.set(c.home.x + rnd(-14, 14), 0, c.home.z + rnd(-14, 14));
          if (insideBuilding(c.goal.x, c.goal.z, 0.5)) c.goal.copy(c.home);
        }
        const want = Math.atan2(c.goal.x - c.position.x, c.goal.z - c.position.z);
        let dh = want - c.yaw; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        c.yaw += clamp(dh, -1.5 * dt, 1.5 * dt);
        const v = c.idle > 0 ? 0 : 1.25 * c.scale;
        c.idle -= dt; if (c.idle < -rnd(3, 8)) c.idle = rnd(1, 4);
        const nx = c.position.x + Math.sin(c.yaw) * v * dt, nz = c.position.z + Math.cos(c.yaw) * v * dt;
        if (!insideBuilding(nx, nz, 0.3)) { c.position.x = nx; c.position.z = nz; } else c.goalT = 0;
        c.position.y = ground(c.position.x, c.position.z);
        c.speed = v; c.phase += dt * v / (1.5 * c.scale);
      } else if (c.state === 'look') {
        // frozen, staring at something terrible
        if (c.lookAt) { const want = Math.atan2(c.lookAt.x - c.position.x, c.lookAt.z - c.position.z); let dh = want - c.yaw; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); c.yaw += clamp(dh, -3 * dt, 3 * dt); }
        c.speed = THREE.MathUtils.damp(c.speed, 0, 6, dt);
        c.waveK = THREE.MathUtils.damp(c.waveK, c.point ? 0.5 : 0, 4, dt);
        if (c.t > c.lookFor) { c.state = 'flee'; c.goalT = 0; c.waveK = 0; }
      } else if (c.state === 'flee') {
        steer(c, dt);
        c.phase += dt * (c.speed / (1.9 * c.scale));
        c.cowerK = THREE.MathUtils.damp(c.cowerK, 0, 6, dt);
        // freeze in terror sometimes when the giant is close
        if (G && Math.random() < dt * 0.05 && c.position.distanceTo(G) < 90) { c.state = 'cower'; c.t = 0; c.speed = 0; }
      } else if (c.state === 'cower') {
        c.cowerK = THREE.MathUtils.damp(c.cowerK, 1, 5, dt);
        if (c.t > rnd(2, 5)) c.state = 'flee';
      } else if (c.state === 'trapped') {
        // on a rooftop: wave for help, then cower
        const w = Math.sin(c.t * 0.35 + c.seed) > -0.2;
        c.waveK = THREE.MathUtils.damp(c.waveK, w ? 1 : 0, 3, dt);
        c.cowerK = THREE.MathUtils.damp(c.cowerK, w ? 0 : 1, 3, dt);
        if (G) c.yaw = Math.atan2(G.x - c.position.x, G.z - c.position.z) + Math.sin(c.t * 0.5 + c.seed) * 0.8;
      } else if (c.state === 'grabbed' && c.hand) {
        c.hand.updateWorldMatrix?.(true, false);
        c.hand.getWorldPosition(c.position);
        // hang below the fist
        c.position.y -= 1.0 * c.scale;
        c.position.add(c.holdOff);
        c.yaw += dt * Math.sin(c.t * 1.3) * 0.8;
      } else if (c.state === 'falling') {
        c.vel.y -= 9.8 * dt;
        c.position.addScaledVector(c.vel, dt);
        const gy = ground(c.position.x, c.position.z);
        if (c.position.y <= gy) { c.position.y = gy; if (c.vel.y < -12) { kill(c, 2); continue; } c.state = 'cower'; c.t = 0; }
      }
      // screams
      c.screamT -= dt;
      if (c.screamT < 0) {
        c.screamT = c.state === 'grabbed' ? rnd(0.8, 1.6) : rnd(4, 12);
        const near = !G || c.position.distanceTo(G) < 120 || c.state === 'grabbed';
        if (near && Math.random() < (c.state === 'grabbed' ? 1 : 0.35)) ctx.audio?.play?.('scream', { position: c.position, volume: c.state === 'grabbed' ? 1 : 0.5, rate: c.female || c.kid ? rnd(1.05, 1.35) : rnd(0.8, 1.05) });
      }
      pose(c, time);
      maxIdx = Math.max(maxIdx, c.slot + 1);
    }
    for (const [name, n] of DEF) { IM[name].count = Math.max(IM[name].count, maxIdx * n); IM[name].instanceMatrix.needsUpdate = true; }
  }

  // everyone stops and stares at `pos` for a few seconds, then flees
  function look(pos, secs = 3) {
    for (const c of list) if (c.alive && (c.state === 'calm' || c.state === 'flee')) { c.state = 'look'; c.t = 0; c.lookAt = pos.clone(); c.lookFor = secs * rnd(0.6, 1.3); c.point = Math.random() < 0.25; }
  }
  function panic() {
    for (const c of list) if (c.alive && (c.state === 'calm' || c.state === 'look' || c.state === 'cower')) { c.state = 'flee'; c.goalT = 0; c.speed = rnd(1, 3); c.waveK = 0; }
  }
  function clear() { for (const c of list.slice()) { hide(c); c.alive = false; slots.push(c.slot); } list.length = 0; }
  return { list, group, spawnCrowd, spawn: spawnOne, nearest, pickUp, release, eaten, crush, update, kill, look, panic, clear };
}
