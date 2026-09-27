// WORLD collision: convex solids (house bodies, roof prisms, props, gate/breach blocks) bucketed in an 8 m XZ grid,
// visited with a 2D DDA; the great wall ring is analytic (cylinder / cone band) except around the two gates, where
// convex blocks take over (so the gate tunnel and the breach hole are exact). Ground is analytic (flat town, canal,
// rubble mounds, procedural terrain outside).
//
// Convex = up to 8 planes (world space, outward normals) + AABB. Boxes also keep an OBB (Y-rotation only) for exact
// sphere contact.
import * as THREE from 'three';

const CELL = 8, GMIN = -400, GN = 100;
const MAXP = 8;

export class Solids {
  constructor() {
    this.cap = 8192;
    this.pl = new Float32Array(this.cap * MAXP * 4); // planes nx,ny,nz,d
    this.np = new Uint8Array(this.cap);
    this.bb = new Float32Array(this.cap * 6);
    this.obb = new Float32Array(this.cap * 8);     // cx,cy,cz,hx,hy,hz,cos,sin (hx==0: not a box)
    this.kind = [];                                  // string per solid
    this.ref = [];                                   // user ref per solid
    this.alive = new Uint8Array(this.cap);
    this.stamp = new Uint32Array(this.cap);
    this.n = 0;
    this.cells = Array.from({ length: GN * GN }, () => []);
    this.frame = 1;
    this.free = [];
  }
  _grow() {
    const c = this.cap * 2;
    const g = (a, T, k) => { const b = new T(c * k); b.set(a); return b; };
    this.pl = g(this.pl, Float32Array, MAXP * 4); this.np = g(this.np, Uint8Array, 1); this.bb = g(this.bb, Float32Array, 6);
    this.obb = g(this.obb, Float32Array, 8); this.alive = g(this.alive, Uint8Array, 1); this.stamp = g(this.stamp, Uint32Array, 1);
    this.cap = c;
  }
  // planes: [[nx,ny,nz,d], ...] outward, d = n·p for points p on the plane; bb [x0,y0,z0,x1,y1,z1]
  add(planes, bb, kind, ref, obb = null) {
    let i;
    if (this.free.length) i = this.free.pop();
    else { if (this.n >= this.cap) this._grow(); i = this.n++; }
    this.np[i] = planes.length;
    for (let k = 0; k < planes.length; k++) this.pl.set(planes[k], (i * MAXP + k) * 4);
    this.bb.set(bb, i * 6);
    if (obb) this.obb.set(obb, i * 8); else this.obb[i * 8 + 3] = 0;
    this.kind[i] = kind; this.ref[i] = ref; this.alive[i] = 1;
    const i0 = Math.max(0, Math.floor((bb[0] - GMIN) / CELL)), i1 = Math.min(GN - 1, Math.floor((bb[3] - GMIN) / CELL));
    const k0 = Math.max(0, Math.floor((bb[2] - GMIN) / CELL)), k1 = Math.min(GN - 1, Math.floor((bb[5] - GMIN) / CELL));
    for (let k = k0; k <= k1; k++) for (let j = i0; j <= i1; j++) this.cells[k * GN + j].push(i);
    return i;
  }
  // remove from the grid for good (id is recycled)
  remove(i) {
    if (i < 0 || !this.alive[i]) return;
    this.alive[i] = 0;
    const bb = this.bb, b = i * 6;
    const i0 = Math.max(0, Math.floor((bb[b] - GMIN) / CELL)), i1 = Math.min(GN - 1, Math.floor((bb[b + 3] - GMIN) / CELL));
    const k0 = Math.max(0, Math.floor((bb[b + 2] - GMIN) / CELL)), k1 = Math.min(GN - 1, Math.floor((bb[b + 5] - GMIN) / CELL));
    for (let k = k0; k <= k1; k++) for (let j = i0; j <= i1; j++) { const L = this.cells[k * GN + j]; const q = L.indexOf(i); if (q >= 0) { L[q] = L[L.length - 1]; L.pop(); } }
    this.ref[i] = null;
    this.free.push(i);
  }
  // oriented box: centre, half sizes (local x,z rotated by angle a about Y; ex=(cos a, sin a), ez=(-sin a, cos a))
  addBox(cx, cy, cz, hx, hy, hz, a, kind, ref) {
    const c = Math.cos(a), s = Math.sin(a);
    const ex = [c, 0, s], ez = [-s, 0, c];
    const P = [];
    const pl = (n, px, py, pz) => P.push([n[0], n[1], n[2], n[0] * px + n[1] * py + n[2] * pz]);
    pl(ex, cx + ex[0] * hx, cy, cz + ex[2] * hx); pl([-ex[0], 0, -ex[2]], cx - ex[0] * hx, cy, cz - ex[2] * hx);
    pl(ez, cx + ez[0] * hz, cy, cz + ez[2] * hz); pl([-ez[0], 0, -ez[2]], cx - ez[0] * hz, cy, cz - ez[2] * hz);
    pl([0, 1, 0], cx, cy + hy, cz); pl([0, -1, 0], cx, cy - hy, cz);
    const ext = Math.abs(c) * hx + Math.abs(s) * hz, extz = Math.abs(s) * hx + Math.abs(c) * hz;
    return this.add(P, [cx - ext, cy - hy, cz - extz, cx + ext, cy + hy, cz + extz], kind, ref, [cx, cy, cz, hx, hy, hz, c, s]);
  }
  // gable roof prism in a local frame (centre cx,cz, angle a), eave height y0, ridge y1, ridge along local x (axis 0)
  // or local z (axis 2); halfLen along the ridge, halfSpan across it. Optional hip: ends slope in (hipK 0..1 of halfLen)
  addRoof(cx, cz, a, y0, y1, axis, halfLen, halfSpan, kind, ref) {
    const c = Math.cos(a), s = Math.sin(a);
    const toW = (lx, lz) => [cx + lx * c - lz * s, cz + lx * s + lz * c];
    const dirW = (lx, lz) => [lx * c - lz * s, lx * s + lz * c];
    const P = [];
    const pl = (nl, pLoc) => { // nl local [nx,ny,nz], pLoc local [x,y,z]
      const [nx, nz] = dirW(nl[0], nl[2]); const l = Math.hypot(nx, nl[1], nz);
      const [px, pz] = toW(pLoc[0], pLoc[2]);
      P.push([nx / l, nl[1] / l, nz / l, (nx * px + nl[1] * pLoc[1] + nz * pz) / l]);
    };
    const h = y1 - y0;
    if (axis === 0) { // ridge along x, slopes face +-z
      pl([0, halfSpan, h], [0, y0, halfSpan]); pl([0, halfSpan, -h], [0, y0, -halfSpan]);
      pl([1, 0, 0], [halfLen, y0, 0]); pl([-1, 0, 0], [-halfLen, y0, 0]);
    } else {
      pl([h, halfSpan, 0], [halfSpan, y0, 0]); pl([-h, halfSpan, 0], [-halfSpan, y0, 0]);
      pl([0, 0, 1], [0, y0, halfLen]); pl([0, 0, -1], [0, y0, -halfLen]);
    }
    P.push([0, -1, 0, -y0]);
    const hx = axis === 0 ? halfLen : halfSpan, hz = axis === 0 ? halfSpan : halfLen;
    const ext = Math.abs(c) * hx + Math.abs(s) * hz, extz = Math.abs(s) * hx + Math.abs(c) * hz;
    return this.add(P, [cx - ext, y0, cz - extz, cx + ext, y1, cz + extz], kind, ref);
  }
  // pyramid / spire: square base half b at y0, apex y1 (for towers)
  addSpire(cx, cz, a, y0, y1, b, kind, ref) {
    const c = Math.cos(a), s = Math.sin(a);
    const P = [];
    const h = y1 - y0;
    for (const [lx, lz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = lx * c - lz * s, nz = lx * s + lz * c;
      const l = Math.hypot(h, b);
      const n = [nx * h / l, b / l, nz * h / l];
      const px = cx + nx * b, pz = cz + nz * b;
      P.push([n[0], n[1], n[2], n[0] * px + n[1] * y0 + n[2] * pz]);
    }
    P.push([0, -1, 0, -y0]);
    const e = b * 1.415;
    return this.add(P, [cx - e, y0, cz - e, cx + e, y1, cz + e], kind, ref);
  }

  // ray vs one convex (Cyrus-Beck). returns t or -1; writes entering plane index to this._hp
  rayConvex(i, ox, oy, oz, dx, dy, dz, maxT) {
    let tE = -1e30, tX = 1e30, hp = -1;
    const base = i * MAXP * 4, n = this.np[i], pl = this.pl;
    for (let k = 0; k < n; k++) {
      const o = base + k * 4;
      const nx = pl[o], ny = pl[o + 1], nz = pl[o + 2], d = pl[o + 3];
      const den = nx * dx + ny * dy + nz * dz;
      const dist = nx * ox + ny * oy + nz * oz - d;
      if (Math.abs(den) < 1e-9) { if (dist > 0) return -1; continue; }
      const t = -dist / den;
      if (den < 0) { if (t > tE) { tE = t; hp = k; } } else if (t < tX) tX = t;
      if (tE > tX) return -1;
    }
    if (tE < 0 || tE > maxT || hp < 0) return -1;
    this._hp = hp;
    return tE;
  }

  // DDA over the grid; returns {t, i, plane} of the nearest hit or null. Reuses an internal result object.
  raycast(ox, oy, oz, dx, dy, dz, maxT, filter = null) {
    this.frame++;
    if (this.frame > 4e9) { this.frame = 1; this.stamp.fill(0); }
    const fr = this.frame;
    let best = maxT, bi = -1, bp = -1;
    // clip the ray to the grid square
    let t0 = 0, t1 = maxT;
    const lo = GMIN, hi = GMIN + GN * CELL;
    for (const [o, d] of [[ox, dx], [oz, dz]]) {
      if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) return null; continue; }
      let a = (lo - o) / d, b = (hi - o) / d; if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
    }
    if (t0 > t1) return null;
    const eps = 1e-4;
    let x = ox + dx * (t0 + eps), z = oz + dz * (t0 + eps);
    let ci = Math.min(GN - 1, Math.max(0, Math.floor((x - GMIN) / CELL))), ck = Math.min(GN - 1, Math.max(0, Math.floor((z - GMIN) / CELL)));
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-12 ? CELL / Math.abs(dx) : 1e30, tdz = Math.abs(dz) > 1e-12 ? CELL / Math.abs(dz) : 1e30;
    let tmx = Math.abs(dx) > 1e-12 ? ((GMIN + (ci + (sx > 0 ? 1 : 0)) * CELL) - ox) / dx : 1e30;
    let tmz = Math.abs(dz) > 1e-12 ? ((GMIN + (ck + (sz > 0 ? 1 : 0)) * CELL) - oz) / dz : 1e30;
    let tc = t0;
    for (let guard = 0; guard < 400; guard++) {
      if (tc > best || tc > t1) break;
      const list = this.cells[ck * GN + ci];
      for (let q = 0; q < list.length; q++) {
        const i = list[q];
        if (this.stamp[i] === fr) continue; this.stamp[i] = fr;
        if (!this.alive[i]) continue;
        if (filter && !filter(this.kind[i])) continue;
        // quick AABB y reject
        const t = this.rayConvex(i, ox, oy, oz, dx, dy, dz, best);
        if (t >= 0 && t < best) { best = t; bi = i; bp = this._hp; }
      }
      if (tmx < tmz) { tc = tmx; tmx += tdx; ci += sx; if (ci < 0 || ci >= GN) break; }
      else { tc = tmz; tmz += tdz; ck += sz; if (ck < 0 || ck >= GN) break; }
    }
    if (bi < 0) return null;
    const o = (bi * MAXP + bp) * 4;
    return { t: best, i: bi, nx: this.pl[o], ny: this.pl[o + 1], nz: this.pl[o + 2] };
  }

  // sphere contacts -> push {normal, depth, kind, ref}
  collide(cx, cy, cz, r, out) {
    const i0 = Math.max(0, Math.floor((cx - r - GMIN) / CELL)), i1 = Math.min(GN - 1, Math.floor((cx + r - GMIN) / CELL));
    const k0 = Math.max(0, Math.floor((cz - r - GMIN) / CELL)), k1 = Math.min(GN - 1, Math.floor((cz + r - GMIN) / CELL));
    if (i0 > i1 || k0 > k1) return;
    this.frame++;
    const fr = this.frame;
    for (let k = k0; k <= k1; k++) for (let j = i0; j <= i1; j++) {
      const list = this.cells[k * GN + j];
      for (let q = 0; q < list.length; q++) {
        const i = list[q];
        if (this.stamp[i] === fr) continue; this.stamp[i] = fr;
        if (!this.alive[i]) continue;
        const b = i * 6, bb = this.bb;
        if (cx + r < bb[b] || cx - r > bb[b + 3] || cy + r < bb[b + 1] || cy - r > bb[b + 4] || cz + r < bb[b + 2] || cz - r > bb[b + 5]) continue;
        const ob = i * 8;
        if (this.obb[ob + 3] > 0) {
          // exact sphere vs OBB
          const O = this.obb;
          const px = cx - O[ob], py = cy - O[ob + 1], pz = cz - O[ob + 2], c = O[ob + 6], s = O[ob + 7];
          const lx = px * c + pz * s, lz = -px * s + pz * c, ly = py;
          const hx = O[ob + 3], hy = O[ob + 4], hz = O[ob + 5];
          const qx = Math.max(-hx, Math.min(hx, lx)), qy = Math.max(-hy, Math.min(hy, ly)), qz = Math.max(-hz, Math.min(hz, lz));
          let ddx = lx - qx, ddy = ly - qy, ddz = lz - qz;
          const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          let nlx, nly, nlz, depth;
          if (d2 > 1e-10) {
            if (d2 >= r * r) continue;
            const d = Math.sqrt(d2); nlx = ddx / d; nly = ddy / d; nlz = ddz / d; depth = r - d;
          } else { // centre inside: push out through the nearest face
            const ex = hx - Math.abs(lx), ey = hy - Math.abs(ly), ez = hz - Math.abs(lz);
            if (ex <= ey && ex <= ez) { nlx = Math.sign(lx) || 1; nly = 0; nlz = 0; depth = ex + r; }
            else if (ey <= ez) { nlx = 0; nly = Math.sign(ly) || 1; nlz = 0; depth = ey + r; }
            else { nlx = 0; nly = 0; nlz = Math.sign(lz) || 1; depth = ez + r; }
          }
          out.push({ normal: new THREE.Vector3(nlx * c - nlz * s, nly, nlx * s + nlz * c), depth, kind: this.kind[i], ref: this.ref[i] });
        } else {
          // generic convex: separating plane approximation
          let best = -1e30, bk = -1;
          const base = i * MAXP * 4, n = this.np[i], pl = this.pl;
          for (let kk = 0; kk < n; kk++) {
            const o = base + kk * 4;
            const sd = pl[o] * cx + pl[o + 1] * cy + pl[o + 2] * cz - pl[o + 3];
            if (sd > best) { best = sd; bk = kk; }
          }
          if (best >= r) continue;
          const o = base + bk * 4;
          out.push({ normal: new THREE.Vector3(pl[o], pl[o + 1], pl[o + 2]), depth: r - best, kind: this.kind[i], ref: this.ref[i] });
        }
      }
    }
  }
  // highest solid top at (x,z) below y (for standing / props), -Infinity if none
  topAt(x, z, yMax = 1e9) {
    const i = Math.floor((x - GMIN) / CELL), k = Math.floor((z - GMIN) / CELL);
    if (i < 0 || k < 0 || i >= GN || k >= GN) return -Infinity;
    const r = this.raycast(x, yMax, z, 0, -1, 0, yMax + 50);
    return r ? yMax - r.t : -Infinity;
  }
  query(x0, z0, x1, z1, fn) { // visit alive solids overlapping an XZ rect (each once)
    const i0 = Math.max(0, Math.floor((x0 - GMIN) / CELL)), i1 = Math.min(GN - 1, Math.floor((x1 - GMIN) / CELL));
    const k0 = Math.max(0, Math.floor((z0 - GMIN) / CELL)), k1 = Math.min(GN - 1, Math.floor((z1 - GMIN) / CELL));
    this.frame++; const fr = this.frame;
    for (let k = k0; k <= k1; k++) for (let j = i0; j <= i1; j++) for (const i of this.cells[k * GN + j]) {
      if (this.stamp[i] === fr) continue; this.stamp[i] = fr; if (this.alive[i]) fn(i);
    }
  }
}
