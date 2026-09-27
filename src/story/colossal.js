// ctx.colossal — the enemy giant: a ~70 m SMILING PURE TITAN boss.
// Sculpted SDF body (built in parallel workers) -> skinned meshes on a procedural rig (colossalRig.js),
// driven by the boss brain (colossalBrain.js). Owns steam (vapor.js + ctx.fx.steam), hookable/collidable
// capsules ('colossal' raycaster/collider with anchor+local), weak points and the public boss API.
import * as THREE from 'three';
import { buildSkeletonDefs, teethLayout, EYES, HEAD_C, H, EYE_X } from './colossalBody.js';
import { createSkinMaterial, createHairMaterial, createEyeMaterial, createTeethMaterial, updateLightingUniforms } from './muscleMaterial.js';
import { buildPartArrays, PARTS, BUILD_VERSION } from './colossalBuild.js';
import { createRig } from './colossalRig.js';
import { createBrain } from './colossalBrain.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getVapor } from './vapor.js';
import { fetchBaked } from '../core/bake.js';

const clamp = THREE.MathUtils.clamp;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------- geometry build (workers in parallel, IndexedDB cache, main-thread fallback) ----------
function idb() {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('aot-giant', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('parts');
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    } catch { res(null); }
  });
}
const idbGet = (db, k) => new Promise((res) => { try { const q = db.transaction('parts').objectStore('parts').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch { res(null); } });
const idbPut = (db, k, v) => { try { db.transaction('parts', 'readwrite').objectStore('parts').put(v, k); } catch {} };
async function buildAll(quality) {
  const q = quality === 'low' ? 1.35 : quality === 'medium' ? 1.12 : 1;
  const Q = { body: 1.35 * q, head: 1.38 * q, handL: 1.15 * q, handR: 1.15 * q, hair: 1.75 * q };
  const dev = !!import.meta.env?.DEV;
  const db = dev ? null : await idb();   // dev: the bake server is always fresh; IDB (keyed by BUILD_VERSION) could be stale
  const out = {};
  await Promise.all(PARTS.map(async (name) => {
    try { const baked = await fetchBaked('colossal', [name, Q[name]]); if (baked && baked.index) { out[name] = baked; return; } } catch {}
    const key = `${BUILD_VERSION}:${name}:${Q[name].toFixed(3)}`;
    if (db) { const c = await idbGet(db, key); if (c && c.index) { out[name] = c; return; } }
    let r = null;
    try {
      r = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('./colossalWorker.js', import.meta.url), { type: 'module' });
        const to = setTimeout(() => { w.terminate(); reject(new Error('worker timeout')); }, 90000);
        w.onmessage = (e) => { clearTimeout(to); w.terminate(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data); };
        w.onerror = (e) => { clearTimeout(to); w.terminate(); reject(e); };
        w.postMessage({ name, q: Q[name] });
      });
    } catch (e) {
      console.warn('[colossal] worker build failed, main thread fallback', name, e?.message || e);
      r = buildPartArrays(name, Q[name]);
    }
    out[name] = r;
    if (db) idbPut(db, key, r);
  }));
  return out;
}
function toGeometry(a) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(a.skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(a.skinWeight, 4));
  g.setAttribute('fibre', new THREE.BufferAttribute(a.fibre, 3));
  g.setAttribute('mdata', new THREE.BufferAttribute(a.mdata, 4));
  g.setAttribute('mdata2', new THREE.BufferAttribute(a.mdata2, 4));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  g.computeBoundingSphere();
  return g;
}

let pre = null;
export function prewarm(ctx) { pre ||= buildAll(ctx.quality?.level); }

export async function create(ctx) {
  const { LAYOUT, scene } = ctx;
  const t0 = performance.now();
  const K = (LAYOUT.colossal.height / 60) * 38;           // model (1.8 m human) -> world  (~70 m giant)
  const W = LAYOUT.wall;
  const ZF = W.radius + W.thickness + 17;                 // feet right against the outer face so it can lean over and grip the top
  const X0 = LAYOUT.colossal.x;

  // ---------- skeleton ----------
  const { bones: bdefs, index: bi } = buildSkeletonDefs();
  const bones = bdefs.map((d) => { const b = new THREE.Bone(); b.name = d.name; return b; });
  bdefs.forEach((d, i) => {
    if (d.parent < 0) bones[i].position.set(...d.pos);
    else { const p = bdefs[d.parent].pos; bones[i].position.set(d.pos[0] - p[0], d.pos[1] - p[1], d.pos[2] - p[2]); bones[d.parent].add(bones[i]); }
  });
  const root = new THREE.Group(); root.name = 'colossal';
  root.add(bones[0]);
  root.scale.setScalar(K);
  root.rotation.y = Math.PI;
  root.position.set(X0, 0, ZF);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const bone = (n) => bones[bi[n]];
  const bindPos = (n) => new THREE.Vector3(...bdefs[bi[n]].pos);

  // ---------- meshes ----------
  const arrays = await (pre || buildAll(ctx.quality?.level));
  const skin = createSkinMaterial(new THREE.Vector3(...H(EYE_X, -0.014, 0.084)), new THREE.Vector3(...H(-EYE_X, -0.014, 0.084)), new THREE.Vector3(0.036, 0.021, 0.03).multiplyScalar(1.14));
  const hairMat = createHairMaterial(H(0, -0.12, 0)[1]);
  const heroFog = (m, k = 0.4) => { m.defines = { ...(m.defines || {}), AOT_FOG_K: k }; m.needsUpdate = true; return m; };
  heroFog(skin); heroFog(hairMat);
  const mats = [skin, hairMat];
  const meshes = [];
  let tris = 0;
  for (const name of PARTS) {
    const a = arrays[name]; if (!a) continue;
    const g = toGeometry(a);
    const m = new THREE.SkinnedMesh(g, name === 'hair' ? hairMat : skin);
    m.name = 'giant_' + name; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    root.add(m);
    m.bind(skeleton);
    meshes.push(m);
    tris += g.index.count / 3;
  }
  // teeth: flat human teeth, clenched in the grin
  const teethMat = heroFog(createTeethMaterial());
  const toothGeos = { up: [], lo: [] };
  const headBP = bindPos('head'), jawBP = bindPos('jaw');
  for (const t of teethLayout()) {
    const g = new RoundedBoxGeometry(t.w * 0.93, t.h, 0.0085 * 1.14, 2, Math.min(0.0022, t.w * 0.2));
    const pos = g.attributes.position, cols = [];
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const fromRoot = t.upper ? (0.5 - y / t.h) : (0.5 + y / t.h);
      pos.setZ(i, pos.getZ(i) * (1 - 0.3 * fromRoot));
      const k = 0.7 + 0.3 * sstep(0.0, 0.45, fromRoot);
      const stain = 0.92 + 0.08 * Math.sin(t.i * 3.1 + (t.upper ? 1 : 2));
      cols.push(0.92 * k * stain, 0.86 * k * stain, 0.74 * k);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const m4 = new THREE.Matrix4().makeBasis(new THREE.Vector3(...t.tangent), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...t.outward));
    const c = new THREE.Vector3(...t.pos);
    m4.setPosition(c.sub(t.upper ? headBP : jawBP));
    g.applyMatrix4(m4); g.deleteAttribute('uv');
    (t.upper ? toothGeos.up : toothGeos.lo).push(g);
  }
  const teethUp = new THREE.Mesh(mergeGeometries(toothGeos.up), teethMat);
  const teethLo = new THREE.Mesh(mergeGeometries(toothGeos.lo), teethMat);
  for (const m of [teethUp, teethLo]) { m.castShadow = true; m.frustumCulled = false; }
  bone('head').add(teethUp); bone('jaw').add(teethLo);
  // mouth interior: dark gullet so gaps between teeth read black, not see-through
  const gullet = new THREE.Mesh(new THREE.SphereGeometry(0.045 * 1.14, 20, 14), heroFog(new THREE.MeshStandardMaterial({ color: 0x1a0504, roughness: 0.6 })));
  gullet.scale.set(1.2, 0.55, 0.8);
  gullet.position.copy(new THREE.Vector3(...H(0, -0.098, 0.05)).sub(headBP));
  bone('head').add(gullet);
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(0.03 * 1.14, 18, 10), heroFog(new THREE.MeshPhysicalMaterial({ color: 0x8a2a28, roughness: 0.35, clearcoat: 0.6 })));
  tongue.scale.set(1.2, 0.35, 1.3);
  tongue.position.copy(new THREE.Vector3(...H(0, -0.118, 0.055)).sub(jawBP));
  bone('jaw').add(tongue);
  // dark lash lines along the squinting slits (the crescent 'happy' eyes read from far away)
  const lashMat = heroFog(new THREE.MeshStandardMaterial({ color: 0x2a140c, roughness: 0.6 }));
  const glintMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.45, 1.3), transparent: true, opacity: 0.85, depthWrite: false });
  for (const sd of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 16; i++) { const u = -1 + i / 8; pts.push(new THREE.Vector3(...H(EYE_X * sd + u * 0.023 * sd, -0.0135 + 0.0068 * (1 - u * u) + 0.002 * u + 0.0036 * (1 - 0.5 * u * u), 0.0935 - 0.006 * u * u)).sub(headBP)); }
    const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0016 * 1.14, 6, false);
    // wet glint in the slit
    const gl = new THREE.Mesh(new THREE.SphereGeometry(0.0024 * 1.14, 8, 6), glintMat);
    gl.position.copy(new THREE.Vector3(...H(EYE_X * sd - 0.004 * sd, -0.0105, 0.0885)).sub(headBP)); gl.frustumCulled = false;
    bone('head').add(gl);
    const lash = new THREE.Mesh(tg, lashMat); lash.frustumCulled = false;
    bone('head').add(lash);
  }
  // eyes (mostly hidden in the squint)
  const eyeMat = heroFog(createEyeMaterial());
  const eyes = EYES.map((e) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(e.r, 24, 16).rotateX(Math.PI / 2), eyeMat);
    m.position.set(e.c[0] - headBP.x, e.c[1] - headBP.y, e.c[2] - headBP.z);
    m.frustumCulled = false;
    bone('head').add(m);
    return m;
  });
  const genMs = performance.now() - t0;
  console.log(`[colossal] giant built: ${tris | 0} tris in ${genMs | 0} ms`);
  root.visible = false;
  scene.add(root);

  // ---------- rig + brain ----------
  const rig = createRig(root, bones, bdefs, bi);
  const headPosition = new THREE.Vector3();
  const G = { root, rig, K, ZF, X0, headPosition, evap: 0 };
  const sys = {};
  G.sys = sys;
  const brain = createBrain(ctx, G);
  const S = brain.S;

  // ---------- steam ----------
  const vapor = getVapor(ctx);
  const EMIT = [
    ['chest', [0.13, 1.5, -0.07], 0.6, 1.2], ['chest', [-0.13, 1.5, -0.07], 0.6, 1.2],
    ['chest', [0, 1.42, -0.09], 0.7, 1.3], ['chest', [0, 1.49, -0.1], 0.5, 1.0],
    ['upperArmL', [0.21, 1.46, 0.0], 0.4, 1.0], ['upperArmR', [-0.21, 1.46, 0.0], 0.4, 1.0],
    ['chest', [0.07, 1.33, 0.1], 0.3, 0.9], ['chest', [-0.07, 1.33, 0.1], 0.3, 0.9], ['spine', [0, 1.1, -0.08], 0.4, 1.1],
  ].map(([b, p, rate, size]) => ({ bone: bone(b), off: new THREE.Vector3(...p).sub(bindPos(b)), rate, size, acc: Math.random(), pos: new THREE.Vector3(), idle: /^chest$/.test(b) && Math.abs(p[0]) > 0.1 }));
  let steamK = 0;
  const fxHandles = [];
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const center = new THREE.Vector3();
  function emitSteam(dt) {
    // calm: thin wisps from the shoulders only (the giant must stay the clearest thing in frame);
    // hurt / steam fury: the whole body vents
    const agitated = S.steaming || S.hurt > 0.15;
    const k = steamK * (agitated ? (0.6 + S.hurt * 1.5 + (S.steaming ? 2.2 : 0)) : 0.3);
    if (k <= 0.001 || dt <= 0) return;
    bone('chest').getWorldPosition(center);
    for (const e of EMIT) {
      if (!agitated && !e.idle) continue;
      e.acc += dt * e.rate * 4 * k;
      while (e.acc >= 1) {
        e.acc -= 1;
        e.bone.localToWorld(_v.copy(e.off));
        _v.x += (Math.random() - 0.5) * 3; _v.y += (Math.random() - 0.5) * 2; _v.z += (Math.random() - 0.5) * 3;
        _v2.copy(_v).sub(center); _v2.y = 0; _v2.normalize().multiplyScalar(S.steaming ? 14 + Math.random() * 14 : 2 + Math.random() * 3);
        _v2.y = (S.steaming ? 10 : 4) + Math.random() * 6;
        vapor.emit({ pos: _v, vel: _v2, size: (agitated ? 3 : 2) + Math.random() * 3 * e.size, size1: (agitated ? 12 + Math.random() * 10 : 6 + Math.random() * 5) * e.size * (S.steaming ? 1.3 : 1), life: agitated ? 2.6 + Math.random() * 2 : 2.2 + Math.random() * 1.5, alpha: S.steaming ? 0.26 : agitated ? 0.18 : 0.1, drag: 0.5, buoy: 3.5, color: [0.96, 0.95, 0.94] });
      }
    }
  }
  function burst(k) {
    for (const e of EMIT) {
      const n = Math.ceil(4 * k * e.size);
      for (let i = 0; i < n; i++) {
        e.bone.localToWorld(_v.copy(e.off));
        _v.x += (Math.random() - 0.5) * 8; _v.y += (Math.random() - 0.5) * 8; _v.z += (Math.random() - 0.5) * 8;
        _v2.set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(8 + Math.random() * 16);
        vapor.emit({ pos: _v, vel: _v2, size: 8 + Math.random() * 8, size1: 28 + Math.random() * 22, life: 4.5 + Math.random() * 3.5, alpha: 0.26, drag: 0.9, buoy: 3.5, glow: [0.25, 0.08, 0.03], glowDecay: 1.2 });
      }
    }
  }
  G.burst = burst;
  G.woundSteam = (p, k) => {
    for (let i = 0; i < 10 * k + 4; i++) {
      _v2.set(Math.random() - 0.5, Math.random() * 0.8 + 0.3, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 10);
      vapor.emit({ pos: p, vel: _v2, size: 2 + Math.random() * 2, size1: 12 + Math.random() * 8, life: 2.5 + Math.random() * 2, alpha: 0.45, drag: 1, buoy: 3 });
    }
    try { ctx.fx?.steam?.(p.clone(), 6 * k + 3, 2.5, { burst: true }); } catch {}
  };
  function startFxSteam() {
    stopFxSteam();
    return; // continuous fx.steam plumes swallowed the body at gameplay distance: bursts only (woundSteam / startBurst / death)
    const spots = [['chest', [0.15, 1.48, -0.07], 14], ['chest', [-0.15, 1.48, -0.07], 14], ['chest', [0, 1.4, -0.1], 12]];
    for (const [bn, p, size] of spots) {
      const b = bone(bn), off = new THREE.Vector3(...p).sub(bindPos(bn));
      let h = null;
      try { h = ctx.fx?.steam?.(b.localToWorld(off.clone()), size, Infinity, { follow: true }); } catch { h = null; }
      if (h) fxHandles.push({ h, b, off });
    }
  }
  function stopFxSteam() { for (const f of fxHandles) { try { f.h.stop?.(); } catch {} } fxHandles.length = 0; }

  // ---------- physics capsules (hook / collide / slash body / velocity) ----------
  const CAPS = [['root', 'neck', 0.15], ['neck', 'head', 0.07], ['head', 'head', 0.12, [0, 0.1, 0.015]],
    ['upperArmL', 'foreArmL', 0.058], ['foreArmL', 'handL', 0.045], ['handL', 'middleTipL', 0.06],
    ['upperArmR', 'foreArmR', 0.058], ['foreArmR', 'handR', 0.045], ['handR', 'middleTipR', 0.06],
    ['thighL', 'shinL', 0.088], ['shinL', 'footL', 0.058], ['thighR', 'shinR', 0.088], ['shinR', 'footR', 0.058],
    ['footL', 'toeL', 0.045], ['footR', 'toeR', 0.045]]
    .map(([a, b, r, off]) => ({ a: bone(a), b: bone(b), r: r * K, off: off ? new THREE.Vector3(...off) : null, pa: new THREE.Vector3(), pb: new THREE.Vector3(), va: new THREE.Vector3(), vb: new THREE.Vector3(), pa0: new THREE.Vector3(), pb0: new THREE.Vector3() }));
  let capsValid = false;
  function updateCaps(dt) {
    for (const c of CAPS) {
      c.pa0.copy(c.pa); c.pb0.copy(c.pb);
      if (c.off) { c.a.localToWorld(c.pa.copy(c.off)); c.pb.copy(c.pa); c.pb.y += 0.01; }
      else { c.a.getWorldPosition(c.pa); c.b.getWorldPosition(c.pb); }
      if (capsValid && dt > 0) { c.va.subVectors(c.pa, c.pa0).divideScalar(dt); c.vb.subVectors(c.pb, c.pb0).divideScalar(dt); if (c.va.lengthSq() > 1e4) c.va.set(0, 0, 0); if (c.vb.lengthSq() > 1e4) c.vb.set(0, 0, 0); }
      else { c.va.set(0, 0, 0); c.vb.set(0, 0, 0); }
    }
    capsValid = true;
  }
  const _ba = new THREE.Vector3(), _oa = new THREE.Vector3(), _oc = new THREE.Vector3(), _pb = new THREE.Vector3();
  function capHit(ro, rd, pa, pb, ra) {
    _ba.subVectors(pb, pa); _oa.subVectors(ro, pa);
    const baba = _ba.dot(_ba), bard = _ba.dot(rd), baoa = _ba.dot(_oa), rdoa = rd.dot(_oa), oaoa = _oa.dot(_oa);
    const a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - ra * ra * baba;
    let h = b * b - a * c;
    if (a > 1e-9 && h >= 0) {
      const t = (-b - Math.sqrt(h)) / a, y = baoa + t * bard;
      if (y > 0 && y < baba) return t;
      _oc.copy(y <= 0 ? _oa : _pb.subVectors(ro, pb));
      const b2 = rd.dot(_oc), c2 = _oc.dot(_oc) - ra * ra; h = b2 * b2 - c2;
      if (h > 0) return -b2 - Math.sqrt(h);
    } else if (a <= 1e-9) {
      const b2 = rd.dot(_oa), c2 = _oa.dot(_oa) - ra * ra; h = b2 * b2 - c2;
      if (h > 0) return -b2 - Math.sqrt(h);
    }
    return -1;
  }
  const segT = (p, a, b) => { _ba.subVectors(b, a); return clamp(_oa.subVectors(p, a).dot(_ba) / Math.max(1e-9, _ba.lengthSq()), 0, 1); };
  const physOn = () => sys.active && root.visible && capsValid && S.mode !== 'dying' && S.mode !== 'dead';
  ctx.physics.addRaycaster('colossal', (o, d, max) => {
    if (!physOn()) return null;
    let best = null, bt = max;
    for (const c of CAPS) { const t = capHit(o, d, c.pa, c.pb, c.r); if (t > 0 && t < bt) { bt = t; best = c; } }
    if (!best) return null;
    const point = o.clone().addScaledVector(d, bt);
    const t = segT(point, best.pa, best.pb);
    const cp = new THREE.Vector3().copy(best.pa).lerp(best.pb, t);
    const normal = point.clone().sub(cp).normalize();
    // anchor to the nearer bone of the capsule
    const anchor = t > 0.5 && !best.off ? best.b : best.a;
    return { point, normal, distance: bt, kind: 'colossal', ref: sys, anchor, local: anchor.worldToLocal(point.clone()) };
  });
  ctx.physics.addCollider('colossal', (c, r, out) => {
    if (!physOn()) return;
    for (const cap of CAPS) {
      const t = segT(c, cap.pa, cap.pb);
      const cp = _v3.copy(cap.pa).lerp(cap.pb, t);
      const d = c.distanceTo(cp), pen = cap.r + r - d;
      if (pen > 0 && d > 1e-6) out.push({ normal: c.clone().sub(cp).divideScalar(d), depth: pen, kind: 'colossal', ref: sys });
    }
  });
  G.bodyHit = (p, r) => {
    if (!physOn()) return false;
    for (const cap of CAPS) { const t = segT(p, cap.pa, cap.pb); if (p.distanceTo(_v3.copy(cap.pa).lerp(cap.pb, t)) < cap.r + r + 0.5) return true; }
    return false;
  };

  // ---------- lighting uniforms ----------
  function updateUniforms() {
    for (const m of mats) updateLightingUniforms(m.userData.uniforms, ctx);
    skin.userData.uniforms.uEvap.value = G.evap; hairMat.userData.uniforms.uEvap.value = G.evap;
    skin.userData.uniforms.uHurt.value = S.hurt * 0.6;
  }
  G.onDead = () => { sys.hide(); };

  // ---------- public API ----------
  const nape = { position: brain.weakPoints.find((w) => w.name === 'nape').position, radius: 3.6 };
  Object.defineProperties(sys, Object.getOwnPropertyDescriptors({
    object: root, position: root.position, headPosition, nape, weakPoints: brain.weakPoints, active: false,
    K, meshes, bones: Object.fromEntries(bones.map((b) => [b.name, b])), rig, brain, genMs, tris,
    get state() { return S.mode; }, get phase() { return S.phase; }, get hp() { return brain.hp; },
    get steaming() { return S.steaming; }, get fighting() { return S.fighting; },
    appear() { brain.lookAt(null); show(); brain.appear(); steamK = 1; startFxSteam(); ctx.events.emit('colossal:appear', sys); },
    show() { show(); brain.show(); },
    // title screen: looming at the wall at golden hour, grinning over the parapet, steam wafting
    titlePose() { show(); brain.show(); brain.lookAt(new THREE.Vector3(0, 12, 120)); S.fighting = false; S.action = null; },
    kick() { if (!sys.active) show(); brain.kick(); },
    startFight() { brain.lookAt(null); if (!sys.active) show(); brain.startFight(); },
    vanish(instant = false) { if (instant) { sys.hide(); return; } S.fighting = false; S.mode = 'dying'; S.t = 4; burst(1.5); },
    hide() { root.visible = false; sys.active = false; steamK = 0; stopFxSteam(); if (S.mode !== 'dead') S.mode = 'hidden'; },
    trySlash: (pos, vel, radius) => brain.trySlash(pos, vel, radius),
    lookAt: (t) => brain.lookAt(t),
    eat: (civ, hand) => brain.eat(civ, hand),
    chew: () => brain.chew(),
    releaseGrab: () => brain.releaseGrab(),
    steamForceAt(pos, out = new THREE.Vector3()) {
      out.set(0, 0, 0);
      if (!sys.active || !S.steaming) return out;
      const ramp = sstep(0, 0.4, S.burstT) * (1 - sstep(2.7, 3.2, S.burstT));
      for (const e of EMIT) {
        e.bone.localToWorld(_v.copy(e.off));
        const d = _v2.copy(pos).sub(_v); const dist = d.length();
        const R = 55;
        if (dist < R && dist > 0.01) out.addScaledVector(d.divideScalar(dist), 95 * ramp * (1 - dist / R) ** 2);
      }
      return out;
    },
    velocityAt(point, out = new THREE.Vector3()) {
      out.set(0, 0, 0);
      if (!capsValid) return out;
      let best = null, bd = 1e9, bt = 0;
      for (const c of CAPS) { const t = segT(point, c.pa, c.pb); const d = point.distanceTo(_v3.copy(c.pa).lerp(c.pb, t)) - c.r; if (d < bd) { bd = d; best = c; bt = t; } }
      if (best) out.copy(best.va).lerp(best.vb, bt);
      return out;
    },
    setPhaseDebug: (p) => { if (!sys.active) show(); brain.setPhaseDebug(p); },
    update(dt, time) {
      if (!sys.active) return;
      if (!bindDebug) { brain.update(dt, time); rig.apply(dt, time); } else { for (const b of bones) b.quaternion.identity(); bone('root').position.set(0, 0.93, 0); root.updateMatrixWorld(true); }
      bone('head').getWorldPosition(headPosition);
      headPosition.add(_v.set(0, 0.06 * K, 0.04 * K).applyQuaternion(bone('head').getWorldQuaternion(new THREE.Quaternion())));
      brain.afterPose();
      // eyes: follow the camera a little inside the squint
      for (const e of eyes) {
        e.getWorldPosition(_v);
        _v2.copy(ctx.camera.position).sub(_v).normalize();
        e.parent.getWorldQuaternion(_q).invert();
        _v2.applyQuaternion(_q);
        const ang = _v2.angleTo(Z);
        if (ang > 0.35) _v2.lerp(Z, 1 - 0.35 / ang).normalize();
        e.quaternion.setFromUnitVectors(Z, _v2);
      }
      emitSteam(dt);
      for (const f of fxHandles) { try { if (f.h.position) f.b.localToWorld(f.h.position.copy(f.off)); } catch {} }
      updateCaps(dt);
      updateUniforms();
      vapor.update(dt);
    },
  }));
  const _q = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1);
  function show() { root.visible = true; sys.active = true; if (steamK <= 0) { steamK = 1; startFxSteam(); } }
  ctx.events.on('fight:start', () => { try { sys.startFight(); } catch (e) { console.error(e); } });

  // debug: ?cpose=wall|appear|fight|p2|p3 to see it without the intro
  const dbg = ctx.params.cpose;
  var bindDebug = ctx.params.cbind === '1';
  if (dbg) {
    ctx.events.on('loaded', () => {
      if (dbg === 'appear') sys.appear();
      else if (dbg === 'kick') { sys.show(); sys.kick(); }
      else if (dbg === 'fight' || dbg === 'p1') sys.startFight();
      else if (dbg === 'p2') { sys.startFight(); sys.setPhaseDebug(2); }
      else if (dbg === 'p3') { sys.startFight(); sys.setPhaseDebug(3); }
      else sys.show();
    });
  }
  return sys;
}
