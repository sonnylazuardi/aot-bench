// The giant's anatomy: the COLOSSAL TITAN (skinless striated muscle, pale fascia plates on the skull, lipless jaw).
// (history: previously a smiling pure titan) Skeleton + ordered SDF primitive list, sculpted as a 1.8 m
// human (model units, +Y up, facing +Z, +X = its left) and scaled up by the rig.
// Soft skin-covered body, oversized head with an enormous clenched rictus grin, squinting crescent eyes,
// crow's-feet, deep nasolabial folds, big nose, and shoulder-length hair parted in the middle (separate part).
// Op masks feeding the skin shader: tendon(=nail/pale), gum, lip, flush (blush), hair.
import { Sculpt } from './sculpt.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mx = (p) => [-p[0], p[1], p[2]];

// head is oversized around the neck joint (uncanny pure-titan proportions)
export const HS = 1.08;
export const HEAD_C = [0, 1.755, 0.004];
export const EYE_X = 0.038;
export const HAIR_HEM = -0.172;   // head-local y of the blunt shoulder-length hem
export const H = (x, y, z) => [HEAD_C[0] + x * HS, HEAD_C[1] + y * HS, HEAD_C[2] + z * HS];
const R = (r) => r * HS;

const A = 38 * Math.PI / 180;
export const ARM = {
  shoulder: [0.215, 1.445, -0.008], dir: [Math.sin(A), -Math.cos(A), 0], upper: 0.35, fore: 0.32,
  dorsal: [Math.cos(A), Math.sin(A), 0], thumb: [0, 0, 1],
};
ARM.elbow = add(ARM.shoulder, mul(ARM.dir, ARM.upper));
ARM.wrist = add(ARM.elbow, mul(ARM.dir, ARM.fore));
export const LEG = { hip: [0.09, 0.92, 0], knee: [0.098, 0.5, 0.014], ankle: [0.106, 0.085, -0.014] };

function handFrame(side) {
  const W = side > 0 ? ARM.wrist : mx(ARM.wrist);
  const F = side > 0 ? ARM.dir : mx(ARM.dir);
  const D = side > 0 ? ARM.dorsal : mx(ARM.dorsal);
  const T = ARM.thumb;
  return { W, F, D, T, p: (x, y, z) => [W[0] + T[0] * x + F[0] * y + D[0] * z, W[1] + T[1] * x + F[1] * y + D[1] * z, W[2] + T[2] * x + F[2] * y + D[2] * z],
    v: (x, y, z) => [T[0] * x + F[0] * y + D[0] * z, T[1] * x + F[1] * y + D[1] * z, T[2] * x + F[2] * y + D[2] * z] };
}
export const FINGERS = [
  { name: 'index', base: [0.028, 0.118, 0.003], dir: [0.07, 1, 0], len: [0.05, 0.031, 0.025], r: [0.0112, 0.0088] },
  { name: 'middle', base: [0.009, 0.122, 0.004], dir: [0.0, 1, 0], len: [0.056, 0.036, 0.027], r: [0.0116, 0.009] },
  { name: 'ring', base: [-0.01, 0.119, 0.003], dir: [-0.06, 1, 0], len: [0.052, 0.034, 0.026], r: [0.0108, 0.0085] },
  { name: 'pinky', base: [-0.029, 0.11, 0.001], dir: [-0.13, 1, 0], len: [0.041, 0.026, 0.022], r: [0.0094, 0.0073] },
  { name: 'thumb', base: [0.032, 0.026, -0.009], dir: [0.55, 0.8, -0.22], len: [0.04, 0.037, 0.03], r: [0.0142, 0.0108] },
];

export function buildSkeletonDefs() {
  const bones = [];
  const B = (name, parent, pos) => { bones.push({ name, parent, pos }); return bones.length - 1; };
  const root = B('root', -1, [0, 0.93, 0]);
  const spine = B('spine', root, [0, 1.06, -0.01]);
  const chest = B('chest', spine, [0, 1.24, -0.015]);
  const neck = B('neck', chest, [0, 1.47, -0.02]);
  const head = B('head', neck, [0, 1.635, -0.014]);
  B('jaw', head, H(0, -0.046, -0.02));
  // hair spring bones (curtains + back), two segments each
  for (const [n, p] of [['hairL', H(0.07, -0.02, 0.0)], ['hairR', H(-0.07, -0.02, 0.0)], ['hairB', H(0, -0.02, -0.07)]]) {
    const a = B(n + '0', head, p);
    B(n + '1', a, add(p, [0, -0.09 * HS, 0]));
  }
  for (const side of [1, -1]) {
    const s = side > 0 ? 'L' : 'R';
    const f = (p) => (side > 0 ? p : mx(p));
    const clav = B('clav' + s, chest, f([0.03, 1.455, 0.02]));
    const ua = B('upperArm' + s, clav, f(ARM.shoulder));
    const fa = B('foreArm' + s, ua, f(ARM.elbow));
    const hand = B('hand' + s, fa, f(ARM.wrist));
    const hf = handFrame(side);
    for (const fg of FINGERS) {
      const d = norm(hf.v(...fg.dir));
      let p = hf.p(...fg.base), parent = hand;
      for (let i = 0; i < 3; i++) { parent = B(fg.name + i + s, parent, p); p = add(p, mul(d, fg.len[i])); }
      B(fg.name + 'Tip' + s, parent, p);
    }
  }
  for (const side of [1, -1]) {
    const s = side > 0 ? 'L' : 'R';
    const f = (p) => (side > 0 ? p : mx(p));
    const th = B('thigh' + s, root, f(LEG.hip));
    const sh = B('shin' + s, th, f(LEG.knee));
    const ft = B('foot' + s, sh, f(LEG.ankle));
    B('toe' + s, ft, f([0.11, 0.02, 0.16]));
  }
  const index = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  return { bones, index };
}

// mouth geometry (head-local, unscaled): lipless, a straight clenched bite line running back toward the jaw hinge
export const MOUTH = {
  y: (u) => -0.097 + 0.008 * u * u,
  hh: (u) => 0.0125 * (1 - 0.3 * Math.pow(Math.abs(u), 2)),
  x: (u) => 0.07 * Math.sin(u * 1.35) / Math.sin(1.35),
  z: (u) => 0.062 + 0.058 * Math.cos(u * 1.3),
};

export function sculptColossal(bi) {
  const S = new Sculpt();
  // ===== torso: shredded, skinless; pale fascia on the sternum, linea alba and clavicles =====
  const T = 1;
  S.ell([0, 0.95, -0.005], [0.15, 0.096, 0.098], { bone: bi.root, k: 0.04 });
  for (const s of [1, -1]) S.ell([0.074 * s, 0.9, -0.056], [0.084, 0.09, 0.072], { bone: bi.root, k: 0.03, fib: [s * 0.6, -1, 0] });
  S.ell([0, 1.075, 0.004], [0.118, 0.13, 0.082], { bone: bi.spine, k: 0.04 });
  S.ell([0, 1.3, 0.004], [0.162, 0.18, 0.125], { bone: bi.chest, k: 0.04 });
  S.ell([0, 1.405, -0.08], [0.12, 0.12, 0.05], { bone: bi.chest, k: 0.03, fib: [0, 1, 0] });
  for (const s of [1, -1]) {
    // big pectorals, fibres fanning from the sternum to the arm
    S.ell([0.078 * s, 1.35, 0.096], [0.095, 0.066, 0.046], { bone: bi.chest, k: 0.016, dir: [s, -0.15, 0.1], hint: [0, 0, 1], fib: [s, 0.25, 0] });
    S.ell([0.088 * s, 1.405, 0.075], [0.08, 0.036, 0.034], { bone: bi.chest, k: 0.02, dir: [s, 0.15, 0], hint: [0, 0, 1], fib: [s, 0.1, 0] });
    { const ins = add(s > 0 ? ARM.shoulder : mx(ARM.shoulder), [0.02 * s, -0.04, 0.032]), mid = lerp([0.11 * s, 1.37, 0.065], ins, 0.5);
      S.cone([0.12 * s, 1.37, 0.08], lerp(mid, ins, 0.3), 0.036, 0.028, { k: 0.02, bone: bi.chest }); }
    S.ell([0.115 * s, 1.26, -0.05], [0.068, 0.15, 0.06], { k: 0.03, bone: bi.chest, dir: [0.45 * s, 1, -0.1] });           // lats
    S.ell([0.104 * s, 1.075, 0.018], [0.044, 0.1, 0.064], { k: 0.025, bone: bi.spine, dir: [-0.35 * s, -1, 0.25] });      // obliques
    for (let i = 0; i < 4; i++) S.ell([0.126 * s, 1.31 - i * 0.04, 0.043 - i * 0.004], [0.013, 0.021, 0.03], { k: 0.012, bone: bi.chest, dir: [0.3 * s, -0.55, 1], hint: [s, 0, 0] }); // serratus
    for (let i = 0; i < 3; i++) S.cap([0.104 * s, 1.24 - i * 0.042, 0.078], [0.142 * s, 1.215 - i * 0.042, 0.006], 0.0065, { k: 0.012, bone: bi.chest, tendon: 0.35 }); // ribs
    S.cone([0.035 * s, 1.62, -0.05], [0.2 * s, 1.48, -0.02], 0.042, 0.04, { k: 0.028, bone: bi.chest });               // huge trapezius rising to the ears
    S.ell([0.085 * s, 1.5, -0.06], [0.05, 0.12, 0.045], { k: 0.028, bone: bi.chest, dir: [0.8 * s, -0.6, 0] });
  }
  for (const s of [1, -1]) S.ell([0.085 * s, 1.478, -0.006], [0.058, 0.034, 0.05], { k: 0.03, bone: bi.chest });
  for (const s of [1, -1]) S.ell([0.13 * s, 1.425, 0.005], [0.09, 0.058, 0.075], { k: 0.04, bone: bi.chest });
  // abs: four rows, separated by fascia (linea alba / tendinous intersections)
  for (let r = 0; r < 4; r++) for (const s of [1, -1]) S.ell([0.035 * s, 1.215 - r * 0.062, 0.081 - r * 0.003], [0.03, 0.028, 0.021], { k: 0.012, bone: r < 1 ? bi.chest : bi.spine, fib: [0, 1, 0] });
  S.cap([0, 1.245, 0.096], [0, 0.98, 0.09], 0.006, { k: 0.01, bone: bi.spine, tendon: T });                         // linea alba
  S.cap([0, 1.44, 0.11], [0, 1.27, 0.128], 0.01, { k: 0.012, bone: bi.chest, tendon: T });                        // sternum plate
  // neck: massive column with huge SCM cords
  S.cone([0, 1.43, -0.02], [0, 1.492, -0.022], 0.068, 0.064, { k: 0.03, bone: bi.chest });
  S.cone([0, 1.492, -0.022], H(0, -0.09, -0.03), 0.064, 0.056, { k: 0.03, bone: bi.neck });
  for (const s of [1, -1]) {
    const top = H(0.058 * s, -0.075, -0.032), bot = [0.02 * s, 1.455, 0.068], mid = lerp(top, bot, 0.55);
    S.cone(top, mid, 0.022, 0.021, { k: 0.01, bone: bi.neck, fib: sub(bot, top) });
    S.cone(mid, bot, 0.021, 0.016, { k: 0.01, bone: bi.chest, fib: sub(bot, top) });
    S.cap(lerp(top, bot, 0.82), bot, 0.006, { k: 0.006, bone: bi.chest, tendon: T });                                  // SCM tendon
    const c0 = [0.024 * s, 1.455, 0.07], c1 = [0.1 * s, 1.46, 0.062], c2 = [0.19 * s, 1.472, 0.008];
    S.cone(c0, c1, 0.0105, 0.0112, { k: 0.012, bone: bi.chest, tendon: T });                                           // clavicles (pale)
    S.cone(c1, c2, 0.0112, 0.0122, { k: 0.012, bone: bi.chest, tendon: T });
  }
  S.sph([0, 1.465, 0.08], 0.014, { k: 0.014, sub: true });
  S.sph([0, 1.03, 0.1], 0.006, { k: 0.01, bone: bi.spine, sub: true });

  // ===== arms =====
  for (const side of [1, -1]) {
    const s = side > 0 ? 'L' : 'R';
    const f = (p) => (side > 0 ? p : mx(p));
    const Sh = f(ARM.shoulder), E = f(ARM.elbow), W = f(ARM.wrist), d = f(ARM.dir), D = f(ARM.dorsal);
    const ua = bi['upperArm' + s], fa = bi['foreArm' + s];
    S.ell(add(add(Sh, mul(d, 0.055)), mul(D, 0.024)), [0.088, 0.112, 0.09], { k: 0.022, bone: ua, dir: d, hint: [0, 0, 1] });           // deltoid cap
    S.cone(Sh, E, 0.078, 0.062, { k: 0.03, bone: ua });
    S.ell(add(lerp(Sh, E, 0.55), [0, 0, 0.036]), [0.056, 0.11, 0.05], { k: 0.022, bone: ua, dir: d });                 // biceps
    S.ell(add(lerp(Sh, E, 0.45), [0, 0, -0.04]), [0.06, 0.13, 0.052], { k: 0.022, bone: ua, dir: d });                 // triceps
    S.sph(E, 0.056, { k: 0.022, bone: fa, tendon: 0.7 });
    S.cone(E, W, 0.064, 0.04, { k: 0.03, bone: fa });
    S.ell(add(lerp(E, W, 0.27), add(mul(D, 0.024), [0, 0, 0.016])), [0.05, 0.1, 0.046], { k: 0.018, bone: fa, dir: d });
    S.ell(add(lerp(E, W, 0.3), [0, 0, -0.026]), [0.045, 0.105, 0.04], { k: 0.018, bone: fa, dir: d });
    S.cap(lerp(E, W, 0.6), add(W, mul(D, 0.012)), 0.0065, { k: 0.01, bone: fa, tendon: T });
  }
  // ===== hands =====
  for (const side of [1, -1]) {
    const s = side > 0 ? 'L' : 'R';
    const hf = handFrame(side);
    const hb = bi['hand' + s];
    const o = { part: 'hand' + s };
    S.cone(hf.p(0, -0.03, 0), hf.p(0, 0.02, 0), 0.028, 0.031, { ...o, k: 0.018, bone: hb, fib: hf.F });
    S.box(hf.p(0, 0.068, 0), [0.045, 0.058, 0.017], 0.014, { ...o, k: 0.016, bone: hb, dir: hf.F, hint: hf.D });
    S.ell(hf.p(0.028, 0.043, -0.012), [0.021, 0.034, 0.017], { ...o, k: 0.016, bone: bi['thumb0' + s], dir: hf.v(0.55, 0.8, -0.2) });
    S.ell(hf.p(-0.03, 0.058, -0.009), [0.016, 0.044, 0.014], { ...o, k: 0.016, bone: hb, dir: hf.F });
    for (const fg of FINGERS) {
      const d = norm(hf.v(...fg.dir));
      let p = hf.p(...fg.base);
      if (fg.name !== 'thumb') S.sph(add(p, hf.v(0, 0, 0.004)), fg.r[0] + 0.0005, { ...o, k: 0.012, bone: hb });
      for (let i = 0; i < 3; i++) {
        const q = add(p, mul(d, fg.len[i]));
        const r0 = fg.r[0] + (fg.r[1] - fg.r[0]) * (i / 3), r1 = fg.r[0] + (fg.r[1] - fg.r[0]) * ((i + 1) / 3);
        S.cone(p, q, r0, r1 * (i === 2 ? 0.93 : 1), { ...o, k: 0.009, bone: bi[fg.name + i + s] });
        if (i > 0) S.sph(p, r0 * 1.04, { ...o, k: 0.007, bone: bi[fg.name + i + s] });
        if (i === 2) S.ell(add(lerp(p, q, 0.64), hf.v(0, 0, r1 * 0.74)), [r1 * 0.78, fg.len[2] * 0.36, r1 * 0.28], { ...o, k: 0.004, bone: bi[fg.name + i + s], dir: d, hint: hf.D, tendon: 1 });
        p = q;
      }
    }
  }
  // ===== legs =====
  for (const side of [1, -1]) {
    const s = side > 0 ? 'L' : 'R';
    const f = (p) => (side > 0 ? p : mx(p));
    const Hp = f(LEG.hip), K = f(LEG.knee), An = f(LEG.ankle);
    const th = bi['thigh' + s], sh = bi['shin' + s], ft = bi['foot' + s];
    const dT = sub(K, Hp), dS = sub(An, K);
    S.cone(Hp, K, 0.085, 0.052, { k: 0.045, bone: th });
    S.ell(add(lerp(Hp, K, 0.45), [0, 0, 0.038]), [0.038, 0.17, 0.034], { k: 0.035, bone: th, dir: dT });
    S.ell(add(lerp(Hp, K, 0.5), [0.036 * side, 0, 0.01]), [0.035, 0.16, 0.04], { k: 0.035, bone: th, dir: dT });
    S.ell(add(lerp(Hp, K, 0.5), [0, 0, -0.042]), [0.045, 0.16, 0.04], { k: 0.035, bone: th, dir: dT });
    S.ell(add(lerp(Hp, K, 0.3), [-0.04 * side, 0, 0]), [0.04, 0.12, 0.048], { k: 0.04, bone: th, dir: dT });
    S.sph(K, 0.046, { k: 0.03, bone: sh });
    S.cone(K, An, 0.044, 0.027, { k: 0.03, bone: sh });
    for (const t of [1, -1]) S.ell(add(lerp(K, An, 0.28), [0.016 * t, 0, -0.032]), [0.027, 0.085, 0.033], { k: 0.03, bone: sh, dir: dS });
    S.cap(add(lerp(K, An, 0.6), [0, 0, -0.028]), add(An, [0, -0.03, -0.043]), 0.012, { k: 0.02, bone: sh });
    S.sph(An, 0.033, { k: 0.025, bone: ft });
    S.box(f([0.109, 0.03, 0.045]), [0.041, 0.03, 0.09], 0.025, { k: 0.025, bone: ft, dir: [0, 0, 1], hint: [0, 1, 0] });
    for (let t = 0; t < 5; t++) {
      const x = 0.109 - (t - 2) * 0.017 * side;
      S.cone(f([x, 0.022, 0.12]), f([x, 0.016, 0.165 - Math.abs(t - 1) * 0.008]), 0.013 - t * 0.001, 0.011 - t * 0.001, { k: 0.01, bone: ft });
    }
  }

  // ===== head: the Colossal — pale skull plates over red muscle =====
  const hb = bi.head, jb = bi.jaw;
  const ho = { part: 'head' };
  const P = 1;   // pale plate / fascia
  S.ell(H(0, 0.036, -0.016), [R(0.08), R(0.1), R(0.098)], { ...ho, k: R(0.02), bone: hb, tendon: P, fib: [0, 0, 1] });   // skull dome
  S.ell(H(0, 0.048, 0.05), [R(0.068), R(0.05), R(0.04)], { ...ho, k: R(0.018), bone: hb, tendon: P });                    // forehead plate
  S.ell(H(0, -0.04, 0.042), [R(0.074), R(0.07), R(0.064)], { ...ho, k: R(0.022), bone: hb });                              // mid-face (muscle)
  for (const s of [1, -1]) {
    // red muscle bands: temporalis fans and the split frontalis
    S.ell(H(0.068 * s, 0.004, -0.004), [R(0.02), R(0.054), R(0.052)], { ...ho, k: R(0.012), bone: hb, dir: [0.1 * s, -1, 0.35] });
    S.ell(H(0.03 * s, 0.062, 0.078), [R(0.022), R(0.032), R(0.011)], { ...ho, k: R(0.008), bone: hb, dir: [0.2 * s, 1, 0.3], hint: [0, 0, 1] });
    // heavy pale brow ridge
    S.cone(H(0.004 * s, 0.012, 0.095), H(0.06 * s, 0.004, 0.072), R(0.019), R(0.015), { ...ho, k: R(0.01), bone: hb, tendon: P });
    // pale cheekbone plates + zygomatic arch
    S.ell(H(0.052 * s, -0.036, 0.068), [R(0.03), R(0.016), R(0.024)], { ...ho, k: R(0.01), bone: hb, tendon: P, dir: [s, 0.12, -0.55], hint: [0, 1, 0] });
    S.cone(H(0.066 * s, -0.03, 0.04), H(0.08 * s, -0.022, -0.008), R(0.013), R(0.01), { ...ho, k: R(0.01), bone: hb, tendon: P });
    // lower orbital rim (pale)
    // cheek muscles: zygomaticus strands from the cheekbone to the mouth corner, masseter behind
    S.cap(H(0.034 * s, -0.04, 0.084), H(0.03 * s, -0.072, 0.1), R(0.0085), { ...ho, k: R(0.008), bone: hb });
    S.cap(H(0.05 * s, -0.04, 0.076), H(0.046 * s, -0.074, 0.088), R(0.0085), { ...ho, k: R(0.008), bone: hb });
    S.ell(H(0.064 * s, -0.062, 0.022), [R(0.016), R(0.034), R(0.024)], { ...ho, k: R(0.012), bone: hb, dir: [0, -1, 0.25] });
    S.ell(H(0.064 * s, -0.098, 0.012), [R(0.016), R(0.03), R(0.024)], { ...ho, k: R(0.012), bone: jb, dir: [0, -1, 0.25] });
    S.ell(H(0.08 * s, -0.012, -0.016), [R(0.01), R(0.024), R(0.015)], { ...ho, k: R(0.01), bone: hb });             // small ears
    // pale jaw plate: mandible body + ramus
    S.cone(H(0.026 * s, -0.132, 0.08), H(0.074 * s, -0.106, -0.008), R(0.021), R(0.019), { ...ho, k: R(0.012), bone: jb, tendon: P });
    S.cone(H(0.074 * s, -0.106, -0.008), H(0.076 * s, -0.048, -0.016), R(0.017), R(0.013), { ...ho, k: R(0.012), bone: jb, tendon: P });
    // vertical jaw-muscle fibre bands from cheekbone to mandible
    for (let j = 0; j < 3; j++) S.cap(H((0.066 + j * 0.005) * s, -0.042, 0.05 - j * 0.017), H((0.07 + j * 0.004) * s, -0.098, 0.044 - j * 0.017), R(0.0065), { ...ho, k: R(0.006), bone: j === 0 ? hb : jb, fib: [0, -1, 0] });
  }
  // nose: pale ridge
  S.cone(H(0, -0.004, 0.091), H(0, -0.046, 0.113), R(0.0095), R(0.0125), { ...ho, k: R(0.01), bone: hb, tendon: 0.85 });
  for (const s of [1, -1]) S.sph(H(0.0145 * s, -0.052, 0.101), R(0.0105), { ...ho, k: R(0.008), bone: hb });
  // jaws with gums (no lips) and a pale chin
  S.ell(H(0, -0.079, 0.066), [R(0.056), R(0.017), R(0.05)], { ...ho, k: R(0.012), bone: hb, gum: 1 });
  S.ell(H(0, -0.114, 0.063), [R(0.051), R(0.014), R(0.046)], { ...ho, k: R(0.01), bone: jb, gum: 1 });
  S.ell(H(0, -0.136, 0.078), [R(0.044), R(0.024), R(0.024)], { ...ho, k: R(0.014), bone: jb, tendon: P });
  S.ell(H(0, -0.094, 0.026), [R(0.03), R(0.011), R(0.042)], { ...ho, k: R(0.01), bone: jb, gum: 1 });                    // tongue bed
  // ---- carve ----
  for (let i = 0; i <= 16; i++) {      // lipless bite slot along the dental arch, back to the molars
    const u = -1 + i / 8;
    const x = MOUTH.x(u), y = MOUTH.y(u), z = MOUTH.z(u) + 0.012, hh = MOUTH.hh(u);
    S.ell(H(x, y, z), [R(0.009), R(hh), R(0.04)], { ...ho, sub: true, k: R(0.004), dir: [0, 1, 0], hint: [Math.sin(u * 1.3), 0, Math.cos(u * 1.3)] });
  }
  for (const s of [1, -1]) {
    S.ell(H(0.032 * s, -0.014, 0.088), [R(0.024), R(0.019), R(0.032)], { ...ho, sub: true, k: R(0.008) });      // deep sunken sockets
    S.sph(H(0.009 * s, -0.057, 0.108), R(0.0058), { ...ho, sub: true, k: R(0.004) });                          // nostrils
    S.ell(H(0.056 * s, -0.096, 0.048), [R(0.012), R(0.02), R(0.03)], { ...ho, sub: true, k: R(0.008) });      // open cheeks (teeth to the hinge)
    // muscle grooves between the plates
    S.cap(H(0.052 * s, 0.03, 0.07), H(0.062 * s, -0.012, 0.062), R(0.0028), { ...ho, sub: true, k: R(0.003) });
    S.cap(H(0.06 * s, -0.045, 0.07), H(0.064 * s, -0.08, 0.058), R(0.0028), { ...ho, sub: true, k: R(0.003) });
  }
  // cheek strands bridging upper and lower jaw across the open cheeks (split head/jaw so they stretch)
  for (const s of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const z = 0.064 - i * 0.012, x = (0.05 + i * 0.004) * s;
      const top = H(x, -0.072 - i * 0.001, z + 0.003), bot = H(x + 0.002 * s, -0.12 + i * 0.002, z - 0.004), mid = lerp(top, bot, 0.5);
      const r = R(0.0034 - i * 0.0002);
      S.cap(top, mid, r, { ...ho, k: R(0.004), bone: hb, fib: sub(bot, top) });
      S.cap(mid, bot, r, { ...ho, k: R(0.004), bone: jb, fib: sub(bot, top) });
    }
  }
  return { ops: S.ops };
}

// hair: shoulder-length, straight, parted in the middle. Separate part (own material), clumps give a ragged hem.
export function sculptHair(bi) {
  const S = new Sculpt();
  const hb = bi.head;
  const o = { part: 'hair', hair: 1 };
  // two cap lobes flowing away from the parting + back lobe (hairline set back: forehead triangle shows)
  for (const s of [1, -1]) {
    S.ell(H(0.03 * s, 0.05, -0.016), [R(0.063), R(0.086), R(0.101)], { ...o, k: R(0.03), bone: hb, fib: [s * 0.9, -0.45, 0] });
  }
  S.ell(H(0, 0.02, -0.055), [R(0.086), R(0.09), R(0.068)], { ...o, k: R(0.03), bone: hb, fib: [0, -0.6, -0.8] });
  // fringe: from the parting down to the temples, leaving a skin triangle between
  for (const s of [1, -1]) {
    S.cone(H(0.008 * s, 0.112, 0.05), H(0.066 * s, 0.03, 0.058), R(0.014), R(0.02), { ...o, k: R(0.022), bone: hb, fib: [s, -0.8, 0] });
    S.cone(H(0.066 * s, 0.035, 0.055), H(0.08 * s, -0.035, 0.05), R(0.018), R(0.017), { ...o, k: R(0.02), bone: hb, fib: [0.3 * s, -1, 0] });
  }
  // curtains: clumps hanging from the scalp to the shoulders, around the sides and back
  const N = 15;
  for (let i = 0; i < N; i++) {
    const a = -Math.PI * 0.17 + (i / (N - 1)) * Math.PI * 0.67; // left side: temple -> back centre
    for (const s of [1, -1]) {
      if (s < 0 && i === N - 1) continue;
      const ang = s > 0 ? a : Math.PI - a;
      const cx = Math.cos(ang), cz = Math.sin(ang) * -1;
      const front = cz > 0.35;
      const r0 = 0.083, r1 = 0.098 + 0.012 * Math.abs(Math.sin(i * 1.7));
      const len = 0.235 + 0.015 * Math.sin(i * 2.3 + s);
      const top = H(cx * r0, 0.03, cz * r0 - 0.012);
      const mid = H(cx * (r1 + 0.004), -0.06, cz * (r1 + 0.002) - 0.016);
      const bot = H(cx * (r1 + 0.018), 0.03 - len, cz * (r1 + 0.012) - 0.022);
      const side = s > 0 ? 'hairL' : 'hairR';
      const back = Math.abs(cz) < 0.5 && cz < 0 ? true : cz < -0.6;
      const bn = back ? 'hairB' : side;
      S.cone(top, mid, R(0.03), R(0.028), { ...o, k: R(0.022), bone: hb, fib: [0, -1, 0] });
      S.cone(mid, bot, R(0.028), R(0.022), { ...o, k: R(0.02), bone: bi[bn + '0'], fib: [0, -1, 0] });
    }
  }
  // parting groove
  S.cap(H(0, 0.1, 0.075), H(0, 0.125, -0.02), R(0.0035), { ...o, sub: true, k: R(0.005) });
  // keep the face clear: carve the hair out in front of the face (the curtains frame it)
  S.ell(H(0, -0.09, 0.14), [R(0.058), R(0.11), R(0.09)], { ...o, sub: true, k: R(0.02) });
  S.ell(H(0, 0.03, 0.13), [R(0.04), R(0.055), R(0.062)], { ...o, sub: true, k: R(0.018) });             // forehead triangle (stops at the hairline)
  S.ell(H(0, -0.024, 0.15), [R(0.086), R(0.038), R(0.09)], { ...o, sub: true, k: R(0.015) });   // open the squinting eyes
  return { ops: S.ops };
}

// teeth along the grin: flat human teeth, clenched, following the smile curve
export function teethLayout() {
  const out = [];
  const n = 11;
  const widths = [0.0068, 0.0064, 0.0064, 0.0062, 0.0062, 0.006, 0.006, 0.0058, 0.0058, 0.0056, 0.0055];
  for (const upper of [true, false]) {
    for (const s of [1, -1]) {
      let th = 0;
      for (let i = 0; i < n; i++) {
        const w = widths[i] * (upper ? 1 : 0.93);
        const ax = 0.064, az = 0.056, cz = 0.058;
        const dth = (w * 1.03) / Math.hypot(ax * Math.cos(th), az * Math.sin(th));
        const tc = th + dth * 0.5; th += dth;
        const x = ax * Math.sin(tc) * s, z = cz + az * Math.cos(tc);
        const u = x / 0.066;
        const yc = MOUTH.y(Math.max(-1, Math.min(1, u)));
        const hgt = (upper ? 0.0112 : 0.0098) * (1 - 0.15 * (i / n));
        const tx = ax * Math.cos(tc) * s, tz = -az * Math.sin(tc), tl = Math.hypot(tx, tz);
        const ox = Math.sin(tc) * s / ax, oz = Math.cos(tc) / az, ol = Math.hypot(ox, oz);
        const yTop = upper ? yc + hgt - 0.0005 : yc - 0.0005;
        out.push({ pos: H(x, yTop - hgt / 2, z), tangent: [tx / tl, 0, tz / tl], outward: [ox / ol, 0, oz / ol], w: w * HS, h: hgt * HS, upper, i });
      }
    }
  }
  return out;
}

export const EYES = [{ c: H(0.032, -0.016, 0.064), r: R(0.0062) }, { c: H(-0.032, -0.016, 0.064), r: R(0.0062) }];
