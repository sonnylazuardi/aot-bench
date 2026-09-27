// WORLD utilities: seeded RNG, hashes, value noise (JS side, mirrors the GLSL helpers where needed).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1) { this.f = mulberry32(seed); }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return Math.floor(a + (b - a + 1) * this.f()); }
  pick(arr) { return arr[Math.floor(this.f() * arr.length) % arr.length]; }
  chance(p) { return this.f() < p; }
  // weighted pick: [[w, value], ...]
  wpick(list) {
    let s = 0; for (const [w] of list) s += w;
    let r = this.f() * s;
    for (const [w, v] of list) { if ((r -= w) <= 0) return v; }
    return list[list.length - 1][1];
  }
  gauss() { return (this.f() + this.f() + this.f() - 1.5) / 1.5; }
}

// integer hash -> [0,1)
export function hash2i(x, y, s = 0) {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((y | 0) + 0x61c88647, 0x27d4eb2f) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Float hash identical to the GLSL `hash12` (Dave Hoskins, "hash without sine"), used where JS must agree with shaders
// (the great wall's block joints: the breach hole follows the mortar joints drawn by the wall shader).
const fract = (x) => x - Math.floor(x);
export function hash12(x, y) {
  // p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z);
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = fract(x * 0.1031);
  // emulate float32 precision a bit (GLSL mediump/highp float); highp in practice -> use Math.fround
  a = Math.fround(a); b = Math.fround(b); c = Math.fround(c);
  const d = Math.fround(a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33));
  a = Math.fround(a + d); b = Math.fround(b + d); c = Math.fround(c + d);
  return fract(Math.fround(Math.fround(a + b) * c));
}

// 2D value noise + fbm (JS)
function vhash(ix, iy, seed) { return hash2i(ix, iy, seed); }
export function vnoise(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = vhash(ix, iy, seed), b = vhash(ix + 1, iy, seed), c = vhash(ix, iy + 1, seed), d = vhash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export function fbm(x, y, oct = 4, seed = 0, lac = 2.0, gain = 0.5) {
  let s = 0, a = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x, y, seed + i * 17); n += a; a *= gain; x *= lac; y *= lac; }
  return s / n;
}
// ridged fbm in [0,1]
export function ridged(x, y, oct = 5, seed = 0) {
  let s = 0, a = 1, n = 0;
  for (let i = 0; i < oct; i++) { const v = 1 - Math.abs(vnoise(x, y, seed + i * 31) * 2 - 1); s += a * v * v; n += a; a *= 0.5; x *= 2.03; y *= 2.03; }
  return s / n;
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// sRGB hex -> linear [r,g,b]
export function lin(hex) {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}
export function mixc(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
export function scalec(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }

// distance from point to segment (2D) and param
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px, qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}
