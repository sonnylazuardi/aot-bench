// Procedural Survey Corps soldier: ONE skinned mesh (body, clothes, harness, ODM gear, head, hair — all baked with
// per-vertex colour + roughness/metalness), a second tiny skinned mesh for emblem decals, and the two blades as
// separate child meshes of the hand bones (hideable / swappable / trail sampling).
//
// Character space: +Y up, +Z forward, +X = the character's LEFT. Feet at y = 0, ~1.74 m tall.
// All bones have IDENTITY bind rotations (only offsets) — poses set bone rotations directly (see pose.js).
import * as THREE from 'three';
import { emblemTexture, bladeTexture } from './emblem.js';

// ------------------------------------------------------------------ palette (sRGB hex -> linear)
const C = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const COL = {
  jacket: C(0x8a5a36), jacketDark: C(0x5c3a22), shirt: C(0xe6e0d4), trousers: C(0xd9d2c3), boot: C(0x3a2618), bootHi: C(0x4a3020),
  sole: C(0x120e0b), strap: C(0x1c1a18), strapHi: C(0x3a3430), skin: C(0xe2b393), skinShade: C(0xc8977a), hair: C(0x231a14),
  eye: C(0x2a2f38), white: C(0xf2f0ea), brow: C(0x1c1510), lip: C(0xa86a5a), cloak: C(0x2f4a33), steel: C(0xc9d0d8),
  darkSteel: C(0x6a717a), brass: C(0xb08a4c), gunmetal: C(0x8a929c), leatherBox: C(0x3a2b20),
};
// character-only light rig (updated each frame by the player): sun direction in VIEW space + strengths
export const RIG = { uSunView: { value: new THREE.Vector3(0, 0.3, -1) }, uRim: { value: 1 }, uFill: { value: 1 } };
export const RIG_GLSL = `
uniform vec3 uSunView; uniform float uRim; uniform float uFill;
vec3 heroRig(vec3 n, vec3 viewPos, vec3 albedo) {
  vec3 V = normalize(viewPos);                       // toward the camera
  float edge = 1.0 - clamp(abs(dot(n, V)), 0.0, 1.0);
  float fres = smoothstep(0.62, 0.97, edge);          // only the silhouette band, not the whole surface
  float back = 0.5 + 1.5 * max(0.0, -dot(V, uSunView)); // blazes when the camera looks into the sun (anime silhouette halo)
  float sunSide = 0.6 + 0.4 * clamp(dot(n, uSunView) + 0.5, 0.0, 1.0);
  vec3 rim = vec3(1.0, 0.7, 0.42) * fres * back * sunSide * 1.5 * uRim;
  vec3 fill = albedo * vec3(0.16, 0.18, 0.22) * (0.7 + 0.3 * n.y) * uFill;     // cool fill keeps hues from going black
  return rim + fill;
}`;
const PBR = { cloth: [0.86, 0], jacket: [0.6, 0], leather: [0.5, 0], skin: [0.62, 0], hair: [0.7, 0], metal: [0.28, 0.9], darkMetal: [0.36, 0.85], eye: [0.25, 0] };

// ------------------------------------------------------------------ skeleton (bind = identity rotations)
export const BONES = [
  ['root', null, 0, 0, 0],
  ['hips', 'root', 0, 0.95, 0],
  ['spine', 'hips', 0, 1.07, -0.01],
  ['chest', 'spine', 0, 1.25, -0.015],
  ['neck', 'chest', 0, 1.46, -0.012],
  ['head', 'neck', 0, 1.55, 0.0],
  ['shoulderL', 'chest', 0.03, 1.41, -0.02], ['upperArmL', 'shoulderL', 0.18, 1.41, -0.025], ['lowerArmL', 'upperArmL', 0.203, 1.128, -0.035], ['handL', 'lowerArmL', 0.218, 0.878, -0.02],
  ['shoulderR', 'chest', -0.03, 1.41, -0.02], ['upperArmR', 'shoulderR', -0.18, 1.41, -0.025], ['lowerArmR', 'upperArmR', -0.203, 1.128, -0.035], ['handR', 'lowerArmR', -0.218, 0.878, -0.02],
  ['upperLegL', 'hips', 0.09, 0.92, 0], ['lowerLegL', 'upperLegL', 0.097, 0.5, 0.012], ['footL', 'lowerLegL', 0.1, 0.085, -0.015],
  ['upperLegR', 'hips', -0.09, 0.92, 0], ['lowerLegR', 'upperLegR', -0.097, 0.5, 0.012], ['footR', 'lowerLegR', -0.1, 0.085, -0.015],
];
export const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
export const BIND = Object.fromEntries(BONES.map((b) => [b[0], new THREE.Vector3(b[2], b[3], b[4])]));

// ------------------------------------------------------------------ geometry accumulator
class Acc {
  constructor() { this.pos = []; this.col = []; this.pbr = []; this.si = []; this.sw = []; this.uv = []; this.idx = []; this.n = 0; }
  // w: {boneIndex: weight}
  v(x, y, z, col, pbr, w, u = 0, vv = 0) {
    this.pos.push(x, y, z); this.col.push(col[0], col[1], col[2]); this.pbr.push(pbr[0], pbr[1]); this.uv.push(u, vv);
    const e = Object.entries(w).map(([k, x]) => [+k, x]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    let s = 0; for (const [, x] of e) s += x;
    for (let i = 0; i < 4; i++) { this.si.push(e[i] ? e[i][0] : 0); this.sw.push(e[i] ? e[i][1] / s : 0); }
    return this.n++;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('pbr', new THREE.Float32BufferAttribute(this.pbr, 2));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}
const W = (o) => { const w = {}; for (const k in o) w[BI[k]] = o[k]; return w; };
const lerpW = (a, b, t) => { const w = {}; for (const k in a) w[k] = (w[k] || 0) + a[k] * (1 - t); for (const k in b) w[k] = (w[k] || 0) + b[k] * t; return w; };
const sp = (x, m) => Math.sign(x) * Math.pow(Math.abs(x), m);
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ------------------------------------------------------------------ tubes (vertical-ish rings), with a surface evaluator
// ring: { y, x, z (centre), rx, rf (front z radius), rb (back z radius), n (superellipse exponent), col | colFn(a,y), pbr, w }
function tube(acc, rings, { segs = 16, capTop = true, capBot = true } = {}) {
  const start = acc.n;
  for (const r of rings) {
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const p = ringPoint(r, a);
      const col = r.colFn ? r.colFn(a, r.y) : r.col;
      const pbr = (col === COL.jacket || col === COL.jacketDark) ? PBR.jacket : (r.pbr || PBR.cloth);
      acc.v(p[0], p[1], p[2], col, pbr, r.w);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) for (let s = 0; s < segs; s++) {
    const a = start + i * segs + s, b = start + i * segs + ((s + 1) % segs);
    const c = start + (i + 1) * segs + ((s + 1) % segs), d = start + (i + 1) * segs + s;
    acc.quad(a, b, c, d); // rings top->bottom, a=0 -> +X, winding outward
  }
  if (capTop) { const r = rings[0]; const c = acc.v(r.x || 0, r.y + (r.capH || 0), r.z || 0, r.colFn ? r.colFn(0, r.y) : r.col, r.pbr || PBR.cloth, r.w); for (let s = 0; s < segs; s++) acc.tri(c, start + ((s + 1) % segs), start + s); }
  if (capBot) { const r = rings[rings.length - 1], o = start + (rings.length - 1) * segs; const c = acc.v(r.x || 0, r.y - (r.capH || 0), r.z || 0, r.colFn ? r.colFn(0, r.y) : r.col, r.pbr || PBR.cloth, r.w); for (let s = 0; s < segs; s++) acc.tri(c, o + s, o + ((s + 1) % segs)); }
  return { rings };
}
function ringPoint(r, a, off = 0) {
  const c = Math.cos(a), s = Math.sin(a), m = 2 / (r.n || 2);
  const rz = s >= 0 ? r.rf : r.rb;
  return [(r.x || 0) + sp(c, m) * (r.rx + off), r.y, (r.z || 0) + sp(s, m) * (rz + off)];
}
// surface point on a tube at height y, angle a (rings sorted top->bottom by y)
function surf(T, y, a, off) {
  const R = T.rings;
  let i = 0; while (i < R.length - 2 && R[i + 1].y > y) i++;
  const A = R[i], B = R[i + 1];
  const t = THREE.MathUtils.clamp((A.y - y) / Math.max(1e-5, A.y - B.y), 0, 1);
  const r = { x: lerp(A.x || 0, B.x || 0, t), y, z: lerp(A.z || 0, B.z || 0, t), rx: lerp(A.rx, B.rx, t), rf: lerp(A.rf, B.rf, t), rb: lerp(A.rb, B.rb, t), n: lerp(A.n || 2, B.n || 2, t) };
  const p = ringPoint(r, a, off);
  const nrm = new THREE.Vector3(p[0] - r.x, 0, p[2] - r.z).normalize();
  return { p: new THREE.Vector3(p[0], p[1], p[2]), n: nrm, w: lerpW(A.w, B.w, t) };
}
// strap: a flat leather band following a path of (y, a) samples on a tube, with thickness
function strap(acc, T, path, { width = 0.026, off = 0.004, thick = 0.005, closed = false, col = COL.strap, pbr = PBR.leather } = {}) {
  const P = path.map(([y, a]) => surf(T, y, a, off));
  const n = P.length, start = acc.n;
  for (let i = 0; i < n; i++) {
    const prev = P[closed ? (i - 1 + n) % n : Math.max(0, i - 1)].p, next = P[closed ? (i + 1) % n : Math.min(n - 1, i + 1)].p;
    const t = next.clone().sub(prev).normalize();
    const b = new THREE.Vector3().crossVectors(P[i].n, t).normalize().multiplyScalar(width / 2);
    const o = P[i].p, inn = o.clone().addScaledVector(P[i].n, -thick);
    for (const q of [o.clone().add(b), o.clone().sub(b), inn.clone().sub(b), inn.clone().add(b)]) acc.v(q.x, q.y, q.z, col, pbr, P[i].w);
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = start + i * 4, b = start + ((i + 1) % n) * 4;
    acc.quad(a, a + 1, b + 1, b);       // outer face
    acc.quad(a, b, b + 3, a + 3);       // edge
    acc.quad(a + 1, a + 2, b + 2, b + 1); // edge
  }
}
const loop = (y0, tilt = 0, phase = 0, N = 28) => { const out = []; for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; out.push([y0 + tilt * Math.cos(a - phase), a]); } return out; };
const line = (pts, N = 14) => { // piecewise-linear (y, a) path resampled
  const out = [];
  for (let k = 0; k < pts.length - 1; k++) for (let i = 0; i < N; i++) { const t = i / N; out.push([lerp(pts[k][0], pts[k + 1][0], t), lerp(pts[k][1], pts[k + 1][1], t)]); }
  out.push(pts[pts.length - 1]); return out;
};

// ------------------------------------------------------------------ superquadrics (rounded boxes / capsules / discs)
// polar axis = local Y. size = half extents. e1 = latitude squareness, e2 = longitude squareness (1 = round, 0.2 = boxy)
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
function sq(acc, center, size, { e1 = 1, e2 = 1, rot = [0, 0, 0], col, pbr = PBR.cloth, w, su = 16, sv = 10, colFn = null, clip = null } = {}) {
  _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], 'XYZ'));
  _m4.compose(new THREE.Vector3(...center), _q, new THREE.Vector3(1, 1, 1));
  const start = acc.n;
  for (let j = 0; j <= sv; j++) {
    const v = -Math.PI / 2 + (j / sv) * Math.PI;
    for (let i = 0; i < su; i++) {
      const u = -Math.PI + (i / su) * Math.PI * 2;
      const cv = Math.cos(v), x = size[0] * sp(cv, e1) * sp(Math.cos(u), e2), y = size[1] * sp(Math.sin(v), e1), z = size[2] * sp(cv, e1) * sp(Math.sin(u), e2);
      _v.set(x, y, z).applyMatrix4(_m4);
      const c = colFn ? colFn(x / size[0], y / size[1], z / size[2]) : col;
      acc.v(_v.x, _v.y, _v.z, c, pbr, w);
    }
  }
  for (let j = 0; j < sv; j++) for (let i = 0; i < su; i++) {
    const a = start + j * su + i, b = start + j * su + ((i + 1) % su), c = start + (j + 1) * su + ((i + 1) % su), d = start + (j + 1) * su + i;
    acc.quad(a, d, c, b);
  }
}
const cyl = (acc, center, r, halfLen, axis, o) => { // rounded cylinder along axis 'x' | 'y' | 'z'
  const rot = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
  const R = o.rot ? [rot[0] + o.rot[0], rot[1] + o.rot[1], rot[2] + o.rot[2]] : rot;
  sq(acc, center, [r, halfLen, r], { e1: 0.18, e2: 1, su: 14, sv: 8, ...o, rot: R });
};

// ------------------------------------------------------------------ the soldier
export function buildCharacter() {
  const acc = new Acc();
  const X0 = 0; // (left/right mirror helper below)

  // ---------------- torso (pelvis -> collar)
  const jacketFront = (a, y) => { // open jacket: shirt visible down the front centre, V collar
    const d = Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
    const half = y > 1.33 ? 0.16 + (y - 1.33) * 3.2 : 0.16;
    if (d < half) return COL.shirt;
    if (d < half + 0.13 && y > 1.07) return COL.jacketDark; // lapel edge
    return COL.jacket;
  };
  const Hw = W({ hips: 1 }), HS = W({ hips: 0.55, spine: 0.45 }), S = W({ spine: 1 }), SC = W({ spine: 0.45, chest: 0.55 }), Cw = W({ chest: 1 }), CN = W({ chest: 0.6, neck: 0.4 });
  const torsoR = [
    { y: 1.485, rx: 0.058, rf: 0.056, rb: 0.062, n: 2, z: -0.012, col: COL.shirt, w: CN },
    { y: 1.47, rx: 0.088, rf: 0.07, rb: 0.078, n: 2.2, z: -0.015, colFn: jacketFront, w: CN },
    { y: 1.44, rx: 0.152, rf: 0.092, rb: 0.096, n: 3.2, z: -0.018, colFn: jacketFront, w: Cw },
    { y: 1.4, rx: 0.176, rf: 0.104, rb: 0.103, n: 3.0, z: -0.02, colFn: jacketFront, w: Cw },
    { y: 1.34, rx: 0.172, rf: 0.117, rb: 0.106, n: 2.7, z: -0.018, colFn: jacketFront, w: Cw },
    { y: 1.28, rx: 0.165, rf: 0.121, rb: 0.104, n: 2.5, z: -0.015, colFn: jacketFront, w: Cw },
    { y: 1.21, rx: 0.155, rf: 0.114, rb: 0.1, n: 2.4, z: -0.012, colFn: jacketFront, w: SC },
    { y: 1.14, rx: 0.147, rf: 0.106, rb: 0.097, n: 2.4, z: -0.01, colFn: jacketFront, w: S },
    { y: 1.075, rx: 0.147, rf: 0.105, rb: 0.098, n: 2.4, z: -0.01, colFn: jacketFront, w: S },
    { y: 1.045, rx: 0.152, rf: 0.108, rb: 0.102, n: 2.4, z: -0.01, col: COL.jacketDark, w: HS }, // hem lip
    { y: 1.044, rx: 0.136, rf: 0.094, rb: 0.091, n: 2.4, z: -0.01, col: COL.shirt, w: HS },
    { y: 1.0, rx: 0.14, rf: 0.095, rb: 0.094, n: 2.4, z: -0.01, col: COL.shirt, w: W({ hips: 0.8, spine: 0.2 }) },
    { y: 0.975, rx: 0.146, rf: 0.097, rb: 0.1, n: 2.4, z: -0.01, col: COL.trousers, w: Hw },
    { y: 0.93, rx: 0.153, rf: 0.099, rb: 0.108, n: 2.4, z: -0.012, col: COL.trousers, w: Hw },
    { y: 0.88, rx: 0.148, rf: 0.096, rb: 0.112, n: 2.3, z: -0.012, col: COL.trousers, w: Hw },
    { y: 0.835, rx: 0.12, rf: 0.085, rb: 0.098, n: 2.2, z: -0.01, col: COL.trousers, w: Hw },
    { y: 0.8, rx: 0.06, rf: 0.05, rb: 0.055, n: 2, z: -0.005, col: COL.trousers, w: Hw },
  ];
  const torso = tube(acc, torsoR, { segs: 32 });

  // ---------------- neck + head
  tube(acc, [
    { y: 1.575, rx: 0.042, rf: 0.045, rb: 0.043, z: 0.0, col: COL.skin, pbr: PBR.skin, w: W({ head: 1 }) },
    { y: 1.52, rx: 0.046, rf: 0.047, rb: 0.047, z: -0.005, col: COL.skin, pbr: PBR.skin, w: W({ neck: 1 }) },
    { y: 1.47, rx: 0.05, rf: 0.05, rb: 0.052, z: -0.01, col: COL.skin, pbr: PBR.skin, w: W({ neck: 0.5, chest: 0.5 }) },
  ], { segs: 14 });
  const Hd = W({ head: 1 }), hc = [0, 1.645, 0.008];
  sq(acc, hc, [0.08, 0.104, 0.097], { e1: 0.85, e2: 0.9, col: COL.skin, pbr: PBR.skin, w: Hd, su: 22, sv: 16,
    colFn: (x, y, z) => (y < -0.2 && z < 0.3 ? COL.skinShade : COL.skin) });
  sq(acc, [0, 1.588, 0.03], [0.062, 0.05, 0.07], { e1: 0.8, e2: 0.85, col: COL.skin, pbr: PBR.skin, w: Hd, su: 16, sv: 10 }); // jaw
  sq(acc, [0, 1.632, 0.104], [0.011, 0.024, 0.016], { rot: [-0.28, 0, 0], col: COL.skin, pbr: PBR.skin, w: Hd, su: 10, sv: 8 }); // nose
  for (const sx of [1, -1]) {
    sq(acc, [0.081 * sx, 1.64, 0.0], [0.012, 0.027, 0.02], { col: COL.skinShade, pbr: PBR.skin, w: Hd, su: 10, sv: 8 }); // ears
    sq(acc, [0.033 * sx, 1.657, 0.0975], [0.0185, 0.0092, 0.006], { rot: [0, 0.28 * sx, -0.08 * sx], col: COL.white, pbr: PBR.eye, w: Hd, su: 12, sv: 6 });
    sq(acc, [0.03 * sx, 1.657, 0.1015], [0.0085, 0.0088, 0.004], { rot: [0, 0.28 * sx, 0], col: COL.eye, pbr: PBR.eye, w: Hd, su: 10, sv: 6 });
    sq(acc, [0.035 * sx, 1.677, 0.1], [0.024, 0.0058, 0.007], { rot: [0, 0.3 * sx, 0.14 * sx], col: COL.brow, pbr: PBR.hair, w: Hd, su: 10, sv: 6 }); // brows (stern)
  }
  sq(acc, [0, 1.589, 0.1005], [0.018, 0.0032, 0.004], { col: COL.lip, pbr: PBR.skin, w: Hd, su: 10, sv: 6 }); // mouth
  hair(acc, Hd);

  // ---------------- arms (sleeves to the wrist, cuff, fist)
  const arms = {};
  for (const [S, sx] of [['L', 1], ['R', -1]]) {
    const UA = 'upperArm' + S, LA = 'lowerArm' + S, SH = 'shoulder' + S, HA = 'hand' + S;
    const at = (y) => { // arm centreline x/z at y (shoulder -> elbow -> wrist)
      const s0 = BIND[UA], e = BIND[LA], w = BIND[HA];
      if (y >= e.y) { const t = (s0.y - y) / (s0.y - e.y); return [lerp(s0.x, e.x, t), lerp(s0.z, e.z, t)]; }
      const t = (e.y - y) / (e.y - w.y); return [lerp(e.x, w.x, t), lerp(e.z, w.z, t)];
    };
    const R = (y, r, rf, rb, col, w, extra = {}) => { const [x, z] = at(Math.min(y, BIND[UA].y)); return { y, x: y > BIND[UA].y ? BIND[UA].x * 0.97 : x, z, rx: r, rf, rb, col, w, ...extra }; };
    const ring = [
      R(1.462, 0.03, 0.03, 0.03, COL.jacket, W({ [SH]: 0.5, [UA]: 0.5 })),
      R(1.44, 0.056, 0.055, 0.056, COL.jacket, W({ [UA]: 0.55, [SH]: 0.45 })),
      R(1.395, 0.06, 0.058, 0.058, COL.jacket, W({ [UA]: 0.85, [SH]: 0.15 })),
      R(1.33, 0.054, 0.052, 0.052, COL.jacket, W({ [UA]: 1 })),
      R(1.25, 0.048, 0.047, 0.048, COL.jacket, W({ [UA]: 1 })),
      R(1.17, 0.045, 0.045, 0.045, COL.jacket, W({ [UA]: 0.85, [LA]: 0.15 })),
      R(1.128, 0.043, 0.044, 0.045, COL.jacket, W({ [UA]: 0.5, [LA]: 0.5 })),
      R(1.085, 0.044, 0.045, 0.044, COL.jacket, W({ [UA]: 0.15, [LA]: 0.85 })),
      R(1.02, 0.045, 0.045, 0.043, COL.jacket, W({ [LA]: 1 })),
      R(0.95, 0.039, 0.039, 0.038, COL.jacket, W({ [LA]: 1 })),
      R(0.912, 0.036, 0.036, 0.036, COL.jacket, W({ [LA]: 1 })),
      R(0.911, 0.041, 0.041, 0.041, COL.jacketDark, W({ [LA]: 1 })), // cuff
      R(0.888, 0.041, 0.041, 0.041, COL.jacketDark, W({ [LA]: 1 })),
      R(0.887, 0.03, 0.031, 0.03, COL.skin, W({ [LA]: 1 }), { pbr: PBR.skin }),
      R(0.868, 0.028, 0.03, 0.029, COL.skin, W({ [LA]: 0.4, [HA]: 0.6 }), { pbr: PBR.skin }),
    ];
    arms[S] = tube(acc, ring, { segs: 14 });
    // fist around the grip (grip axis along +Z at 6 cm below the wrist)
    const h = BIND[HA], Hw2 = W({ [HA]: 1 });
    sq(acc, [h.x + 0.004 * sx, h.y - 0.058, h.z + 0.012], [0.03, 0.048, 0.045], { e1: 0.45, e2: 0.5, col: COL.skin, pbr: PBR.skin, w: Hw2, su: 14, sv: 10 });
    sq(acc, [h.x - 0.016 * sx, h.y - 0.06, h.z + 0.05], [0.014, 0.03, 0.018], { rot: [0.3, 0, 0], col: COL.skinShade, pbr: PBR.skin, w: Hw2, su: 10, sv: 8 }); // thumb
    // trigger grip: handle through the fist, trigger guard, blade mount + the wire trigger box
    cyl(acc, [h.x, h.y - 0.06, h.z + 0.005], 0.016, 0.085, 'z', { col: COL.gunmetal, pbr: PBR.darkMetal, w: Hw2 });
    sq(acc, [h.x, h.y - 0.1, h.z + 0.03], [0.008, 0.024, 0.03], { e1: 0.3, e2: 0.3, col: COL.darkSteel, pbr: PBR.darkMetal, w: Hw2, su: 10, sv: 6 }); // trigger guard
    sq(acc, [h.x, h.y - 0.058, h.z + 0.1], [0.018, 0.032, 0.022], { e1: 0.25, e2: 0.25, col: COL.steel, pbr: PBR.metal, w: Hw2, su: 12, sv: 6 }); // blade mount
    sq(acc, [h.x, h.y - 0.05, h.z - 0.085], [0.02, 0.026, 0.022], { e1: 0.3, e2: 0.3, col: COL.darkSteel, pbr: PBR.darkMetal, w: Hw2, su: 12, sv: 6 }); // pommel/cable box
  }

  // ---------------- legs (breeches -> knee-high boots)
  const legs = {};
  for (const [S, sx] of [['L', 1], ['R', -1]]) {
    const UL = 'upperLeg' + S, LL = 'lowerLeg' + S, F = 'foot' + S;
    const at = (y) => {
      const hp = BIND[UL], k = BIND[LL], a = BIND[F];
      if (y >= k.y) { const t = THREE.MathUtils.clamp((hp.y - y) / (hp.y - k.y), 0, 1); return [lerp(hp.x, k.x, t), lerp(hp.z, k.z, t)]; }
      const t = THREE.MathUtils.clamp((k.y - y) / (k.y - a.y), 0, 1); return [lerp(k.x, a.x, t), lerp(k.z, a.z, t)];
    };
    const R = (y, rx, rf, rb, col, w, extra = {}) => { const [x, z] = at(y); return { y, x, z, rx, rf, rb, col, w, ...extra }; };
    const tr = COL.trousers, bt = COL.boot;
    const ring = [
      R(1.0, 0.05, 0.05, 0.05, tr, W({ hips: 0.7, [UL]: 0.3 })),
      R(0.95, 0.086, 0.09, 0.09, tr, W({ [UL]: 0.55, hips: 0.45 })),
      R(0.88, 0.09, 0.092, 0.095, tr, W({ [UL]: 0.9, hips: 0.1 })),
      R(0.8, 0.086, 0.087, 0.088, tr, W({ [UL]: 1 })),
      R(0.72, 0.076, 0.078, 0.076, tr, W({ [UL]: 1 })),
      R(0.64, 0.065, 0.066, 0.064, tr, W({ [UL]: 1 })),
      R(0.585, 0.058, 0.06, 0.057, tr, W({ [UL]: 0.85, [LL]: 0.15 })),
      R(0.56, 0.056, 0.058, 0.055, tr, W({ [UL]: 0.7, [LL]: 0.3 })),
      R(0.559, 0.064, 0.068, 0.062, COL.bootHi, W({ [UL]: 0.7, [LL]: 0.3 }), { pbr: PBR.leather }), // boot cuff lip
      R(0.535, 0.063, 0.066, 0.061, COL.bootHi, W({ [UL]: 0.6, [LL]: 0.4 }), { pbr: PBR.leather }),
      R(0.5, 0.061, 0.064, 0.06, bt, W({ [UL]: 0.5, [LL]: 0.5 }), { pbr: PBR.leather }),
      R(0.455, 0.058, 0.058, 0.062, bt, W({ [UL]: 0.2, [LL]: 0.8 }), { pbr: PBR.leather }),
      R(0.38, 0.056, 0.054, 0.066, bt, W({ [LL]: 1 }), { pbr: PBR.leather }),
      R(0.3, 0.052, 0.05, 0.06, bt, W({ [LL]: 1 }), { pbr: PBR.leather }),
      R(0.2, 0.045, 0.045, 0.048, bt, W({ [LL]: 1 }), { pbr: PBR.leather }),
      R(0.13, 0.041, 0.043, 0.044, bt, W({ [LL]: 1 }), { pbr: PBR.leather }),
      R(0.09, 0.043, 0.046, 0.046, bt, W({ [LL]: 0.5, [F]: 0.5 }), { pbr: PBR.leather }),
      R(0.06, 0.045, 0.05, 0.05, bt, W({ [F]: 1 }), { pbr: PBR.leather }),
    ];
    legs[S] = tube(acc, ring, { segs: 16 });
    const f = BIND[F], Fw = W({ [F]: 1 });
    sq(acc, [f.x, 0.046, f.z + 0.045], [0.046, 0.042, 0.125], { e1: 0.45, e2: 0.55, col: COL.boot, pbr: PBR.leather, w: Fw, su: 16, sv: 10,
      colFn: (x, y) => (y < -0.55 ? COL.sole : COL.boot) });
    sq(acc, [f.x, 0.085, f.z + 0.005], [0.05, 0.012, 0.055], { e1: 0.3, e2: 0.7, col: COL.strap, pbr: PBR.leather, w: Fw, su: 14, sv: 6 }); // ankle strap
    sq(acc, [f.x + 0.048 * sx, 0.085, f.z + 0.01], [0.006, 0.012, 0.012], { e1: 0.3, e2: 0.3, col: COL.brass, pbr: PBR.metal, w: Fw, su: 8, sv: 6 }); // buckle
  }

  // ---------------- harness network (leather straps)
  strap(acc, torso, loop(0.968, 0.0), { width: 0.034, closed: true });                     // waist belt
  strap(acc, torso, loop(0.905, 0.035, -Math.PI / 2), { width: 0.028, closed: true });     // hip belt (low at the back)
  strap(acc, torso, loop(1.2, 0.0), { width: 0.028, closed: true, off: 0.005 });           // under-chest strap
  for (const sx of [1, -1]) {
    const aF = Math.PI / 2 - 0.62 * sx, aB = -Math.PI / 2 + 0.55 * sx, aS = sx > 0 ? 0.35 : Math.PI - 0.35;
    // shoulder straps: front (chest) up over the shoulder to the back, down to the belt (X across the back)
    strap(acc, torso, line([[1.2, aF], [1.33, aF + 0.1 * sx], [1.43, aS + 0.35 * sx]], 10), { width: 0.026, off: 0.006 });
    strap(acc, torso, line([[1.43, aS - 0.2 * sx], [1.34, aB], [1.2, -Math.PI / 2 - 0.25 * sx], [0.98, -Math.PI / 2 - 0.9 * sx]], 10), { width: 0.026, off: 0.006 });
    // side straps from the belt down each flank
    strap(acc, torso, line([[1.19, sx > 0 ? 0.05 : Math.PI - 0.05], [0.98, sx > 0 ? 0.1 : Math.PI - 0.1]], 8), { width: 0.022, off: 0.006 });
  }
  for (const [S, sx] of [['L', 1], ['R', -1]]) {
    const T = legs[S], out = sx > 0 ? 0 : Math.PI;
    strap(acc, T, loop(0.87, 0.02, out), { width: 0.022, closed: true, off: 0.004 });
    strap(acc, T, loop(0.76, 0.025, out + Math.PI), { width: 0.022, closed: true, off: 0.004 });
    strap(acc, T, loop(0.66, 0.018, out), { width: 0.02, closed: true, off: 0.004 });
    strap(acc, T, line([[0.94, out], [0.62, out]], 12), { width: 0.022, off: 0.007 });                        // outer vertical strap
    strap(acc, T, line([[0.93, Math.PI / 2 + 0.25 * sx], [0.7, Math.PI / 2 - 0.35 * sx], [0.6, Math.PI / 2 - 0.6 * sx]], 8), { width: 0.018, off: 0.007 }); // front diagonal
    // buckles on the thigh loops
    for (const y of [0.87, 0.66]) { const s0 = surf(T, y, Math.PI / 2 + 0.3 * sx, 0.012); sq(acc, s0.p.toArray(), [0.01, 0.014, 0.004], { rot: [0, 0.3 * sx, 0], e1: 0.3, e2: 0.3, col: COL.brass, pbr: PBR.metal, w: s0.w, su: 8, sv: 6 }); }
  }
  // chest buckle / cloak clasp
  sq(acc, [0, 1.2, 0.118], [0.018, 0.018, 0.006], { e1: 0.3, e2: 0.3, col: COL.brass, pbr: PBR.metal, w: SC, su: 10, sv: 6 });
  for (const sx of [1, -1]) sq(acc, [0.06 * sx, 1.43, 0.08], [0.012, 0.012, 0.006], { e1: 0.5, e2: 0.5, col: COL.brass, pbr: PBR.metal, w: Cw, su: 10, sv: 6 });

  // ---------------- hood bunched behind the neck (cloak is the separate cloth sim)
  sq(acc, [0, 1.475, -0.095], [0.12, 0.05, 0.06], { rot: [0.35, 0, 0], e1: 0.8, e2: 0.9, col: COL.cloak, pbr: PBR.cloth, w: CN, su: 18, sv: 10 });
  sq(acc, [0, 1.5, -0.075], [0.09, 0.035, 0.05], { rot: [0.5, 0, 0], e1: 0.8, e2: 0.9, col: COL.cloak, pbr: PBR.cloth, w: CN, su: 14, sv: 8 });

  // ---------------- ODM gear
  const Hg = W({ hips: 1 });
  // gas tank across the lower back + central housing + nozzle
  cyl(acc, [0, 1.0, -0.158], 0.052, 0.135, 'x', { col: COL.steel, pbr: PBR.metal, w: Hg, colFn: (x, y, z) => (Math.abs(y) > 0.9 ? COL.darkSteel : COL.steel) });
  sq(acc, [0, 0.955, -0.165], [0.075, 0.065, 0.05], { e1: 0.35, e2: 0.35, col: COL.gunmetal, pbr: PBR.darkMetal, w: Hg, su: 14, sv: 8 });
  cyl(acc, [0, 0.9, -0.19], 0.02, 0.03, 'y', { rot: [0.6, 0, 0], col: COL.darkSteel, pbr: PBR.darkMetal, w: Hg });
  sq(acc, [0, 0.955, -0.117], [0.1, 0.02, 0.012], { e1: 0.3, e2: 0.3, col: COL.strap, pbr: PBR.leather, w: Hg, su: 12, sv: 6 }); // mounting plate
  for (const sx of [1, -1]) {
    // anchor launchers (wire reels) at the waist
    cyl(acc, [0.172 * sx, 0.935, -0.085], 0.056, 0.027, 'x', { col: COL.gunmetal, pbr: PBR.darkMetal, w: Hg });
    cyl(acc, [0.2 * sx, 0.935, -0.085], 0.03, 0.006, 'x', { col: COL.brass, pbr: PBR.metal, w: Hg });
    cyl(acc, [0.172 * sx, 0.935, -0.02], 0.016, 0.05, 'z', { col: COL.darkSteel, pbr: PBR.darkMetal, w: Hg }); // barrel
    sq(acc, [0.172 * sx, 0.935, 0.034], [0.018, 0.018, 0.012], { e1: 0.6, e2: 1, col: COL.steel, pbr: PBR.metal, w: Hg, su: 10, sv: 6 }); // hook head in the barrel
    // blade boxes (scabbards) on each hip — big rectangular gunmetal boxes, gas canister along the top
    const bx = 0.262 * sx, by = 0.785, bz = -0.13, tilt = -0.14;
    sq(acc, [bx, by, bz], [0.056, 0.098, 0.325], { rot: [tilt, 0, 0], e1: 0.14, e2: 0.14, col: COL.darkSteel, pbr: PBR.darkMetal, w: Hg, su: 18, sv: 10,
      colFn: (x, y, z) => {
        if (z > 0.93) return COL.leatherBox;                                   // front end (blade handles)
        const band = Math.abs(z + 0.35) < 0.035 || Math.abs(z - 0.25) < 0.035 || Math.abs(z - 0.78) < 0.03;
        if (band) return COL.steel;                                             // clamp bands
        if (Math.abs(y) > 0.55 && Math.abs(y) < 0.66) return COL.gunmetal;      // panel seam
        return x * sx > 0.6 ? COL.gunmetal : COL.darkSteel;
      } });
    sq(acc, [bx + 0.004 * sx, by - 0.02, bz + 0.33], [0.05, 0.075, 0.018], { rot: [tilt, 0, 0], e1: 0.3, e2: 0.3, col: COL.gunmetal, pbr: PBR.darkMetal, w: Hg, su: 12, sv: 6 }); // blade ends
    cyl(acc, [bx - 0.004 * sx, by + 0.128, bz - 0.03], 0.043, 0.27, 'z', { rot: [tilt, 0, 0], col: COL.steel, pbr: PBR.metal, w: Hg,
      colFn: (x, y) => (Math.abs(y) > 0.8 ? COL.darkSteel : COL.steel) });
    cyl(acc, [bx - 0.004 * sx, by + 0.13, bz + 0.27], 0.014, 0.035, 'z', { rot: [tilt, 0, 0], col: COL.brass, pbr: PBR.metal, w: Hg }); // valve
    sq(acc, [0.21 * sx, 0.875, -0.05], [0.014, 0.07, 0.014], { rot: [0.25, 0, 0], e1: 0.4, e2: 0.4, col: COL.strap, pbr: PBR.leather, w: Hg, su: 8, sv: 6 }); // hanger strap
    sq(acc, [0.225 * sx, 0.84, -0.2], [0.012, 0.06, 0.012], { rot: [-0.3, 0, 0], e1: 0.4, e2: 0.4, col: COL.strap, pbr: PBR.leather, w: Hg, su: 8, sv: 6 });
  }

  // ---------------- materials + mesh
  const geo = acc.build();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, RIG);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 pbr; varying vec2 vPbr; varying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr; vBind = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vPbr; varying vec3 vBind;
${RIG_GLSL}
float chHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float chNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(chHash(i), chHash(i+vec3(1,0,0)), f.x), mix(chHash(i+vec3(0,1,0)), chHash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(chHash(i+vec3(0,0,1)), chHash(i+vec3(1,0,1)), f.x), mix(chHash(i+vec3(0,1,1)), chHash(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  { float cloth = step(0.75, vPbr.x) * (1.0 - vPbr.y);
    float g = chNoise(vBind * 180.0) * 0.6 + chNoise(vBind * 34.0) * 0.4;           // weave grain + mottling
    float leather = step(0.45, vPbr.x) * step(vPbr.x, 0.56);
    float scuff = chNoise(vBind * 60.0);
    diffuseColor.rgb *= 1.0 + (g - 0.5) * 0.16 * cloth + (scuff - 0.5) * 0.22 * leather;
    diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.02, 0.35, vBind.y));            // grime toward the boots
  }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += heroRig(normal, vViewPosition, diffuseColor.rgb);')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;');
  };
  mat.customProgramCacheKey = () => 'aot-soldier-v5';

  const bones = [];
  for (const [name, parent, x, y, z] of BONES) {
    const b = new THREE.Bone(); b.name = name;
    if (parent) { const p = BIND[parent]; b.position.set(x - p.x, y - p.y, z - p.z); bones[BI[parent]].add(b); }
    else b.position.set(x, y, z);
    bones.push(b);
  }
  const skeleton = new THREE.Skeleton(bones);
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = 'SoldierBody';
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(skeleton);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.2); // explicit: skips three's CPU-skinned bounds pass

  // ---------------- emblem decals (second skinned mesh on the same skeleton)
  const dec = new Acc();
  const decal = (T, y0, a0, hh, ha, off = 0.004, N = 6) => {
    const start = dec.n;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const y = y0 + hh - (2 * hh * j) / N, a = a0 + ha - (2 * ha * i) / N; // u runs left->right as seen from outside
      const s = surf(T, y, a, off);
      dec.v(s.p.x, s.p.y, s.p.z, [1, 1, 1], [0.8, 0], s.w, i / N, 1 - j / N);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = start + j * (N + 1) + i; dec.quad(a, a + N + 1, a + N + 2, a + 1); }
  };
  decal(arms.L, 1.3, 0, 0.042, 0.62, 0.005);
  decal(arms.R, 1.3, Math.PI, 0.042, 0.62, 0.005);
  decal(torso, 1.305, Math.PI / 2 + 0.52, 0.036, 0.23, 0.005);   // chest pocket (left breast)
  decal(torso, 1.27, -Math.PI / 2, 0.095, 0.7, 0.004);           // jacket back (under the cloak)
  const dgeo = dec.build();
  const dmat = new THREE.MeshStandardMaterial({ map: emblemTexture(256), transparent: true, alphaTest: 0.3, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
  const decals = new THREE.SkinnedMesh(dgeo, dmat);
  decals.name = 'SoldierEmblems'; decals.frustumCulled = false; decals.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.2, 0), 1.2); decals.bind(skeleton, mesh.bindMatrix);
  mesh.add(decals);

  // ---------------- blades (child meshes of the hand bones)
  const bladeGeo = makeBladeGeometry();
  const bladeMat = new THREE.MeshStandardMaterial({ map: bladeTexture(), metalness: 0.92, roughness: 0.16, envMapIntensity: 1.6, emissive: 0x0c0f12 });
  bladeMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, RIG);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + RIG_GLSL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += heroRig(normal, vViewPosition, diffuseColor.rgb);');
  };
  bladeMat.customProgramCacheKey = () => 'aot-blade-v2';
  const blades = {}, sockets = {};
  for (const [S, sx] of [['L', 1], ['R', -1]]) {
    const hb = bones[BI['hand' + S]];
    const m = new THREE.Mesh(bladeGeo, bladeMat); m.name = 'blade' + S; m.castShadow = true;
    m.position.set(0, -0.058, 0.115); hb.add(m);
    blades[S] = m;
    const base = new THREE.Object3D(); base.position.set(0, 0, 0.02); m.add(base);
    const tip = new THREE.Object3D(); tip.position.set(0, 0, 1.0); m.add(tip);
    sockets['bladeBase' + S] = base; sockets['bladeTip' + S] = tip;
    const grip = new THREE.Object3D(); grip.position.set(0, -0.058, 0.02); hb.add(grip); sockets['grip' + S] = grip;
    const hips = bones[BI.hips];
    const l = new THREE.Object3D(); l.position.set(0.172 * sx, 0.935 - 0.95, 0.05); hips.add(l); sockets['launcher' + S] = l;
    const can = new THREE.Object3D(); can.position.set(0.258 * sx, 0.9 - 0.95, -0.43); hips.add(can); sockets['canister' + S] = can;
  }
  const nozzle = new THREE.Object3D(); nozzle.position.set(0, 0.88 - 0.95, -0.21); bones[BI.hips].add(nozzle); sockets.nozzle = nozzle;
  const headTop = new THREE.Object3D(); headTop.position.set(0, 0.2, 0); bones[BI.head].add(headTop); sockets.head = headTop;

  const root = new THREE.Group(); root.name = 'Player';
  root.add(mesh);
  return { root, mesh, decals, skeleton, bones, blades, bladeGeo, sockets, materials: { body: mat, blade: bladeMat, decal: dmat } };
}

// ODM blade: long, thin, single-edged, flat, with the slanted cut tip. Along +Z, edge toward -Y.
function makeBladeGeometry() {
  const L = 1.0, H = 0.052, T = 0.0035, cut = 0.07;
  // profile in (z, y): spine at +H/2, edge at -H/2, slanted tip
  const prof = [[0, H / 2], [L - cut, H / 2], [L, -H / 2 + 0.006], [L - 0.004, -H / 2], [0, -H / 2]];
  const pos = [], uv = [], idx = [];
  const addFace = (sx) => {
    const s = pos.length / 3;
    for (const [z, y] of prof) { pos.push(sx * (y < 0 ? T * 0.25 : T), y, z); uv.push(z / L, (y + H / 2) / H); }
    if (sx > 0) idx.push(s, s + 1, s + 4, s + 1, s + 2, s + 4, s + 2, s + 3, s + 4);
    else idx.push(s, s + 4, s + 1, s + 1, s + 4, s + 2, s + 2, s + 4, s + 3);
  };
  addFace(1); addFace(-1);
  // spine strip (top) and tip
  const n = prof.length;
  for (let i = 0; i < n; i++) {
    const a = i, b = (i + 1) % n; // right face a,b ; left face n+a, n+b
    idx.push(a, n + a, b, b, n + a, n + b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// hair shell over the skull: irregular hairline + jagged strand tips, clumpy volume
function hair(acc, w) {
  const c = [0, 1.656, 0.0], ex = [0.094, 0.118, 0.11];
  const su = 30, sv = 9, start = acc.n;
  const vmin = (u) => { // u: azimuth, +Z (front) = +PI/2 in this param (x = cos u, z = sin u)
    const f = Math.sin(u); // 1 front, -1 back
    const side = Math.cos(u);
    return f > 0 ? THREE.MathUtils.lerp(-0.02, 0.2, f) - 0.05 * Math.abs(side) : THREE.MathUtils.lerp(-0.02, -0.72, -f);
  };
  const noise = (a, b) => Math.sin(a * 5.1 + b * 2.3) * 0.5 + Math.sin(a * 11.7 - b * 4.1) * 0.3 + Math.sin(a * 2.3 + 1.7) * 0.2;
  for (let j = 0; j <= sv; j++) {
    for (let i = 0; i < su; i++) {
      const u = -Math.PI + (i / su) * Math.PI * 2;
      let t = j / sv;
      let v = Math.PI / 2 - t * (Math.PI / 2 - vmin(u));
      let r = 1 + 0.05 * noise(u, t * 3) + 0.03 * (1 - t);
      if (j === sv) { // strand tips: alternate long / short
        const tipLen = (i % 2 === 0 ? 0.2 : 0.07) * (Math.sin(u) > 0.3 ? 1.1 : 1);
        v -= tipLen; r *= 0.95;
      }
      if (j === sv - 1) r *= 1.02;
      const cv = Math.cos(v);
      const x = c[0] + ex[0] * r * sp(cv, 0.9) * sp(Math.cos(u), 0.9);
      const y = c[1] + ex[1] * r * sp(Math.sin(v), 0.9);
      const z = c[2] + ex[2] * r * sp(cv, 0.9) * sp(Math.sin(u), 0.9);
      const shade = 0.75 + 0.35 * (0.5 + 0.5 * noise(u * 2.7, t * 5));
      acc.v(x, y, z, [COL.hair[0] * shade, COL.hair[1] * shade, COL.hair[2] * shade], PBR.hair, w);
    }
  }
  for (let j = 0; j < sv; j++) for (let i = 0; i < su; i++) {
    const a = start + j * su + i, b = start + j * su + ((i + 1) % su), cc = start + (j + 1) * su + ((i + 1) % su), d = start + (j + 1) * su + i;
    acc.quad(a, b, cc, d);
  }
  // a second, inner layer so the jagged fringe has thickness (never see-through)
  const s2 = acc.n;
  for (let j = 0; j <= sv; j++) for (let i = 0; i < su; i++) {
    const k = start + j * su + i;
    const x = acc.pos[k * 3], y = acc.pos[k * 3 + 1], z = acc.pos[k * 3 + 2];
    const dx = x - c[0], dy = y - c[1], dz = z - c[2], L = Math.hypot(dx, dy, dz);
    acc.v(c[0] + dx * (1 - 0.012 / L), c[1] + dy * (1 - 0.012 / L), c[2] + dz * (1 - 0.012 / L), COL.hair, PBR.hair, w);
  }
  for (let j = 0; j < sv; j++) for (let i = 0; i < su; i++) {
    const a = s2 + j * su + i, b = s2 + j * su + ((i + 1) % su), cc = s2 + (j + 1) * su + ((i + 1) % su), d = s2 + (j + 1) * su + i;
    acc.quad(a, d, cc, b);
  }
}
