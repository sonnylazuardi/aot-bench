// WORLD: the great wall (Wall Maria around Shiganshina).
//  * static ring: a lathe of the cut-stone cross-section (plinth, string courses, corbelled cornice, walkway with
//    cannon rails, parapet, battered outer face) in 24 angular chunks + tall pilasters on both faces that rise above
//    the top as square posts (reference: colossal_fullbody_town / poster), cannons, rails, lanterns.
//  * HERO SECTION (±101 m of arc around the outer gate): rebuilt on demand. Lower band (< RIM m) in the breach zone
//    is either the intact gatehouse (arched tunnel, pylons, gate leaves) or the breached wall (per-course hole whose
//    edges follow the mortar joints the shader draws, exposed rubble core); the rim band (> RIM m) is a row of 2.6 m
//    columns whose tops can be bitten away (the giant crushing the wall top).
import * as THREE from 'three';
import { GB } from './geom.js';
import { Rng, lin, hash12, hash2i } from './util.js';
import { LAYOUT } from '../core/layout.js';

export const WALL = {
  R: LAYOUT.wall.radius, T: LAYOUT.wall.thickness, H: LAYOUT.wall.height,
  RO: LAYOUT.wall.radius + LAYOUT.wall.thickness, // outer radius at the top (394)
  BATTER: 3.0,                                      // outer face leans: +3 m at the base
  CH: 1.3, BL: 2.6,                                 // masonry course height / mean block length (shader + breach)
  GATE_HALF: 8, GATE_SPRING: 15, GATE_ZONE: 30,     // opening half width, arch springing height, inner gate zone half arc
  PARA_H: 1.35,
  AG: Math.PI / 2,                                  // outer gate angle
  HERO: 101.4, CW: 2.6, BZ: 46.8, RIM: 36.4,        // hero half arc, rim column width, breach zone half arc, rim base
  NPIL: 116,                                        // pilasters around the ring
};
WALL.NCOL = Math.round((2 * WALL.HERO) / WALL.CW);
export const outerR = (y) => WALL.RO + WALL.BATTER * Math.max(0, 1 - y / 46.5);
export const WMAT = { ASHLAR: 0, WALK: 1, CORE: 2, WOOD: 3, IRON: 4, TRIM: 5, RUBBLE: 6 };
export function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

// ------------------------------------------------------------------------------------------------ shader
export const WALL_GLSL = /* glsl */`
vec4 ashlarW(vec2 uv, float ch, float bl, float seed) {
  float row = floor(uv.y / ch);
  float fy = uv.y - row * ch;
  float x = uv.x / bl + hash12(vec2(row, seed));
  float k = floor(x);
  float rs = row + seed * 13.0;
  float j0 = k + (hash12(vec2(k, rs)) - 0.5) * 0.5;
  float j1 = k + 1.0 + (hash12(vec2(k + 1.0, rs)) - 0.5) * 0.5;
  float c = k;
  if (x < j0) { j1 = j0; j0 = k - 1.0 + (hash12(vec2(k - 1.0, rs)) - 0.5) * 0.5; c = k - 1.0; }
  else if (x > j1) { j0 = j1; j1 = k + 2.0 + (hash12(vec2(k + 2.0, rs)) - 0.5) * 0.5; c = k + 1.0; }
  float ex = min(x - j0, j1 - x) * bl;
  float ey = min(fy, ch - fy);
  return vec4(min(ex, ey), hash12(vec2(c, row) + seed * 3.1), row, c);
}
vec3 voro(vec2 p) { // (F1, F2-F1, id hash)
  vec2 ip = floor(p), fp = fract(p);
  float F1 = 9.0, F2 = 9.0; vec2 id = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(ip + g) * 0.8 + 0.1;
    vec2 r = g + o - fp; float d = dot(r, r);
    if (d < F1) { F2 = F1; F1 = d; id = ip + g; } else if (d < F2) F2 = d;
  }
  return vec3(sqrt(F1), sqrt(F2) - sqrt(F1), hash12(id));
}
Surf wallStone(vec2 uv, vec3 tint, float ch, float bl, float seed, float y, float dmg) {
  vec4 blk = ashlarW(uv, ch, bl, seed);
  float e = blk.x;
  float lod = smoothstep(0.04, 0.16, gPx);
  vec3 c = tint * (0.82 + 0.3 * blk.y);
  c *= 0.93 + 0.14 * hash12(vec2(floor(blk.z / 7.0), seed + 2.0));
  c *= 0.84 + 0.3 * nL(uv * 0.0035 + seed);
  c = mix(c, c * vec3(1.07, 1.0, 0.88), smoothstep(0.6, 0.9, hash12(vec2(blk.w, blk.z) + 7.7)) * 0.7);
  float g1 = nF(uv * 0.9 + seed), g2 = nH(uv * 0.21 + blk.y * 3.0);
  c *= 0.84 + 0.2 * g1 + 0.14 * (g2 - 0.5);
  float pillow = smoothstep(0.0, 0.2, e);
  float mort = (1.0 - aa(0.035, e)) * (1.0 - lod);
  c *= mix(0.74, 1.0, mix(pillow, 0.92, lod));
  c = mix(c, vec3(0.19, 0.18, 0.16) * (0.8 + 0.4 * g1), mort * 0.85);
  // faint joint lines survive at distance (courses read even far away)
  c *= 1.0 - lod * 0.18 * (1.0 - smoothstep(0.0, 0.25 + gPx * 0.6, e));
  float st = smoothstep(0.52, 0.92, nH(vec2(uv.x * 0.23, uv.y * 0.011) + seed));
  float st2 = smoothstep(0.58, 0.95, nM(vec2(uv.x * 0.05, uv.y * 0.005) + seed * 2.0));
  c *= 1.0 - 0.32 * st - 0.22 * st2;
  float lime = smoothstep(0.7, 0.95, nH(vec2(uv.x * 0.31 + 3.0, uv.y * 0.02)));
  c = mix(c, vec3(0.5, 0.49, 0.45), lime * 0.22);
  float baseH = 6.0 + 6.0 * nM(vec2(uv.x * 0.01, 0.5) + seed);
  float wet = 1.0 - smoothstep(0.0, baseH, y);
  c *= 1.0 - 0.4 * wet;
  float moss = wet * smoothstep(0.45, 0.75, nM(uv * 0.08 + seed)) + mort * wet * 0.8;
  c = mix(c, vec3(0.06, 0.075, 0.03) * (0.7 + 0.6 * g1), clamp(moss, 0.0, 1.0) * 0.7);
  // damage: soot, cracks radiating near breaks
  float crack = (1.0 - smoothstep(0.0, 0.05, abs(nH(uv * 0.12 + 5.0) - 0.5))) * dmg;
  c *= 1.0 - dmg * (0.25 + 0.35 * nH(uv * 0.15)) - crack * 0.6;
  Surf s = surfInit(c, 0.9 - 0.1 * wet);
  s.h = (0.07 * pillow + 0.02 * g2) * (1.0 - lod) - 0.02 * mort - crack * 0.03;
  s.ao = mix(0.8, 1.0, mix(pillow, 1.0, lod));
  return s;
}
Surf surf() {
  float id = floor(vMat.x + 0.5);
  vec3 tint = vTint;
  vec2 uv = vUV.xy;
  float y = vWPos.y;
  float dmg = vUV.w;
  if (id < 0.5) return wallStone(uv, tint, 1.3, 2.6, 0.0, y, dmg);
  if (id < 1.5) { // walkway flagstones
    Surf s = wallStone(uv, tint, 0.95, 1.5, 5.0, 60.0, 0.0);
    s.alb *= 0.9 + 0.2 * nM(uv * 0.05);
    s.rough = 0.85;
    return s;
  }
  if (id < 2.5) { // exposed rubble core / broken block ends (u = depth into the wall)
    float depth = uv.x;
    bool face = depth < 1.6 || depth > 12.4;
    vec3 v = voro(uv * vec2(1.7, 2.1));
    float stone = smoothstep(0.02, 0.12, v.y);
    vec3 c = tint * (0.5 + 0.55 * v.z) * (0.8 + 0.35 * nF(uv * 1.3));
    vec3 mortar = vec3(0.27, 0.25, 0.21) * (0.8 + 0.4 * nH(uv * 0.7));
    c = mix(mortar, c, stone);
    if (face) { c = tint * (1.0 + 0.25 * nF(uv * 2.0)) * (0.85 + 0.2 * nH(uv * 0.5)); stone = 1.0; }
    c *= 0.85 + 0.2 * nM(uv * 0.1);
    Surf s = surfInit(c * (1.0 - 0.2 * dmg), 0.95);
    s.h = face ? nH(uv * 0.4) * 0.1 : stone * 0.12 * (1.0 - v.x);
    return s;
  }
  if (id < 3.5) { // heavy timber (gate leaves, carriages)
    float plank = abs(fract(uv.x / 0.42) - 0.5);
    float g = nF(vec2(uv.x * 0.8, uv.y * 0.07));
    vec3 c = tint * (0.6 + 0.6 * g) * (0.75 + 0.25 * smoothstep(0.43, 0.49, 0.5 - plank + 0.45));
    float band = 1.0 - aa(0.18, abs(fract(uv.y / 3.2) - 0.5) * 3.2 - 1.2);
    c = mix(c, vec3(0.035, 0.032, 0.03) * (0.8 + 0.5 * nH(uv * 2.0)), band);
    Surf s = surfInit(c, mix(0.8, 0.45, band));
    s.metal = band * 0.6;
    s.h = (1.0 - smoothstep(0.43, 0.5, plank)) * 0.02 + band * 0.03;
    return s;
  }
  if (id < 4.5) { // iron
    float rust = smoothstep(0.45, 0.8, nH(uv * 0.8));
    Surf s = surfInit(mix(vec3(0.045, 0.045, 0.048), vec3(0.16, 0.07, 0.03), rust), mix(0.45, 0.85, rust));
    s.metal = 0.75 * (1.0 - rust);
    return s;
  }
  if (id < 5.5) return wallStone(uv, tint, max(vUV.z, 0.35), max(vUV.z, 0.35) * 2.1, 9.0, y, dmg);
  if (id < 6.5) { // loose rubble mound
    vec3 v = voro(uv * 1.2);
    vec3 v2 = voro(uv * 4.1 + 3.0);
    float stone = smoothstep(0.03, 0.14, v.y);
    vec3 c = tint * (0.6 + 0.45 * v.z) * (0.8 + 0.3 * nF(uv));
    vec3 dust = vec3(0.3, 0.27, 0.22) * (0.8 + 0.3 * nH(uv * 0.3));
    c = mix(mix(dust, c * 0.7, smoothstep(0.02, 0.1, v2.y)), c, stone);
    Surf s = surfInit(c, 0.95);
    s.h = stone * 0.25 * (1.0 - v.x) + smoothstep(0.02, 0.1, v2.y) * 0.04;
    return s;
  }
  // 7: lantern glass (warm)
  Surf s = surfInit(tint, 0.3);
  s.emis = tint * 0.6;
  return s;
}
`;

// ------------------------------------------------------------------------------------------------ profile
const STONE = lin(0xb3a68f), STONE_DK = lin(0x9e9380), TRIM = lin(0xc2b69d), WALK = lin(0xa89e8c), IRON = [0.05, 0.05, 0.05];
const colOf = (mat) => (mat === WMAT.WALK ? WALK : mat === WMAT.TRIM ? TRIM : mat === WMAT.IRON ? IRON : STONE);

function profilePoints() {
  const { R, RO, H } = WALL;
  const P = [];
  const add = (r, y, mat = WMAT.ASHLAR, p = 0) => P.push([r, y, mat, p]);
  add(R - 1.6, 0, WMAT.TRIM, 0.55); add(R - 1.6, 2.4, WMAT.TRIM, 0.55); add(R - 0.9, 3.2, WMAT.TRIM, 0.55);
  add(R - 0.9, 3.5, WMAT.ASHLAR); add(R, 3.9, WMAT.ASHLAR);
  add(R, 21.6, WMAT.TRIM, 0.5); add(R - 0.55, 22.0, WMAT.TRIM, 0.5); add(R - 0.55, 23.0, WMAT.TRIM, 0.5); add(R, 23.5, WMAT.ASHLAR);
  add(R, 44.2, WMAT.TRIM, 0.6); add(R - 0.5, 44.6, WMAT.TRIM, 0.6); add(R - 0.5, 45.3, WMAT.TRIM, 0.6); add(R - 1.1, 46.1, WMAT.TRIM, 0.6);
  add(R - 1.1, 47.9, WMAT.TRIM, 0.6); add(R - 1.4, 48.2, WMAT.TRIM, 0.6); add(R - 1.4, H, WMAT.WALK);
  const rail = (rr) => { add(rr, H, WMAT.IRON); add(rr, H + 0.14, WMAT.IRON); add(rr + 0.12, H + 0.14, WMAT.IRON); add(rr + 0.12, H, WMAT.WALK); };
  rail(R + 6.0); rail(R + 7.6);
  add(RO - 1.2, H, WMAT.TRIM, 0.45); add(RO - 1.2, H + WALL.PARA_H, WMAT.TRIM, 0.45); add(RO + 0.25, H + WALL.PARA_H, WMAT.TRIM, 0.45);
  add(RO + 0.25, H - 0.6, WMAT.TRIM, 0.6); add(RO + 0.6, H - 0.9, WMAT.TRIM, 0.6); add(RO + 0.6, H - 2.4, WMAT.TRIM, 0.6); add(outerR(46.5), 46.5, WMAT.ASHLAR);
  add(outerR(33.4), 33.4, WMAT.TRIM, 0.5); add(outerR(33.4) + 0.45, 33.0, WMAT.TRIM, 0.5); add(outerR(32.2) + 0.45, 32.2, WMAT.TRIM, 0.5); add(outerR(31.8), 31.8, WMAT.ASHLAR);
  add(outerR(16.6), 16.6, WMAT.TRIM, 0.5); add(outerR(16.6) + 0.45, 16.2, WMAT.TRIM, 0.5); add(outerR(15.4) + 0.45, 15.4, WMAT.TRIM, 0.5); add(outerR(15.0), 15.0, WMAT.ASHLAR);
  add(outerR(4.2), 4.2, WMAT.TRIM, 0.6); add(outerR(4.2) + 1.2, 3.4, WMAT.TRIM, 0.6); add(outerR(0) + 1.2, 0, WMAT.TRIM, 0.6);
  return P;
}
// segments [r0,y0,r1,y1,mat,pp]
function segsOf(P) { const S = []; for (let i = 0; i + 1 < P.length; i++) S.push([P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], P[i][2], P[i][3]]); return S; }
function clipSegs(S, yMin, yMax) {
  const out = [];
  for (const [r0, y0, r1, y1, m, p] of S) {
    if (Math.abs(y1 - y0) < 1e-6) { if (y0 >= yMin && y0 < yMax) out.push([r0, y0, r1, y1, m, p]); continue; }
    const t = (y) => (y - y0) / (y1 - y0);
    let ta = t(yMin), tb = t(yMax); if (ta > tb) { const q = ta; ta = tb; tb = q; }
    const a = Math.max(0, ta), b = Math.min(1, tb);
    if (b - a < 1e-6) continue;
    out.push([r0 + (r1 - r0) * a, y0 + (y1 - y0) * a, r0 + (r1 - r0) * b, y0 + (y1 - y0) * b, m, p]);
  }
  return out;
}

// lathe of segments between angles a0..a1
function lathe(gb, segs, a0, a1, step, dmg = 0) {
  const n = Math.max(1, Math.ceil((a1 - a0) / step - 1e-6));
  for (const [r0, y0, r1, y1, mat, pp] of segs) {
    const dr = r1 - r0, dy = y1 - y0;
    const L = Math.hypot(dr, dy); if (L < 1e-4) continue;
    const nr = -dy / L, ny = dr / L; // outward
    const horiz = Math.abs(ny) > 0.7;
    const sgn = nr < 0 ? 1 : -1;
    gb.set({ mat, p0: pp, p1: dmg, col: colOf(mat) });
    const rm = (r0 + r1) / 2;
    let prev = -1;
    for (let k = 0; k <= n; k++) {
      const a = a0 + (a1 - a0) * (k / n);
      const c = Math.cos(a), s = Math.sin(a);
      let ua, ub, va, vb;
      if (horiz) { ua = c * r0; va = -s * r0; ub = c * r1; vb = -s * r1; }
      else { ua = ub = sgn * a * rm; va = y0; vb = y1; }
      const i0 = gb.vtx(c * r0, y0, s * r0, nr * c, ny, nr * s, ua, va);
      gb.vtx(c * r1, y1, s * r1, nr * c, ny, nr * s, ub, vb);
      if (prev >= 0) { gb.tri(prev, prev + 1, i0 + 1); gb.tri(prev, i0 + 1, i0); }
      prev = i0;
    }
  }
}

// frames at angle a: inward (local +z towards the town) at radius r / outward
function frameIn(gb, a, r, y = 0) { gb.frame(Math.cos(a) * r, y, Math.sin(a) * r, Math.atan2(Math.cos(a), -Math.sin(a))); }
function frameOut(gb, a, r, y = 0) { gb.frame(Math.cos(a) * r, y, Math.sin(a) * r, Math.atan2(-Math.cos(a), Math.sin(a))); }

// ------------------------------------------------------------------------------------------------ details
// inner pilaster (tall, shallow, full height, rising above the top as a square post); yTop cuts it (broken rim)
function innerPilaster(gb, a, y0, y1, post = true, broken = false) {
  const { R, H } = WALL;
  frameIn(gb, a, R);
  const hw = 2.3, d = 1.75;
  gb.set({ mat: WMAT.ASHLAR, col: STONE, p0: 0, p1: 0 });
  if (y1 > y0) gb.box(-hw, y0, -0.5, hw, y1, d, 1 | 2 | 16);
  if (y0 <= 3.9 && y1 > 3.9) { // base block
    gb.set({ mat: WMAT.TRIM, col: TRIM, p0: 0.55 });
    gb.box(-hw - 0.4, 0, -0.5, hw + 0.4, 3.6, d + 0.9, 1 | 2 | 16);
    gb.poly([[-hw - 0.4, 3.6, d + 0.9], [hw + 0.4, 3.6, d + 0.9], [hw + 0.4, 4.3, d], [-hw - 0.4, 4.3, d]]);
  }
  if (post && !broken && y1 >= H - 0.01) {
    // cap post above the walkway
    gb.set({ mat: WMAT.TRIM, col: TRIM, p0: 0.6 });
    gb.box(-hw - 0.2, H - 0.3, -3.2, hw + 0.2, H + 0.25, d + 0.25, 63 & ~8);
    gb.set({ mat: WMAT.ASHLAR, col: STONE });
    gb.box(-hw + 0.3, H + 0.25, -2.6, hw - 0.3, H + 2.9, d - 0.3, 1 | 2 | 16 | 32);
    gb.set({ mat: WMAT.TRIM, col: TRIM, p0: 0.5 });
    gb.box(-hw + 0.1, H + 2.9, -2.8, hw - 0.1, H + 3.35, d - 0.1, 63 & ~8);
  }
  if (broken && y1 > y0) { gb.set({ mat: WMAT.CORE, col: STONE }); gb.poly([[-hw, y1, d], [hw, y1, d], [hw, y1 - 0.4, -0.5], [-hw, y1 - 0.4, -0.5]]); }
  gb.frame();
}
function outerPilaster(gb, a, y0, y1, post = true) {
  const { RO, H } = WALL;
  frameOut(gb, a, 0);
  const hw = 2.6, d = 2.2;
  gb.set({ mat: WMAT.ASHLAR, col: STONE_DK, p0: 0, p1: 0 });
  const zf = (y) => outerR(y) + d, zb = (y) => outerR(y) - 1.0;
  const ya = Math.max(y0, 0), yb = Math.min(y1, H - 2.4);
  if (yb > ya) {
    gb.poly([[-hw, ya, zf(ya)], [hw, ya, zf(ya)], [hw, yb, zf(yb)], [-hw, yb, zf(yb)]]);
    gb.poly([[hw, ya, zf(ya)], [hw, ya, zb(ya)], [hw, yb, zb(yb)], [hw, yb, zf(yb)]]);
    gb.poly([[-hw, ya, zb(ya)], [-hw, ya, zf(ya)], [-hw, yb, zf(yb)], [-hw, yb, zb(yb)]]);
  }
  if (post && y1 >= H - 2.4) {
    gb.box(-hw, H - 2.4, RO - 0.5, hw, H + 2.9, RO + d, 1 | 2 | 16);
    gb.set({ mat: WMAT.TRIM, col: TRIM, p0: 0.5 });
    gb.box(-hw - 0.15, H + 2.9, RO - 0.9, hw + 0.15, H + 3.35, RO + d + 0.15, 63 & ~8);
  }
  gb.frame();
}
function cannon(gb, a) {
  const { RO, H } = WALL;
  frameOut(gb, a, RO - 3.6, H);
  gb.set({ mat: WMAT.WOOD, col: lin(0x4a3524), p0: 0, p1: 0 });
  gb.box(-0.55, 0.35, -1.2, -0.3, 1.05, 1.1); gb.box(0.3, 0.35, -1.2, 0.55, 1.05, 1.1); gb.box(-0.55, 0.3, -1.25, 0.55, 0.5, 1.1);
  gb.set({ col: lin(0x3a2a1c) });
  for (const [x, z] of [[-0.68, 0.7], [0.68, 0.7], [-0.68, -0.8], [0.68, -0.8]]) {
    const pts = [];
    for (let k = 0; k < 10; k++) { const aa = (k / 10) * Math.PI * 2; pts.push([x, 0.42 + Math.sin(aa) * 0.42, z + Math.cos(aa) * 0.42]); }
    gb.poly(x < 0 ? pts.map(([px, py, pz]) => [px - 0.08, py, pz]) : pts.map(([px, py, pz]) => [px + 0.08, py, pz]).reverse());
  }
  gb.set({ mat: WMAT.IRON, col: IRON });
  const seg = 8, L0 = -1.4, L1 = 1.9, y0 = 1.25, el = 0.06;
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const p = (aa, rr, zz) => [Math.cos(aa) * rr, y0 + Math.sin(aa) * rr + zz * el, zz];
    gb.poly([p(a0, 0.32, L0), p(a1, 0.32, L0), p(a1, 0.21, L1), p(a0, 0.21, L1)].reverse());
  }
  const back = []; for (let k = 0; k < seg; k++) { const aa = (k / seg) * Math.PI * 2; back.push([Math.cos(aa) * 0.32, y0 + Math.sin(aa) * 0.32 + L0 * el, L0]); }
  gb.poly(back.reverse());
  gb.frame();
}
function railPost(gb, a, lantern) {
  const { R, H } = WALL;
  frameIn(gb, a, R - 1.15, H);
  gb.set({ mat: WMAT.IRON, col: IRON, p0: 0, p1: 0 });
  gb.box(-0.05, 0, -0.05, 0.05, 1.15, 0.05, 1 | 2 | 16 | 32 | 4);
  if (lantern) {
    gb.box(-0.04, 1.15, -0.04, 0.04, 2.6, 0.04, 1 | 2 | 16 | 32);
    gb.box(-0.03, 2.5, 0, 0.03, 2.56, 0.5, 63);
    gb.set({ col: lin(0x2a2622) });
    gb.box(-0.14, 2.05, 0.36, 0.14, 2.45, 0.64, 4 | 8);
    gb.set({ mat: 7, col: lin(0xffb860) });
    gb.box(-0.12, 2.08, 0.38, 0.12, 2.42, 0.62, 1 | 2 | 16 | 32);
  }
  gb.frame();
}
function railBarSegs() {
  const { R, H } = WALL;
  const bar = (y) => [[R - 1.2, y, R - 1.2, y + 0.06, WMAT.IRON, 0], [R - 1.2, y + 0.06, R - 1.1, y + 0.06, WMAT.IRON, 0], [R - 1.1, y + 0.06, R - 1.1, y, WMAT.IRON, 0], [R - 1.1, y, R - 1.2, y, WMAT.IRON, 0]];
  return [...bar(H + 1.1), ...bar(H + 0.55)];
}

// ------------------------------------------------------------------------------------------------ build
export function buildWall(ctx, shared, solids) {
  const { R, H, HERO, BZ, RIM, AG, CW, NCOL } = WALL;
  const prof = profilePoints();
  const segsAll = segsOf(prof);
  const segsLow = clipSegs(segsAll, -1, RIM);
  const segsHigh = clipSegs(segsAll, RIM, 999);
  const rails = railBarSegs();
  const heroA = HERO / R, bzA = BZ / R;
  const innerGateA = -Math.PI / 2, igA = WALL.GATE_ZONE / R;
  const mat = shared.wallMat;
  const group = new THREE.Group(); group.name = 'wall';
  const step = 3.2 / R;
  const inHero = (a) => Math.abs(angDiff(a, AG)) < heroA - 1e-7;
  const inIG = (a) => Math.abs(angDiff(a, innerGateA)) < igA - 1e-7;
  const dA = (Math.PI * 2) / WALL.NPIL;
  const chunks = 24;
  for (let ci = 0; ci < chunks; ci++) {
    const A0 = -Math.PI + (ci / chunks) * Math.PI * 2, A1 = -Math.PI + ((ci + 1) / chunks) * Math.PI * 2;
    const gb = new GB(30000);
    const cuts = [A0, A1];
    for (const e of [AG - heroA, AG - bzA, AG + bzA, AG + heroA, innerGateA - igA, innerGateA + igA]) if (e > A0 && e < A1) cuts.push(e);
    cuts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a0 = cuts[i], a1 = cuts[i + 1], m = (a0 + a1) / 2;
      if (inIG(m)) continue;
      if (inHero(m)) { if (Math.abs(angDiff(m, AG)) > bzA) lathe(gb, segsLow, a0, a1, step); continue; }
      lathe(gb, segsAll, a0, a1, step);
      lathe(gb, rails, a0, a1, step * 2);
    }
    // pilasters, cannons, posts
    for (let k = Math.ceil((A0 - AG) / dA); AG + k * dA < A1; k++) {
      const a = AG + k * dA;
      if (inIG(a) || Math.abs(angDiff(a, innerGateA)) < igA + 3 / R) continue;
      const s = angDiff(a, AG) * R;
      if (Math.abs(s) < BZ + 3) continue;
      if (inHero(a)) { innerPilaster(gb, a, 3.9, RIM, false); outerPilaster(gb, a, 0, RIM, false); }
      else { innerPilaster(gb, a, 3.9, H, true); outerPilaster(gb, a, 0, H, true); if (k % 2 === 0) cannon(gb, a + dA / 2); }
    }
    const nP = Math.round((A1 - A0) * R / 4.4);
    for (let b = 0; b < nP; b++) {
      const a = A0 + ((b + 0.5) / nP) * (A1 - A0);
      if (inHero(a) || inIG(a)) continue;
      railPost(gb, a, b % 7 === 3);
    }
    if (!gb.count) continue;
    const mesh = new THREE.Mesh(gb.build(), mat);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'wall' + ci;
    group.add(mesh);
  }
  // inner (north) gate: static
  {
    const gb = new GB(30000);
    gateIntact(gb, segsAll, innerGateA, WALL.GATE_ZONE, H + 10, false);
    lathe(gb, rails, innerGateA - igA, innerGateA + igA, step * 2);
    const mesh = new THREE.Mesh(gb.build(), mat); mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'wall-innergate';
    group.add(mesh);
  }
  ctx.scene.add(group);

  // ---------------- static colliders for the non-analytic parts ----------------
  const boxArc = (s0, s1, y0, y1, r0, r1, kind = 'wall', ref = 'wall', ag = AG) => {
    const am = ag + ((s0 + s1) / 2) / R;
    const len = (s1 - s0) * ((r0 + r1) / 2) / R;
    const rm = (r0 + r1) / 2;
    const cx = Math.cos(am) * rm, cz = Math.sin(am) * rm;
    // local x = tangent (-sin, cos), local z = radial -> angle fa with ex=(cos fa, sin fa) = tangent
    const fa = Math.atan2(Math.cos(am), -Math.sin(am));
    return solids.addBox(cx, (y0 + y1) / 2, cz, Math.abs(len) / 2 + 0.05, (y1 - y0) / 2, (r1 - r0) / 2, fa, kind, ref);
  };
  // hero lower band outside the breach zone
  for (const sg of [-1, 1]) for (let s = BZ; s < HERO - 1e-6; s += 9.1) {
    const e = Math.min(HERO, s + 9.1);
    boxArc(sg > 0 ? s : -e, sg > 0 ? e : -s, 0, RIM, R, outerR(RIM / 2));
  }
  // inner gate zone: side blocks, arch block, door
  const GZ = WALL.GATE_ZONE, GH = WALL.GATE_HALF, GS = WALL.GATE_SPRING;
  for (const [s0, s1] of [[-GZ, -GZ / 2 - GH / 2], [-GZ / 2 - GH / 2, -GH], [GH, GZ / 2 + GH / 2], [GZ / 2 + GH / 2, GZ]]) boxArc(s0, s1, 0, H, R, outerR(H / 2), 'wall', 'wall', innerGateA);
  boxArc(-GH, GH, GS + GH, H, R, outerR(H / 2), 'wall', 'wall', innerGateA);
  boxArc(-GH, GH, 0, GS + GH, outerR(0) - 1.2, outerR(0), 'wall', 'wall', innerGateA);
  boxArc(-GZ, GZ, H, H + WALL.PARA_H, WALL.RO - 1.2, WALL.RO + 0.25, 'wall', 'wall', innerGateA);
  // pilasters (all static ones)
  for (let k = 0; k < WALL.NPIL; k++) {
    const a = AG + k * dA;
    if (inIG(a) || Math.abs(angDiff(a, innerGateA)) < igA + 3 / R) continue;
    const s = angDiff(a, AG) * R;
    if (Math.abs(s) < BZ + 3) continue;
    const top = inHero(a) ? RIM : H + 3.35;
    const fa = Math.atan2(Math.cos(a), -Math.sin(a));
    solids.addBox(Math.cos(a) * (R - 0.6), top / 2, Math.sin(a) * (R - 0.6), 2.3, top / 2, 1.15, fa, 'wall', 'wall');
    const ro = outerR(20) + 1.1;
    if (ro < 399) solids.addBox(Math.cos(a) * ro, top / 2, Math.sin(a) * ro, 2.6, top / 2, 1.1, fa, 'wall', 'wall');
  }

  // ---------------- dynamic hero section ----------------
  const hero = {
    breached: false,
    hole: makeHole(),
    topIn: new Float32Array(NCOL).fill(999), topOut: new Float32Array(NCOL).fill(999), // 999 = intact
    mesh: new THREE.Mesh(new THREE.BufferGeometry(), mat),
    solids: [],
    dirty: true,
  };
  hero.mesh.castShadow = hero.mesh.receiveShadow = true; hero.mesh.name = 'wall-hero';
  hero.mesh.frustumCulled = true;
  group.add(hero.mesh);

  function rebuild() {
    const gb = new GB(60000);
    // rim columns
    for (let c = 0; c < NCOL; c++) {
      const s0 = -HERO + c * CW, s1 = s0 + CW;
      const a0 = AG + s0 / R, a1 = AG + s1 / R;
      if (hero.topIn[c] > 900) {
        lathe(gb, segsHigh, a0, a1, CW / R + 1e-6);
        lathe(gb, rails, a0, a1, CW / R + 1e-6);
        railPost(gb, (a0 + a1) / 2, c % 5 === 2);
        if (c % 16 === 7 && Math.abs((s0 + s1) / 2) > 26) cannon(gb, (a0 + a1) / 2);
      } else brokenColumn(gb, c, s0, s1);
    }
    // pilasters in the hero arc (upper part follows the rim state)
    for (let k = -8; k <= 8; k++) {
      const a = AG + k * dA, s = k * dA * R;
      if (Math.abs(s) > HERO - 2 || Math.abs(s) < BZ + 3) continue;
      const c = Math.floor((s + HERO) / CW);
      const t = Math.min(hero.topIn[c], hero.topIn[Math.max(0, c - 1)], hero.topIn[Math.min(NCOL - 1, c + 1)]);
      if (t > 900) { innerPilaster(gb, a, RIM, H, true); outerPilaster(gb, a, RIM, H, true); }
      else { innerPilaster(gb, a, RIM, t - 0.6, false, true); outerPilaster(gb, a, RIM, Math.min(t, hero.topOut[c]) - 0.6, false); }
    }
    // breach zone lower band
    if (!hero.breached) gateIntact(gb, segsLow, AG, BZ, RIM, true);
    else breachedLower(gb, segsLow, hero.hole);
    const g = gb.build();
    hero.mesh.geometry.dispose();
    hero.mesh.geometry = g;
    // colliders
    for (const i of hero.solids) solids.remove(i);
    hero.solids.length = 0;
    const add = (i) => hero.solids.push(i);
    // rim: runs of equal state up to 4 columns
    let c = 0;
    while (c < NCOL) {
      const intact = hero.topIn[c] > 900;
      let e = c + 1;
      if (intact) while (e < NCOL && e - c < 4 && hero.topIn[e] > 900) e++;
      const s0 = -HERO + c * CW, s1 = -HERO + e * CW;
      if (intact) {
        add(boxArc(s0, s1, RIM, H, R, outerR(H - 3)));
        add(boxArc(s0, s1, H, H + WALL.PARA_H, WALL.RO - 1.2, WALL.RO + 0.25));
      } else {
        const t = Math.min(hero.topIn[c], hero.topOut[c]);
        if (t > RIM + 0.2) add(boxArc(s0, s1, RIM, t, R, outerR(t - 2)));
      }
      c = e;
    }
    // lower breach zone
    if (!hero.breached) {
      for (const [s0, s1] of [[-BZ, -BZ + 12.9], [-BZ + 12.9, -BZ + 25.8], [-BZ + 25.8, -GH - 5], [-GH - 5, -GH], [GH, GH + 5], [GH + 5, BZ - 25.8], [BZ - 25.8, BZ - 12.9], [BZ - 12.9, BZ]]) add(boxArc(s0, s1, 0, RIM, R, outerR(RIM / 2)));
      add(boxArc(-GH, GH, GS + GH, RIM, R, outerR(RIM / 2)));
      add(boxArc(-GH, -GH + 2.5, GS, GS + GH, R, outerR(GS))); add(boxArc(GH - 2.5, GH, GS, GS + GH, R, outerR(GS)));
      add(boxArc(-GH, GH, 0, GS + GH, outerR(0) - 1.2, outerR(0))); // gate leaves
      add(boxArc(-22, 22, 0, H + 4.5, outerR(0) - 1.5, outerR(0) + 4.0, 'wall', 'gate'));   // outer pylon (approx)
    } else {
      const rows = hero.hole.rows;
      const nR = Math.round(RIM / WALL.CH);
      let r = 0;
      while (r < nR) {
        const row = rows[r];
        let e = r + 1;
        const same = (q) => { const a = rows[q], b = row; if (!a && !b) return true; if (!a || !b) return false; return Math.abs(a.iL - b.iL) < 0.5 && Math.abs(a.iR - b.iR) < 0.5 && Math.abs(a.oL - b.oL) < 0.5 && Math.abs(a.oR - b.oR) < 0.5; };
        while (e < nR && same(e)) e++;
        const y0 = r * WALL.CH, y1 = e * WALL.CH;
        const spans = row ? [[-BZ, (row.iL + row.oL) / 2], [(row.iR + row.oR) / 2, BZ]] : [[-BZ, BZ]];
        for (const [sa, sb] of spans) {
          for (let s = sa; s < sb - 0.05; s += 12) add(boxArc(s, Math.min(sb, s + 12), y0, y1, R, outerR((y0 + y1) / 2)));
        }
        r = e;
      }
    }
    hero.dirty = false;
  }

  function brokenColumn(gb, c, s0, s1) {
    const tI = (k) => (k < 0 || k >= NCOL || hero.topIn[k] > 900 ? null : hero.topIn[k]);
    const tO = (k) => (k < 0 || k >= NCOL || hero.topOut[k] > 900 ? null : hero.topOut[k]);
    const j = (k, s) => (hash2i(k, s, 17) - 0.5);
    // edge heights (shared with broken neighbours), mid heights jagged
    const eI0 = tI(c - 1) !== null ? Math.min(tI(c - 1), tI(c)) + j(c, 1) * 0.8 : tI(c) + j(c, 2) * 0.6;
    const eI1 = tI(c + 1) !== null ? Math.min(tI(c + 1), tI(c)) + j(c + 1, 1) * 0.8 : tI(c) + j(c, 3) * 0.6;
    const eO0 = tO(c - 1) !== null ? Math.min(tO(c - 1), tO(c)) + j(c, 4) * 0.8 : tO(c) + j(c, 5) * 0.6;
    const eO1 = tO(c + 1) !== null ? Math.min(tO(c + 1), tO(c)) + j(c + 1, 4) * 0.8 : tO(c) + j(c, 6) * 0.6;
    const mI = tI(c) + j(c, 7) * 1.4, mO = tO(c) + j(c, 8) * 1.4;
    const sm = (s0 + s1) / 2 + j(c, 9) * 0.8;
    const { R: RR } = WALL;
    const P = (s, r, y) => { const a = AG + s / RR; return [Math.cos(a) * r, y, Math.sin(a) * r]; };
    const face = (sa, sb, ya, yb, inner) => {
      // vertical face from RIM to the jagged top (two points)
      const r0 = inner ? RR : outerR(RIM), rA = inner ? RR : outerR(ya), rB = inner ? RR : outerR(yb);
      const a0 = AG + sa / RR, a1 = AG + sb / RR;
      const sgn = inner ? 1 : -1;
      const n0 = inner ? -1 : 1;
      const u0 = sgn * a0 * RR, u1 = sgn * a1 * RR;
      const pts = inner ? [[a0, r0, RIM, u0], [a1, r0, RIM, u1], [a1, rB, yb, u1], [a0, rA, ya, u0]] : [[a1, outerR(RIM), RIM, u1], [a0, outerR(RIM), RIM, u0], [a0, rA, ya, u0], [a1, rB, yb, u1]];
      gb.set({ mat: WMAT.ASHLAR, col: STONE, p0: 0, p1: 0.6 });
      const base = gb.v;
      for (const [a, r, y, u] of pts) gb.vtx(Math.cos(a) * r, y, Math.sin(a) * r, n0 * Math.cos(a), 0, n0 * Math.sin(a), u, y);
      gb.tri(base, base + 1, base + 2); gb.tri(base, base + 2, base + 3);
    };
    face(s0, sm, eI0, mI, true); face(sm, s1, mI, eI1, true);
    face(s0, sm, eO0, mO, false); face(sm, s1, mO, eO1, false);
    // rubble cap: 3x3 grid (s: s0, sm, s1) x (r: inner, mid, outer)
    const rM = RR + 7, mid = (a, b) => (a + b) / 2 + 0.6 + j(c, 10) * 1.2;
    const grid = [
      [P(s0, RR, eI0), P(sm, RR, mI), P(s1, RR, eI1)],
      [P(s0, rM, mid(eI0, eO0)), P(sm, rM, mid(mI, mO) + 0.4), P(s1, rM, mid(eI1, eO1))],
      [P(s0, outerR(eO0), eO0), P(sm, outerR(mO), mO), P(s1, outerR(eO1), eO1)],
    ];
    gb.set({ mat: WMAT.CORE, col: STONE, p1: 0.3 });
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const q = [grid[a][b], grid[a][b + 1], grid[a + 1][b + 1], grid[a + 1][b]];
      capQuad(gb, q);
    }
    // side faces against intact neighbours (or the static wall at the hero ends)
    const sideAt = (s, dir, yb) => {
      // face at arc s, facing dir (+1 towards +s), from yb up to the walkway / parapet
      const pts = [[RR - 1.4, yb], [WALL.RO + 0.25, yb], [WALL.RO + 0.25, WALL.H + WALL.PARA_H], [WALL.RO - 1.2, WALL.H + WALL.PARA_H], [WALL.RO - 1.2, WALL.H], [RR - 1.4, WALL.H]];
      const a = AG + s / RR;
      const tx = -Math.sin(a) * dir, tz = Math.cos(a) * dir;
      const W = pts.map(([r, y]) => [Math.cos(a) * r, y, Math.sin(a) * r]);
      gb.set({ mat: WMAT.CORE, col: STONE, p1: 0.4 });
      const poly = (ids) => {
        const base = gb.v;
        for (const k of ids) { const p = W[k]; gb.vtx(p[0], p[1], p[2], tx, 0, tz, Math.hypot(p[0], p[2]) - RR, p[1]); }
        // orientation: ensure CCW facing (tx,tz)
        const A = W[ids[0]], B = W[ids[1]], C = W[ids[2]];
        const nx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
        const flip = nx * tx + nz * tz < 0;
        for (let q = 1; q + 1 < ids.length; q++) flip ? gb.tri(base, base + q + 1, base + q) : gb.tri(base, base + q, base + q + 1);
      };
      poly([0, 1, 4, 5]); poly([4, 1, 2, 3]);
    };
    if (tI(c - 1) === null) sideAt(s0, 1, Math.min(eI0, eO0));
    if (tI(c + 1) === null) sideAt(s1, -1, Math.min(eI1, eO1));
  }

  // bite the rim: point on/near the wall top
  function bite(p, radius, force) {
    const r = Math.hypot(p.x, p.z);
    const a = Math.atan2(p.z, p.x);
    const s = angDiff(a, AG) * R;
    if (Math.abs(s) > HERO + radius || r < R - radius - 2 || r > WALL.RO + radius + 3) return 0;
    if (p.y < RIM - radius) return 0;
    let removed = 0;
    const rng = new Rng((Math.floor(p.x * 7) * 131 + Math.floor(p.z * 13)) >>> 0);
    for (let c = 0; c < NCOL; c++) {
      const sc = -HERO + (c + 0.5) * CW;
      const ds = Math.abs(sc - s);
      if (ds > radius) continue;
      const depth = Math.sqrt(radius * radius - ds * ds) * (0.55 + 0.45 * Math.min(1.5, force)) * rng.range(0.75, 1.2);
      const yb = Math.max(RIM + 1.3, Math.min(WALL.H - 0.3, p.y + 1.5) - depth);
      const inner = r < (R + WALL.RO) / 2;
      const tIn = Math.max(RIM + 1.3, yb + (inner ? 0 : rng.range(0.5, 3))), tOut = Math.max(RIM + 1.3, yb + (inner ? rng.range(0.5, 3) : 0));
      const oldI = hero.topIn[c] > 900 ? WALL.H : hero.topIn[c], oldO = hero.topOut[c] > 900 ? WALL.H : hero.topOut[c];
      if (tIn < oldI - 0.2 || tOut < oldO - 0.2) {
        removed += (oldI - Math.min(oldI, tIn)) + (oldO - Math.min(oldO, tOut));
        hero.topIn[c] = Math.min(oldI, tIn); hero.topOut[c] = Math.min(oldO, tOut);
      }
    }
    if (removed > 0) hero.dirty = true;
    return removed;
  }

  // widen / punch the breach (only once breached)
  function widen(p, radius, force) {
    if (!hero.breached) return 0;
    const a = Math.atan2(p.z, p.x), s = angDiff(a, AG) * R;
    if (Math.abs(s) > BZ + radius || p.y > RIM + radius) return 0;
    const rows = hero.hole.rows;
    let changed = 0;
    const rng = new Rng((Math.floor(p.x * 11) * 71 + Math.floor(p.y * 17)) >>> 0);
    const lim = BZ - 3;
    for (let r = 0; r < Math.round(RIM / WALL.CH) - 1; r++) {
      const yc = (r + 0.5) * WALL.CH;
      const dy = Math.abs(yc - p.y);
      if (dy > radius) continue;
      const reach = Math.sqrt(radius * radius - dy * dy) * (0.6 + 0.4 * Math.min(1.5, force)) * rng.range(0.8, 1.2);
      let row = rows[r];
      if (!row) {
        // punch a new hole in an intact course (grows the breach upwards / opens new holes)
        if (reach < 2.5) continue;
        row = rows[r] = { r, y0: r * WALL.CH, y1: (r + 1) * WALL.CH, iL: s - reach, iR: s + reach, oL: s - reach * 0.7, oR: s + reach * 0.7 };
        changed++;
      } else {
        const nl = Math.max(-lim, Math.min(row.iL, s - reach)), nr = Math.min(lim, Math.max(row.iR, s + reach));
        if (nl < row.iL - 0.3 || nr > row.iR + 0.3) {
          row.iL = nl; row.iR = nr;
          row.oL = Math.max(-lim, Math.min(row.oL, nl + rng.range(0.5, 2))); row.oR = Math.min(lim, Math.max(row.oR, nr - rng.range(0.5, 2)));
          changed++;
        }
      }
      row.iL = Math.max(-lim, row.iL); row.iR = Math.min(lim, row.iR); row.oL = Math.max(-lim, Math.min(row.oL, row.oR - 1)); row.oR = Math.min(lim, Math.max(row.oR, row.oL + 1));
    }
    if (changed) hero.dirty = true;
    return changed;
  }

  rebuild();
  return {
    group, hero, rebuild, bite, widen,
    setBreached(v) { hero.breached = v; hero.dirty = true; },
    wallTopAt(a) {
      const s = angDiff(a, AG) * R;
      if (Math.abs(s) < HERO) { const c = Math.min(NCOL - 1, Math.max(0, Math.floor((s + HERO) / CW))); return hero.topIn[c] > 900 ? H : Math.min(hero.topIn[c], hero.topOut[c]); }
      return H;
    },
    isAnalytic(a) { return !(Math.abs(angDiff(a, AG)) < heroA || Math.abs(angDiff(a, innerGateA)) < igA); },
  };
}

function capQuad(gb, q) {
  // quad roughly facing up; compute normal, ensure up
  const [A, B, C, D] = q;
  const e1 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]], e2 = [D[0] - B[0], D[1] - B[1], D[2] - B[2]];
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(...n) || 1; n = n.map((v) => v / l);
  let pts = q;
  if (n[1] < 0) { n = n.map((v) => -v); pts = [A, D, C, B]; }
  const base = gb.v;
  for (const p of pts) gb.vtx(p[0], p[1], p[2], n[0], n[1], n[2], Math.hypot(p[0], p[2]) - WALL.R, p[0] * 0.7 + p[2] * 0.7);
  gb.tri(base, base + 1, base + 2); gb.tri(base, base + 2, base + 3);
}

// ------------------------------------------------------------------------------------------------ gates & breach
// hole in (s = arc offset from the gate centre on the inner face [m], row) space
export function makeHole() {
  const rng = new Rng(4242);
  const { R, CH, BL, AG } = WALL;
  const rows = [];
  const u0 = AG * R; // inner face shader u = a * R (increasing with angle) -> u = u0 + s
  const jointsNear = (row, uTarget) => {
    const off = hash12(row, 0);
    const k = Math.floor(uTarget / BL + off);
    let best = uTarget, bd = 1e9;
    for (let kk = k - 2; kk <= k + 2; kk++) {
      const j = (kk + (hash12(kk, row) - 0.5) * 0.5 - off) * BL;
      if (Math.abs(j - uTarget) < bd) { bd = Math.abs(j - uTarget); best = j; }
    }
    return best;
  };
  const topY = 35.2;
  const nRows = Math.round(WALL.RIM / CH);
  let skewL = 0, skewR = 0;
  for (let r = 0; r < nRows; r++) {
    const y = (r + 0.5) * CH;
    const t = Math.min(1, y / topY);
    const hw = y > topY ? 0 : 20.5 * Math.pow(Math.max(0, 1 - t * t), 0.33);
    skewL = (skewL + rng.range(-0.8, 0.8)) * 0.7; skewR = (skewR + rng.range(-0.8, 0.8)) * 0.7;
    if (hw <= 0.8) { rows.push(null); continue; }
    const sL = -(hw + skewL + rng.range(-1.3, 1.3)), sR = hw + skewR + rng.range(-1.3, 1.3);
    const siL = jointsNear(r, u0 + sL) - u0, siR = jointsNear(r, u0 + sR) - u0;
    const iL = Math.min(siL, siR - 2), iR = Math.max(siR, siL + 2);
    rows.push({ r, y0: r * CH, y1: (r + 1) * CH, iL, iR, oL: Math.min(iL + rng.range(0.6, 2.4), -1), oR: Math.max(iR - rng.range(0.6, 2.4), 1) });
  }
  return { rows };
}

// intact gate zone (lower band up to yCut) at angle ag with half arc zone
function gateIntact(gb, segs, ag, zone, yCut, hero) {
  const { R, GATE_HALF: GH, GATE_SPRING: GS } = WALL;
  const archTop = (s) => (Math.abs(s) >= GH ? -1 : GS + Math.sqrt(GH * GH - s * s));
  const cols = [];
  for (let s = -zone; s <= zone + 1e-6; s += 1.3) cols.push(s);
  for (const e of [-GH, GH, zone]) if (!cols.some((c) => Math.abs(c - e) < 1e-3)) cols.push(e);
  cols.sort((a, b) => a - b);
  const sgs = clipSegs(segs, -1, yCut);
  for (const [r0, y0, r1, y1, mat, pp] of sgs) {
    const dr = r1 - r0, dy = y1 - y0, L = Math.hypot(dr, dy); if (L < 1e-4) continue;
    const nr = -dy / L, ny = dr / L, horiz = Math.abs(ny) > 0.7;
    for (let ci = 0; ci + 1 < cols.length; ci++) {
      const sa = cols[ci], sb = cols[ci + 1], sm = (sa + sb) / 2;
      const top = archTop(sm);
      let ya = y0, yb = y1;
      if (top > 0 && Math.max(y0, y1) <= top + 0.01) continue;
      if (top > 0 && Math.min(y0, y1) < top) { if (horiz) continue; if (y0 < y1) ya = top; else yb = top; }
      const lr = (y) => (Math.abs(dy) > 1e-4 ? r0 + dr * ((y - y0) / dy) : r0);
      const seg = [[lr(ya), ya, lr(yb), yb, mat, pp]];
      if (horiz) seg[0] = [r0, y0, r1, y1, mat, pp];
      lathe(gb, seg, ag + sa / R, ag + sb / R, 1);
    }
  }
  tunnel(gb, ag, GH, GS);
  gateFrame(gb, ag, true, yCut, hero); // both sides
  gateDoors(gb, ag, GH, GS);
}

function breachedLower(gb, segs, hole) {
  const { R, AG, BZ, RIM, CH } = WALL;
  const rows = hole.rows;
  const nR = Math.round(RIM / CH);
  const sToA = (s) => AG + s / R;
  for (const [r0, y0, r1, y1, mat, pp] of segs) {
    const dr = r1 - r0, dy = y1 - y0, L = Math.hypot(dr, dy); if (L < 1e-4) continue;
    const horiz = Math.abs(dr / L) > 0.7;
    const yLo = Math.min(y0, y1), yHi = Math.max(y0, y1);
    const ra = Math.floor(yLo / CH), rb = Math.min(nR, Math.ceil(yHi / CH - 1e-6));
    const outerSide = (r0 + r1) / 2 > R + 7;
    const lr = (y) => (Math.abs(dy) > 1e-4 ? r0 + dr * ((y - y0) / dy) : r0);
    for (let r = ra; r < Math.max(rb, ra + 1); r++) {
      const ya = Math.max(yLo, r * CH), yb = Math.min(yHi, (r + 1) * CH);
      if (!horiz && yb - ya < 1e-3) continue;
      const row = rows[r];
      const spans = row ? [[-BZ, outerSide ? row.oL : row.iL], [outerSide ? row.oR : row.iR, BZ]] : [[-BZ, BZ]];
      for (const [sa, sb] of spans) {
        if (sb - sa < 0.05) continue;
        const n = Math.max(1, Math.ceil((sb - sa) / 2.6));
        const Y0 = y0 < y1 ? ya : yb, Y1 = y0 < y1 ? yb : ya;
        const seg = horiz ? [[r0, y0, r1, y1, mat, pp]] : [[lr(Y0), Y0, lr(Y1), Y1, mat, pp]];
        for (let k = 0; k < n; k++) {
          const s0 = sa + ((sb - sa) * k) / n, s1 = sa + ((sb - sa) * (k + 1)) / n;
          lathe(gb, seg, sToA(s0), sToA(s1), 1, row ? 0.55 * Math.max(0, 1 - Math.min(Math.abs(s1 - row.iL), Math.abs(s0 - row.iR)) / 9) : 0.1);
        }
      }
    }
  }
  // break surfaces
  gb.set({ mat: WMAT.CORE, p0: 0, p1: 0.35, col: STONE });
  const P = (s, r, y) => { const a = sToA(s); return [Math.cos(a) * r, y, Math.sin(a) * r]; };
  for (let r = 0; r < nR; r++) {
    const row = rows[r];
    const up = r + 1 < nR ? rows[r + 1] : null;
    const yT = (r + 1) * CH;
    const ri = R, ro = outerR(yT - CH / 2), roT = outerR(yT);
    if (row) {
      const y0 = row.y0, y1 = row.y1;
      quad4(gb, P(row.iL, ri, y0), P(row.oL, ro, y0), P(row.oL, ro, y1), P(row.iL, ri, y1));
      quad4(gb, P(row.oR, ro, y0), P(row.iR, ri, y0), P(row.iR, ri, y1), P(row.oR, ro, y1));
      if (!up) ledge(gb, P(row.iL, ri, yT), P(row.iR, ri, yT), P(row.oR, roT, yT), P(row.oL, roT, yT), true);
      else {
        if (row.iL > up.iL + 0.01) ledge(gb, P(up.iL, ri, yT), P(row.iL, ri, yT), P(row.oL, roT, yT), P(up.oL, roT, yT), false);
        else if (row.iL < up.iL - 0.01) ledge(gb, P(row.iL, ri, yT), P(up.iL, ri, yT), P(up.oL, roT, yT), P(row.oL, roT, yT), true);
        if (row.iR < up.iR - 0.01) ledge(gb, P(row.iR, ri, yT), P(up.iR, ri, yT), P(up.oR, roT, yT), P(row.oR, roT, yT), false);
        else if (row.iR > up.iR + 0.01) ledge(gb, P(up.iR, ri, yT), P(row.iR, ri, yT), P(row.oR, roT, yT), P(up.oR, roT, yT), true);
      }
    } else if (up) {
      // intact course under a punched hole: its top is exposed
      ledge(gb, P(up.iL, ri, yT), P(up.iR, ri, yT), P(up.oR, roT, yT), P(up.oL, roT, yT), false);
    }
  }
  // ragged stubs of the outer gatehouse pylon beyond the hole
  const fa = Math.atan2(-Math.cos(AG), Math.sin(AG));
  gb.frame(Math.cos(AG) * (outerR(0) - 1.5), 0, Math.sin(AG) * (outerR(0) - 1.5), fa);
  gb.set({ mat: WMAT.ASHLAR, col: STONE, p0: 0, p1: 0.5 });
  const rl = rows[2], lx = rl ? -rl.oL : 21, rx = rl ? rl.oR : 21;
  // local x = tangent pointing to decreasing angle for an outward frame -> s = -x
  gb.box(Math.min(lx + 0.5, 22), 0, 0, 22, 11, 4.4, 1 | 2 | 4 | 16);
  gb.box(-22, 0, 0, -Math.min(rx + 0.5, 22), 15, 4.4, 1 | 2 | 4 | 16);
  gb.frame();
}

function quad4(gb, p0, p1, p2, p3) {
  const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(...n) || 1; n = n.map((v) => v / l);
  const d = (p) => Math.hypot(p[0], p[2]) - WALL.R;
  const i = gb.v;
  for (const p of [p0, p1, p2, p3]) gb.vtx(p[0], p[1], p[2], n[0], n[1], n[2], d(p), p[1]);
  gb.tri(i, i + 1, i + 2); gb.tri(i, i + 2, i + 3);
}
function ledge(gb, p0, p1, p2, p3, down) {
  const pts = down ? [p0, p3, p2, p1] : [p0, p1, p2, p3];
  const ny = down ? -1 : 1;
  const d = (p) => Math.hypot(p[0], p[2]) - WALL.R;
  const i = gb.v;
  for (const p of pts) gb.vtx(p[0], p[1], p[2], 0, ny, 0, d(p), p[0] * 0.7 + p[2] * 0.7);
  const a = pts[0], b = pts[1], c = pts[2];
  const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  if ((cy > 0) === (ny > 0)) { gb.tri(i, i + 1, i + 2); gb.tri(i, i + 2, i + 3); } else { gb.tri(i, i + 2, i + 1); gb.tri(i, i + 3, i + 2); }
}

function tunnel(gb, ag, GH, GS) {
  const { R } = WALL;
  gb.frame(0, 0, 0, Math.atan2(Math.cos(ag), -Math.sin(ag)));
  const zi = -(R - 2.6), zo = -(outerR(0) + 3.2);
  gb.set({ mat: WMAT.ASHLAR, col: STONE_DK, p0: 0, p1: 0.25 });
  gb.wall(-GH, zo, -GH, zi, 0, GS);
  gb.wall(GH, zi, GH, zo, 0, GS);
  gb.set({ mat: WMAT.TRIM, col: STONE_DK, p0: 0.6, p1: 0.3 });
  const n = 12;
  for (let k = 0; k < n; k++) {
    const a0 = Math.PI * (k / n), a1 = Math.PI * ((k + 1) / n);
    const p = (a, z) => [Math.cos(a) * GH, GS + Math.sin(a) * GH, z];
    gb.poly([p(a0, zi), p(a0, zo), p(a1, zo), p(a1, zi)]);
  }
  gb.frame();
}

function gateFrame(gb, ag, outerGate, yCut, hero, outerSide) {
  if (outerSide === undefined) { gateFrame(gb, ag, outerGate, yCut, hero, true); gateFrame(gb, ag, outerGate, yCut, hero, false); return; }
  const { R, H, GATE_HALF: GH, GATE_SPRING: GS } = WALL;
  if (outerSide) frameOut(gb, ag, outerR(0) - 1.5); else frameIn(gb, ag, R + 1.0);
  const W = outerSide ? 22 : 19, D = outerSide ? 5.5 : 3.2, TOP = outerSide ? H + 4.5 : H - 2;
  gb.set({ mat: WMAT.ASHLAR, col: STONE, p0: 0, p1: 0.1 });
  const cols = [];
  for (let x = -W; x <= W + 1e-6; x += 1) cols.push(x);
  for (const e of [-GH - 1.6, -GH, GH, GH + 1.6]) if (!cols.includes(e)) cols.push(e);
  cols.sort((a, b) => a - b);
  const archTop = (x, r) => (Math.abs(x) >= r ? -1 : GS + Math.sqrt(r * r - x * x));
  for (let i = 0; i + 1 < cols.length; i++) {
    const xa = cols[i], xb = cols[i + 1], xm = (xa + xb) / 2;
    const t = archTop(xm, GH), vous = archTop(xm, GH + 1.6);
    if (t > 0) {
      const ta = archTop(xa, GH), tb = archTop(xb, GH), va = archTop(xa, GH + 1.6), vb = archTop(xb, GH + 1.6);
      gb.set({ mat: WMAT.TRIM, col: TRIM, p0: 0.8 });
      gb.poly([[xa, Math.max(ta, GS), D], [xb, Math.max(tb, GS), D], [xb, vb, D], [xa, va, D]]);
      gb.set({ mat: WMAT.ASHLAR, col: STONE });
      gb.poly([[xa, va, D], [xb, vb, D], [xb, TOP, D], [xa, TOP, D]]);
      gb.set({ mat: WMAT.TRIM, col: STONE_DK, p0: 0.8 });
      gb.poly([[xb, Math.max(tb, GS), D], [xa, Math.max(ta, GS), D], [xa, Math.max(ta, GS), -1], [xb, Math.max(tb, GS), -1]]);
    } else if (vous > 0) {
      const va = Math.max(archTop(xa, GH + 1.6), 0), vb = Math.max(archTop(xb, GH + 1.6), 0);
      gb.set({ mat: WMAT.TRIM, col: TRIM, p0: 0.8 });
      gb.poly([[xa, 0, D], [xb, 0, D], [xb, Math.max(vb, GS), D], [xa, Math.max(va, GS), D]]);
      gb.set({ mat: WMAT.ASHLAR, col: STONE });
      gb.poly([[xa, Math.max(va, GS), D], [xb, Math.max(vb, GS), D], [xb, TOP, D], [xa, TOP, D]]);
    } else {
      gb.set({ mat: WMAT.ASHLAR, col: STONE });
      gb.poly([[xa, 0, D], [xb, 0, D], [xb, TOP, D], [xa, TOP, D]]);
    }
  }
  gb.set({ mat: WMAT.ASHLAR, col: STONE_DK, p1: 0.2 });
  gb.wall(-GH, -1, -GH, D, 0, GS);
  gb.wall(GH, D, GH, -1, 0, GS);
  gb.set({ mat: WMAT.ASHLAR, col: STONE, p1: 0 });
  gb.wall(W, D, W, -2, 0, TOP); gb.wall(-W, -2, -W, D, 0, TOP);
  gb.set({ mat: WMAT.TRIM, col: TRIM, p0: 0.6 });
  gb.box(-W - 0.5, TOP - 1.2, -2, W + 0.5, TOP, D + 0.6, 1 | 2 | 4 | 8 | 16);
  if (outerSide) {
    // back face of the part that rises above the walkway (seen from the town / wall top)
    gb.set({ mat: WMAT.ASHLAR, col: STONE, p0: 0, p1: 0 });
    gb.wall(W, -2, -W, -2, H - 3, TOP - 1.2);
    gb.set({ mat: WMAT.TRIM, col: TRIM, p0: 0.6 });
    gb.box(-W - 0.5, TOP - 1.2, -2.6, W + 0.5, TOP, -2, 4 | 8 | 32 | 1 | 2);
    for (let x = -W; x < W; x += 3.2) gb.box(x + 0.4, TOP, -1, x + 2.0, TOP + 1.8, D + 0.4, 1 | 2 | 4 | 16 | 32);
    gb.box(-W - 0.8, 0, D, W + 0.8, 4.2, D + 1.2, 1 | 2 | 4 | 16);
    gb.set({ mat: WMAT.TRIM, col: lin(0xcfc4ab), p0: 1.2 });
    gb.box(-1.4, GS + GH - 0.5, D, 1.4, GS + GH + 2.6, D + 0.6, 1 | 2 | 4 | 8 | 16);
    gb.set({ mat: WMAT.TRIM, col: TRIM, p0: 0.7 });
    for (const x of [-W + 1.5, -GH - 4, GH + 4, W - 1.5]) gb.box(x - 1.2, 4.2, D, x + 1.2, TOP - 1.2, D + 0.7, 1 | 2 | 16);
  } else {
    gb.box(-W - 0.5, 0, D, W + 0.5, 2.6, D + 0.8, 1 | 2 | 4 | 16);
    gb.set({ mat: WMAT.WOOD, col: lin(0x4a3524) });
    for (const x of [-W + 3, W - 3]) gb.box(x - 0.35, TOP, D - 0.5, x + 0.35, TOP + 0.7, D + 4.5, 63);
  }
  gb.frame();
  void yCut; void hero;
}

function gateDoors(gb, ag, GH, GS) {
  gb.frame(0, 0, 0, Math.atan2(Math.cos(ag), -Math.sin(ag)));
  const z = -(outerR(0) - 0.4);
  gb.set({ mat: WMAT.WOOD, col: lin(0x5a4230), p0: 0, p1: 0 });
  const top = (x) => GS + Math.sqrt(Math.max(0, GH * GH - x * x));
  const n = 16;
  for (let i = 0; i < n; i++) {
    const xa = -GH + (2 * GH * i) / n, xb = -GH + (2 * GH * (i + 1)) / n;
    gb.poly([[xa, 0, z + 0.6], [xb, 0, z + 0.6], [xb, top(xb), z + 0.6], [xa, top(xa), z + 0.6]]);
    gb.poly([[xb, 0, z - 0.6], [xa, 0, z - 0.6], [xa, top(xa), z - 0.6], [xb, top(xb), z - 0.6]]);
  }
  for (const y of [3, 8, 13]) gb.box(-GH, y, z + 0.6, GH, y + 0.8, z + 1.1, 4 | 8 | 16);
  gb.frame();
}
