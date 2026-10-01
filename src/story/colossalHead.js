// The COLOSSAL TITAN's head, variant A (owned by the head sculptor). colossalBody.sculptColossal(bi, {head}) calls
// sculptHead(S, bi), which appends the head's SDF ops (part:'head', bones head/jaw) to the shared Sculpt.
// Primary reference: ref/colossal_head_game_closeup.png (Koei Tecmo game). Proportions follow the realistic refs
// (colossal_realistic_*.png): a human-proportioned bald skull, small against the huge neck/shoulders.
//   1. volumes: pale wrinkled skull cap + angry overhanging brow + narrow nose ridge; red face/jaw underneath
//   2. red muscle: big striated bulges under the eyes, thin temporal strands at the sides
//   3. pale skin straps laid flush (conformal copies of the surface, crisp step): upper/lower lip bands framing a
//      mouth ~45% of the face width, diagonal cheek straps (cheekbone -> mouth corner -> jaw), zygoma, temple straps
//   4. carves: deep sockets, nostrils, the front tooth slot + a back window where molars show through the masseter
//   5. gums, masseter strands across the back window, striated chin, skin furrows over the cranium
// Head-local coordinates (x = its left, y up, z forward), scaled by HS around HEAD_C. HS is smaller than the body's
// 1.08 on purpose (small head); the jaw bone pivot (body: model 0, 1.7053, -0.0176) sits at the hinge in front of the ear.
import { makeSDF, grad } from './sculpt.js';

export const HS = 0.65;                    // ~9 heads tall (realistic refs): head ~1/4.4 of the shoulder width
export const HEAD_C = [0, 1.735, 0.006];
const WX = 1.3;                            // design space is laterally compressed: x is widened by WX (face width ~0.75 x head height)
const H = (x, y, z) => [HEAD_C[0] + x * WX * HS, HEAD_C[1] + y * HS, HEAD_C[2] + z * HS];
const R = (r) => r * HS;
const E = (rx, ry, rz) => [rx * WX * HS, ry * HS, rz * HS];   // volume radii in design space
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---- layout (head-local, unscaled) ----
const BITE = -0.118;                       // clenched bite line
const TOP_H = 0.017, LOW_H = 0.015;       // teeth heights
const ARCH = { ax: 0.056, az: 0.062, cz: 0.05 };   // dental arch ellipse (front of the teeth at z = cz + az)
const U_FRONT = 0.5;                      // front slot half-extent in arch parameter (x ~ +-0.037: ~45% of the face)
const U_BACK = [0.74, 1.04];                // molar window behind the diagonal strap
const EYE = { x: 0.034, y: -0.019, z: 0.075 };
export const MOUTH = {
  y: (u) => BITE + 0.003 * u * u,
  hh: () => (TOP_H + LOW_H) / 2,
  x: (u) => ARCH.ax * Math.sin(u * 1.2),
  z: (u) => ARCH.cz + ARCH.az * Math.cos(u * 1.2),
};
const archOut = (u) => { const th = u * 1.2; return norm([Math.sin(th) / ARCH.ax, 0, Math.cos(th) / ARCH.az]); };
export const EYES = [{ c: H(EYE.x, EYE.y, EYE.z), r: R(0.0048) }, { c: H(-EYE.x, EYE.y, EYE.z), r: R(0.0048) }];
// eye-pit shading (muscleMaterial uEyeL/uEyeR/uEyeRad)
export const SOCKETS = [{ c: H(EYE.x, EYE.y + 0.002, 0.088), rad: E(0.02, 0.013, 0.03) }, { c: H(-EYE.x, EYE.y + 0.002, 0.088), rad: E(0.02, 0.013, 0.03) }];
export const MOUTH_INNER = { c: H(0, BITE + 0.002, 0.052), r: R(0.048), s: [1.1 * WX, 0.48, 0.75] };
export const TONGUE = { c: H(0, BITE - 0.012, -0.004) };   // well behind the teeth (its mesh size is fixed in colossal.js)

// ---- surface projection against a frozen SDF ----
function surfacer(ops) {
  const f = makeSDF(ops), g = [0, 0, 0];
  return (p) => {
    let q = p.slice();
    for (let i = 0; i < 16; i++) { const d = f(q[0], q[1], q[2]); grad(f, q[0], q[1], q[2], 0.0015, g); q = [q[0] - g[0] * d, q[1] - g[1] * d, q[2] - g[2] * d]; }
    grad(f, q[0], q[1], q[2], 0.002, g);
    return { p: q, n: [g[0], g[1], g[2]] };
  };
}
// Catmull-Rom resample of a control polyline (model coords) at ~step spacing
function resample(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const L = Math.hypot(...sub(p2, p1)), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function sculptHead(S, bi) {
  const hb = bi.head, jb = bi.jaw;
  const ho = { part: 'head' };
  const PALE = { ...ho, tendon: 1 };
  const MUS = { ...ho, tendon: 0 };
  const sym = (fn) => { fn(1); fn(-1); };
  const boneAt = (y) => (y < BITE ? jb : hb);
  const chain = (pts, r0, r1, o) => { for (let i = 0; i < pts.length - 1; i++) S.cone(pts[i], pts[i + 1], r0 + (r1 - r0) * i / (pts.length - 1), r0 + (r1 - r0) * (i + 1) / (pts.length - 1), { ...o, fib: o.fib || sub(pts[i + 1], pts[i]) }); };

  // ================= 1. volumes =================
  // pale skull cap (fib = wrinkle-fold direction: rising from the brow, then running back over the crown)
  S.ell(H(0, 0.028, -0.016), E(0.08, 0.088, 0.092), { ...PALE, k: R(0.02), bone: hb, fib: [0, 0.4, -1] });
  S.ell(H(0, 0.03, 0.03), E(0.071, 0.064, 0.062), { ...PALE, k: R(0.022), bone: hb, fib: [0, 1, 0] });
  // red face block, upper jaw, massive mandible + chin, ramus
  S.ell(H(0, -0.062, 0.038), E(0.077, 0.055, 0.068), { ...MUS, k: R(0.02), bone: hb, fib: [0, 1, 0] });
  S.ell(H(0, -0.096, 0.068), E(0.06, 0.03, 0.052), { ...MUS, k: R(0.016), bone: hb, fib: [0, 1, 0] });
  S.box(H(0, -0.152, 0.044), E(0.068, 0.04, 0.06), R(0.03), { ...MUS, k: R(0.016), bone: jb, dir: [0, 1, 0], hint: [0, 0, 1], fib: [0, 1, 0] });
  S.box(H(0, -0.166, 0.079), E(0.045, 0.03, 0.03), R(0.018), { ...MUS, k: R(0.014), bone: jb, dir: [0, 1, 0.12], hint: [0, 0, 1], fib: [0, 1, 0] });
  sym((s) => {
    S.cone(H(0.066 * s, -0.176, -0.004), H(0.07 * s, -0.055, -0.026), R(0.016), R(0.012), { ...MUS, k: R(0.016), bone: jb, fib: [0, 1, 0] });
    S.ell(H(0.064 * s, -0.04, 0.06), E(0.017, 0.012, 0.02), { ...PALE, k: R(0.016), bone: hb, fib: [1, 0, 0] });              // cheekbone
    S.ell(H(0.077 * s, -0.046, -0.04), [R(0.0075), R(0.017), R(0.011)], { ...PALE, k: R(0.007), bone: hb, fib: [0, 1, 0] });          // small ear, set back
  });
  // angry overhanging brow: one smooth ridge per orbit (inner end low and forward), blended into the forehead
  sym((s) => {
    S.ell(H(0.027 * s, -0.004, 0.097), [R(0.0105), R(0.031 * WX), R(0.016)], { ...PALE, k: R(0.014), bone: hb, dir: [s * WX, 0.2, -0.3], hint: [0, 0.2, 1], fib: [0, 1, 0] });
    S.ell(H(0.056 * s, -0.002, 0.079), [R(0.0095), R(0.016 * WX), R(0.014)], { ...PALE, k: R(0.014), bone: hb, dir: [0.75 * s * WX, -0.15, -0.65], hint: [0.6 * s, 0.2, 0.8], fib: [0, 1, 0] });
  });
  S.ell(H(0, -0.015, 0.099), E(0.011, 0.011, 0.01), { ...PALE, k: R(0.01), bone: hb, fib: [0, 1, 0] });
  // narrow pale nose ridge
  S.cone(H(0, -0.016, 0.106), H(0, -0.064, 0.12), R(0.0062), R(0.0082), { ...PALE, k: R(0.008), bone: hb, fib: [0, -1, 0.2] });
  sym((s) => S.cone(H(0.0055 * s, -0.026, 0.099), H(0.0085 * s, -0.062, 0.106), R(0.0045), R(0.006), { ...PALE, k: R(0.008), bone: hb }));
  S.ell(H(0, -0.069, 0.117), E(0.0115, 0.0085, 0.009), { ...PALE, k: R(0.008), bone: hb });

  // ================= 2. red muscle =================
  let surf = surfacer(S.ops);
  let fB = makeSDF(S.ops.filter((o) => o.part === 'head'));
  // CONFORMAL plates: a copy of the current surface pushed out by `prot`, clipped to a region (crisp step at the edge)
  const conform = (region, bc, br, prot, opts) => {
    const base = fB, P = R(prot), far = R(0.012);
    return S._push({ d: (x, y, z) => { const r = region(x, y, z); return r > far ? r : Math.max(base(x, y, z) - P, r); }, bc, br: br + R(0.004) }, opts);
  };
  // rounded trapezoid on the surface around c: half-width hwN at the `along`-negative end, hwW at the other
  const lobe = (c, hwN, hwW, hl, rr, along, prot, opts) => {
    const { p, n } = surf(H(...c));
    const a = norm(sub(along, mul(n, dot(along, n)))), b = cross(a, n);
    const HN = R(hwN), HW = R(hwW), HL = R(hl), RR = R(rr), TH = R(0.03);
    const region = (x, y, z) => {
      const dx = x - p[0], dy = y - p[1], dz = z - p[2];
      const u = dx * b[0] + dy * b[1] + dz * b[2], v = dx * a[0] + dy * a[1] + dz * a[2], h = dx * n[0] + dy * n[1] + dz * n[2];
      const t = Math.min(1, Math.max(0, (v + HL) / (2 * HL)));
      const qx = Math.abs(u) - (HN + (HW - HN) * t) + RR, qy = Math.abs(v) - HL + RR;
      const d2 = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - RR;
      return Math.max(d2, Math.abs(h) - TH);
    };
    return conform(region, p, Math.hypot(R(Math.max(hwN, hwW)), HL), prot, { ...MUS, ...opts, k: R(0.0015), fib: opts.fib || a });
  };
  // temporal fans: muscle showing through at the sides of the skull, narrowing down onto the arch
  sym((s) => lobe([0.085 * s, 0.012, 0.0], 0.01, 0.024, 0.036, 0.012, [0, 1, -0.45], 0.0026, { bone: hb, fib: [0, -1, 0.4] }));
  // big striated bulges under the eyes (zygomaticus / levator), vertical bundles
  sym((s) => {
    S.ell(H(0.036 * s, -0.056, 0.09), E(0.021, 0.03, 0.016), { ...MUS, k: R(0.012), bone: hb, dir: [0.15 * s, -1, 0.15], hint: [0, 0, 1] });
    S.ell(H(0.03 * s, -0.036, 0.095), [R(0.012), R(0.017 * WX), R(0.012)], { ...MUS, k: R(0.01), bone: hb, dir: [1, 0, 0], hint: [0, 0, 1] });    // orbicularis under the eye
    S.ell(H(0.071 * s, -0.09, 0.03), [R(0.03), R(0.04), R(0.014)], { ...MUS, k: R(0.012), bone: hb, dir: [0.05 * s, -1, 0.1], hint: [1 * s, 0, 0] });   // masseter (upper)
    S.ell(H(0.069 * s, -0.142, 0.026), [R(0.028), R(0.034), R(0.013)], { ...MUS, k: R(0.012), bone: jb, dir: [0.05 * s, -1, 0.1], hint: [1 * s, 0, 0] });  // masseter (lower)
  });
  // striated chin: vertical bundles below the lower lip band
  for (let i = -3; i <= 3; i++) S.cap(H(i * 0.011, BITE - LOW_H - 0.02, 0.108 - Math.abs(i) * 0.003), H(i * 0.012, -0.188, 0.1 - Math.abs(i) * 0.004), R(0.0058), { ...MUS, k: R(0.005), bone: jb, fib: [0, 1, 0] });

  // ================= 3. pale skin straps (conformal tubes on the surface) =================
  surf = surfacer(S.ops);
  fB = makeSDF(S.ops.filter((o) => o.part === 'head'));
  const strap = (ctrl, w, { prot = 0.0024, bone, step = 0.005 } = {}) => {
    const pts = resample(ctrl.map((c) => surf(H(...c)).p), R(step)).map((p) => surf(p).p);
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1);
      const w0 = typeof w === 'function' ? w(t0) : w, w1 = typeof w === 'function' ? w(t1) : w;
      const m = lerp(pts[i], pts[i + 1], 0.5);
      segs.push({ a: pts[i], b: pts[i + 1], r0: R(w0) / 2, r1: R(w1) / 2, bone: bone ?? boneAt((m[1] - HEAD_C[1]) / HS) });
    }
    let i0 = 0;
    for (let i = 1; i <= segs.length; i++) {
      if (i < segs.length && segs[i].bone === segs[i0].bone) continue;
      const run = segs.slice(i0, i);
      const region = (x, y, z) => {
        let d = 1e9;
        for (const g of run) {
          const bax = g.b[0] - g.a[0], bay = g.b[1] - g.a[1], baz = g.b[2] - g.a[2];
          const pax = x - g.a[0], pay = y - g.a[1], paz = z - g.a[2];
          const t = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz + 1e-12)));
          const e = Math.hypot(pax - bax * t, pay - bay * t, paz - baz * t) - (g.r0 + (g.r1 - g.r0) * t);
          if (e < d) d = e;
        }
        return d;
      };
      let c = [0, 0, 0];
      for (const g of run) c = add(c, mul(add(g.a, g.b), 0.5 / run.length));
      let br = 0;
      for (const g of run) br = Math.max(br, Math.hypot(...sub(g.a, c)) + g.r0, Math.hypot(...sub(g.b, c)) + g.r1);
      conform(region, c, br, prot, { ...PALE, k: R(0.0015), bone: run[0].bone, fib: sub(run[run.length - 1].b, run[0].a) });
      i0 = i;
    }
  };
  const arc = (u0, u1, n, f) => { const out = []; for (let i = 0; i <= n; i++) out.push(f(u0 + (u1 - u0) * i / n)); return out; };
  // upper lip band (pale skin frame over the upper teeth) + pale philtrum up to the nose
  strap(arc(-0.74, 0.74, 10, (u) => { const o = archOut(u); return [MOUTH.x(u) + o[0] * 0.006, BITE + TOP_H + 0.0065 - 0.002 * u * u, MOUTH.z(u) + o[2] * 0.006]; }), 0.012);
  strap([[0, -0.072, 0.11], [0, BITE + TOP_H + 0.006, 0.106]], 0.015);
  // thick lower lip band under the lower teeth, continuing back along the jaw to the angle
  sym((s) => {
    const front = arc(0, 0.8 * s, 6, (u) => { const o = archOut(u); return [MOUTH.x(u) + o[0] * 0.006, BITE - LOW_H - 0.0085 + 0.003 * u * u, MOUTH.z(u) + o[2] * 0.006]; });
    strap([...front, [0.064 * s, -0.152, 0.03], [0.067 * s, -0.176, -0.008]], (t) => 0.017 - 0.006 * t, { bone: jb });
  });
  sym((s) => {
    // diagonal cheek strap: cheekbone at the outer eye corner -> down-forward to the mouth corner
    strap([[0.072 * s, -0.03, 0.062], [0.062 * s, -0.06, 0.078], [0.047 * s, -0.095, 0.09], [0.04 * s, BITE + 0.002, 0.094], [0.042 * s, BITE - LOW_H - 0.006, 0.09]], (t) => 0.0105 - 0.002 * t);
    // zygoma: from the outer eye corner back to the temple strap
    strap([[0.071 * s, -0.03, 0.064], [0.079 * s, -0.034, 0.034], [0.082 * s, -0.036, 0.0]], 0.0085);
    // temple strap: behind the orbit, down in front of the ear to the jaw angle
    strap([[0.077 * s, 0.01, 0.034], [0.082 * s, -0.036, -0.006], [0.077 * s, -0.1, -0.02], [0.07 * s, -0.155, -0.02], [0.067 * s, -0.176, -0.008]], (t) => 0.0095 + 0.003 * t);
  });

  // ================= 4. carves =================
  sym((s) => {
    S.ell(H(EYE.x * s, EYE.y, 0.092), [R(0.02), R(0.0078), R(0.026)], { ...ho, sub: true, k: R(0.004), dir: [1, -0.1 * s, 0], hint: [0, 0, 1] });   // deep narrow socket
    S.ell(H(EYE.x * s, EYE.y + 0.005, 0.099), [R(0.024), R(0.0065), R(0.014)], { ...ho, sub: true, k: R(0.006) });                                    // under-brow pocket
    S.ell(H(0.0075 * s, -0.077, 0.111), [R(0.0042), R(0.003), R(0.009)], { ...ho, sub: true, k: R(0.002), dir: [0, 0.6, 1], hint: [1, 0, 0] });         // nostril
  });
  // skin furrows over the cranium: shallow grooves rising from the brow, fanning back over the crown
  {
    const sf = surfacer(S.ops);
    for (let i = -3; i <= 3; i++) {
      const x0 = i * 0.0125 + (i % 2 ? 0.003 : -0.002);
      const ctrl = [[x0 * 0.7, 0.02, 0.12], [x0, 0.058, 0.12], [x0 * 1.25, 0.095, 0.1], [x0 * 1.45, 0.122, 0.02]].map((p) => sf(H(...p)).p);
      const pts = resample(ctrl, R(0.006));
      for (let k = 0; k < pts.length - 1; k++) {
        const t = k / (pts.length - 1), r = R(0.0016 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05)) + 0.0004);
        S.cap(pts[k], pts[k + 1], r, { ...ho, sub: true, k: R(0.0012) });
      }
    }
    sym((s) => S.cap(sf(H(0.006 * s, -0.004, 0.12)).p, sf(H(0.007 * s, 0.018, 0.12)).p, R(0.0014), { ...ho, sub: true, k: R(0.001) }));   // frown creases
  }
  // front tooth slot (~45% of the face width) and the molar window behind each diagonal strap
  const slot = (u0, u1, n) => {
    for (let i = 0; i <= n; i++) {
      const u = u0 + (u1 - u0) * i / n, out = archOut(u);
      const c = add([MOUTH.x(u), MOUTH.y(u) + (TOP_H - LOW_H) / 2, MOUTH.z(u)], mul(out, 0.022));
      S.ell(H(...c), [R(0.0105), R((TOP_H + LOW_H) / 2 + 0.0004), R(0.026)], { ...ho, sub: true, k: R(0.0025), dir: [0, 1, 0], hint: out });
    }
  };
  slot(-U_FRONT, U_FRONT, 16);
  sym((s) => { const [a, b] = U_BACK; slot(a * s, b * s, 5); });

  // ================= 5. gums, socket backstops, masseter strands across the molar window =================
  const gumAt = (u) => {
    const base = sub([MOUTH.x(u), MOUTH.y(u), MOUTH.z(u)], mul(archOut(u), 0.006));
    S.ell(H(base[0], base[1] + TOP_H * 0.75, base[2]), [R(0.009), R(0.007), R(0.008)], { ...ho, k: R(0.006), bone: hb, gum: 1 });
    S.ell(H(base[0], base[1] - LOW_H * 0.75, base[2]), [R(0.009), R(0.007), R(0.008)], { ...ho, k: R(0.006), bone: jb, gum: 1 });
  };
  for (let i = 0; i <= 12; i++) gumAt(-1.02 + (i / 12) * 2.04);
  sym((s) => S.ell(H(EYE.x * s, EYE.y, 0.064), [R(0.013), R(0.008), R(0.006)], { ...ho, k: R(0.004), bone: hb, flush: 1 }));   // dark socket backstop
  sym((s) => {
    for (let k = 0; k < 5; k++) {
      const u = (U_BACK[0] + 0.02 + k * 0.055) * s, out = archOut(u);
      const c = add([MOUTH.x(u), MOUTH.y(u), MOUTH.z(u)], mul(out, 0.007 + k * 0.0012));
      const top = H(c[0], c[1] + TOP_H + 0.006, c[2]), mid = H(c[0] + 0.0012 * s, c[1], c[2] + 0.001), bot = H(c[0], c[1] - LOW_H - 0.006, c[2]);
      S.cap(top, mid, R(0.0026), { ...MUS, k: R(0.0022), bone: hb, fib: [0, 1, 0] });
      S.cap(mid, bot, R(0.0026), { ...MUS, k: R(0.0022), bone: jb, fib: [0, 1, 0] });
    }
  });
  return S;
}

// teeth along the arch: long narrow flat teeth, clenched (the back ones only show through the molar windows)
export function teethLayout() {
  const out = [];
  const n = 11;
  for (const upper of [true, false]) {
    for (const s of [1, -1]) {
      let th = 0;
      for (let i = 0; i < n; i++) {
        const w = (0.0066 - 0.00012 * i) * (upper ? 1 : 0.94);
        const { ax, az, cz } = ARCH;
        const dth = (w * 1.04) / Math.hypot(ax * WX * Math.cos(th), az * Math.sin(th));
        const tc = th + dth * 0.5; th += dth;
        const x = ax * Math.sin(tc) * s, z = cz + az * Math.cos(tc);
        const yc = MOUTH.y(Math.min(1, tc / 1.2));
        const hgt = (upper ? TOP_H : LOW_H) * (1 - 0.18 * (i / n));
        const tx = ax * WX * Math.cos(tc) * s, tz = -az * Math.sin(tc), tl = Math.hypot(tx, tz);
        const ox = Math.sin(tc) * s / (ax * WX), oz = Math.cos(tc) / az, ol = Math.hypot(ox, oz);
        const yTop = upper ? yc + hgt - 0.0004 : yc - 0.0004;
        out.push({ pos: H(x, yTop - hgt / 2, z), tangent: [tx / tl, 0, tz / tl], outward: [ox / ol, 0, oz / ol], w: w * HS, h: hgt * HS, upper, i });
      }
    }
  }
  return out;
}
