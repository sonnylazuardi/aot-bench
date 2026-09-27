// WORLD geometry builder: growable typed arrays, local Y-rotation frame, planar UVs that match the shader TBN.
//
// Vertex layout shared by every procedural world material (see shaders.js):
//   position(3) normal(3) color(3: linear tint) aUV(4: u, v [metres, planar in the surface's T/B frame], p0, p1)
//   aMat(4: material id, object id (house id for the collapse state texture), p2, p3)
// Planar frame (identical in GLSL):  T = |N.y| > 0.999 ? (1,0,0) : normalize(cross(up, N));  B = cross(N, T)
import * as THREE from 'three';

class Buf {
  constructor(T, n) { this.T = T; this.a = new T(n); this.n = 0; }
  grow(k) { if (this.n + k > this.a.length) { const b = new this.T(Math.max(this.a.length * 2, this.n + k)); b.set(this.a.subarray(0, this.n)); this.a = b; } }
  take() { return this.n > this.a.length * 0.7 ? this.a.subarray(0, this.n) : this.a.slice(0, this.n); }
}

const _t = [0, 0, 0], _b = [0, 0, 0];
const _W = new Float64Array(256 * 3);
function frameTB(nx, ny, nz) {
  if (Math.abs(ny) > 0.999) { _t[0] = 1; _t[1] = 0; _t[2] = 0; }
  else { // cross(up, N) = (nz, 0, -nx)
    const l = Math.hypot(nz, nx); _t[0] = nz / l; _t[1] = 0; _t[2] = -nx / l;
  }
  // B = cross(N, T)
  _b[0] = ny * _t[2] - nz * _t[1]; _b[1] = nz * _t[0] - nx * _t[2]; _b[2] = nx * _t[1] - ny * _t[0];
}

export class GB {
  constructor(cap = 2048) {
    this.P = new Buf(Float32Array, cap * 3); this.N = new Buf(Float32Array, cap * 3); this.C = new Buf(Float32Array, cap * 3);
    this.U = new Buf(Float32Array, cap * 4); this.M = new Buf(Float32Array, cap * 4); this.I = new Buf(Uint32Array, cap * 6);
    this.v = 0;
    this.col = [1, 1, 1]; this.p0 = 0; this.p1 = 0; this.mat = 0; this.id = 0; this.p2 = 0; this.p3 = 0;
    this.cx = 0; this.cy = 0; this.cz = 0; this.ca = 1; this.sa = 0; // frame
    this.uOff = 0; this.vOff = 0;
  }
  // attributes applied to following vertices
  set(o) { for (const k in o) this[k] = o[k]; return this; }
  frame(cx = 0, cy = 0, cz = 0, a = 0) { this.cx = cx; this.cy = cy; this.cz = cz; this.ca = Math.cos(a); this.sa = Math.sin(a); return this; }
  // local -> world (ex = (ca, sa), ez = (-sa, ca))
  wx(x, z) { return this.cx + x * this.ca - z * this.sa; }
  wz(x, z) { return this.cz + x * this.sa + z * this.ca; }
  vtx(x, y, z, nx, ny, nz, u, v) { // world coords
    this.P.grow(3); this.N.grow(3); this.C.grow(3); this.U.grow(4); this.M.grow(4);
    let i = this.P.n; const P = this.P.a; P[i] = x; P[i + 1] = y; P[i + 2] = z; this.P.n += 3;
    const N = this.N.a; N[i] = nx; N[i + 1] = ny; N[i + 2] = nz; this.N.n += 3;
    const C = this.C.a; C[i] = this.col[0]; C[i + 1] = this.col[1]; C[i + 2] = this.col[2]; this.C.n += 3;
    i = this.U.n; const U = this.U.a; U[i] = u; U[i + 1] = v; U[i + 2] = this.p0; U[i + 3] = this.p1; this.U.n += 4;
    const M = this.M.a; M[i] = this.mat; M[i + 1] = this.id; M[i + 2] = this.p2; M[i + 3] = this.p3; this.M.n += 4;
    return this.v++;
  }
  tri(a, b, c) { this.I.grow(3); const I = this.I.a, n = this.I.n; I[n] = a; I[n + 1] = b; I[n + 2] = c; this.I.n += 3; }
  // Convex planar polygon given in LOCAL coords (array of [x,y,z]), CCW seen from the front. The planar UV origin is
  // `o` (local [x,y,z], default first point); u/v offsets this.uOff/this.vOff are added.
  poly(pts, o = null, nOverride = null) {
    const n = pts.length;
    const W = _W;
    const ca = this.ca, sa = this.sa, cx = this.cx, cy = this.cy, cz = this.cz;
    for (let i = 0; i < n; i++) {
      const p = pts[i], x = p[0], z = p[2];
      W[i * 3] = cx + x * ca - z * sa; W[i * 3 + 1] = p[1] + cy; W[i * 3 + 2] = cz + x * sa + z * ca;
    }
    let nx, ny, nz;
    if (nOverride) { nx = nOverride[0]; ny = nOverride[1]; nz = nOverride[2]; }
    else {
      nx = 0; ny = 0; nz = 0;
      for (let i = 0; i < n; i++) {
        const a = i * 3, b = ((i + 1) % n) * 3;
        nx += (W[a + 1] - W[b + 1]) * (W[a + 2] + W[b + 2]); ny += (W[a + 2] - W[b + 2]) * (W[a] + W[b]); nz += (W[a] - W[b]) * (W[a + 1] + W[b + 1]);
      }
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
    }
    frameTB(nx, ny, nz);
    let ox, oy, oz;
    if (o) { ox = cx + o[0] * ca - o[2] * sa; oy = o[1] + cy; oz = cz + o[0] * sa + o[2] * ca; } else { ox = W[0]; oy = W[1]; oz = W[2]; }
    const tx = _t[0], ty = _t[1], tz = _t[2], bx = _b[0], by = _b[1], bz = _b[2];
    // grow once, then write directly
    this.P.grow(n * 3); this.N.grow(n * 3); this.C.grow(n * 3); this.U.grow(n * 4); this.M.grow(n * 4); this.I.grow((n - 2) * 3);
    const P = this.P.a, N = this.N.a, C = this.C.a, U = this.U.a, M = this.M.a;
    const col = this.col, uOff = this.uOff, vOff = this.vOff;
    const base = this.v;
    for (let i = 0; i < n; i++) {
      const x = W[i * 3], y = W[i * 3 + 1], z = W[i * 3 + 2];
      const dx = x - ox, dy = y - oy, dz = z - oz;
      let k = this.P.n;
      P[k] = x; P[k + 1] = y; P[k + 2] = z; N[k] = nx; N[k + 1] = ny; N[k + 2] = nz; C[k] = col[0]; C[k + 1] = col[1]; C[k + 2] = col[2];
      this.P.n += 3; this.N.n += 3; this.C.n += 3;
      k = this.U.n;
      U[k] = dx * tx + dy * ty + dz * tz + uOff; U[k + 1] = dx * bx + dy * by + dz * bz + vOff; U[k + 2] = this.p0; U[k + 3] = this.p1;
      M[k] = this.mat; M[k + 1] = this.id; M[k + 2] = this.p2; M[k + 3] = this.p3;
      this.U.n += 4; this.M.n += 4;
      this.v++;
    }
    const I = this.I.a;
    let q = this.I.n;
    for (let i = 1; i + 1 < n; i++) { I[q++] = base; I[q++] = base + i; I[q++] = base + i + 1; }
    this.I.n = q;
    return base;
  }
  quad(a, b, c, d, o) { return this.poly([a, b, c, d], o); }
  // vertical rectangle from local A(x0,z0) to B(x1,z1) (A is on the left seen from outside), y0..y1. UV origin (A, y0)
  wall(x0, z0, x1, z1, y0, y1, o = null) {
    return this.poly([[x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]], o);
  }
  // axis-aligned (local frame) box; mask bits: 1 +x, 2 -x, 4 +y, 8 -y, 16 +z, 32 -z
  box(x0, y0, z0, x1, y1, z1, mask = 63, o = null) {
    if (mask & 16) this.wall(x0, z1, x1, z1, y0, y1, o);
    if (mask & 32) this.wall(x1, z0, x0, z0, y0, y1, o);
    if (mask & 1) this.wall(x1, z1, x1, z0, y0, y1, o);
    if (mask & 2) this.wall(x0, z0, x0, z1, y0, y1, o);
    if (mask & 4) this.poly([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], o);
    if (mask & 8) this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], o);
    return this;
  }
  // box rotated in its own frame (for tilted beams / rubble): centre c (local), half sizes h, rotation matrix m3 (array 9)
  obox(cx, cy, cz, hx, hy, hz, m) {
    const corners = [];
    for (let i = 0; i < 8; i++) {
      const x = (i & 1 ? hx : -hx), y = (i & 2 ? hy : -hy), z = (i & 4 ? hz : -hz);
      corners.push([cx + m[0] * x + m[1] * y + m[2] * z, cy + m[3] * x + m[4] * y + m[5] * z, cz + m[6] * x + m[7] * y + m[8] * z]);
    }
    const F = [[1, 3, 7, 5], [0, 4, 6, 2], [2, 6, 7, 3], [0, 1, 5, 4], [4, 5, 7, 6], [0, 2, 3, 1]];
    for (const f of F) this.poly(f.map((k) => corners[k]), null);
    return this;
  }
  // vertical cylinder / frustum (local), seg sides
  cyl(cx, cz, y0, y1, r0, r1, seg = 8, caps = true) {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const p = (a, r, y) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      this.poly([p(a1, r0, y0), p(a0, r0, y0), p(a0, r1, y1), p(a1, r1, y1)]);
    }
    if (caps && r1 > 0.001) {
      const pts = []; for (let k = seg - 1; k >= 0; k--) { const a = (k / seg) * Math.PI * 2; pts.push([cx + Math.cos(a) * r1, y1, cz + Math.sin(a) * r1]); }
      this.poly(pts); // decreasing angle = CCW seen from above
    }
    return this;
  }
  get count() { return this.v; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.take(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.take(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.take(), 3));
    g.setAttribute('aUV', new THREE.BufferAttribute(this.U.take(), 4));
    g.setAttribute('aMat', new THREE.BufferAttribute(this.M.take(), 4));
    g.setIndex(new THREE.BufferAttribute(this.I.take(), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// Build a 3x3 rotation (row-major array) from yaw (Y), pitch (X), roll (Z)
export function rot3(yaw, pitch, roll) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // R = Ry * Rx * Rz
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
  const Rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  const mul = (A, B) => { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C; };
  return mul(mul(Ry, Rx), Rz);
}
