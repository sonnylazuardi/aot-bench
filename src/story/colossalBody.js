// The giant's anatomy: the COLOSSAL TITAN (skinless striated muscle, pale fascia plates on the skull, lipless jaw).
// (history: previously a smiling pure titan) Skeleton + ordered SDF primitive list, sculpted as a 1.8 m
// human (model units, +Y up, facing +Z, +X = its left) and scaled up by the rig.
// Soft skin-covered body, oversized head with an enormous clenched rictus grin, squinting crescent eyes,
// crow's-feet, deep nasolabial folds, big nose, and shoulder-length hair parted in the middle (separate part).
// Op masks feeding the skin shader: tendon(=nail/pale), gum, lip, flush (blush), hair.
import { Sculpt, makeSDF, grad } from './sculpt.js';
import { sculptHead } from './colossalHead.js';
export { teethLayout, EYES, MOUTH, SOCKETS, MOUTH_INNER, TONGUE } from './colossalHead.js';

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
  shoulder: [0.245, 1.425, -0.008], dir: [Math.sin(A), -Math.cos(A), 0], upper: 0.35, fore: 0.32,
  dorsal: [Math.cos(A), Math.sin(A), 0], thumb: [0, 0, 1],
};
ARM.elbow = add(ARM.shoulder, mul(ARM.dir, ARM.upper));
ARM.wrist = add(ARM.elbow, mul(ARM.dir, ARM.fore));
export const LEG = { hip: [0.112, 0.92, 0], knee: [0.12, 0.5, 0.014], ankle: [0.126, 0.085, -0.014] };

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

export function sculptColossal(bi) {
  const S = new Sculpt();
  // ===== torso: shredded, skinless; pale fascia on the sternum, linea alba and clavicles =====
  const T = 1;
  S.ell([0, 0.95, -0.005], [0.172, 0.105, 0.11], { bone: bi.root, k: 0.04 });
  S.ell([0, 0.865, 0.012], [0.085, 0.055, 0.075], { bone: bi.root, k: 0.04 });                                          // broad groin (no slot)
  for (const s of [1, -1]) S.ell([0.09 * s, 0.9, -0.07], [0.105, 0.11, 0.09], { bone: bi.root, k: 0.03, fib: [s * 0.6, -1, 0] });
  S.ell([0, 1.075, 0.008], [0.122, 0.13, 0.085], { bone: bi.spine, k: 0.04 });
  S.ell([0, 1.295, 0.004], [0.18, 0.2, 0.122], { bone: bi.chest, k: 0.04 });
  S.ell([0, 1.405, -0.08], [0.12, 0.12, 0.05], { bone: bi.chest, k: 0.03, fib: [0, 1, 0] });
  for (const s of [1, -1]) {
    // big pectorals, fibres fanning from the sternum to the arm
    S.ell([0.084 * s, 1.345, 0.098], [0.09, 0.064, 0.025], { bone: bi.chest, k: 0.012, dir: [-0.22 * s, 1, 0.1], hint: [0.15 * s, 0, 1], fib: [s, 0.25, 0] });   // thick smooth-edged pec slab
    S.ell([0.15 * s, 1.385, 0.075], [0.07, 0.04, 0.03], { bone: bi.chest, k: 0.012, dir: [s, 0.35, -0.3], hint: [0, 0, 1], fib: [s, 0.3, 0] });            // pec fans to the armpit
    S.ell([0.1 * s, 1.392, 0.086], [0.085, 0.028, 0.017], { bone: bi.chest, k: 0.014, dir: [s, 0.12, 0], hint: [0, 0, 1], fib: [s, 0.1, 0] });
    { const ins = add(s > 0 ? ARM.shoulder : mx(ARM.shoulder), [0.02 * s, -0.04, 0.032]), mid = lerp([0.11 * s, 1.37, 0.065], ins, 0.5);
      S.cone([0.12 * s, 1.37, 0.08], lerp(mid, ins, 0.3), 0.036, 0.028, { k: 0.02, bone: bi.chest }); }
    S.ell([0.14 * s, 1.27, -0.05], [0.09, 0.16, 0.07], { k: 0.016, bone: bi.chest, dir: [0.45 * s, 1, -0.1] });           // lats
    S.ell([0.104 * s, 1.075, 0.018], [0.044, 0.1, 0.064], { k: 0.014, bone: bi.spine, dir: [-0.35 * s, -1, 0.25] });      // obliques
    for (let i = 0; i < 4; i++) S.ell([0.126 * s, 1.31 - i * 0.04, 0.043 - i * 0.004], [0.013, 0.021, 0.03], { k: 0.012, bone: bi.chest, dir: [0.3 * s, -0.55, 1], hint: [s, 0, 0] }); // serratus
    for (let i = 0; i < 3; i++) S.cap([0.104 * s, 1.24 - i * 0.042, 0.078], [0.142 * s, 1.215 - i * 0.042, 0.006], 0.0065, { k: 0.012, bone: bi.chest, tendon: 0.35 }); // ribs
    S.cone([0.05 * s, 1.55, -0.05], [0.2 * s, 1.455, -0.02], 0.036, 0.036, { k: 0.018, bone: bi.chest });         // traps slope from mid-neck               // huge trapezius rising to the ears
    S.ell([0.085 * s, 1.47, -0.06], [0.05, 0.11, 0.045], { k: 0.016, bone: bi.chest, dir: [0.8 * s, -0.6, 0] });
  }
  for (const s of [1, -1]) S.ell([0.085 * s, 1.448, -0.006], [0.058, 0.034, 0.05], { k: 0.03, bone: bi.chest });
  for (const s of [1, -1]) S.ell([0.15 * s, 1.4, 0.005], [0.1, 0.064, 0.085], { k: 0.04, bone: bi.chest });
  // abs: four rows, separated by fascia (linea alba / tendinous intersections)
  for (let r = 0; r < 4; r++) for (const s of [1, -1]) S.ell([0.04 * s, 1.215 - r * 0.064, 0.094 - r * 0.004], [0.036, 0.03, 0.017], { k: 0.008, bone: r < 1 ? bi.chest : bi.spine, fib: [0, 1, 0] });
  // neck: massive column with huge SCM cords
  S.cone([0, 1.43, -0.02], [0, 1.492, -0.022], 0.068, 0.064, { k: 0.03, bone: bi.chest });
  // (head A is small, ~1/9 of the height: the column tapers into the skull base behind the jaw — colossalHead.js)
  S.cone([0, 1.492, -0.022], [0, 1.672, -0.024], 0.062, 0.044, { k: 0.03, bone: bi.neck });
  S.ell([0, 1.55, 0.026], [0.034, 0.065, 0.03], { k: 0.03, bone: bi.neck, fib: [0, 1, 0.3] });                     // throat (hyoid) column under the jaw
  S.ell([0, 1.465, 0.05], [0.036, 0.05, 0.03], { k: 0.03, bone: bi.chest, fib: [0, 1, 0.3] });                    // lower throat into a shallow V at the notch
  for (const s of [1, -1]) {
    const top = [0.052 * s, 1.692, -0.03], bot = [0.02 * s, 1.415, 0.062], mid = lerp(top, bot, 0.55);
    S.cone(top, mid, 0.017, 0.016, { k: 0.016, bone: bi.neck, fib: sub(bot, top) });
    S.cone(mid, bot, 0.016, 0.01, { k: 0.02, bone: bi.chest, fib: sub(bot, top) });
    S.cap(lerp(top, bot, 0.62), lerp(top, bot, 0.98), 0.0055, { k: 0.008, bone: bi.chest, tendon: 1, fib: sub(bot, top) });   // pale SCM tendon cord into the sternum
    const c0 = [0.024 * s, 1.428, 0.072], c1 = [0.1 * s, 1.432, 0.064], c2 = [0.19 * s, 1.445, 0.01];
    S.cone(c0, c1, 0.0095, 0.01, { k: 0.01, bone: bi.chest, tendon: 0.95 });                                           // crisp clavicle shelf (pale fascia band)
    S.cone(c1, c2, 0.01, 0.011, { k: 0.01, bone: bi.chest, tendon: 0.95 });
  }

  // ===== arms =====
  for (const side of [1, -1]) {
    const s = side > 0 ? 'L' : 'R';
    const f = (p) => (side > 0 ? p : mx(p));
    const Sh = f(ARM.shoulder), E = f(ARM.elbow), W = f(ARM.wrist), d = f(ARM.dir), D = f(ARM.dorsal);
    const ua = bi['upperArm' + s], fa = bi['foreArm' + s];
    S.ell(add(add(Sh, mul(d, 0.055)), mul(D, 0.03)), [0.095, 0.104, 0.088], { k: 0.012, bone: ua, dir: d, hint: [0, 0, 1] });           // deltoid cap
    S.cone(Sh, E, 0.072, 0.058, { k: 0.03, bone: ua });
    // deltoid: anterior + posterior heads over the lateral cap
    S.ell(add(add(Sh, mul(d, 0.045)), [0, 0.01, 0.05]), [0.048, 0.09, 0.04], { k: 0.012, bone: ua, dir: d, hint: [0, 0, 1] });
    S.ell(add(add(Sh, mul(d, 0.045)), [0, 0.01, -0.05]), [0.048, 0.09, 0.04], { k: 0.012, bone: ua, dir: d, hint: [0, 0, 1] });
    S.ell(add(lerp(Sh, E, 0.55), [0, 0, 0.036]), [0.056, 0.11, 0.05], { k: 0.012, bone: ua, dir: d });                 // biceps
    S.ell(add(lerp(Sh, E, 0.45), [0, 0, -0.04]), [0.06, 0.13, 0.052], { k: 0.012, bone: ua, dir: d });                 // triceps
    S.sph(E, 0.056, { k: 0.022, bone: fa, tendon: 0.7 });
    S.cone(E, W, 0.064, 0.04, { k: 0.03, bone: fa });
    S.ell(add(lerp(E, W, 0.27), add(mul(D, 0.024), [0, 0, 0.016])), [0.05, 0.1, 0.046], { k: 0.012, bone: fa, dir: d });
    S.ell(add(lerp(E, W, 0.3), [0, 0, -0.026]), [0.045, 0.105, 0.04], { k: 0.012, bone: fa, dir: d });
    S.cap(lerp(E, W, 0.6), add(W, mul(D, 0.012)), 0.0065, { k: 0.01, bone: fa, tendon: T });
  }
  // ===== hands =====
  for (const side of [1, -1]) {
    const s = side > 0 ? 'L' : 'R';
    const hf = handFrame(side);
    const hb = bi['hand' + s];
    const o = { part: 'hand' + s };
    S.cone(hf.p(0, -0.03, 0), hf.p(0, 0.02, 0), 0.028, 0.031, { ...o, k: 0.018, bone: hb, fib: hf.F });
    S.box(hf.p(0, 0.07, 0), [0.052, 0.062, 0.021], 0.016, { ...o, k: 0.016, bone: hb, dir: hf.F, hint: hf.D });
    S.ell(hf.p(0.028, 0.043, -0.012), [0.021, 0.034, 0.017], { ...o, k: 0.016, bone: bi['thumb0' + s], dir: hf.v(0.55, 0.8, -0.2) });
    S.ell(hf.p(-0.03, 0.058, -0.009), [0.016, 0.044, 0.014], { ...o, k: 0.016, bone: hb, dir: hf.F });
    for (const fg of FINGERS) {
      if (fg.name !== 'thumb') S.cap(hf.p(fg.base[0] * 0.3, 0.004, 0.019), add(hf.p(...fg.base), hf.v(0, -0.004, 0.014)), 0.0042, { ...o, k: 0.005, bone: hb, tendon: 1 });   // extensor tendon fan
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
    // thighs: teardrop-tapered wedges built from separate bellies (no single sausage)
    S.cone(Hp, K, 0.1, 0.056, { k: 0.03, bone: th });
    S.ell(add(lerp(Hp, K, 0.42), [0.07 * side, 0, 0.012]), [0.058, 0.21, 0.064], { k: 0.012, bone: th, dir: dT });         // vastus lateralis (outer bulge)
    S.ell(add(lerp(Hp, K, 0.4), [0.006 * side, 0, 0.072]), [0.044, 0.21, 0.04], { k: 0.01, bone: th, dir: dT });          // rectus femoris (central ridge)
    S.ell(add(lerp(Hp, K, 0.8), [-0.046 * side, 0, 0.042]), [0.05, 0.085, 0.046], { k: 0.012, bone: th, dir: add(dT, [0.15 * side, 0, 0]) }); // vastus medialis teardrop
    S.ell(add(lerp(Hp, K, 0.28), [-0.07 * side, 0.02, 0.006]), [0.064, 0.17, 0.07], { k: 0.016, bone: th, dir: dT });     // adductors fill the inner thigh
    S.ell(add(lerp(Hp, K, 0.5), [0, 0, -0.068]), [0.068, 0.2, 0.056], { k: 0.014, bone: th, dir: dT });                   // hamstrings
    S.ell(f([0.168, 0.94, 0.02]), [0.042, 0.085, 0.05], { k: 0.02, bone: bi.root, dir: [0.1 * side, -1, 0.15] });        // tensor fasciae latae
    S.ell(f([0.15, 0.975, -0.05]), [0.055, 0.06, 0.055], { k: 0.022, bone: bi.root });                                    // gluteus medius flare
    // long pale sartorius strap: outer hip -> inner knee
    { const a0 = f([0.152, 1.0, 0.085]), a1 = add(lerp(Hp, K, 0.45), [0.0, 0, 0.098]), a2 = add(K, [-0.055 * side, 0.03, 0.03]);
      S.cone(a0, a1, 0.0075, 0.0085, { k: 0.008, bone: th, tendon: 1, fib: sub(a2, a0) });
      S.cone(a1, a2, 0.0085, 0.007, { k: 0.008, bone: th, tendon: 1, fib: sub(a2, a0) }); }
    // knee: flatter, squarer patella zone with pale tendon
    S.ell(K, [0.06, 0.05, 0.052], { k: 0.024, bone: sh });
    S.ell(add(K, [0, 0.006, 0.05]), [0.034, 0.04, 0.014], { k: 0.012, bone: sh, tendon: 0.85, dir: [0, 1, 0], hint: [0, 0, 1] });
    // shins with thick calves
    S.cone(K, An, 0.058, 0.036, { k: 0.026, bone: sh });
    for (const t of [1, -1]) S.ell(add(lerp(K, An, 0.27), [0.024 * t, 0, -0.05]), [0.042, 0.12, 0.05], { k: 0.012, bone: sh, dir: dS });
    S.ell(add(lerp(K, An, 0.35), [0.02 * side, 0, 0.032]), [0.024, 0.15, 0.024], { k: 0.012, bone: sh, dir: dS });        // tibialis
    S.cap(add(lerp(K, An, 0.62), [0, 0, -0.04]), add(An, [0, -0.03, -0.055]), 0.016, { k: 0.014, bone: sh, tendon: 0.9 }); // achilles
    S.sph(An, 0.042, { k: 0.025, bone: ft });
    S.box(f([0.129, 0.034, 0.05]), [0.05, 0.034, 0.1], 0.028, { k: 0.025, bone: ft, dir: [0, 0, 1], hint: [0, 1, 0] });
    for (let t = 0; t < 5; t++) {
      const x = 0.129 - (t - 2) * 0.02 * side;
      S.cone(f([x, 0.025, 0.135]), f([x, 0.018, 0.18 - Math.abs(t - 1) * 0.008]), 0.016 - t * 0.001, 0.013 - t * 0.001, { k: 0.01, bone: ft });
    }
  }

  // ===== deep anatomical grooves (2x deeper so they read at 80 m); ends taper to nothing (no round puncture pits) =====
  const groove = (a, b, r, o) => { const m = lerp(a, b, 0.5); S.cone(a, m, r * 0.15, r, { ...o, sub: true }); S.cone(m, b, r, r * 0.15, { ...o, sub: true }); };
  groove([0, 1.41, 0.118], [0, 0.97, 0.106], 0.005, { k: 0.008, tendon: 1 });                        // sternum + linea alba: pale recessed groove
  for (let r = 0; r < 3; r++) groove([-0.078, 1.183 - r * 0.064, 0.104 - r * 0.004], [0.078, 1.183 - r * 0.064, 0.104 - r * 0.004], 0.0038, { k: 0.007, tendon: 1 }); // tendinous intersections
  for (const s of [1, -1]) {
    groove([0.08 * s, 1.24, 0.1], [0.078 * s, 0.99, 0.09], 0.0042, { k: 0.007, tendon: 1 });         // semilunar line (pale frame)
    groove([0.15 * s, 1.0, 0.07], [0.035 * s, 0.86, 0.1], 0.005, { k: 0.007, tendon: 1 });           // inguinal V (pale)
    groove([0.03 * s, 1.288, 0.118], [0.15 * s, 1.3, 0.09], 0.006, { k: 0.012 });                    // curved lower pec shelf
    const Hp = s > 0 ? LEG.hip : mx(LEG.hip), Kn = s > 0 ? LEG.knee : mx(LEG.knee);
    for (const off of [0.034, -0.03]) groove(add(lerp(Hp, Kn, 0.12), [off * s, 0, 0.1]), add(lerp(Hp, Kn, 0.86), [off * s * 0.7, 0, 0.075]), 0.006, { k: 0.007 }); // quad separation
  }

  // ===== head: owned by the head sculptor (colossalHead.js) =====
  sculptHead(S, bi);
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
