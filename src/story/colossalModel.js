// The imported Colossal Titan model ("Colossal Titan" by Sidaivan, CC BY 4.0 — see src/story/credits.js) as the
// boss body, behind `?colossal=model`. The asset is produced by tools/import-colossal.mjs
// (public/assets/colossal/colossal.glb: Mixamo-rigged, its own skin weights, bind pose = T-pose, model units of
// colossalBody.js: feet y=0, facing +Z, +X = its left, hips at the procedural rig's hip height).
//
// The procedural 62-bone rig (colossalRig.js) stays the DRIVER: the brain poses it exactly as before (IK targets,
// grips, gait, kneel...). Every frame update() retargets it onto the Mixamo skeleton:
//   1. rotations: each mapped Mixamo bone gets   Q_group = Q_driver_group * C * Q_rest_group
//      (C aligns the model's T-pose bone to the driver's A-pose bone once; fingers/thumbs reuse the hand's C,
//      torso/neck/head/feet use identity so the model keeps its own posture there),
//   2. hips follow the driver root (offset kept in the driver root frame),
//   3. two-bone IK on arms and legs puts the model's wrists/ankles where the driver's are (palm / sole aligned),
//      so wall grips, foot plants and weak points line up with the brain's world,
//   4. weak points (wrists / Achilles / nape), headPosition and the physics capsules are moved onto the model's
//      own bones.
// LOD0/1/2 SkinnedMeshes share the skeleton; LOD is picked by camera distance. Shadows come from a ~4k-tri skinned
// proxy (colorWrite/depthWrite off), like the procedural body.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ARM, LEG, FINGERS } from './colossalBody.js';
export { COLOSSAL_CREDIT } from './credits.js';

const ASSET = `${import.meta.env?.BASE_URL ?? '/'}assets/colossal/colossal.glb`;
let pending = null;
export function preload() {
  pending ||= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(ASSET);
  return pending;
}

// LOD switch distances (world metres, camera -> chest) with hysteresis
const LOD_DIST = [260, 620];
const LOD_HYST = 25;

export async function createColossalModel(ctx, { root, bones, bdefs, bi, K, heroFog = (m) => m }) {
  const t0 = performance.now();
  const gltf = await preload();
  const tLoad = performance.now() - t0;
  const holder = gltf.scene;
  holder.name = 'colossal_model';
  root.add(holder);
  root.updateMatrixWorld(true);

  // ---------- meshes / materials ----------
  const T = {};   // Mixamo bone name -> bone
  const lods = [[], [], []];
  let shadowSrc = null;
  holder.traverse((o) => {
    if (o.isBone) T[o.name] = o;
    if (!o.isSkinnedMesh) return;
    const m = /^lod(\d)_/.exec(o.name);
    if (m) lods[+m[1]].push(o);
    else if (o.name === 'shadow') shadowSrc = o;
  });
  const matCache = new Map();
  const mats = [];
  const skinMat = (src) => {
    if (matCache.has(src)) return matCache.get(src);
    const m = new THREE.MeshPhysicalMaterial({
      name: 'colossal_' + src.name, map: src.map, normalMap: src.normalMap,
      roughness: 0.5, metalness: 0, clearcoat: 0.28, clearcoatRoughness: 0.42,   // wet, skinless sheen
      side: THREE.FrontSide,
    });
    if (src.normalMap) m.normalScale.copy(src.normalScale).multiplyScalar(0.9);
    for (const t of [m.map, m.normalMap]) if (t) t.anisotropy = 8;
    heroFog(m, 0.5);
    m.userData.baseColor = m.color.clone();
    matCache.set(src, m); mats.push(m);
    return m;
  };
  const meshes = [];
  let tris = 0;
  lods.forEach((list, li) => {
    for (const mesh of list) {
      mesh.material = skinMat(mesh.material);
      mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
      mesh.visible = li === 0;
      mesh.name = 'giant_model_' + mesh.name;
      meshes.push(mesh);
      if (li === 0) tris += mesh.geometry.index.count / 3;
    }
  });
  const shadowProxies = [];
  let shadowTris = 0;
  if (shadowSrc) {
    shadowSrc.material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    shadowSrc.castShadow = true; shadowSrc.receiveShadow = false; shadowSrc.frustumCulled = false;
    shadowSrc.name = 'giant_shadow_model';
    shadowProxies.push(shadowSrc);
    shadowTris = shadowSrc.geometry.index.count / 3;
  }

  // ---------- retarget setup ----------
  const D = (n) => bones[bi[n]];
  const dIdx = new Map(bones.map((b, i) => [b, i]));
  const bindPos = (n) => new THREE.Vector3(...bdefs[bi[n]].pos);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3();
  const groupPosT = (b, out) => out.setFromMatrixPosition(_m.multiplyMatrices(rootInv, b.matrixWorld));
  const groupQT = (b, out) => { _m.multiplyMatrices(rootInv, b.matrixWorld).decompose(_v3, out, _s); return out; };

  const hips = T.Hips;
  if (!hips) throw new Error('[colossalModel] no Hips bone in the model');
  const order = [];
  hips.traverse((o) => { if (o.isBone) order.push(o); });
  const restLocal = new Map(order.map((b) => [b, b.quaternion.clone()]));
  const restGroupQ = new Map(order.map((b) => [b, groupQT(b, new THREE.Quaternion())]));
  const restGroupP = new Map(order.map((b) => [b, groupPosT(b, new THREE.Vector3())]));
  const baseQ = groupQT(hips.parent, new THREE.Quaternion());
  const baseInv = new THREE.Matrix4().multiplyMatrices(rootInv, hips.parent.matrixWorld).invert();

  // basis alignment: rotation taking the target (dir, sec) frame onto the driver (dir, sec) frame
  const frame = (dir, sec) => {
    const x = dir.clone().normalize(), y = sec.clone().addScaledVector(x, -sec.dot(x));
    if (y.lengthSq() < 1e-8) y.set(0, 1, 0).addScaledVector(x, -x.y);
    y.normalize();
    return new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y));
  };
  const align = (dDir, tDir, sec = new THREE.Vector3(0, 0, 1)) => new THREE.Quaternion().setFromRotationMatrix(frame(dDir, sec).multiply(frame(tDir, sec).transpose()));
  const tp = (n) => restGroupP.get(T[n]);
  const I = new THREE.Quaternion();
  const MAP = [];   // { t, d, C }
  const add = (dName, tName, C = I) => { if (T[tName] && bi[dName] !== undefined) MAP.push({ t: T[tName], d: D(dName), C }); };
  add('root', 'Hips'); add('spine', 'Spine'); add('chest', 'Spine2'); add('neck', 'Neck'); add('head', 'Head');
  const C_ = {};
  for (const s of ['L', 'R']) {
    const S = s === 'L' ? 'Left' : 'Right';
    const dv = (a, b) => bindPos(b).sub(bindPos(a));
    const tv = (a, b) => tp(b).clone().sub(tp(a));
    const cClav = align(dv('clav' + s, 'upperArm' + s), tv(S + 'Shoulder', S + 'Arm'));
    const cUp = align(dv('upperArm' + s, 'foreArm' + s), tv(S + 'Arm', S + 'ForeArm'));
    const cFore = align(dv('foreArm' + s, 'hand' + s), tv(S + 'ForeArm', S + 'Hand'));
    const cHand = align(dv('hand' + s, 'middle0' + s), tv(S + 'Hand', S + 'HandMiddle1'));
    const cThigh = align(dv('thigh' + s, 'shin' + s), tv(S + 'UpLeg', S + 'Leg'));
    const cShin = align(dv('shin' + s, 'foot' + s), tv(S + 'Leg', S + 'Foot'));
    C_[s] = { cHand };
    add('clav' + s, S + 'Shoulder', cClav); add('upperArm' + s, S + 'Arm', cUp); add('foreArm' + s, S + 'ForeArm', cFore); add('hand' + s, S + 'Hand', cHand);
    for (const fg of FINGERS) {
      const tn = fg.name === 'thumb' ? 'Thumb' : fg.name[0].toUpperCase() + fg.name.slice(1);
      for (let i = 0; i < 3; i++) add(fg.name + i + s, `${S}Hand${tn}${i + 1}`, cHand);
    }
    add('thigh' + s, S + 'UpLeg', cThigh); add('shin' + s, S + 'Leg', cShin); add('foot' + s, S + 'Foot'); add('toe' + s, S + 'ToeBase');
  }
  const mapT = new Map(MAP.map((e) => [e.t, e]));
  const dToT = new Map(MAP.map((e) => [e.d, e.t]));
  const spine1 = T.Spine1, dSpine = D('spine'), dChest = D('chest');
  const hipsOff = restGroupP.get(hips).clone().sub(bindPos('root'));   // model hips relative to the driver root (driver root frame)

  // limb IK data
  const limb = (a, b, c, dEnd, dMid, endOffset) => ({ a: T[a], b: T[b], c: T[c], dEnd: D(dEnd), dMid: D(dMid), l1: tp(b).distanceTo(tp(a)), l2: tp(c).distanceTo(tp(b)), off: endOffset });
  const limbs = [];
  for (const s of ['L', 'R']) {
    const S = s === 'L' ? 'Left' : 'Right', side = s === 'L' ? 1 : -1;
    // palm alignment: the model's palm centre (60% wrist->knuckle) lands on the driver's palm (brain grip point, 0.085 along F)
    const knuckle = tp(S + 'HandMiddle1').distanceTo(tp(S + 'Hand'));
    const F = new THREE.Vector3(ARM.dir[0] * side, ARM.dir[1], ARM.dir[2]).normalize();
    limbs.push(limb(S + 'Arm', S + 'ForeArm', S + 'Hand', 'hand' + s, 'foreArm' + s, F.multiplyScalar(0.085 - 0.6 * knuckle)));
    // sole alignment: the model's ankle sits higher than the driver's; keep the offset in the driver foot frame
    limbs.push(limb(S + 'UpLeg', S + 'Leg', S + 'Foot', 'foot' + s, 'shin' + s, tp(S + 'Foot').clone().sub(bindPos('foot' + s))));
  }

  // ---------- per-frame retarget ----------
  const dq = bones.map(() => new THREE.Quaternion());
  const gq = new Map(order.map((b) => [b, new THREE.Quaternion()]));
  const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
  const S0 = new THREE.Vector3(), E0 = new THREE.Vector3(), W0 = new THREE.Vector3(), Tg = new THREE.Vector3(), Pl = new THREE.Vector3(), E = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3();
  const setLocal = (b, groupQ) => { b.quaternion.copy(b === hips ? baseQ : gq.get(b.parent)).invert().multiply(groupQ); gq.get(b).copy(groupQ); };
  function retarget() {
    rootInv.copy(root.matrixWorld).invert();
    for (let i = 0; i < bones.length; i++) {
      const p = bdefs[i].parent;
      if (p < 0) dq[i].copy(bones[i].quaternion); else dq[i].multiplyQuaternions(dq[p], bones[i].quaternion);
    }
    for (const b of order) {
      const e = mapT.get(b);
      if (e) _qa.multiplyQuaternions(dq[dIdx.get(e.d)], e.C).multiply(restGroupQ.get(b));
      else if (b === spine1) _qa.copy(dq[dIdx.get(dSpine)]).slerp(dq[dIdx.get(dChest)], 0.5).multiply(restGroupQ.get(b));
      else _qa.multiplyQuaternions(gq.get(b.parent), restLocal.get(b));
      setLocal(b, _qa);
    }
    // hips: driver root position + the rest offset carried in the driver root's frame
    _v.copy(hipsOff).applyQuaternion(dq[0]).add(D('root').position);
    hips.position.copy(_v.applyMatrix4(baseInv));
    holder.updateMatrixWorld(true);
    // two-bone IK: model wrist/ankle onto the driver's (plus palm / sole offset in the driver end-bone frame)
    for (const L of limbs) {
      groupPosT(L.a, S0);
      groupPosT(L.dEnd, Tg).add(_v.copy(L.off).applyQuaternion(dq[dIdx.get(L.dEnd)]));
      groupPosT(L.dMid, Pl);
      u.copy(Tg).sub(S0);
      const d = THREE.MathUtils.clamp(u.length(), Math.abs(L.l1 - L.l2) + 1e-4, L.l1 + L.l2 - 1e-4);
      u.normalize();
      const cosA = THREE.MathUtils.clamp((L.l1 * L.l1 + d * d - L.l2 * L.l2) / (2 * L.l1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
      w.copy(Pl).sub(S0); w.addScaledVector(u, -w.dot(u));
      if (w.lengthSq() < 1e-10) w.set(0, 0, 1);
      w.normalize();
      E.copy(S0).addScaledVector(u, L.l1 * cosA).addScaledVector(w, L.l1 * sinA);
      // upper bone: swing its child onto E
      groupPosT(L.b, E0);
      _q.setFromUnitVectors(_v.copy(E0).sub(S0).normalize(), _v2.copy(E).sub(S0).normalize());
      const endQ = _qb.copy(gq.get(L.c));
      setLocal(L.a, _qa.copy(gq.get(L.a)).premultiply(_q));
      _qa.multiplyQuaternions(gq.get(L.a), L.b.quaternion); gq.get(L.b).copy(_qa);
      L.a.updateMatrixWorld(true);
      // lower bone: swing the end joint onto the target
      groupPosT(L.b, E0); groupPosT(L.c, W0);
      Tg.copy(S0).addScaledVector(u, d);
      _q.setFromUnitVectors(_v.copy(W0).sub(E0).normalize(), _v2.copy(Tg).sub(E0).normalize());
      setLocal(L.b, _qa.copy(gq.get(L.b)).premultiply(_q));
      setLocal(L.c, endQ);   // the hand / foot keeps its retargeted orientation
      L.a.updateMatrixWorld(true);
    }
  }

  // ---------- weak points / head / capsules onto the model ----------
  const lm = gltf.parser?.json?.extras?.landmarks;   // (landmarks also live in colossal.json; bones are the source of truth)
  void lm;
  const napeRest = (() => { // back of the neck halfway between the Neck and Head joints, just under the skin
    const n = tp('Neck'), h = tp('Head');
    return new THREE.Vector3(0, (n.y + h.y) / 2, n.z - 0.045);
  })();
  const WP = {
    hand_L: { b: T.LeftHand, d: D('handL') }, hand_R: { b: T.RightHand, d: D('handR') },
    ankle_L: { b: T.LeftFoot, d: D('footL') }, ankle_R: { b: T.RightFoot, d: D('footR') },
    nape: { b: T.Neck, local: napeRest.clone().sub(tp('Neck')).applyQuaternion(restGroupQ.get(T.Neck).clone().invert()) },
  };
  const headLocal = new THREE.Vector3(0, 0.055, 0.02).applyQuaternion(restGroupQ.get(T.Head).clone().invert());
  function fixWeakPoints(weakPoints) {
    for (const wp of weakPoints) {
      const f = WP[wp.name]; if (!f || !f.b) continue;
      if (f.local) { f.b.localToWorld(wp.position.copy(f.local)); continue; }
      // driver offset carried over: shift by (model joint - driver joint)
      f.b.getWorldPosition(_v); f.d.getWorldPosition(_v2);
      wp.position.add(_v.sub(_v2));
    }
  }
  // physics capsules (colossal.js CAPS): re-point them at the model's bones and fit the small head
  function fitCaps(caps) {
    const headR = 0.072;
    for (const c of caps) {
      const ta = dToT.get(c.a), tb = dToT.get(c.b);
      if (c.a === D('head') && c.off) { c.a = T.Head; c.b = T.Head; c.off.copy(headLocal); c.r = headR * K; continue; }
      if (c.a === D('neck') && c.b === D('head')) { c.a = T.Neck; c.b = T.Head; c.r = 0.06 * K; continue; }
      if (c.a === D('root') && c.b === D('neck')) { c.a = T.Hips; c.b = T.Neck; continue; }
      if (ta) c.a = ta;
      if (tb) c.b = tb;
      // finger-tip capsules: the model's middle finger end
      if (!tb && /middleTip/.test(c.b.name)) c.b = T[(c.b.name.endsWith('L') ? 'Left' : 'Right') + 'HandMiddle4'] || c.b;
    }
  }

  // ---------- LOD ----------
  let lod = 0;
  const chestW = new THREE.Vector3();
  function updateLod(camera) {
    if (!camera) return;
    (T.Spine2 || hips).getWorldPosition(chestW);
    const d = chestW.distanceTo(camera.position);
    let want = d > LOD_DIST[1] ? 2 : d > LOD_DIST[0] ? 1 : 0;
    if (want !== lod) {   // hysteresis: only switch once clearly past the edge
      const edge = LOD_DIST[Math.min(want, lod)];
      if (Math.abs(d - edge) < LOD_HYST) want = lod;
    }
    if (want !== lod || ctx.params?.clod !== undefined) {
      if (ctx.params?.clod !== undefined) want = +ctx.params.clod;
      lod = want;
      lods.forEach((list, i) => { for (const m of list) m.visible = i === lod; });
    }
  }

  // ---------- material state (hurt flush / death evaporation) ----------
  const charred = new THREE.Color(0.32, 0.22, 0.2), hurtGlow = new THREE.Color(0.9, 0.18, 0.08);
  function updateMaterials(G) {
    const S = G?.S, evap = G?.evap || 0, hurt = S ? S.hurt * 0.6 : 0;
    for (const m of mats) {
      m.color.copy(m.userData.baseColor).lerp(charred, Math.min(1, evap * 1.2));
      m.emissive.copy(hurtGlow).multiplyScalar(hurt * 0.12 + evap * 0.25);
    }
  }

  retarget();
  const fitMs = performance.now() - t0 - tLoad;
  console.log(`[colossal] model: ${tris | 0} tris (LOD1 ${lods[1].reduce((s, m) => s + m.geometry.index.count / 3, 0) | 0}, LOD2 ${lods[2].reduce((s, m) => s + m.geometry.index.count / 3, 0) | 0}, shadow ${shadowTris | 0}), load ${tLoad | 0} ms, setup ${fitMs | 0} ms`);

  return {
    object: holder, meshes, shadowProxies, tris, shadowTris, bones: T, lods, materials: mats,
    get lod() { return lod; },
    fitCaps,
    update(dt, sys, G) {
      retarget();
      if (sys?.weakPoints) fixWeakPoints(sys.weakPoints);
      if (sys?.headPosition && T.Head) T.Head.localToWorld(sys.headPosition.copy(headLocal));
      updateLod(ctx.camera);
      updateMaterials(G);
    },
  };
}
