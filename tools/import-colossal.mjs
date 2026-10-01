// Import pipeline for the external Colossal Titan model ("Colossal Titan" by Sidaivan, CC BY 4.0 — see
// public/assets/colossal/ATTRIBUTION.md). Turns the Sketchfab download into the game asset:
//
//   bun tools/import-colossal.mjs [input] [--out public/assets/colossal] [--no-normals] [--no-compress]
//
//   input: a .glb / .gltf, a folder containing one, or a Sketchfab .zip ("glTF" or "GLB" download).
//          Default: assets-src/colossal_titan.glb, else the newest ~/Downloads/*colossal*titan*.{glb,zip}.
//
// Steps: read -> bake the skin's bind pose (T-pose from the inverse bind matrices) into the joint nodes ->
// normalise (feet y=0, centred on the hips, facing +Z, +X = its left, uniform scale so the hip joints sit at
// the procedural rig's hip height = "model units" of src/story/colossalBody.js; colossal.js scales by K) ->
// flatten the hierarchy (one 'colossal' root, meshes at identity, unit-scale joints, fresh IBMs) -> metallic 0 ->
// optional tangent-space normal maps derived from the base colour (the source has none) -> weld/dedup/prune ->
// LOD1 (~50%) + LOD2 (~15%) + a ~4k-tri skinned shadow proxy (meshoptimizer simplify; skin attributes kept) ->
// textures to WebP <= 2048 -> meshopt compression -> colossal.glb + colossal.json (landmarks, scale, stats).
//
// Manual tweaks: tools/colossal-import.json (hipHeight, yaw, lod ratios, normal strength, landmark overrides).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplifyPrimitive, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && ['out'].includes(argv[i - 1].slice(2))));
const OUT = path.resolve(ROOT, opt('out', 'public/assets/colossal'));
const CFG_FILE = path.join(ROOT, 'tools/colossal-import.json');
const CFG = {
  hipHeight: 0.92,          // procedural rig hip joint height (colossalBody.js LEG.hip[1]) — sets the uniform scale
  yaw: 'auto',              // 'auto' (toes point +Z) or degrees
  lod: [0.5, 0.15],         // LOD1 / LOD2 index ratios
  lodError: [0.01, 0.03],
  shadowTris: 4000,
  shadowInset: 0.004,       // model units the shadow proxy is pushed inside the skin
  normals: true, normalStrength: 2.2, normalBlur: 5,
  roughness: 0.55, metalness: 0,
  webpQuality: 88, maxTexture: 2048,
  landmarks: {},            // overrides: { "wristL": [x,y,z], ... } in output model units
  ...(fs.existsSync(CFG_FILE) ? JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) : {}),
};
if (flag('no-normals')) CFG.normals = false;
const log = (...a) => console.log('[import-colossal]', ...a);
const t0 = performance.now();

// ---------------- input ----------------
function findInput() {
  if (positional[0]) return path.resolve(positional[0]);
  const def = path.join(ROOT, 'assets-src/colossal_titan.glb');
  if (fs.existsSync(def)) return def;
  const dl = '/mnt/c/Users/sonny/Downloads';
  const c = fs.existsSync(dl) ? fs.readdirSync(dl).filter((f) => /colossal.*titan.*\.(glb|zip)$/i.test(f)).map((f) => path.join(dl, f)) : [];
  c.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!c.length) throw new Error('no input: pass a .glb/.gltf/.zip/folder (none in assets-src/ or ~/Downloads)');
  return c[0];
}
function resolveModelFile(p) {
  if (fs.statSync(p).isDirectory()) {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const f = walk(p).filter((f) => /\.(glb|gltf)$/i.test(f)).sort((a, b) => a.length - b.length)[0];
    if (!f) throw new Error('no .glb/.gltf in ' + p);
    return f;
  }
  if (/\.zip$/i.test(p)) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colossal-'));
    const r = spawnSync('unzip', ['-q', '-o', p, '-d', dir], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('unzip failed for ' + p);
    return resolveModelFile(dir);
  }
  return p;
}
const INPUT = findInput();
const FILE = resolveModelFile(INPUT);
log('input', INPUT === FILE ? FILE : `${INPUT} -> ${FILE}`);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const doc = await io.read(FILE);
const R = doc.getRoot();
const srcAsset = R.getAsset();
const skin = R.listSkins()[0];
if (!skin) throw new Error('model has no skin: this importer expects the rigged (Mixamo) Colossal');
const joints = skin.listJoints();
const meshNodes = R.listNodes().filter((n) => n.getMesh());
const M4 = (a) => new THREE.Matrix4().fromArray(a);
const cleanName = (n) => n.replace(/^mixamorig[:_]?/, '').replace(/_\d+$/, '');

// ---------------- 1. bind pose (from IBMs) ----------------
const meshWorld = M4(meshNodes.find((n) => n.getSkin())?.getWorldMatrix() || meshNodes[0].getWorldMatrix());
const ibmAcc = skin.getInverseBindMatrices();
const isIdentity = (m) => m.elements.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9);
const bindW = new Map();   // joint node -> world matrix (with source scale) in the source scene
const jIndex = new Map(joints.map((j, i) => [j, i]));
function bindWorld(j) {
  if (bindW.has(j)) return bindW.get(j);
  const ibm = new THREE.Matrix4(); ibm.fromArray(ibmAcc.getElement(jIndex.get(j), []));
  let w;
  if (!isIdentity(ibm)) w = meshWorld.clone().multiply(ibm.clone().invert());
  else {   // end joints carry identity IBMs (unused by vertices): parent's bind pose x current local
    const p = j.getParentNode();
    const pw = p && jIndex.has(p) ? bindWorld(p) : M4(p ? p.getWorldMatrix() : new THREE.Matrix4().toArray());
    w = pw.clone().multiply(M4(j.getMatrix()));
  }
  bindW.set(j, w);
  return w;
}
joints.forEach(bindWorld);
const J = {};   // clean name -> joint
for (const j of joints) J[cleanName(j.getName())] = j;
for (const need of ['Hips', 'LeftUpLeg', 'RightUpLeg', 'LeftFoot', 'LeftToeBase', 'Head', 'LeftHand', 'RightHand']) if (!J[need]) throw new Error('missing joint ' + need + ' (got ' + Object.keys(J).join(',') + ')');
const bpos = (n) => new THREE.Vector3().setFromMatrixPosition(bindW.get(J[n]));

// ---------------- 2. normalisation ----------------
let minY = Infinity;
const _p = new THREE.Vector3();
for (const n of meshNodes) for (const prim of n.getMesh().listPrimitives()) {
  const a = prim.getAttribute('POSITION'), v = [0, 0, 0];
  for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); _p.fromArray(v).applyMatrix4(meshWorld); minY = Math.min(minY, _p.y); }
}
const hips = bpos('Hips');
const legY = (bpos('LeftUpLeg').y + bpos('RightUpLeg').y) / 2 - minY;
const scale = CFG.hipHeight / legY;
let yaw = 0;
if (CFG.yaw === 'auto') { const d = bpos('LeftToeBase').sub(bpos('LeftFoot')); yaw = -Math.atan2(d.x, d.z); yaw = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2); }
else yaw = Number(CFG.yaw) * Math.PI / 180;
const N = new THREE.Matrix4().makeScale(scale, scale, scale)
  .multiply(new THREE.Matrix4().makeRotationY(yaw))
  .multiply(new THREE.Matrix4().makeTranslation(-hips.x, -minY, -hips.z));
const leftX = bpos('LeftUpLeg').applyMatrix4(N).x;
if (leftX < 0) console.warn('[import-colossal] WARNING: LeftUpLeg ends up at -X after facing +Z — the model is mirrored relative to the rig (L/R swapped)');
log(`scale ${scale.toFixed(5)} (hip joints -> y=${CFG.hipHeight}), yaw ${(yaw * 180 / Math.PI).toFixed(0)}°, source height ${(legY / CFG.hipHeight * 1).toFixed(2)}…`);

// unit-scale joint worlds in output space
const unitW = new Map();
const _t = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
for (const j of joints) { N.clone().multiply(bindW.get(j)).decompose(_t, _q, _s); unitW.set(j, new THREE.Matrix4().compose(_t.clone(), _q.clone(), new THREE.Vector3(1, 1, 1))); }

// ---------------- 3. flatten: meshes to identity, joints re-parented under one root ----------------
const P = N.clone().multiply(meshWorld);
const Pn = new THREE.Matrix3().getNormalMatrix(P);
const done = new Set();
for (const n of meshNodes) for (const prim of n.getMesh().listPrimitives()) {
  for (const [sem, isN] of [['POSITION', false], ['NORMAL', true]]) {
    const a = prim.getAttribute(sem); if (!a || done.has(a)) continue; done.add(a);
    const arr = new Float32Array(a.getCount() * 3), v = [0, 0, 0];
    for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); _p.fromArray(v); if (isN) _p.applyMatrix3(Pn).normalize(); else _p.applyMatrix4(P); _p.toArray(arr, i * 3); }
    a.setArray(arr);
  }
}
const scene = R.listScenes()[0];
const top = doc.createNode('colossal');
const topJoint = joints.find((j) => !jIndex.has(j.getParentNode()));
for (const j of joints) {
  const p = j.getParentNode();
  const pw = jIndex.has(p) ? unitW.get(p) : new THREE.Matrix4();
  const local = pw.clone().invert().multiply(unitW.get(j));
  local.decompose(_t, _q, _s);
  j.setTranslation(_t.toArray()).setRotation(_q.toArray()).setScale([1, 1, 1]);
  j.setName(cleanName(j.getName()));
}
topJoint.getParentNode()?.removeChild(topJoint);
top.addChild(topJoint);
const ibmOut = new Float32Array(joints.length * 16);
joints.forEach((j, i) => unitW.get(j).clone().invert().toArray(ibmOut, i * 16));
ibmAcc.setArray(ibmOut);
skin.setSkeleton(topJoint);
const PART = { 'Mat.2': 'body', 'Mat.1': 'torso', material: 'head', Mat: 'head' };
for (const n of meshNodes) {
  n.getParentNode()?.removeChild(n);
  n.setMatrix(new THREE.Matrix4().toArray());
  const mat = n.getMesh().listPrimitives()[0].getMaterial();
  const part = PART[mat?.getName()] || n.getMesh().getName().replace(/\W+/g, '_');
  n.setName('lod0_' + part); n.getMesh().setName('lod0_' + part);
  n.setSkin(skin);
  top.addChild(n);
}
for (const c of scene.listChildren()) scene.removeChild(c);
for (const n of R.listNodes()) if (n !== top && !jIndex.has(n) && !meshNodes.includes(n)) n.dispose();
for (const c of R.listCameras()) c.dispose();
scene.addChild(top);

// ---------------- 4. materials (+ normal maps derived from the base colour) ----------------
async function normalFromColor(tex, strength, blur) {
  const img = Buffer.from(tex.getImage());
  const { data, info } = await sharp(img).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const { data: low } = await sharp(img).removeAlpha().greyscale().blur(blur).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = (data[i] - low[i] * 0.85) / 255;   // high-passed luminance as height (bright = raised fibre)
  const out = Buffer.alloc(W * H * 3);
  const at = (x, y) => h[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * strength, ny = dy * strength, nz = 1;   // glTF: +Y up in texture space (rows grow downwards)
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (y * W + x) * 3;
    out[o] = (nx * 0.5 + 0.5) * 255; out[o + 1] = (ny * 0.5 + 0.5) * 255; out[o + 2] = (nz * 0.5 + 0.5) * 255;
  }
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}
for (const m of R.listMaterials()) {
  m.setMetallicFactor(CFG.metalness).setRoughnessFactor(CFG.roughness);
  const bc = m.getBaseColorTexture();
  if (CFG.normals && bc && !m.getNormalTexture()) {
    const png = await normalFromColor(bc, CFG.normalStrength, CFG.normalBlur);
    const nt = doc.createTexture((bc.getName() || m.getName()) + '_n').setImage(new Uint8Array(png)).setMimeType('image/png');
    m.setNormalTexture(nt);
    m.getNormalTextureInfo().setTexCoord(m.getBaseColorTextureInfo().getTexCoord());
  }
}

// ---------------- 5. weld / dedup / prune ----------------
await doc.transform(dedup(), prune({ keepLeaves: true, keepAttributes: true }), weld());

// ---------------- 6. LODs + shadow proxy (simplified copies, skin attributes kept) ----------------
const lod0 = meshNodes.slice();
const tris = (prims) => prims.reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
const stats = { lod0: tris(lod0.flatMap((n) => n.getMesh().listPrimitives())) };
const cloneAcc = (a) => a.clone();
CFG.lod.forEach((ratio, li) => {
  const L = li + 1;
  for (const n0 of lod0) {
    const m = doc.createMesh(n0.getMesh().getName().replace('lod0_', `lod${L}_`));
    for (const p0 of n0.getMesh().listPrimitives()) {
      const p = doc.createPrimitive().setMaterial(p0.getMaterial()).setIndices(cloneAcc(p0.getIndices()));
      for (const sem of p0.listSemantics()) p.setAttribute(sem, cloneAcc(p0.getAttribute(sem)));
      simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: CFG.lodError[li] });
      m.addPrimitive(p);
    }
    top.addChild(doc.createNode(m.getName()).setMesh(m).setSkin(skin));
  }
  stats['lod' + L] = tris(top.listChildren().filter((n) => n.getName().startsWith(`lod${L}_`)).flatMap((n) => n.getMesh().listPrimitives()));
});
{ // shadow proxy: all parts merged, position-welded (seams/parts closed), simplified hard, pushed inside the skin
  const pos = [], jnt = [], wgt = [], idx = [];
  const key = new Map();
  let jType = null;
  for (const n0 of lod0) for (const p0 of n0.getMesh().listPrimitives()) {
    const pa = p0.getAttribute('POSITION'), ja = p0.getAttribute('JOINTS_0'), wa = p0.getAttribute('WEIGHTS_0'), ia = p0.getIndices();
    jType ||= ja.getArray().constructor;
    const remap = new Uint32Array(pa.getCount()), v = [0, 0, 0], jv = [0, 0, 0, 0], wv = [0, 0, 0, 0];
    for (let i = 0; i < pa.getCount(); i++) {
      pa.getElement(i, v);
      const k = v.map((x) => Math.round(x * 2000)).join(',');   // 0.5 mm (model units) weld grid
      let r = key.get(k);
      if (r === undefined) { r = pos.length / 3; key.set(k, r); pos.push(...v); ja.getElement(i, jv); wa.getElement(i, wv); jnt.push(...jv); wgt.push(...wv); }
      remap[i] = r;
    }
    const iarr = ia.getArray();
    for (let i = 0; i < iarr.length; i++) idx.push(remap[iarr[i]]);
  }
  const P32 = new Float32Array(pos);
  const target = Math.min(idx.length, CFG.shadowTris * 3);
  const [sIdx] = MeshoptSimplifier.simplify(new Uint32Array(idx), P32, 3, target, 0.08, []);
  // erode: vertex normals of the simplified mesh, push inward
  const nrm = new Float32Array(P32.length);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < sIdx.length; i += 3) {
    a.fromArray(P32, sIdx[i] * 3); b.fromArray(P32, sIdx[i + 1] * 3); c.fromArray(P32, sIdx[i + 2] * 3);
    const f = b.sub(a).cross(c.sub(a));
    for (let k = 0; k < 3; k++) { nrm[sIdx[i + k] * 3] += f.x; nrm[sIdx[i + k] * 3 + 1] += f.y; nrm[sIdx[i + k] * 3 + 2] += f.z; }
  }
  for (let i = 0; i < P32.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; for (let k = 0; k < 3; k++) P32[i + k] -= nrm[i + k] / l * CFG.shadowInset; }
  const buf = R.listBuffers()[0];
  const shadowMat = doc.createMaterial('shadow').setMetallicFactor(0);
  const prim = doc.createPrimitive().setMaterial(shadowMat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P32).setBuffer(buf))
    .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new jType(jnt)).setBuffer(buf))
    .setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(wgt)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(sIdx)).setBuffer(buf));
  const { compactPrimitive } = await import('@gltf-transform/functions');
  compactPrimitive(prim);
  const m = doc.createMesh('shadow').addPrimitive(prim);
  top.addChild(doc.createNode('shadow').setMesh(m).setSkin(skin));
  stats.shadow = sIdx.length / 3;
}
log('triangles', JSON.stringify(stats));

// ---------------- 7. landmarks ----------------
const jw = (n) => J[n] ? new THREE.Vector3().setFromMatrixPosition(unitW.get(J[n])) : null;
let headTop = -Infinity, bmin = new THREE.Vector3(Infinity, Infinity, Infinity), bmax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
const headP = jw('Head'), neckP = jw('Neck');
let chin = null, napeS = null;
for (const n of lod0) for (const prim of n.getMesh().listPrimitives()) {
  const a = prim.getAttribute('POSITION'), v = [0, 0, 0];
  for (let i = 0; i < a.getCount(); i++) {
    a.getElement(i, v); _p.fromArray(v); bmin.min(_p); bmax.max(_p);
    if (Math.abs(_p.x) < 0.25 && _p.y > neckP.y - 0.1) headTop = Math.max(headTop, _p.y);
    // chin: the front-most midline point between the neck joint and the head joint
    if (Math.abs(_p.x) < 0.012 && _p.y > neckP.y - 0.02 && _p.y < headP.y + 0.02 && (!chin || _p.z > chin.z)) chin = _p.clone();
    // nape: the back-most midline skin point halfway between the neck and head joints
    if (Math.abs(_p.x) < 0.015 && Math.abs(_p.y - (neckP.y + headP.y) / 2) < 0.012 && (!napeS || _p.z < napeS.z)) napeS = _p.clone();
  }
}
const L = (v) => v && v.toArray().map((x) => +x.toFixed(4));
const side = (s) => (s === 'L' ? 'Left' : 'Right');
const landmarks = {
  headTop: [headP.x, headTop, headP.z], chin: L(chin), head: L(headP), neck: L(neckP),
  nape: L(napeS ? napeS.clone().add(new THREE.Vector3(0, 0, 0.012)) : neckP.clone().add(new THREE.Vector3(0, (headP.y - neckP.y) * 0.5, -0.06))),   // just under the skin
};
for (const s of ['L', 'R']) {
  Object.assign(landmarks, {
    ['shoulder' + s]: L(jw(side(s) + 'Arm')), ['elbow' + s]: L(jw(side(s) + 'ForeArm')), ['wrist' + s]: L(jw(side(s) + 'Hand')),
    ['knuckle' + s]: L(jw(side(s) + 'HandMiddle1')), ['hip' + s]: L(jw(side(s) + 'UpLeg')), ['knee' + s]: L(jw(side(s) + 'Leg')),
    ['ankle' + s]: L(jw(side(s) + 'Foot')), ['toe' + s]: L(jw(side(s) + 'ToeBase')),
  });
}
landmarks.headTop = landmarks.headTop.map((x) => +x.toFixed(4));
Object.assign(landmarks, CFG.landmarks);
const jointsOut = Object.fromEntries(joints.map((j) => [j.getName(), L(new THREE.Vector3().setFromMatrixPosition(unitW.get(j)))]));

// ---------------- 8. textures + compression ----------------
if (!flag('no-compress')) {
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [CFG.maxTexture, CFG.maxTexture], quality: CFG.webpQuality }),
    prune({ keepLeaves: true }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizationVolume: 'scene', quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14 }),
    dedup(),   // quantize clones the skin per mesh node; merge them back into one
  );
}
R.getAsset().extras = {
  ...(srcAsset.extras || {}),
  title: 'Colossal Titan', author: 'Sidaivan (https://sketchfab.com/Sidaivan)',
  source: 'https://sketchfab.com/3d-models/colossal-titan-e031a57fd4bf411f8e893361676b4544',
  license: 'CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/)',
  modified: 'rescaled, re-oriented, bind pose baked, texture-compressed (WebP), normal maps derived from the base colour, LODs + shadow proxy, meshopt-compressed; retargeted at runtime to the game boss rig',
};
fs.mkdirSync(OUT, { recursive: true });
const glbPath = path.join(OUT, 'colossal.glb');
await io.write(glbPath, doc);
const info = {
  generated: new Date().toISOString(), source: path.basename(FILE), tool: 'tools/import-colossal.mjs',
  units: 'procedural-rig model units (src/story/colossalBody.js): feet y=0, facing +Z, +X = its left; colossal.js scales by K',
  scale, yawDeg: yaw * 180 / Math.PI, height: +bmax.y.toFixed(4), bounds: { min: L(bmin), max: L(bmax) },
  triangles: stats, bytes: fs.statSync(glbPath).size, landmarks, joints: jointsOut, config: CFG,
};
fs.writeFileSync(path.join(OUT, 'colossal.json'), JSON.stringify(info, null, 1) + '\n');
log(`wrote ${path.relative(ROOT, glbPath)} (${(info.bytes / 1048576).toFixed(2)} MB) + colossal.json in ${((performance.now() - t0) / 1000).toFixed(1)} s; height ${info.height} model units`);
