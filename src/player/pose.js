// Procedural pose model + library + application to the soldier skeleton (all allocation-free per frame).
// Character space: +Y up, +Z forward, +X = character's LEFT.
// Euler triplets are [pitch (about X, + = bend forward), yaw (about Y, + = turn left), roll (about Z, + = tilt right)].
// Arm directions (upper arm ua, forearm la, blade bd) are in CHEST space; leg directions (ul thigh, ll shin) in HIPS space.
import * as THREE from 'three';
import { BIND, BI } from './character.js';

const TAU = Math.PI * 2;
const EUL = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'shR', 'ftL', 'ftR'];
const DIRS = ['uaL', 'laL', 'bdL', 'uaR', 'laR', 'bdR', 'ulL', 'llL', 'ulR', 'llR'];
const SCAL = ['hipY', 'hipZ'];

export function makePose() {
  const p = {};
  for (const k of EUL) p[k] = [0, 0, 0];
  for (const k of DIRS) p[k] = new THREE.Vector3(0, -1, 0);
  for (const k of SCAL) p[k] = 0;
  return p;
}
export function zeroPose(p) {
  for (const k of EUL) { p[k][0] = p[k][1] = p[k][2] = 0; }
  for (const k of DIRS) p[k].set(0, 0, 0);
  for (const k of SCAL) p[k] = 0;
}
export function addPose(out, p, w) {
  for (const k of EUL) { const a = out[k], b = p[k]; a[0] += b[0] * w; a[1] += b[1] * w; a[2] += b[2] * w; }
  for (const k of DIRS) out[k].addScaledVector(p[k], w);
  for (const k of SCAL) out[k] += p[k] * w;
}
export function finishPose(p, wsum) {
  const iw = wsum > 1e-6 ? 1 / wsum : 1;
  for (const k of EUL) { const a = p[k]; a[0] *= iw; a[1] *= iw; a[2] *= iw; }
  for (const k of DIRS) { if (p[k].lengthSq() < 1e-8) p[k].set(0, -1, 0); p[k].normalize(); }
  for (const k of SCAL) p[k] *= iw;
}
export function copyPose(src, out) { zeroPose(out); addPose(out, src, 1); return out; }

// ------------------------------------------------------------------ helpers (write into pose)
const e3 = (a, p, y, r) => { a[0] = p; a[1] = y; a[2] = r; };
const dv = (v, x, y, z) => v.set(x, y, z).normalize();
// leg from thigh swing angle (forward +) and knee bend (+), side splay sx*out
function leg(p, S, thigh, knee, out = 0.05) {
  const sx = S === 'L' ? 1 : -1;
  dv(p['ul' + S], out * sx, -Math.cos(thigh), Math.sin(thigh));
  const a = thigh - knee;
  dv(p['ll' + S], out * 0.6 * sx, -Math.cos(a), Math.sin(a));
}
// mirror-aware arm: x given for the LEFT side, flipped for R
function arm(p, S, ua, la, bd) {
  const sx = S === 'L' ? 1 : -1;
  dv(p['ua' + S], ua[0] * sx, ua[1], ua[2]);
  dv(p['la' + S], la[0] * sx, la[1], la[2]);
  dv(p['bd' + S], bd[0] * sx, bd[1], bd[2]);
}
const sm = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// ------------------------------------------------------------------ pose library
export const POSE = {
  idle(p, t) {
    zeroPose(p);
    const br = Math.sin(t * TAU * 0.28) * 0.018, sway = Math.sin(t * TAU * 0.13) * 0.02;
    e3(p.hips, 0.02, 0.05, sway); e3(p.spine, 0.04, -0.03, -sway * 0.6); e3(p.chest, -0.03 + br, -0.03, 0); e3(p.head, 0.06, 0.04, 0);
    arm(p, 'L', [0.22, -1, -0.02], [0.14, -1, 0.3], [0.45, -0.55, -0.72]);
    arm(p, 'R', [0.22, -1, 0.0], [0.14, -1, 0.34], [0.42, -0.6, -0.7]);
    e3(p.shL, 0, 0, -br); e3(p.shR, 0, 0, br);
    leg(p, 'L', 0.03, 0.08, 0.14); leg(p, 'R', -0.04, 0.05, 0.12);
    e3(p.ftL, 0, 0.12, 0); e3(p.ftR, 0.04, -0.1, 0);
    p.hipY = -0.012;
  },
  // phase 0..1, k 0 (jog) .. 1 (sprint)
  run(p, phase, k) {
    zeroPose(p);
    const s = Math.sin(phase * TAU), c = Math.cos(phase * TAU);
    const amp = 0.55 + 0.35 * k;
    const kL = 0.2 + (1.1 + 0.8 * k) * Math.max(0, Math.sin(phase * TAU - 1.5));
    const kR = 0.2 + (1.1 + 0.8 * k) * Math.max(0, Math.sin(phase * TAU + Math.PI - 1.5));
    leg(p, 'L', amp * s + 0.1, kL, 0.05); leg(p, 'R', -amp * s + 0.1, kR, 0.05);
    e3(p.ftL, -0.3 * s, 0, 0); e3(p.ftR, 0.3 * s, 0, 0);
    e3(p.hips, 0.14 + 0.16 * k, 0.14 * s, 0); e3(p.spine, 0.08, -0.12 * s, 0); e3(p.chest, 0.04 + 0.06 * k, -0.1 * s, 0);
    e3(p.head, -0.12 - 0.12 * k, 0.08 * s, 0);
    // AoT run: grips held low and back, blades trailing behind like fins
    const sw = 0.28 * s * (1 - 0.4 * k);
    arm(p, 'L', [0.32, -0.85, -0.3 + sw], [0.25, -0.75, 0.25 + sw], [0.5, -0.1, -0.86]);
    arm(p, 'R', [0.32, -0.85, -0.3 - sw], [0.25, -0.75, 0.25 - sw], [0.5, -0.1, -0.86]);
    p.hipY = -0.03 - 0.045 * Math.abs(c) - 0.03 * k; p.hipZ = 0.02;
  },
  jump(p, t) { // rising
    zeroPose(p);
    leg(p, 'L', 1.0, 1.5, 0.08); leg(p, 'R', 0.25, 0.9, 0.06);
    e3(p.ftL, 0.3, 0, 0); e3(p.ftR, 0.3, 0, 0);
    e3(p.hips, 0.12, 0, 0); e3(p.chest, -0.08, 0, 0); e3(p.head, -0.1, 0, 0);
    arm(p, 'L', [0.55, -0.55, -0.35], [0.5, -0.2, 0.3], [0.55, 0.1, -0.83]);
    arm(p, 'R', [0.55, -0.55, -0.35], [0.5, -0.2, 0.3], [0.55, 0.1, -0.83]);
  },
  fall(p, t) {
    zeroPose(p);
    const w = Math.sin(t * 7) * 0.08;
    leg(p, 'L', 0.35 + w, 0.9, 0.16); leg(p, 'R', -0.1 - w, 0.6, 0.14);
    e3(p.hips, 0.1, 0, 0); e3(p.chest, -0.1, 0, 0); e3(p.head, -0.2, 0, 0);
    arm(p, 'L', [0.85, -0.25 + w, 0.2], [0.75, 0.2, 0.55], [0.3, 0.2, -0.93]);
    arm(p, 'R', [0.85, -0.25 - w, 0.2], [0.75, 0.2, 0.55], [0.3, 0.2, -0.93]);
  },
  // free flight (body frame already aligned head-first-ish along velocity by the controller). k = speed factor.
  fly(p, t, k) {
    zeroPose(p);
    const f = Math.sin(t * 9) * 0.04 * k;
    leg(p, 'L', -0.18 + f, 0.35 + 0.1 * k, 0.07); leg(p, 'R', -0.05 - f, 0.55 + 0.1 * k, 0.05);
    e3(p.ftL, -0.5, 0, 0); e3(p.ftR, -0.5, 0, 0);
    e3(p.hips, -0.05, 0, 0); e3(p.spine, 0.02, 0, 0); e3(p.chest, -0.06, 0, 0); e3(p.head, -0.45 * k - 0.1, 0, 0);
    // arms reach forward-down on the grips, blades swept back and out like wings
    arm(p, 'L', [0.42, -0.5, 0.75], [0.32, -0.3, 0.9], [0.68, 0.12, -0.72]);
    arm(p, 'R', [0.42, -0.5, 0.75], [0.32, -0.3, 0.9], [0.68, 0.12, -0.72]);
  },
  // attached swing: phase -1 (behind, falling in) .. 0 (bottom) .. 1 (front, rising). hangs from the hip launchers
  swing(p, t, phase) {
    zeroPose(p);
    const tuck = sm(0.55 + phase * 0.6), trail = sm(-phase * 1.2);
    leg(p, 'L', 0.35 + 1.1 * tuck - 0.45 * trail, 0.7 + 1.3 * tuck, 0.1);
    leg(p, 'R', 0.1 + 0.9 * tuck - 0.35 * trail, 1.0 + 1.1 * tuck, 0.08);
    e3(p.ftL, 0.1 - 0.4 * trail, 0, 0); e3(p.ftR, 0.1 - 0.4 * trail, 0, 0);
    e3(p.hips, 0.08 - 0.2 * trail + 0.12 * tuck, 0, 0); e3(p.spine, 0.08 * tuck, 0, 0); e3(p.chest, -0.06, 0, 0); e3(p.head, -0.22 + 0.1 * trail, 0, 0);
    // arms spread wide on the grips, blades swept out and back like wings (readable silhouette from behind)
    arm(p, 'L', [0.82, -0.3, 0.42], [0.72, -0.08, 0.66], [0.78, 0.12, -0.6]);
    arm(p, 'R', [0.82, -0.3, 0.42], [0.72, -0.08, 0.66], [0.78, 0.12, -0.6]);
  },
  // winch pulling hard toward the anchor: streamlined, legs trailing, grips forward
  reel(p, t) {
    zeroPose(p);
    const f = Math.sin(t * 13) * 0.05;
    leg(p, 'L', -0.12 + f, 0.25, 0.05); leg(p, 'R', 0.05 - f, 0.6, 0.04);
    e3(p.ftL, -0.6, 0, 0); e3(p.ftR, -0.6, 0, 0);
    e3(p.hips, -0.08, 0, 0); e3(p.chest, -0.08, 0, 0); e3(p.head, -0.55, 0, 0);
    arm(p, 'L', [0.3, -0.35, 0.9], [0.22, -0.2, 1], [0.72, 0.2, -0.66]);
    arm(p, 'R', [0.3, -0.35, 0.9], [0.22, -0.2, 1], [0.72, 0.2, -0.66]);
  },
  // gas boost: superman line, arms swept back along the body, blades out like wings
  boost(p, t) {
    zeroPose(p);
    const f = Math.sin(t * 16) * 0.035;
    leg(p, 'L', -0.08 + f, 0.12, 0.04); leg(p, 'R', -0.02 - f, 0.25, 0.03);
    e3(p.ftL, -0.8, 0, 0); e3(p.ftR, -0.8, 0, 0);
    e3(p.hips, -0.04, 0, 0); e3(p.chest, -0.1, 0, 0); e3(p.head, -0.7, 0, 0);
    arm(p, 'L', [0.42, -0.3, -0.86], [0.4, -0.15, -0.9], [0.88, 0.25, -0.4]);
    arm(p, 'R', [0.42, -0.3, -0.86], [0.4, -0.15, -0.9], [0.88, 0.25, -0.4]);
  },
  // feet planted on a facade (frame: body up = wall normal). run = 0 crouched, phase = wall-run cycle
  wall(p, t, run, phase) {
    zeroPose(p);
    const s = Math.sin(phase * TAU);
    const kL = 1.5 - run * (0.9 - 0.9 * Math.max(0, s)), kR = 1.5 - run * (0.9 - 0.9 * Math.max(0, -s));
    leg(p, 'L', 1.0 - run * (0.6 - 0.7 * s), kL, 0.14); leg(p, 'R', 0.9 - run * (0.6 + 0.7 * s), kR, 0.14);
    e3(p.ftL, -0.5, 0, 0); e3(p.ftR, -0.5, 0, 0);
    e3(p.hips, 0.45 - 0.2 * run, 0, 0); e3(p.spine, 0.12, 0, 0); e3(p.chest, 0.05, 0, 0); e3(p.head, -0.35, 0, 0);
    p.hipY = -0.38 + 0.2 * run;
    arm(p, 'L', [0.6, -0.55, 0.45], [0.45, -0.1, 0.9], [0.6, 0.35, -0.72]);
    arm(p, 'R', [0.6, -0.55, 0.45], [0.45, -0.1, 0.9], [0.6, 0.35, -0.72]);
  },
  // spinning nape slash: arms flung out, blades leading the spin (root spin handled by the controller)
  slash(p, t, u) {
    zeroPose(p);
    const k = sm(u / 0.15) * (1 - sm((u - 0.8) / 0.2));
    leg(p, 'L', 0.55 * k, 1.1 * k + 0.2, 0.1); leg(p, 'R', 0.2 * k, 0.9 * k + 0.2, 0.08);
    e3(p.hips, 0.1 * k, 0, 0); e3(p.chest, 0.1 * k, 0.25 * k, 0); e3(p.head, -0.3, -0.2 * k, 0);
    arm(p, 'L', [1, 0.1, 0.25], [1, 0.05, 0.45], [0.55, 0.25, 0.8]);
    arm(p, 'R', [1, 0.1, -0.1], [1, 0.05, 0.1], [0.6, -0.25, -0.76]);
  },
  // wind-up before the slash (blades cocked back over the shoulder)
  windup(p) {
    zeroPose(p);
    leg(p, 'L', 0.7, 1.4, 0.1); leg(p, 'R', 0.3, 1.2, 0.08);
    e3(p.hips, 0.2, 0, 0); e3(p.spine, 0.1, -0.35, 0); e3(p.chest, 0.05, -0.35, 0); e3(p.head, -0.3, 0.5, 0);
    arm(p, 'L', [0.45, 0.4, -0.8], [0.3, 0.7, -0.65], [0.7, -0.3, -0.64]);
    arm(p, 'R', [0.55, 0.2, -0.8], [0.5, 0.5, -0.7], [0.8, -0.2, -0.56]);
  },
  land(p, sev) { // superhero-ish crouch, deeper with severity
    zeroPose(p);
    const d = 0.6 + 0.4 * sev;
    leg(p, 'L', 1.25 * d, 2.3 * d, 0.14); leg(p, 'R', 0.35 * d, 1.9 * d, 0.1);
    e3(p.ftL, -0.3, 0, 0); e3(p.ftR, 0.4, 0, 0);
    e3(p.hips, 0.5 * d, 0, 0); e3(p.spine, 0.2, 0, 0); e3(p.chest, 0.15, 0, 0); e3(p.head, -0.55, 0, 0);
    p.hipY = -0.42 * d; p.hipZ = -0.03;
    arm(p, 'L', [0.75, -0.55, 0.2], [0.6, -0.7, 0.3], [0.6, -0.1, -0.8]);
    arm(p, 'R', [0.35, -0.8, 0.45], [0.2, -0.9, 0.4], [0.4, -0.2, -0.9]);
  },
  roll(p) { // tucked ball (the controller spins the root)
    zeroPose(p);
    leg(p, 'L', 1.9, 2.6, 0.12); leg(p, 'R', 1.8, 2.6, 0.1);
    e3(p.hips, 0.6, 0, 0); e3(p.spine, 0.45, 0, 0); e3(p.chest, 0.35, 0, 0); e3(p.head, 0.4, 0, 0);
    p.hipY = -0.35;
    arm(p, 'L', [0.35, -0.45, 0.8], [0.2, 0.4, 0.9], [0.4, 0.4, -0.82]);
    arm(p, 'R', [0.35, -0.45, 0.8], [0.2, 0.4, 0.9], [0.4, 0.4, -0.82]);
  },
  grabbed(p, t, struggle) {
    zeroPose(p);
    const s = Math.sin(t * 11), c = Math.sin(t * 7.3 + 1);
    leg(p, 'L', 0.3 + 0.5 * s * struggle, 0.6 + 0.6 * Math.max(0, s), 0.1); leg(p, 'R', 0.2 - 0.5 * s * struggle, 0.7 + 0.6 * Math.max(0, -s), 0.1);
    e3(p.hips, 0.1, 0.1 * c, 0); e3(p.spine, -0.1, 0.2 * c * struggle, 0); e3(p.chest, -0.15, 0.2 * c * struggle, 0.1 * s); e3(p.head, -0.3, 0.3 * s, 0);
    arm(p, 'L', [0.3, -0.9, 0.1], [0.2, -0.9, 0.3], [0.5, -0.3, -0.8]);                         // pinned
    const hack = Math.sin(t * 14);
    arm(p, 'R', [0.4, 0.5 + 0.4 * hack, 0.7], [0.3, 0.2 + 0.7 * hack, 0.8], [0.3, -0.9 * hack, 0.5]); // hacking at the fingers
  },
  dead(p, t) {
    zeroPose(p);
    leg(p, 'L', 0.35, 0.8, 0.2); leg(p, 'R', 0.05, 0.3, 0.16);
    e3(p.hips, 0.1, 0, 0.1); e3(p.spine, 0.2, 0.1, 0); e3(p.chest, 0.15, 0.1, 0.1); e3(p.head, 0.6, 0.3, 0.3);
    arm(p, 'L', [0.6, -0.8, 0.1], [0.5, -0.8, 0.3], [0.8, -0.5, 0.3]);
    arm(p, 'R', [0.2, -0.95, 0.3], [0.1, -1, 0.1], [0.3, -0.9, -0.3]);
  },
  hurt(p) { // flinch
    zeroPose(p);
    leg(p, 'L', 0.4, 0.9, 0.1); leg(p, 'R', -0.2, 0.5, 0.1);
    e3(p.hips, -0.15, 0, 0.1); e3(p.chest, -0.3, 0.2, 0.15); e3(p.head, -0.4, 0.3, 0);
    arm(p, 'L', [0.8, -0.2, -0.3], [0.7, 0.3, 0.3], [0.5, 0.3, -0.8]);
    arm(p, 'R', [0.8, 0.0, 0.2], [0.6, 0.5, 0.5], [0.4, 0.4, -0.8]);
  },
};

// ------------------------------------------------------------------ apply to skeleton
const bindDir = {};
for (const [u, l] of [['upperArmL', 'lowerArmL'], ['lowerArmL', 'handL'], ['upperArmR', 'lowerArmR'], ['lowerArmR', 'handR'],
  ['upperLegL', 'lowerLegL'], ['lowerLegL', 'footL'], ['upperLegR', 'lowerLegR'], ['lowerLegR', 'footR']]) {
  bindDir[u] = BIND[l].clone().sub(BIND[u]).normalize();
}
const _e = new THREE.Euler(), _qh = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _qsh = new THREE.Quaternion();
const _qu = new THREE.Quaternion(), _ql = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const eq = (a, out) => out.setFromEuler(_e.set(a[0], a[1], a[2], 'YXZ'));
const hipsBind = BIND.hips.clone();

export function applyPose(bones, P) {
  const b = (n) => bones[BI[n]];
  // spine chain (local eulers)
  const hips = b('hips');
  hips.position.set(hipsBind.x, hipsBind.y + P.hipY, hipsBind.z + P.hipZ);
  eq(P.hips, hips.quaternion);
  eq(P.spine, b('spine').quaternion);
  eq(P.chest, b('chest').quaternion);
  eq(P.neck, b('neck').quaternion);
  eq(P.head, b('head').quaternion);
  // arms: directions in chest space -> shoulder-local minimal rotations
  for (const S of ['L', 'R']) {
    const sh = b('shoulder' + S); eq(P['sh' + S], sh.quaternion);
    _qsh.copy(sh.quaternion).invert();                                    // chest -> shoulder space
    // upper arm
    _v.copy(P['ua' + S]).applyQuaternion(_qsh);
    const ua = b('upperArm' + S); ua.quaternion.setFromUnitVectors(bindDir['upperArm' + S], _v);
    // forearm: target in upper-arm space
    _qu.copy(sh.quaternion).multiply(ua.quaternion);                       // upper arm in chest space
    _qt.copy(_qu).invert();
    _v.copy(P['la' + S]).applyQuaternion(_qt);
    const la = b('lowerArm' + S); la.quaternion.setFromUnitVectors(bindDir['lowerArm' + S], _v);
    _ql.copy(_qu).multiply(la.quaternion);                                 // forearm in chest space
    // hand: blade (+Z bind) along bd, fist 'up' (+Y bind, toward the elbow) opposite the forearm
    _z.copy(P['bd' + S]);
    _y.copy(P['la' + S]).negate(); _y.addScaledVector(_z, -_y.dot(_z));
    if (_y.lengthSq() < 1e-4) _y.set(0, 1, 0).addScaledVector(_z, -_z.y);
    _y.normalize(); _x.crossVectors(_y, _z);
    _m.makeBasis(_x, _y, _z); _qh.setFromRotationMatrix(_m);                // hand in chest space
    const hd = b('hand' + S); hd.quaternion.copy(_ql).invert().multiply(_qh);
  }
  // legs: directions in hips space
  for (const S of ['L', 'R']) {
    const ul = b('upperLeg' + S); ul.quaternion.setFromUnitVectors(bindDir['upperLeg' + S], P['ul' + S]);
    _qt.copy(ul.quaternion).invert();
    _v.copy(P['ll' + S]).applyQuaternion(_qt);
    const ll = b('lowerLeg' + S); ll.quaternion.setFromUnitVectors(bindDir['lowerLeg' + S], _v);
    eq(P['ft' + S], b('foot' + S).quaternion);
  }
}
