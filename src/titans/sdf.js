// Signed-distance modelling + narrow-band Surface Nets polygonizer.
// Pure JS (no three.js) so it can run inside a Web Worker.
//
// A body is an ordered list of primitives. Each primitive is combined with the running distance
// by a polynomial smooth-min ('add') or smooth-max-of-negation ('sub', carving). Every primitive
// carries a bounding sphere so evaluation can skip anything that cannot influence the result.

// ---------------------------------------------------------------- primitives
function frame(ax, ay, az) {
  // orthonormal basis with u = axis (normalized), s, t perpendicular (row-major 3x3, rows = local axes)
  const l = Math.hypot(ax, ay, az) || 1;
  const ux = ax / l, uy = ay / l, uz = az / l;
  let sx, sy, sz;
  if (Math.abs(ux) < 0.9) { sx = 0; sy = -uz; sz = uy; } else { sx = -uz; sy = 0; sz = ux; }
  // s = normalize(u x X) or (u x Y)
  if (Math.abs(ux) < 0.9) { sx = 0; sy = uz; sz = -uy; } else { sx = -uz; sy = 0; sz = ux; }
  let sl = Math.hypot(sx, sy, sz); sx /= sl; sy /= sl; sz /= sl;
  const tx = uy * sz - uz * sy, ty = uz * sx - ux * sz, tz = ux * sy - uy * sx;
  return [ux, uy, uz, sx, sy, sz, tx, ty, tz];
}

// Euler (x,y,z order, radians) rotation -> row-major matrix R (local->world). We store M = R^T (world->local).
export function eulerMat(rx = 0, ry = 0, rz = 0) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rz * Ry * Rx  (intrinsic XYZ as in three.js 'XYZ' order: R = Rx*Ry*Rz) -> use three's convention R = Rx * Ry * Rz
  const a = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const b = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const c = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const mul = (m, n) => {
    const o = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = m[i * 3] * n[j] + m[i * 3 + 1] * n[3 + j] + m[i * 3 + 2] * n[6 + j];
    return o;
  };
  const R = mul(mul(a, b), c);
  // transpose
  return [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
}

export class Ellipsoid {
  // c: center, r: radii, rot: optional euler [rx,ry,rz] (radians)
  constructor(c, r, rot) {
    this.cx = c[0]; this.cy = c[1]; this.cz = c[2];
    this.rx = r[0]; this.ry = r[1]; this.rz = r[2];
    this.m = rot ? eulerMat(rot[0], rot[1], rot[2]) : null;
    this.rmin = Math.min(r[0], r[1], r[2]);
    this.bx = c[0]; this.by = c[1]; this.bz = c[2]; this.br = Math.max(r[0], r[1], r[2]);
  }
  d(x, y, z) {
    let px = x - this.cx, py = y - this.cy, pz = z - this.cz;
    const m = this.m;
    if (m) { const a = m[0] * px + m[1] * py + m[2] * pz, b = m[3] * px + m[4] * py + m[5] * pz, c = m[6] * px + m[7] * py + m[8] * pz; px = a; py = b; pz = c; }
    const ax = px / this.rx, ay = py / this.ry, az = pz / this.rz;
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const bx = ax / this.rx, by = ay / this.ry, bz = az / this.rz;
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    if (k1 < 1e-9) return -this.rmin;
    return k0 * (k0 - 1) / k1;
  }
}

// Capsule with different end radii (IQ round cone), optional elliptic cross-section:
// flat = [sScale, tScale] squashes the cross-section (≤1), side = preferred 's' axis direction.
export class RoundCone {
  constructor(a, b, ra, rb, flat, side) {
    this.ax = a[0]; this.ay = a[1]; this.az = a[2];
    const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
    this.L = Math.hypot(bx, by, bz) || 1e-6;
    this.ra = ra; this.rb = rb;
    let f = frame(bx, by, bz);
    if (side) {
      // s = side orthogonalized against u
      const ux = f[0], uy = f[1], uz = f[2];
      let sx = side[0], sy = side[1], sz = side[2];
      const dd = sx * ux + sy * uy + sz * uz; sx -= dd * ux; sy -= dd * uy; sz -= dd * uz;
      const sl = Math.hypot(sx, sy, sz);
      if (sl > 1e-6) {
        sx /= sl; sy /= sl; sz /= sl;
        f = [ux, uy, uz, sx, sy, sz, uy * sz - uz * sy, uz * sx - ux * sz, ux * sy - uy * sx];
      }
    }
    this.f = f;
    this.fs = flat ? flat[0] : 1; this.ft = flat ? flat[1] : 1;
    this.scale = Math.min(this.fs, this.ft, 1);
    // precomputed round-cone constants in local space: a=(0,0,0), b=(0,L,0)
    const l2 = this.L * this.L, rr = ra - rb;
    this.l2 = l2; this.rr = rr; this.a2 = l2 - rr * rr; this.il2 = 1 / l2;
    this.bx = (a[0] + b[0]) / 2; this.by = (a[1] + b[1]) / 2; this.bz = (a[2] + b[2]) / 2;
    this.br = this.L / 2 + Math.max(ra, rb);
  }
  d(x, y, z) {
    const f = this.f;
    const px = x - this.ax, py = y - this.ay, pz = z - this.az;
    // local coords: along axis (Y), s, t (scaled)
    const ly = f[0] * px + f[1] * py + f[2] * pz;
    const ls = (f[3] * px + f[4] * py + f[5] * pz) / this.fs;
    const lt = (f[6] * px + f[7] * py + f[8] * pz) / this.ft;
    const l2 = this.l2, rr = this.rr, a2 = this.a2, il2 = this.il2, L = this.L;
    const yy = ly * L; // dot(pa, ba) where ba = (0,L,0)
    const zz = yy - l2;
    // x2 = dot2(pa*l2 - ba*y)
    const qx = ls * l2, qy = ly * l2 - L * yy, qz = lt * l2;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yy * yy * l2, z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    let d;
    if (Math.sign(zz) * a2 * z2 > k) d = Math.sqrt(x2 + z2) * il2 - this.rb;
    else if (Math.sign(yy) * a2 * y2 < k) d = Math.sqrt(x2 + y2) * il2 - this.ra;
    else d = (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - this.ra;
    return d * this.scale;
  }
}

export class RBox {
  // center, half extents, corner radius, euler rot
  constructor(c, h, r, rot) {
    this.cx = c[0]; this.cy = c[1]; this.cz = c[2];
    this.hx = h[0] - r; this.hy = h[1] - r; this.hz = h[2] - r; this.r = r;
    this.m = rot ? eulerMat(rot[0], rot[1], rot[2]) : null;
    this.bx = c[0]; this.by = c[1]; this.bz = c[2]; this.br = Math.hypot(h[0], h[1], h[2]);
  }
  d(x, y, z) {
    let px = x - this.cx, py = y - this.cy, pz = z - this.cz;
    const m = this.m;
    if (m) { const a = m[0] * px + m[1] * py + m[2] * pz, b = m[3] * px + m[4] * py + m[5] * pz, c = m[6] * px + m[7] * py + m[8] * pz; px = a; py = b; pz = c; }
    const qx = Math.abs(px) - this.hx, qy = Math.abs(py) - this.hy, qz = Math.abs(pz) - this.hz;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - this.r;
  }
}

// ---------------------------------------------------------------- model
export class SDFModel {
  constructor() { this.prims = []; }
  // opts: { op:'add'|'sub', k, bone, tag, flush }
  add(prim, o = {}) {
    prim.sub = o.op === 'sub';
    prim.k = o.k ?? 0;
    prim.bone = o.bone ?? 0;
    prim.tag = o.tag ?? 0;
    prim.flush = o.flush ?? 0;
    prim.w = o.w ?? 1; // skin-weight influence multiplier
    prim.idx = this.prims.length;
    this.prims.push(prim);
    return prim;
  }
  // Uniform-grid acceleration: each cell lists the primitives whose bounds (+margin) touch it.
  // Exact wherever |d| < margin - k (the narrow band we polygonize), sign-correct elsewhere.
  buildAccel(cell, margin) {
    const P = this.prims;
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const p of P) {
      lo = [Math.min(lo[0], p.bx - p.br), Math.min(lo[1], p.by - p.br), Math.min(lo[2], p.bz - p.br)];
      hi = [Math.max(hi[0], p.bx + p.br), Math.max(hi[1], p.by + p.br), Math.max(hi[2], p.bz + p.br)];
    }
    lo = lo.map((v) => v - margin * 2); hi = hi.map((v) => v + margin * 2);
    const nx = Math.max(1, Math.ceil((hi[0] - lo[0]) / cell)), ny = Math.max(1, Math.ceil((hi[1] - lo[1]) / cell)), nz = Math.max(1, Math.ceil((hi[2] - lo[2]) / cell));
    const lists = new Array(nx * ny * nz);
    const hc = cell / 2;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const cx = lo[0] + (x + 0.5) * cell, cy = lo[1] + (y + 0.5) * cell, cz = lo[2] + (z + 0.5) * cell;
      const l = [];
      for (const p of P) {
        const dx = Math.max(Math.abs(cx - p.bx) - hc, 0), dy = Math.max(Math.abs(cy - p.by) - hc, 0), dz = Math.max(Math.abs(cz - p.bz) - hc, 0);
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < p.br + margin + p.k) l.push(p);
      }
      lists[(z * ny + y) * nx + x] = l;
    }
    this.accel = { lo, nx, ny, nz, inv: 1 / cell, lists };
  }
  listAt(x, y, z) {
    const A = this.accel;
    if (!A) return this.prims;
    const ix = Math.min(A.nx - 1, Math.max(0, Math.floor((x - A.lo[0]) * A.inv)));
    const iy = Math.min(A.ny - 1, Math.max(0, Math.floor((y - A.lo[1]) * A.inv)));
    const iz = Math.min(A.nz - 1, Math.max(0, Math.floor((z - A.lo[2]) * A.inv)));
    return A.lists[(iz * A.ny + iy) * A.nx + ix];
  }
  d(x, y, z) {
    let P = this.prims;
    const A = this.accel;
    if (A) {
      const ix = Math.min(A.nx - 1, Math.max(0, Math.floor((x - A.lo[0]) * A.inv)));
      const iy = Math.min(A.ny - 1, Math.max(0, Math.floor((y - A.lo[1]) * A.inv)));
      const iz = Math.min(A.nz - 1, Math.max(0, Math.floor((z - A.lo[2]) * A.inv)));
      P = A.lists[(iz * A.ny + iy) * A.nx + ix];
    }
    return this.dList(P, x, y, z);
  }
  // evaluation with bounding-sphere early-outs
  dList(P, x, y, z) {
    const n = P.length;
    let d = 1e9;
    for (let i = 0; i < n; i++) {
      const p = P[i];
      const dx = x - p.bx, dy = y - p.by, dz = z - p.bz;
      const dist2 = dx * dx + dy * dy + dz * dz;
      const k = p.k;
      if (p.sub) {
        // no effect if di > k - d  (di >= |p-c| - br)
        const th = k - d + p.br;
        if (th < 0 || dist2 > th * th) continue;
        const di = -p.d(x, y, z);
        if (k > 0) { const h = Math.max(k - Math.abs(d - di), 0) / k; d = Math.max(d, di) + h * h * k * 0.25; }
        else d = Math.max(d, di);
      } else {
        const th = d + k + p.br;
        if (th > 0 && dist2 > th * th) continue;
        const di = p.d(x, y, z);
        if (k > 0) { const h = Math.max(k - Math.abs(d - di), 0) / k; d = Math.min(d, di) - h * h * k * 0.25; }
        else d = Math.min(d, di);
      }
    }
    return d;
  }
  // tetrahedral gradient
  grad(x, y, z, e, out) {
    const a = this.d(x + e, y - e, z - e), b = this.d(x - e, y - e, z + e), c = this.d(x - e, y + e, z - e), dd = this.d(x + e, y + e, z + e);
    let gx = a - b - c + dd, gy = -a - b + c + dd, gz = -a + b - c + dd;
    const l = Math.hypot(gx, gy, gz) || 1;
    out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
    return l / (4 * e);
  }
}

// ---------------------------------------------------------------- surface nets
// domain: { min:[x,y,z], max:[x,y,z], h, keep?(x,y,z)->bool }
// returns { pos: Float32Array, nrm: Float32Array, idx: Uint32Array, count }
export function polygonize(model, domain) {
  const h = domain.h;
  const ox = domain.min[0], oy = domain.min[1], oz = domain.min[2];
  const nx = Math.max(2, Math.ceil((domain.max[0] - ox) / h) + 1);
  const ny = Math.max(2, Math.ceil((domain.max[1] - oy) / h) + 1);
  const nz = Math.max(2, Math.ceil((domain.max[2] - oz) / h) + 1);
  const N = nx * ny * nz;
  const val = new Float32Array(N);
  const done = new Uint8Array(N);
  const B = 4;
  const bnx = Math.ceil((nx - 1) / B), bny = Math.ceil((ny - 1) / B), bnz = Math.ceil((nz - 1) / B);
  const R = h * B * 0.8660254 * 1.6 + h; // generous block radius (ellipsoid SDF is approximate)
  const near = [];
  for (let bz = 0; bz < bnz; bz++) for (let by = 0; by < bny; by++) for (let bx = 0; bx < bnx; bx++) {
    const cx = ox + (bx * B + B / 2) * h, cy = oy + (by * B + B / 2) * h, cz = oz + (bz * B + B / 2) * h;
    const dc = model.d(cx, cy, cz);
    if (Math.abs(dc) > R) {
      // far: fill with the sign value (only points not evaluated yet)
      const x1 = Math.min(nx - 1, bx * B + B), y1 = Math.min(ny - 1, by * B + B), z1 = Math.min(nz - 1, bz * B + B);
      for (let z = bz * B; z <= z1; z++) for (let y = by * B; y <= y1; y++) {
        let i = (z * ny + y) * nx + bx * B;
        for (let x = bx * B; x <= x1; x++, i++) if (!done[i]) val[i] = dc;
      }
    } else near.push(bx, by, bz);
  }
  for (let q = 0; q < near.length; q += 3) {
    const bx = near[q], by = near[q + 1], bz = near[q + 2];
    const x1 = Math.min(nx - 1, bx * B + B), y1 = Math.min(ny - 1, by * B + B), z1 = Math.min(nz - 1, bz * B + B);
    for (let z = bz * B; z <= z1; z++) for (let y = by * B; y <= y1; y++) {
      let i = (z * ny + y) * nx + bx * B;
      for (let x = bx * B; x <= x1; x++, i++) {
        if (done[i]) continue;
        val[i] = model.d(ox + x * h, oy + y * h, oz + z * h);
        done[i] = 1;
      }
    }
  }
  // cells -> vertices
  const cnx = nx - 1, cny = ny - 1, cnz = nz - 1;
  const cellV = new Int32Array(cnx * cny * cnz).fill(-1);
  const pos = [];
  const g = [0, 0, 0];
  const corner = new Float32Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  for (let z = 0; z < cnz; z++) for (let y = 0; y < cny; y++) for (let x = 0; x < cnx; x++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = val[((z + CO[c][2]) * ny + (y + CO[c][1])) * nx + x + CO[c][0]];
      corner[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [a, b] of EDGES) {
      const va = corner[a], vb = corner[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += CO[a][0] + (CO[b][0] - CO[a][0]) * t;
      sy += CO[a][1] + (CO[b][1] - CO[a][1]) * t;
      sz += CO[a][2] + (CO[b][2] - CO[a][2]) * t;
      cnt++;
    }
    let px = ox + (x + sx / cnt) * h, py = oy + (y + sy / cnt) * h, pz = oz + (z + sz / cnt) * h;
    // project onto the true surface (1 Newton step), clamp to the cell
    const d0 = model.d(px, py, pz);
    model.grad(px, py, pz, h * 0.25, g);
    px -= g[0] * d0; py -= g[1] * d0; pz -= g[2] * d0;
    const lx = ox + x * h, ly = oy + y * h, lz = oz + z * h;
    px = Math.min(Math.max(px, lx), lx + h); py = Math.min(Math.max(py, ly), ly + h); pz = Math.min(Math.max(pz, lz), lz + h);
    cellV[(z * cny + y) * cnx + x] = pos.length / 3;
    pos.push(px, py, pz);
  }
  // quads
  const idx = [];
  const keep = domain.keep;
  const P = pos;
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) { const t = b; b = d; d = t; }
    // split along the shorter diagonal
    const dac = (P[a * 3] - P[c * 3]) ** 2 + (P[a * 3 + 1] - P[c * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[c * 3 + 2]) ** 2;
    const dbd = (P[b * 3] - P[d * 3]) ** 2 + (P[b * 3 + 1] - P[d * 3 + 1]) ** 2 + (P[b * 3 + 2] - P[d * 3 + 2]) ** 2;
    if (dac < dbd) idx.push(a, b, c, a, c, d); else idx.push(a, b, d, b, c, d);
  };
  const cv = (x, y, z) => cellV[(z * cny + y) * cnx + x];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i0 = (z * ny + y) * nx + x;
    const s0 = val[i0] < 0;
    // x edge
    if (x < nx - 1 && y > 0 && z > 0 && y < ny - 1 && z < nz - 1) {
      const s1 = val[i0 + 1] < 0;
      if (s0 !== s1 && (!keep || keep(ox + (x + 0.5) * h, oy + y * h, oz + z * h)))
        quad(cv(x, y - 1, z - 1), cv(x, y, z - 1), cv(x, y, z), cv(x, y - 1, z), !s0);
    }
    if (y < ny - 1 && x > 0 && z > 0 && x < nx - 1 && z < nz - 1) {
      const s1 = val[i0 + nx] < 0;
      if (s0 !== s1 && (!keep || keep(ox + x * h, oy + (y + 0.5) * h, oz + z * h)))
        quad(cv(x - 1, y, z - 1), cv(x - 1, y, z), cv(x, y, z), cv(x, y, z - 1), !s0);
    }
    if (z < nz - 1 && x > 0 && y > 0 && x < nx - 1 && y < ny - 1) {
      const s1 = val[i0 + nx * ny] < 0;
      if (s0 !== s1 && (!keep || keep(ox + x * h, oy + y * h, oz + (z + 0.5) * h)))
        quad(cv(x - 1, y - 1, z), cv(x, y - 1, z), cv(x, y, z), cv(x - 1, y, z), !s0);
    }
  }
  // compact
  const nv = pos.length / 3;
  const remap = new Int32Array(nv).fill(-1);
  let count = 0;
  for (let i = 0; i < idx.length; i++) { const v = idx[i]; if (remap[v] < 0) remap[v] = count++; }
  const outP = new Float32Array(count * 3), outN = new Float32Array(count * 3);
  for (let v = 0; v < nv; v++) {
    const r = remap[v]; if (r < 0) continue;
    outP[r * 3] = pos[v * 3]; outP[r * 3 + 1] = pos[v * 3 + 1]; outP[r * 3 + 2] = pos[v * 3 + 2];
  }
  for (let r = 0; r < count; r++) {
    model.grad(outP[r * 3], outP[r * 3 + 1], outP[r * 3 + 2], h * 0.35, g);
    outN[r * 3] = g[0]; outN[r * 3 + 1] = g[1]; outN[r * 3 + 2] = g[2];
  }
  const outI = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) outI[i] = remap[idx[i]];
  return { pos: outP, nrm: outN, idx: outI, count };
}

// SDF ambient occlusion (classic 5-tap march along the normal)
export function sdfAO(model, x, y, z, nx, ny, nz, step) {
  let occ = 0, sca = 1;
  for (let i = 1; i <= 5; i++) {
    const hh = step * i;
    const d = model.d(x + nx * hh, y + ny * hh, z + nz * hh);
    occ += (hh - d) * sca;
    sca *= 0.6;
  }
  return Math.min(1, Math.max(0, 1 - 1.6 * occ / step / 2.2));
}
