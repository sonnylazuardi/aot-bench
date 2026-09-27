// Procedural titan anatomy: skeleton + SDF sculpt + skinning data + rigid face parts (teeth, eyes).
// Pure JS (worker friendly). buildTemplate(variantName) -> transferable mesh data + rig metadata.
import { SDFModel, Ellipsoid, RoundCone, RBox, polygonize, sdfAO } from './sdf.js';

// bump when the sculpt / meshing changes (invalidates the IndexedDB template cache)
export const TEMPLATE_VERSION = 'tpl-3';

// ---------------------------------------------------------------- variants
// Fractions are of total height H. face params are in head units (head height = 1).
const FACE0 = {
  cranium: [0.36, 0.40, 0.45], jawW: 1, jawLen: 1, chin: 1, grin: 1, lipT: 1, teethN: 12, toothH: 1,
  eyeS: 1, eyeOut: 0, eyeSp: 1, eyeY: 0, pupil: 0.22, iris: 0, brow: 0.6, nose: 1, noseLen: 1, cheek: 1, ears: 1,
  hair: 'short', lid: 0.1, faceFlat: 0, skullTall: 0, gums: 0,
};
export const VARIANTS = {
  average: {
    H: 8.5, seed: 11, head: 0.150, legs: 0.455, shW: 0.25, hipW: 0.205, arm: 1.0, limb: 1.0, belly: 0.35, muscle: 0.55,
    ribs: 0.15, fat: 0.35, neck: 1.0, neckR: 1.05, hunch: 0.12, foot: 1.0, hand: 1.0, tone: [0.92, 0.72, 0.62],
    face: { grin: 1.05, teethN: 12, pupil: 0.18, brow: 0.7, hair: 'short', lid: 0.15 },
  },
  small: {
    H: 4.2, seed: 23, head: 0.205, legs: 0.37, shW: 0.27, hipW: 0.24, arm: 0.92, limb: 1.15, belly: 0.75, muscle: 0.1,
    ribs: 0, fat: 0.85, neck: 0.55, neckR: 1.25, hunch: 0.05, foot: 1.2, hand: 1.1, tone: [0.95, 0.78, 0.68],
    face: { cranium: [0.40, 0.42, 0.46], grin: 1.18, teethN: 12, eyeS: 1.35, pupil: 0.1, brow: 0.2, nose: 0.75, cheek: 1.35, hair: 'bald', lid: 0.0, jawW: 1.1, chin: 0.8, ears: 1.1 },
  },
  large: {
    H: 14, seed: 37, head: 0.135, legs: 0.47, shW: 0.265, hipW: 0.205, arm: 1.02, limb: 1.05, belly: 0.2, muscle: 0.9,
    ribs: 0.1, fat: 0.25, neck: 1.0, neckR: 1.2, hunch: 0.22, foot: 1.0, hand: 1.05, tone: [0.86, 0.61, 0.52],
    face: { cranium: [0.35, 0.38, 0.44], grin: 1.0, teethN: 14, pupil: 0.3, iris: 1, brow: 1.1, nose: 1.25, jawW: 1.15, jawLen: 1.08, chin: 1.3, hair: 'messy', lid: 0.35, cheek: 0.9 },
  },
  bighead: {
    H: 7, seed: 41, head: 0.255, legs: 0.30, shW: 0.30, hipW: 0.25, arm: 0.95, limb: 1.1, belly: 0.55, muscle: 0.2,
    ribs: 0, fat: 0.6, neck: 0.35, neckR: 1.5, hunch: 0.25, foot: 1.25, hand: 1.15, tone: [0.93, 0.74, 0.64],
    face: { cranium: [0.39, 0.40, 0.45], grin: 1.3, teethN: 14, eyeS: 1.15, eyeSp: 1.12, pupil: 0.07, brow: 0.35, nose: 0.9, cheek: 1.2, hair: 'long', lid: 0.0, jawW: 1.2, ears: 1.25 },
  },
  lanky: {
    H: 11.5, seed: 53, head: 0.112, legs: 0.53, shW: 0.21, hipW: 0.17, arm: 1.28, limb: 0.74, belly: 0.0, muscle: 0.4,
    ribs: 0.6, fat: 0.05, neck: 1.5, neckR: 0.8, hunch: 0.4, foot: 1.0, hand: 1.25, tone: [0.90, 0.72, 0.64],
    face: { cranium: [0.33, 0.44, 0.44], grin: 1.2, teethN: 14, pupil: 0.14, eyeS: 0.9, brow: 0.9, nose: 1.3, noseLen: 1.3, jawLen: 1.2, chin: 1.2, hair: 'messy', lid: 0.3, skullTall: 0.1, cheek: 0.75 },
  },
  fat: {
    H: 9, seed: 67, head: 0.145, legs: 0.39, shW: 0.27, hipW: 0.25, arm: 0.95, limb: 1.4, belly: 1.25, muscle: 0.0,
    ribs: 0, fat: 1.0, neck: 0.5, neckR: 1.6, hunch: 0.1, foot: 1.1, hand: 1.1, tone: [0.95, 0.77, 0.67],
    face: { cranium: [0.38, 0.40, 0.45], grin: 1.2, teethN: 12, pupil: 0.14, eyeS: 0.85, brow: 0.3, nose: 1.1, cheek: 1.5, jawW: 1.3, chin: 1.4, hair: 'bald', lid: 0.45 },
  },
  gaunt: {
    H: 10, seed: 71, head: 0.13, legs: 0.48, shW: 0.225, hipW: 0.175, arm: 1.08, limb: 0.66, belly: -0.35, muscle: 0.25,
    ribs: 1.0, fat: 0.0, neck: 1.25, neckR: 0.75, hunch: 0.35, foot: 1.0, hand: 1.15, tone: [0.87, 0.71, 0.65],
    face: { cranium: [0.34, 0.41, 0.44], grin: 1.25, teethN: 16, eyeS: 1.1, eyeOut: 0.012, pupil: 0.1, brow: 1.0, nose: 1.1, cheek: 0.55, jawW: 0.95, hair: 'long', lid: 0.0, gums: 1 },
  },
  abnormal: {
    H: 9, seed: 83, head: 0.15, legs: 0.49, shW: 0.23, hipW: 0.18, arm: 1.12, limb: 0.82, belly: -0.1, muscle: 0.45,
    ribs: 0.5, fat: 0.1, neck: 1.2, neckR: 0.9, hunch: 0.2, foot: 1.05, hand: 1.2, tone: [0.91, 0.67, 0.57],
    face: { cranium: [0.35, 0.40, 0.46], grin: 1.4, teethN: 16, eyeS: 1.3, eyeOut: 0.03, pupil: 0.05, brow: 0.2, nose: 0.8, cheek: 1.0, jawW: 1.05, hair: 'messy', lid: 0.0, gums: 1 },
  },
};

// bone indices
export const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'eyeL', 'eyeR',
  'clavL', 'upperArmL', 'foreArmL', 'handL', 'fingersL', 'fingers2L', 'thumbL',
  'clavR', 'upperArmR', 'foreArmR', 'handR', 'fingersR', 'fingers2R', 'thumbR',
  'thighL', 'shinL', 'footL', 'toesL', 'thighR', 'shinR', 'footR', 'toesR'];
export const BI = Object.fromEntries(BONES.map((n, i) => [n, i]));
const PARENT = {
  hips: -1, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', jaw: 'head', eyeL: 'head', eyeR: 'head',
  clavL: 'chest', upperArmL: 'clavL', foreArmL: 'upperArmL', handL: 'foreArmL', fingersL: 'handL', fingers2L: 'fingersL', thumbL: 'handL',
  clavR: 'chest', upperArmR: 'clavR', foreArmR: 'upperArmR', handR: 'foreArmR', fingersR: 'handR', fingers2R: 'fingersR', thumbR: 'handR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', toesL: 'footL', thighR: 'hips', shinR: 'thighR', footR: 'shinR', toesR: 'footR',
};

// ---------------------------------------------------------------- small math
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// Ellipsoid aligned to an axis: local y = axis, x = side (orthogonalized), z = x × y.
function EA(c, axis, side, rAlong, rSide, rOther) {
  const u = norm(axis);
  let s = sub(side, mul(u, dot(side, u)));
  s = len(s) < 1e-5 ? norm(cross(u, [0, 0, 1])) : norm(s);
  const t = cross(s, u);
  const e = new Ellipsoid(c, [rSide, rAlong, rOther]);
  e.m = [s[0], s[1], s[2], u[0], u[1], u[2], t[0], t[1], t[2]];
  e.br = Math.max(rSide, rAlong, rOther);
  return e;
}

// ---------------------------------------------------------------- build
export function buildTemplate(name, opts = {}) {
  const V = VARIANTS[name];
  const F = { ...FACE0, ...V.face };
  const H = V.H;
  const R = rng(V.seed);
  const jit = (a) => (R() * 2 - 1) * a;
  const fH = (v) => v * H;
  const M = new SDFModel();
  const bonePos = new Array(BONES.length);
  const setB = (n, p) => { bonePos[BI[n]] = p; };

  // ---- skeleton (bind pose, all bone rotations identity) ----
  const hh = V.head * H;                      // head height (chin->crown)
  const chinY = H - hh;
  const neckLen = fH(0.05) * V.neck;
  const shoulderY = chinY - neckLen * 0.55 - fH(0.012);
  const hipJY = V.legs * H;
  const torso = shoulderY - hipJY;
  const hunchZ = -V.hunch * fH(0.03);
  const hipsP = [0, hipJY + fH(0.025), 0];
  const spineP = [0, hipJY + torso * 0.3, fH(-0.008)];
  const chestP = [0, hipJY + torso * 0.62, fH(-0.012) + hunchZ * 0.4];
  const neckP = [0, shoulderY + fH(0.018), fH(-0.028) + hunchZ];
  // head pivot sits in the upper neck, ~0.3 head-heights above the chin
  const headP = [0, chinY + hh * 0.30, fH(-0.012) + hunchZ * 1.2 + hh * 0.02];
  setB('hips', hipsP); setB('spine', spineP); setB('chest', chestP); setB('neck', neckP); setB('head', headP);
  // head-local -> template
  const hp = (x, y, z) => [headP[0] + x * hh, headP[1] + y * hh, headP[2] + z * hh];
  const hr = (a, b, c) => [a * hh, b * hh, c * hh];
  const jawP = hp(0, 0.02, 0.05);
  setB('jaw', jawP);
  const eyeX = 0.155 * F.eyeSp, eyeY = 0.17 + F.eyeY, eyeZ = 0.30 + F.eyeOut;
  const eyeR = 0.075 * F.eyeS;
  const eyeLc = hp(eyeX, eyeY, eyeZ), eyeRc = hp(-eyeX, eyeY, eyeZ);
  setB('eyeL', eyeLc); setB('eyeR', eyeRc);

  const shX = fH(V.shW) * 0.5 * 0.86;
  const armA = 0.80; // radians below horizontal in bind (A pose)
  const upperL = fH(0.185) * V.arm, foreL = fH(0.15) * V.arm, handL = fH(0.105) * V.hand;
  const legs = {}; const arms = {};
  for (const S of ['L', 'R']) {
    const sx = S === 'L' ? 1 : -1;
    const clav = [sx * fH(0.018), shoulderY - fH(0.012), fH(0.018)];
    const sh = [sx * shX, shoulderY - fH(0.022), fH(-0.008)];
    const dir = [sx * Math.cos(armA), -Math.sin(armA), 0.0];
    const el = add(sh, mul(dir, upperL));
    const wr = add(el, mul(norm([dir[0], dir[1], 0.06]), foreL));
    const hdir = norm([dir[0] * 1.0, dir[1], 0.04]);
    const knuck = add(wr, mul(hdir, handL * 0.45));
    const mid = add(knuck, mul(hdir, handL * 0.28));
    const thumb = add(add(wr, mul(hdir, handL * 0.12)), [0, 0, handL * 0.12]);
    setB('clav' + S, clav); setB('upperArm' + S, sh); setB('foreArm' + S, el); setB('hand' + S, wr);
    setB('fingers' + S, knuck); setB('fingers2' + S, mid); setB('thumb' + S, thumb);
    arms[S] = { clav, sh, el, wr, dir, hdir, knuck, mid, thumb, sx };
    const hipX = sx * fH(V.hipW) * 0.5 * 0.52;
    const hj = [hipX, hipJY, 0];
    const kneeY = hipJY * 0.53, ankleY = Math.max(fH(0.038), hipJY * 0.085);
    const kn = [hipX * 0.92, kneeY, fH(0.004)];
    const an = [hipX * 0.9, ankleY, fH(-0.008)];
    const footL = fH(0.145) * V.foot;
    const ball = [an[0] + sx * footL * 0.04, fH(0.012) * V.foot, an[2] + footL * 0.62];
    setB('thigh' + S, hj); setB('shin' + S, kn); setB('foot' + S, an); setB('toes' + S, ball);
    legs[S] = { hj, kn, an, ball, footL, sx };
  }

  const bone = BI;
  const L = V.limb, mus = V.muscle, fat = V.fat;
  const K = (v) => fH(v); // smooth radius helper

  // ---- torso ----
  const swk = V.shW / 0.25;
  const ribTop = shoulderY + fH(0.012), ribBot = hipJY + torso * 0.42;
  const ribC = [0, (ribTop + ribBot) / 2, fH(-0.004) + hunchZ * 0.5];
  const chestW = fH(0.086) * swk * (0.92 + 0.2 * fat);
  const chestD = fH(0.064) * (0.92 + 0.25 * fat);
  M.add(EA(ribC, [0, 1, hunchZ / H * 0.6], [1, 0, 0], (ribTop - ribBot) / 2, chestW, chestD), { k: 0, bone: bone.chest });
  // upper chest block so the shoulders have mass under the clavicles
  M.add(EA([0, shoulderY - fH(0.045), fH(0.004) + hunchZ * 0.6], [1, 0, 0], [0, 1, 0], shX * 0.95, fH(0.05), fH(0.05) * (0.9 + 0.2 * fat)), { k: K(0.05), bone: bone.chest });
  for (const sx of [1, -1]) {
    // lats: flare the back below the armpits
    M.add(EA([sx * fH(0.062) * swk, ribC[1] + fH(0.01), ribC[2] - fH(0.022)], [-sx * 0.25, 1, 0.1], [1, 0, 0], fH(0.1), fH(0.03) * (0.8 + 0.6 * mus), fH(0.038)), { k: K(0.035), bone: bone.chest });
    // pecs: broad flat plates that slope into the armpit
    const pc = [sx * fH(0.045) * swk, shoulderY - fH(0.062), ribC[2] + chestD * 0.62 + fat * fH(0.01)];
    M.add(EA(pc, [sx, -0.35, 0.25], [0, 1, 0], fH(0.052) * swk, fH(0.036) * (1 + 0.5 * fat), fH(0.018) * (0.6 + 0.6 * mus + 0.8 * fat)), { k: K(0.025), bone: bone.chest });
    if (fat > 0.6) // sagging chest fat
      M.add(new Ellipsoid(add(pc, [sx * fH(0.004), -fH(0.03), fH(0.006)]), [fH(0.045), fH(0.035), fH(0.028)]), { k: K(0.03), bone: bone.chest });
    // traps: thick from the neck down to the shoulder cap
    M.add(new RoundCone([sx * fH(0.018), chinY - fH(0.005), fH(-0.03) + hunchZ], [sx * shX * 0.85, shoulderY + fH(0.004), fH(-0.012)], fH(0.03) * (0.8 + 0.5 * mus), fH(0.024), [1, 0.62], [0, 0, 1]), { k: K(0.035), bone: bone.chest });
    // clavicle ridge
    M.add(new RoundCone([sx * fH(0.012), shoulderY - fH(0.004), fH(0.04)], [sx * shX * 0.9, shoulderY + fH(0.004), fH(0.008)], fH(0.008), fH(0.009)), { k: K(0.018), bone: bone.chest });
    // obliques / waist
    M.add(new Ellipsoid([sx * fH(0.058), hipJY + torso * 0.24, fH(0.004)], [fH(0.03) * (1 + fat), fH(0.07), fH(0.05) * (1 + 0.3 * fat)]), { k: K(0.04), bone: bone.spine });
    // shoulder blades
    M.add(EA([sx * fH(0.045) * swk, shoulderY - fH(0.06), ribC[2] - chestD * 0.82], [sx * 0.2, 1, 0], [1, 0, 0], fH(0.045), fH(0.035), fH(0.012)), { k: K(0.02), bone: bone.chest });
  }
  // abdomen
  const abC = [0, (ribBot + hipJY) / 2 + fH(0.02), fH(0.006)];
  M.add(EA(abC, [0, 1, 0], [1, 0, 0], (ribBot - hipJY) / 2 + fH(0.035), fH(0.07) * (0.92 + 0.4 * fat), fH(0.055) * (0.95 + 0.35 * fat)), { k: K(0.05), bone: bone.spine });
  // belly
  if (V.belly > 0) {
    M.add(new Ellipsoid([0, abC[1] - fH(0.01), fH(0.03) + fH(0.03) * V.belly], [fH(0.066) * (0.75 + 0.45 * V.belly), fH(0.07) * (0.7 + 0.45 * V.belly), fH(0.045) * (0.6 + 0.6 * V.belly)]), { k: K(0.06), bone: bone.spine, flush: 0.1 });
    if (V.belly > 0.9) // sagging overhang
      M.add(new Ellipsoid([0, abC[1] - fH(0.06), fH(0.07)], [fH(0.08), fH(0.045), fH(0.05)]), { k: K(0.05), bone: bone.spine });
  } else if (V.belly < 0) {
    // sunken belly under the ribcage
    M.add(new Ellipsoid([0, ribBot + fH(0.005), fH(0.072)], [fH(0.055), fH(0.045), fH(0.03) * -V.belly]), { op: 'sub', k: K(0.04), bone: bone.spine });
  }
  // abs (subtle)
  if (mus > 0.3 && fat < 0.5) {
    for (let r = 0; r < 3; r++) for (const sx of [1, -1]) {
      M.add(new Ellipsoid([sx * fH(0.019), ribBot + fH(0.012) - r * fH(0.034), fH(0.052) + (V.belly > 0 ? fH(0.01) : 0)], [fH(0.018), fH(0.015), fH(0.01) * mus]), { k: K(0.014), bone: bone.spine });
    }
  }
  // pelvis & glutes (narrow, male-ish)
  M.add(EA([0, hipJY + fH(0.02), fH(-0.006)], [0, 1, 0], [1, 0, 0], fH(0.06), fH(V.hipW) * 0.44 * (0.95 + 0.2 * fat), fH(0.058) * (0.9 + 0.25 * fat)), { k: K(0.04), bone: bone.hips });
  for (const sx of [1, -1]) {
    M.add(new Ellipsoid([sx * fH(0.036), hipJY - fH(0.005), fH(-0.042)], [fH(0.04), fH(0.05), fH(0.036) * (0.9 + 0.4 * fat)]), { k: K(0.03), bone: bone.hips });
    if (fat > 0.5) M.add(new Ellipsoid([sx * fH(0.07), abC[1] - fH(0.02), fH(0.0)], [fH(0.035), fH(0.045), fH(0.05)]), { k: K(0.04), bone: bone.spine });
  }
  // smooth, sexless groin
  M.add(new Ellipsoid([0, hipJY - fH(0.025), fH(0.012)], [fH(0.034), fH(0.032), fH(0.036)]), { k: K(0.035), bone: bone.hips });
  // ribs (gaunt): arcs from sternum around the flank
  if (V.ribs > 0.05) {
    for (let r = 0; r < 7; r++) {
      const y = ribTop - fH(0.05) - r * fH(0.021);
      if (y < ribBot + fH(0.01)) break;
      const fr = 1 - Math.abs((y - ribC[1]) / ((ribTop - ribBot) / 2)) ** 2;
      const wx = chestW * Math.sqrt(Math.max(0.2, fr)), wz = chestD * Math.sqrt(Math.max(0.2, fr));
      for (const sx of [1, -1]) {
        const pts = [];
        for (let k = 0; k <= 4; k++) {
          const ang = 0.35 + k * 0.42; // around the side, from front to back
          pts.push([sx * wx * Math.sin(ang) * 1.0, y - fH(0.012) * k * 0.6 + (k === 0 ? fH(0.012) : 0), ribC[2] + wz * Math.cos(ang) * 1.0]);
        }
        for (let k = 0; k < 4; k++) M.add(new RoundCone(pts[k], pts[k + 1], fH(0.0055) * V.ribs, fH(0.0055) * V.ribs), { k: K(0.01), bone: bone.chest });
      }
    }
  }
  // spine groove + navel
  M.add(new RoundCone([0, ribTop - fH(0.03), ribC[2] - chestD - fH(0.004)], [0, hipJY + fH(0.05), fH(-0.064)], fH(0.009), fH(0.009)), { op: 'sub', k: K(0.02), bone: bone.spine });
  M.add(new Ellipsoid([0, hipJY + torso * 0.24, fH(0.058) + (V.belly > 0 ? fH(0.03) * V.belly : 0)], [fH(0.006), fH(0.009), fH(0.012)]), { op: 'sub', k: K(0.008), bone: bone.spine });

  // ---- neck ----
  const nr = fH(0.036) * V.neckR;
  M.add(new RoundCone([0, shoulderY - fH(0.02), fH(-0.012) + hunchZ], hp(0, 0.06, -0.06), nr * 1.25, nr, [1, 0.92], [1, 0, 0]), { k: K(0.035), bone: bone.neck });
  // sternocleidomastoid
  for (const sx of [1, -1]) {
    M.add(new RoundCone([sx * fH(0.01), shoulderY - fH(0.004), fH(0.036)], hp(sx * 0.27, 0.06, -0.06), fH(0.011) * V.neckR, fH(0.014) * V.neckR), { k: K(0.02), bone: bone.neck });
  }
  if (fat > 0.6) M.add(new Ellipsoid(hp(0, -0.28, 0.12), hr(0.3, 0.14, 0.26)), { k: hh * 0.1, bone: bone.jaw }); // double chin

  // ---- arms ----
  for (const S of ['L', 'R']) {
    const A = arms[S], sx = A.sx;
    const up = norm(sub(A.el, A.sh)), fo = norm(sub(A.wr, A.el));
    // deltoid
    M.add(EA(add(A.sh, add(mul(up, fH(0.02)), [sx * fH(0.006), fH(0.004), 0])), up, [0, 0, 1], fH(0.065), fH(0.042) * L * (0.85 + 0.35 * mus), fH(0.043) * L * (0.85 + 0.3 * mus)), { k: K(0.03), bone: bone['upperArm' + S] });
    // upper arm
    M.add(new RoundCone(A.sh, A.el, fH(0.034) * L, fH(0.026) * L), { k: K(0.02), bone: bone['upperArm' + S] });
    // biceps / triceps
    const mid = lerp3(A.sh, A.el, 0.5);
    M.add(EA(add(mid, [0, 0, fH(0.012) * L]), up, [0, 0, 1], fH(0.065), fH(0.022) * L * (0.8 + 0.5 * mus + 0.3 * fat), fH(0.025) * L * (0.8 + 0.4 * mus)), { k: K(0.02), bone: bone['upperArm' + S] });
    M.add(EA(add(lerp3(A.sh, A.el, 0.4), [0, 0, -fH(0.014) * L]), up, [0, 0, 1], fH(0.06), fH(0.024) * L * (0.8 + 0.4 * mus + 0.5 * fat), fH(0.024) * L), { k: K(0.02), bone: bone['upperArm' + S] });
    // elbow knob
    M.add(new Ellipsoid(add(A.el, [0, 0, -fH(0.02) * L]), [fH(0.014) * L, fH(0.014) * L, fH(0.012) * L]), { k: K(0.015), bone: bone['foreArm' + S], flush: 0.6 });
    // forearm
    M.add(new RoundCone(A.el, A.wr, fH(0.028) * L, fH(0.017) * L, [1, 0.72], [0, 0, 1]), { k: K(0.02), bone: bone['foreArm' + S] });
    M.add(EA(lerp3(A.el, A.wr, 0.28), fo, [0, 0, 1], fH(0.05), fH(0.028) * L * (0.8 + 0.4 * mus), fH(0.024) * L), { k: K(0.022), bone: bone['foreArm' + S] });
    // hand: palm + fingers + thumb. Palm faces the body, knuckle row runs along Z.
    const hd = A.hdir, side = [0, 0, 1];
    const palmC = add(A.wr, mul(hd, handL * 0.25));
    const pn = mul(norm(cross(side, hd)), sx); // back-of-hand (dorsal) direction
    M.add(EA(palmC, hd, side, handL * 0.25, fH(0.03) * V.hand, fH(0.012) * V.hand * (0.9 + 0.3 * fat)), { k: K(0.012), bone: bone['hand' + S] });
    // thenar pad
    M.add(EA(add(add(A.wr, mul(hd, handL * 0.15)), [0, 0, fH(0.016)]), hd, side, handL * 0.14, fH(0.012), fH(0.012)), { k: K(0.01), bone: bone['hand' + S] });
    const fl = [0.34, 0.39, 0.37, 0.3];
    for (let f = 0; f < 4; f++) {
      const off = (1.5 - f) * fH(0.0145) * V.hand; // along Z (index at +Z front)
      const splay = (1.5 - f) * 0.05;
      const fd = norm(add(hd, [0, 0, splay]));
      const k0 = add(A.knuck, [0, 0, off]);
      const r0 = fH(0.0078) * V.hand * (f === 3 ? 0.85 : 1) * (0.9 + 0.3 * fat);
      const k1 = add(k0, mul(fd, handL * fl[f] * 0.55));
      const k2 = add(k1, mul(fd, handL * fl[f] * 0.45));
      M.add(new RoundCone(add(k0, mul(hd, -handL * 0.1)), k1, r0 * 1.05, r0 * 0.92), { k: K(0.004), bone: bone['fingers' + S] });
      M.add(new RoundCone(k1, k2, r0 * 0.92, r0 * 0.78), { k: K(0.004), bone: bone['fingers2' + S] });
      // knuckle bumps (flush)
      M.add(new Ellipsoid(add(k0, mul(pn, r0 * 0.35)), [r0 * 0.9, r0 * 0.9, r0 * 0.9]), { k: K(0.005), bone: bone['fingers' + S], flush: 0.7 });
    }
    const td = norm(add(hd, [0, 0, 0.9]));
    const t1 = add(A.thumb, mul(td, handL * 0.22)), t2 = add(t1, mul(td, handL * 0.18));
    M.add(new RoundCone(A.thumb, t1, fH(0.0105) * V.hand, fH(0.0085) * V.hand), { k: K(0.006), bone: bone['thumb' + S] });
    M.add(new RoundCone(t1, t2, fH(0.0085) * V.hand, fH(0.007) * V.hand), { k: K(0.004), bone: bone['thumb' + S] });
    A.palm = add(palmC, mul(pn, -fH(0.03)));
    A.pn = pn;
    A.handEnd = add(A.mid, mul(hd, handL * 0.25));
  }

  // ---- legs ----
  for (const S of ['L', 'R']) {
    const G = legs[S], sx = G.sx;
    M.add(new RoundCone(add(G.hj, [sx * fH(0.008), 0, 0]), G.kn, fH(0.05) * L * (0.9 + 0.35 * fat), fH(0.034) * L, [1, 0.95], [1, 0, 0]), { k: K(0.04), bone: bone['thigh' + S] });
    const th = norm(sub(G.kn, G.hj));
    // quads, hamstrings, adductor
    M.add(EA(add(lerp3(G.hj, G.kn, 0.5), [sx * fH(0.006), 0, fH(0.016) * L]), th, [1, 0, 0], fH(0.11), fH(0.034) * L * (0.85 + 0.3 * mus + 0.3 * fat), fH(0.03) * L * (0.8 + 0.4 * mus)), { k: K(0.03), bone: bone['thigh' + S] });
    M.add(EA(add(lerp3(G.hj, G.kn, 0.45), [0, 0, -fH(0.018) * L]), th, [1, 0, 0], fH(0.1), fH(0.03) * L, fH(0.028) * L * (0.85 + 0.3 * fat)), { k: K(0.03), bone: bone['thigh' + S] });
    M.add(EA(add(lerp3(G.hj, G.kn, 0.3), [-sx * fH(0.016) * L, 0, 0]), th, [1, 0, 0], fH(0.085), fH(0.022) * L * (0.9 + 0.5 * fat), fH(0.03) * L), { k: K(0.03), bone: bone['thigh' + S] });
    // knee cap
    M.add(new Ellipsoid(add(G.kn, [0, fH(0.008), fH(0.03) * L]), [fH(0.02) * L, fH(0.022) * L, fH(0.014) * L]), { k: K(0.02), bone: bone['shin' + S], flush: 0.7 });
    // shin + calf
    M.add(new RoundCone(G.kn, G.an, fH(0.04) * L, fH(0.022) * L), { k: K(0.02), bone: bone['shin' + S] });
    const sh = norm(sub(G.an, G.kn));
    M.add(EA(add(lerp3(G.kn, G.an, 0.3), [0, 0, -fH(0.02) * L]), sh, [1, 0, 0], fH(0.085), fH(0.034) * L * (0.8 + 0.4 * mus + 0.3 * fat), fH(0.03) * L * (0.8 + 0.4 * mus)), { k: K(0.025), bone: bone['shin' + S] });
    // ankle bones
    M.add(new Ellipsoid(G.an, [fH(0.024) * L ** 0.5, fH(0.02), fH(0.02)]), { k: K(0.015), bone: bone['foot' + S] });
    // foot: heel + arch + ball + toes
    const fl = G.footL * 1.0;
    const heel = [G.an[0], fH(0.022) * V.foot, G.an[2] - fl * 0.16];
    M.add(new RoundCone(heel, [G.ball[0], fH(0.018) * V.foot, G.ball[2]], fH(0.024) * V.foot, fH(0.022) * V.foot, [1.45, 0.75], [1, 0, 0]), { k: K(0.02), bone: bone['foot' + S] });
    M.add(new RoundCone(add(G.an, [0, -fH(0.01), 0]), [G.ball[0], fH(0.022) * V.foot, G.ball[2] - fl * 0.12], fH(0.024) * V.foot, fH(0.018) * V.foot, [1.4, 1], [1, 0, 0]), { k: K(0.02), bone: bone['foot' + S] });
    // toes
    for (let t = 0; t < 5; t++) {
      const tx = G.ball[0] + sx * (t - 1.8) * fH(0.0105) * V.foot;
      const tl = fl * (t === 0 ? 0.3 : 0.24 - t * 0.02);
      const tr = fH(t === 0 ? 0.0105 : 0.0078 - t * 0.0006) * V.foot;
      const bz = G.ball[2] - (t * t) * fl * 0.012;
      M.add(new RoundCone([tx, tr * 1.05, bz], [tx - sx * t * fH(0.001), tr * 0.95, bz + tl], tr * 1.1, tr * 0.95), { k: K(0.006), bone: bone['toes' + S] });
    }
  }

  // ---- head (head-local units; head height = 1) ----
  const cr = F.cranium;
  const HB = bone.head, JB = bone.jaw;
  M.add(new Ellipsoid(hp(0, 0.30 + F.skullTall * 0.3, -0.06), hr(cr[0], cr[1] + F.skullTall, cr[2])), { k: 0, bone: HB });
  M.add(new Ellipsoid(hp(0, 0.18, -0.2), hr(cr[0] * 0.85, 0.3, 0.3)), { k: hh * 0.1, bone: HB });
  // temples / forehead front
  M.add(new Ellipsoid(hp(0, 0.34, 0.18), hr(cr[0] * 0.85, 0.24, 0.24)), { k: hh * 0.12, bone: HB });
  // mid face (maxilla)
  M.add(new Ellipsoid(hp(0, 0.03, 0.19), hr(0.26 * F.jawW ** 0.5, 0.2, 0.25)), { k: hh * 0.1, bone: HB });
  // cheekbones + cheeks (the grin bunches them up)
  for (const sx of [1, -1]) {
    M.add(new Ellipsoid(hp(sx * 0.225, 0.08, 0.23), hr(0.09, 0.06, 0.09)), { k: hh * 0.08, bone: HB, flush: 0.3 });
    M.add(new Ellipsoid(hp(sx * 0.2 * F.grin ** 0.5, -0.04, 0.29), hr(0.1 * F.cheek, 0.085, 0.085 * F.cheek)), { k: hh * 0.07, bone: HB, flush: 0.55 });
  }
  // mandible
  const jw = F.jawW, jl = F.jawLen;
  M.add(new Ellipsoid(hp(0, -0.14 * jl, 0.17), hr(0.25 * jw, 0.13 * jl, 0.24)), { k: hh * 0.1, bone: JB });
  for (const sx of [1, -1]) M.add(new RoundCone(hp(sx * 0.25 * jw, 0.02, -0.02), hp(sx * 0.2 * jw, -0.2 * jl, 0.12), hh * 0.06, hh * 0.05), { k: hh * 0.08, bone: JB });
  M.add(new Ellipsoid(hp(0, -0.27 * jl, 0.3), hr(0.1 * F.chin ** 0.5, 0.07, 0.07 * F.chin)), { k: hh * 0.08, bone: JB, flush: 0.2 });
  // brow ridge
  for (const sx of [1, -1]) M.add(new RoundCone(hp(sx * 0.02, 0.265, 0.39), hp(sx * 0.27, 0.27, 0.29), hh * 0.045 * (0.6 + 0.6 * F.brow), hh * 0.04 * (0.5 + 0.5 * F.brow)), { k: hh * 0.06, bone: HB });
  // nose
  const nl = F.noseLen, ns = F.nose;
  M.add(new RoundCone(hp(0, 0.2, 0.4), hp(0, 0.2 - 0.2 * nl, 0.46 + 0.05 * ns), hh * 0.035 * ns, hh * 0.055 * ns, [1, 0.8], [1, 0, 0]), { k: hh * 0.05, bone: HB, flush: 0.5 });
  for (const sx of [1, -1]) M.add(new Ellipsoid(hp(sx * 0.055 * ns, 0.02 - 0.2 * (nl - 1), 0.43 + 0.03 * ns), hr(0.045 * ns, 0.035 * ns, 0.04 * ns)), { k: hh * 0.03, bone: HB, flush: 0.5 });
  // ears
  for (const sx of [1, -1]) {
    M.add(new Ellipsoid(hp(sx * (cr[0] + 0.005), 0.16, -0.03), hr(0.04 * F.ears, 0.12 * F.ears, 0.075 * F.ears), [0, sx * 0.35, sx * 0.12]), { k: hh * 0.03, bone: HB, flush: 0.8 });
  }
  // --- carving ---
  // eye sockets (almond)
  for (const sx of [1, -1]) {
    M.add(new Ellipsoid(hp(sx * eyeX, eyeY + 0.005, eyeZ + eyeR * 0.75), hr(eyeR * 1.32, eyeR * (0.58 + 0.25 * F.eyeS), eyeR * 0.9), [0, 0, -sx * 0.1]), { op: 'sub', k: hh * 0.03, bone: HB });
  }
  // nostrils
  for (const sx of [1, -1]) M.add(new Ellipsoid(hp(sx * 0.035 * ns, -0.01 - 0.2 * (nl - 1), 0.47 + 0.045 * ns), hr(0.016, 0.012, 0.02)), { op: 'sub', k: hh * 0.01, bone: HB });
  // ear concha
  for (const sx of [1, -1]) M.add(new Ellipsoid(hp(sx * (cr[0] + 0.045 * F.ears), 0.15, -0.0), hr(0.02, 0.06 * F.ears, 0.04 * F.ears), [0, sx * 0.35, 0]), { op: 'sub', k: hh * 0.02, bone: HB });
  // the grin: a wide slot across the face front, split between head (upper) and jaw (lower)
  const mouthY = -0.115, gw = 0.3 * F.grin;
  const slot = M.add(new Ellipsoid(hp(0, mouthY, 0.26), hr(gw, 0.04 * F.lipT + 0.012, 0.22)), { op: 'sub', k: hh * 0.02, bone: HB, tag: 3 });
  slot.split = { y: headP[1] + mouthY * hh, below: JB, above: HB };
  // mouth cavity (visible when the jaw drops)
  const cav = M.add(new Ellipsoid(hp(0, mouthY - 0.02, 0.1), hr(gw * 0.8, 0.1, 0.24)), { op: 'sub', k: hh * 0.04, bone: HB, tag: 3 });
  cav.split = { y: headP[1] + (mouthY - 0.02) * hh, below: JB, above: HB };
  // lips, re-added after carving: thin stretched ridges along the arch
  const archZ = (x) => 0.43 - 1.35 * x * x;
  const lipR = hh * 0.022 * F.lipT;
  for (const [yOff, B, tag] of [[0.05, HB, 2], [-0.05, JB, 2]]) {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x0 = -gw * 0.98 + (2 * gw * 0.98) * i / n, x1 = -gw * 0.98 + (2 * gw * 0.98) * (i + 1) / n;
      const y0 = mouthY + yOff * (1 - (x0 / gw) ** 2 * 0.55) + 0.05 * (x0 / gw) ** 2 * (yOff > 0 ? 1 : -0.2);
      const y1 = mouthY + yOff * (1 - (x1 / gw) ** 2 * 0.55) + 0.05 * (x1 / gw) ** 2 * (yOff > 0 ? 1 : -0.2);
      M.add(new RoundCone(hp(x0, y0, archZ(x0 * 0.9) + 0.01), hp(x1, y1, archZ(x1 * 0.9) + 0.01), lipR, lipR), { k: hh * 0.025, bone: B, tag });
    }
  }
  // hair
  if (F.hair === 'short' || F.hair === 'messy' || F.hair === 'long') {
    M.add(new Ellipsoid(hp(0, 0.36 + F.skullTall * 0.3, -0.1), hr(cr[0] + 0.02, cr[1] + F.skullTall - 0.02, cr[2] + 0.005)), { k: hh * 0.02, bone: HB, tag: 1 });
    if (F.hair !== 'short') {
      const n = F.hair === 'long' ? 22 : 16;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        if (Math.cos(a) > 0.3 && Math.abs(Math.sin(a)) < 0.6) continue; // keep the face clear
        const rx = Math.sin(a), rz = Math.cos(a);
        const top = hp(rx * cr[0] * 0.75, 0.55 + jit(0.05), -0.08 + rz * cr[2] * 0.7);
        const dropL = F.hair === 'long' ? 0.75 + jit(0.25) : 0.35 + jit(0.15);
        const bot = hp(rx * (cr[0] + 0.07 + jit(0.03)), 0.55 - dropL, -0.06 + rz * (cr[2] * 0.9 + 0.05) + jit(0.04));
        M.add(new RoundCone(top, bot, hh * (0.05 + jit(0.01)), hh * (0.022 + jit(0.008)), [1, 0.55], [rz, 0, -rx]), { k: hh * 0.03, bone: HB, tag: 1 });
      }
    }
  }

  // ---- domains ----
  M.buildAccel(H / 28, H * 0.05);
  const hBody = H / (opts.bodyRes || 115);
  const box = (lo, hi) => ({ min: lo, max: hi });
  const headBox = box(hp(-0.62, -0.46, -0.66), hp(0.62, 1.0 + F.skullTall, 0.66));
  headBox.min[1] = Math.max(headBox.min[1], shoulderY + fH(0.01));
  const hiBoxes = [];
  const lod1 = !!opts.lod1;
  if (!lod1) {
    hiBoxes.push({ ...headBox, h: hh / (opts.headRes || 40), ao: hh * 0.03, name: 'head' });
    for (const S of ['L', 'R']) {
      const A = arms[S];
      const pts = [A.wr, A.handEnd, add(A.handEnd, [0, 0, handL * 0.4]), add(A.handEnd, [0, 0, -handL * 0.4]), add(A.thumb, mul(norm(add(A.hdir, [0, 0, 0.9])), handL * 0.45))];
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
      const m = fH(0.03);
      hiBoxes.push({ min: [lo[0] - m, lo[1] - m, lo[2] - m], max: [hi[0] + m, hi[1] + m, hi[2] + m], h: handL / 26, ao: handL * 0.08, name: 'hand' + S });
    }
    for (const S of ['L', 'R']) {
      const G = legs[S];
      const m = fH(0.04);
      hiBoxes.push({ min: [G.an[0] - fH(0.05) * V.foot - m * 0.3, -0.02 * H, G.an[2] - G.footL * 0.25], max: [G.an[0] + fH(0.05) * V.foot + m * 0.3, G.an[1] + fH(0.02), G.ball[2] + G.footL * 0.4], h: G.footL / 24, ao: G.footL * 0.06, name: 'foot' + S });
    }
  }
  const ov = hBody * 1.6;
  const inside = (b, x, y, z, s) => x > b.min[0] + s && x < b.max[0] - s && y > b.min[1] + s && y < b.max[1] - s && z > b.min[2] + s && z < b.max[2] - s;
  const allLo = [-fH(0.62), -fH(0.01), -fH(0.2)], allHi = [fH(0.62), H * 1.03, fH(0.3)];
  const domains = [{ min: allLo, max: allHi, h: lod1 ? H / (opts.lodRes || 56) : hBody, ao: fH(0.012), keep: hiBoxes.length ? (x, y, z) => { for (const b of hiBoxes) if (inside(b, x, y, z, ov)) return false; return true; } : null, name: 'body' }, ...hiBoxes];

  const parts = [];
  for (const d of domains) {
    const t0 = performance.now();
    const r = polygonize(M, d);
    r.ao = d.ao; r.name = d.name;
    if (opts.debug) console.log('  domain', d.name, 'tris', r.idx.length / 3, 'ms', (performance.now() - t0).toFixed(0));
    parts.push(r);
  }

  // ---- per-vertex attributes (skin weights, tags, flush, AO, husk thickness) ----
  const NB = BONES.length;
  // husk: the skeletal remnant the corpse shrinks toward
  const husk = new SDFModel();
  const bw = fH(0.012);
  const seg = (a, b, r) => husk.add(new RoundCone(a, b, r, r), {});
  husk.add(new Ellipsoid(hp(0, 0.3, -0.06), hr(cr[0] * 0.88, cr[1] * 0.85, cr[2] * 0.85)), {});
  husk.add(new Ellipsoid(hp(0, -0.12, 0.18), hr(0.2, 0.12, 0.2)), {});
  husk.add(new Ellipsoid([0, chestP[1], chestP[2]], [chestW * 0.8, fH(0.1), fH(0.055)]), {});
  husk.add(new Ellipsoid([0, hipsP[1], 0], [fH(V.hipW) * 0.38, fH(0.045), fH(0.045)]), {});
  seg(hipsP, neckP, bw * 1.3); seg(neckP, headP, bw);
  for (const S of ['L', 'R']) {
    const A = arms[S], G = legs[S];
    seg(A.sh, A.el, bw); seg(A.el, A.wr, bw * 0.9); seg(A.wr, A.handEnd, bw * 0.8); seg(A.clav, A.sh, bw * 0.8);
    seg(G.hj, G.kn, bw * 1.3); seg(G.kn, G.an, bw * 1.1); seg(G.an, add(G.ball, [0, 0, G.footL * 0.2]), bw);
  }
  const TH_SCALE = fH(0.125);
  const P = M.prims;
  const g = [0, 0, 0];

  const tA = performance.now();
  const out = { pos: [], nrm: [], si: [], sw: [], mat: [], info: [], idx: [] };
  let vbase = 0;
  const bwts = new Float32Array(NB);
  for (const part of parts) {
    const { pos, nrm, idx, count } = part;
    const vW = new Float32Array(count * NB);
    const vMat = new Float32Array(count * 4), vInfo = new Float32Array(count * 4);
    for (let v = 0; v < count; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      bwts.fill(0);
      let tw = 0, hair = 0, lip = 0, mouth = 0, flush = 0, best = 1e9, bestB = 0;
      const PL = M.listAt(x, y, z);
      for (let i = 0; i < PL.length; i++) {
        const p = PL[i];
        const dx = x - p.bx, dy = y - p.by, dz = z - p.bz;
        const band = Math.max(p.k, hBody * 0.5) * 1.6 + hBody * 0.6;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) - p.br > band) continue;
        const di = Math.abs(p.d(x, y, z));
        if (di < best) { best = di; bestB = p.split ? (y < p.split.y ? p.split.below : p.split.above) : p.bone; }
        if (di > band) continue;
        let w = 1 - di / band; w = w * w * p.w;
        if (p.sub && !p.tag) w *= 0.3;
        const b = p.split ? (y < p.split.y ? p.split.below : p.split.above) : p.bone;
        bwts[b] += w; tw += w;
        if (p.tag === 1) hair += w; else if (p.tag === 2) lip += w; else if (p.tag === 3) mouth += w;
        flush += p.flush * w;
      }
      if (tw < 1e-6) { bwts[bestB] = 1; tw = 1; }
      for (let b = 0; b < NB; b++) vW[v * NB + b] = bwts[b] / tw;
      vMat[v * 4] = hair / tw; vMat[v * 4 + 1] = lip / tw; vMat[v * 4 + 2] = 0; vMat[v * 4 + 3] = 0;
      const ao = sdfAO(M, x, y, z, nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2], part.ao);
      const th = Math.max(0, husk.d(x, y, z));
      vInfo[v * 4] = ao; vInfo[v * 4 + 1] = Math.min(1, th / TH_SCALE); vInfo[v * 4 + 2] = Math.min(1, flush / tw); vInfo[v * 4 + 3] = Math.min(1, mouth / tw);
    }
    // smooth weights over mesh neighbours (2 passes), only over bones that appear in this part
    const nbr = buildNeighbours(idx, count);
    const used = [];
    for (let b = 0; b < NB; b++) { for (let v = 0; v < count; v++) if (vW[v * NB + b] > 0) { used.push(b); break; } }
    const tmp = new Float32Array(vW.length);
    const st = nbr.start, nl = nbr.list;
    for (let pass = 0; pass < 2; pass++) {
      tmp.set(vW);
      for (let v = 0; v < count; v++) {
        const s0 = st[v], e = st[v + 1];
        if (e === s0) continue;
        const inv = 1 / (e - s0 + 1);
        for (let q = 0; q < used.length; q++) {
          const b = used[q];
          let acc = tmp[v * NB + b];
          for (let j = s0; j < e; j++) acc += tmp[nl[j] * NB + b];
          vW[v * NB + b] = acc * inv;
        }
      }
    }
    for (let v = 0; v < count; v++) {
      // top-4 (insertion, no allocation)
      let i0 = 0, i1 = 0, i2 = 0, i3 = 0, w0 = 0, w1 = 0, w2 = 0, w3 = 0;
      for (let q = 0; q < used.length; q++) {
        const b = used[q], w = vW[v * NB + b];
        if (w <= w3) continue;
        if (w > w0) { i3 = i2; w3 = w2; i2 = i1; w2 = w1; i1 = i0; w1 = w0; i0 = b; w0 = w; }
        else if (w > w1) { i3 = i2; w3 = w2; i2 = i1; w2 = w1; i1 = b; w1 = w; }
        else if (w > w2) { i3 = i2; w3 = w2; i2 = b; w2 = w; }
        else { i3 = b; w3 = w; }
      }
      const sw = w0 + w1 + w2 + w3 || 1;
      out.si.push(i0, i1, i2, i3); out.sw.push(w0 / sw, w1 / sw, w2 / sw, w3 / sw);
      out.pos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      out.nrm.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
      for (let c = 0; c < 4; c++) { out.mat.push(vMat[v * 4 + c]); out.info.push(vInfo[v * 4 + c]); }
    }
    for (let i = 0; i < idx.length; i++) out.idx.push(idx[i] + vbase);
    vbase += count;
  }

  if (opts.debug) console.log('  attrs ms', (performance.now() - tA).toFixed(0));
  // ---- rigid parts: teeth + eyes ----
  const rigid = (positions, normals, indices, boneIdx, matv, infov) => {
    const n = positions.length / 3;
    for (let v = 0; v < n; v++) {
      out.pos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      out.nrm.push(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
      out.si.push(boneIdx, 0, 0, 0); out.sw.push(1, 0, 0, 0);
      const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
      const ao = sdfAO(M, x, y, z, normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2], hh * 0.02);
      out.mat.push(...matv); out.info.push(ao, 0, infov[2], infov[3]);
    }
    for (const i of indices) out.idx.push(i + vbase);
    vbase += n;
  };
  // teeth along the dental arch
  const TN = F.teethN;
  const toothW = (2 * gw * 0.92) / TN;
  for (const upper of [true, false]) {
    for (let i = 0; i < TN; i++) {
      const u = (i + 0.5) / TN * 2 - 1; // -1..1
      const x = u * gw * 0.9;
      const zf = archZ(x) - 0.035;
      const dz = -2.7 * x; // arch slope dz/dx
      const yaw = Math.atan(dz);
      const edge = Math.abs(u);
      const th = 0.075 * F.toothH * (1 - edge * 0.25) * (upper ? 1 : 0.9) + jit(0.006);
      const tw = toothW * (0.94 + jit(0.04)) * (1 - edge * 0.15);
      const td = 0.045 * (1 - edge * 0.2);
      const cy = mouthY + (upper ? th * 0.5 - 0.004 : -th * 0.5 + 0.004);
      const c = hp(x, cy, zf);
      const tooth = superEllipsoid(hr(tw * 0.5, th * 0.55, td * 0.5), 0.35, 0.4, 7, 10);
      transformRigid(tooth, c, yaw + jit(0.08), jit(0.05) + (upper ? 0.06 : -0.06), jit(0.04));
      const yel = 0.25 + R() * 0.5 + edge * 0.3;
      rigid(tooth.pos, tooth.nrm, tooth.idx, upper ? HB : JB, [0, 0, 1, 0], [0, 0, yel, 0]);
    }
  }
  // eyeballs (pole forward so iso-lines of the forward coordinate are circles)
  for (const S of ['L', 'R']) {
    const c = S === 'L' ? eyeLc : eyeRc;
    const eye = eyeSphere(eyeR * hh, 18, 22, 2.0);
    transformRigid(eye, c, 0, 0, 0);
    rigid(eye.pos, eye.nrm, eye.idx, S === 'L' ? bone.eyeL : bone.eyeR, [0, 0, 0, 1], [0, 0, 0, 0]);
  }

  // ---- metadata ----
  const bones = BONES.map((n, i) => ({ name: n, parent: PARENT[n] === -1 ? -1 : BI[PARENT[n]], pos: bonePos[i] }));
  const cap = (b, a0, b0, r) => ({ bone: BI[b], a: sub(a0, bonePos[BI[b]]), b: sub(b0, bonePos[BI[b]]), r });
  const capsules = [
    cap('hips', [0, hipsP[1] - fH(0.03), 0], [0, spineP[1], 0], fH(0.1) * (0.9 + 0.3 * fat)),
    cap('spine', spineP, [0, chestP[1], 0], fH(0.095) * (0.9 + 0.3 * fat + 0.2 * Math.max(0, V.belly))),
    cap('chest', [0, chestP[1], chestP[2]], [0, shoulderY - fH(0.02), chestP[2]], fH(0.1) * (V.shW / 0.25)),
    cap('neck', neckP, headP, nr * 1.1),
    cap('head', hp(0, -0.15, 0.12), hp(0, 0.45, -0.05), hh * 0.42),
  ];
  for (const S of ['L', 'R']) {
    const A = arms[S], G = legs[S];
    capsules.push(cap('upperArm' + S, A.sh, A.el, fH(0.036) * L), cap('foreArm' + S, A.el, A.wr, fH(0.028) * L), cap('hand' + S, A.wr, A.handEnd, fH(0.035) * V.hand),
      cap('thigh' + S, G.hj, G.kn, fH(0.065) * L), cap('shin' + S, G.kn, G.an, fH(0.042) * L), cap('foot' + S, G.an, add(G.ball, [0, 0, G.footL * 0.25]), fH(0.03) * V.foot));
  }
  const meta = {
    name, H, headH: hh, tone: V.tone, bones, capsules,
    eyeL: eyeLc, eyeR: eyeRc, eyeR_: eyeR * hh, pupil: F.pupil, iris: F.iris, lid: F.lid,
    nape: { bone: BI.neck, offset: sub(lerp3(neckP, headP, 0.6), neckP).map((v, i) => i === 2 ? v - nr * 0.9 : v) },
    mouth: { bone: BI.head, offset: sub(hp(0, mouthY, 0.5), headP) },
    palm: { L: { bone: BI.handL, offset: sub(arms.L.palm, arms.L.wr) }, R: { bone: BI.handR, offset: sub(arms.R.palm, arms.R.wr) } },
    thScale: TH_SCALE,
    legLen: { thigh: len(sub(legs.L.kn, legs.L.hj)), shin: len(sub(legs.L.an, legs.L.kn)), ankleY: legs.L.an[1] },
    armLen: { upper: upperL, fore: len(sub(arms.L.wr, arms.L.el)), hand: handL },
    shoulderY, chinY, hipJY,
    hands: { L: { hd: arms.L.hdir, dorsal: arms.L.pn }, R: { hd: arms.R.hdir, dorsal: arms.R.pn } },
  };

  // ---- pack ----
  const nv = out.pos.length / 3;
  const res = {
    meta,
    position: new Float32Array(out.pos), normal: new Float32Array(out.nrm),
    skinIndex: new Uint16Array(out.si), skinWeight: packWeights(out.sw),
    aMat: new Uint8Array(out.mat.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255))),
    aInfo: new Uint8Array(out.info.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255))),
    index: nv > 65535 ? new Uint32Array(out.idx) : new Uint16Array(out.idx),
    tris: out.idx.length / 3, verts: nv,
  };
  return res;
}

// 4 weights per vertex -> normalized uint8 that still sum to 255
function packWeights(sw) {
  const o = new Uint8Array(sw.length);
  for (let v = 0; v < sw.length; v += 4) {
    let rest = 255;
    for (let k = 1; k < 4; k++) { const q = Math.round(sw[v + k] * 255); o[v + k] = q; rest -= q; }
    o[v] = Math.max(0, rest);
  }
  return o;
}

function buildNeighbours(idx, count) {
  const deg = new Int32Array(count + 1);
  for (let i = 0; i < idx.length; i += 3) { deg[idx[i]] += 2; deg[idx[i + 1]] += 2; deg[idx[i + 2]] += 2; }
  const start = new Int32Array(count + 1);
  for (let v = 0; v < count; v++) start[v + 1] = start[v] + deg[v];
  const fill = start.slice(0, count);
  const list = new Int32Array(start[count]);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    list[fill[a]++] = b; list[fill[a]++] = c; list[fill[b]++] = a; list[fill[b]++] = c; list[fill[c]++] = a; list[fill[c]++] = b;
  }
  return { start, list };
}

const spow = (v, e) => Math.sign(v) * Math.abs(v) ** e;
function superEllipsoid(r, e1, e2, nLat, nLon) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= nLat; i++) {
    const v = -Math.PI / 2 + Math.PI * i / nLat;
    for (let j = 0; j <= nLon; j++) {
      const u = -Math.PI + 2 * Math.PI * j / nLon;
      const cv = Math.cos(v), sv = Math.sin(v), cu = Math.cos(u), su = Math.sin(u);
      pos.push(r[0] * spow(cv, e1) * spow(cu, e2), r[1] * spow(sv, e1), r[2] * spow(cv, e1) * spow(su, e2));
      const n = norm([spow(cv, 2 - e1) * spow(cu, 2 - e2) / r[0], spow(sv, 2 - e1) / r[1], spow(cv, 2 - e1) * spow(su, 2 - e2) / r[2]]);
      nrm.push(...n);
    }
  }
  const W = nLon + 1;
  for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) {
    const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  return { pos, nrm, idx };
}
function eyeSphere(r, nRing, nSeg, maxTheta) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= nRing; i++) {
    const th = maxTheta * i / nRing;
    for (let j = 0; j <= nSeg; j++) {
      const ph = 2 * Math.PI * j / nSeg;
      const n = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      pos.push(n[0] * r, n[1] * r, n[2] * r); nrm.push(...n);
    }
  }
  const W = nSeg + 1;
  for (let i = 0; i < nRing; i++) for (let j = 0; j < nSeg; j++) {
    const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  return { pos, nrm, idx };
}
// rotate (yaw about Y, pitch about X, roll about Z) then translate
function transformRigid(m, c, yaw, pitch, roll) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const rot = (x, y, z) => {
    // roll (Z)
    let x1 = x * cr - y * sr, y1 = x * sr + y * cr, z1 = z;
    // pitch (X)
    let y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp, x2 = x1;
    // yaw (Y)
    return [x2 * cy + z2 * sy, y2, -x2 * sy + z2 * cy];
  };
  for (let i = 0; i < m.pos.length; i += 3) {
    const p = rot(m.pos[i], m.pos[i + 1], m.pos[i + 2]);
    m.pos[i] = p[0] + c[0]; m.pos[i + 1] = p[1] + c[1]; m.pos[i + 2] = p[2] + c[2];
    const n = rot(m.nrm[i], m.nrm[i + 1], m.nrm[i + 2]);
    m.nrm[i] = n[0]; m.nrm[i + 1] = n[1]; m.nrm[i + 2] = n[2];
  }
}
