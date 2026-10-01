// Procedural sculpting: ordered list of signed-distance primitives (smooth union / smooth subtraction)
// -> narrow-band surface nets -> BufferGeometry with SDF normals, skin weights, muscle-fibre directions,
// material masks and SDF ambient occlusion baked per vertex.
//
// All coordinates are "model units" (the Colossal is sculpted as a 1.8 m human and scaled up by the rig).
import * as THREE from 'three';

// ---------- primitive SDFs (closures, allocation free) ----------
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

// tapered capsule between a (radius ra) and b (radius rb)  (iq's round cone)
function roundCone(a, b, ra, rb) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz, rr = ra - rb, a2 = l2 - rr * rr, il2 = 1 / l2;
  return (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const yy = pax * bax + pay * bay + paz * baz;
    const z0 = yy - l2;
    const cx = pax * l2 - bax * yy, cy = pay * l2 - bay * yy, cz = paz * l2 - baz * yy;
    const x2 = cx * cx + cy * cy + cz * cz;
    const y2 = yy * yy * l2, z2 = z0 * z0 * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(z0) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
  };
}
// ellipsoid with rotation (m = row-major 3x3 world->local), iq's bound approximation
function ellipsoid(c, r, m) {
  const [rx, ry, rz] = r;
  return (x, y, z) => {
    let px = x - c[0], py = y - c[1], pz = z - c[2];
    if (m) { const qx = m[0] * px + m[1] * py + m[2] * pz, qy = m[3] * px + m[4] * py + m[5] * pz, qz = m[6] * px + m[7] * py + m[8] * pz; px = qx; py = qy; pz = qz; }
    const k0 = len3(px / rx, py / ry, pz / rz);
    const k1 = len3(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
    return k1 < 1e-9 ? -Math.min(rx, ry, rz) : k0 * (k0 - 1) / k1;
  };
}
function roundBox(c, h, rad, m) {
  const [hx, hy, hz] = h;
  return (x, y, z) => {
    let px = x - c[0], py = y - c[1], pz = z - c[2];
    if (m) { const qx = m[0] * px + m[1] * py + m[2] * pz, qy = m[3] * px + m[4] * py + m[5] * pz, qz = m[6] * px + m[7] * py + m[8] * pz; px = qx; py = qy; pz = qz; }
    const qx = Math.abs(px) - hx + rad, qy = Math.abs(py) - hy + rad, qz = Math.abs(pz) - hz + rad;
    return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - rad;
  };
}

// rotation matrix (row-major world->local) whose local Y axis = dir, local Z ~ up hint
export function basisY(dir, hint = [0, 0, 1]) {
  const y = new THREE.Vector3(...dir).normalize();
  let h = new THREE.Vector3(...hint);
  if (Math.abs(h.dot(y)) > 0.95) h = new THREE.Vector3(1, 0, 0);
  const x = new THREE.Vector3().crossVectors(y, h).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return [x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z];
}

// ---------- sculpt builder ----------
// op fields: d(x,y,z), k (blend), sub, bone, mat:[tendon, gum], fib:[x,y,z]|null, bc (bound centre), br (bound radius)
export class Sculpt {
  constructor() { this.ops = []; }
  _push(o, opts) {
    const op = Object.assign({ k: 0.01, sub: false, bone: 0, tendon: 0, gum: 0, lip: 0, flush: 0, hair: 0, shade: 0, fib: null, skin: true }, opts, o);
    if (op.fib) { const l = Math.hypot(...op.fib) || 1; op.fib = op.fib.map((v) => v / l); }
    this.ops.push(op);
    return op;
  }
  cone(a, b, ra, rb, opts = {}) {
    const bc = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const br = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2 + Math.max(ra, rb);
    return this._push({ d: roundCone(a, b, ra, rb), bc, br, fib: opts.fib || [b[0] - a[0], b[1] - a[1], b[2] - a[2]], sa: a, sb: b, sr: Math.max(ra, rb) }, opts);
  }
  cap(a, b, r, opts = {}) { return this.cone(a, b, r, r, opts); }
  sph(c, r, opts = {}) { return this._push({ d: (x, y, z) => len3(x - c[0], y - c[1], z - c[2]) - r, bc: c, br: r }, opts); }
  // ellipsoid; `dir` orients its local Y axis (radius r[1]) along dir (fibre direction by default)
  ell(c, r, opts = {}) {
    const m = opts.dir ? basisY(opts.dir, opts.hint) : null;
    const fib = opts.fib || (opts.dir ? opts.dir : (r[1] >= r[0] && r[1] >= r[2] ? [0, 1, 0] : r[0] >= r[2] ? [1, 0, 0] : [0, 0, 1]));
    return this._push({ d: ellipsoid(c, r, m), bc: c, br: Math.max(...r) }, { ...opts, fib });
  }
  box(c, h, rad, opts = {}) {
    const m = opts.dir ? basisY(opts.dir, opts.hint) : null;
    return this._push({ d: roundBox(c, h, rad, m), bc: c, br: Math.hypot(...h) }, { fib: opts.dir || [0, 1, 0], ...opts });
  }
}

const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };

export function makeSDF(ops) {
  const n = ops.length;
  const cx = new Float64Array(n), cy = new Float64Array(n), cz = new Float64Array(n), br = new Float64Array(n), kk = new Float64Array(n);
  const sub = new Uint8Array(n), fns = [];
  ops.forEach((o, i) => { cx[i] = o.bc[0]; cy[i] = o.bc[1]; cz[i] = o.bc[2]; br[i] = o.br; kk[i] = o.k; sub[i] = o.sub ? 1 : 0; fns.push(o.d); });
  return (x, y, z) => {
    let d = 1e9;
    for (let i = 0; i < n; i++) {
      const dx = x - cx[i], dy = y - cy[i], dz = z - cz[i];
      const bd = Math.sqrt(dx * dx + dy * dy + dz * dz) - br[i];
      const k = kk[i];
      if (sub[i] === 0) {
        if (bd > d + k) continue;
        const di = fns[i](x, y, z);
        d = k > 0 ? smin(d, di, k) : Math.min(d, di);
      } else {
        if (bd > k - d) continue;
        const di = fns[i](x, y, z);
        d = k > 0 ? smax(d, -di, k) : Math.max(d, -di);
      }
    }
    return d;
  };
}

// Spatially accelerated SDF: bricks of size bs over [min,max], each with the (ordered) list of ops that can
// matter within `margin` of the brick. Outside every list -> returns +margin (far outside).
export function makeBrickSDF(ops, min, max, bs, margin) {
  const nbx = Math.max(1, Math.ceil((max[0] - min[0]) / bs)), nby = Math.max(1, Math.ceil((max[1] - min[1]) / bs)), nbz = Math.max(1, Math.ceil((max[2] - min[2]) / bs));
  const NB = nbx * nby * nbz;
  const n = ops.length;
  // bound = segment (a..b) inflated by r  (spheres/ellipsoids: a == b)
  const ax = new Float64Array(n), ay = new Float64Array(n), az = new Float64Array(n), dx_ = new Float64Array(n), dy_ = new Float64Array(n), dz_ = new Float64Array(n), il = new Float64Array(n), br = new Float64Array(n), kk = new Float64Array(n);
  const sb = new Uint8Array(n), fns = [];
  ops.forEach((o, i) => {
    const A = o.sa || o.bc, B = o.sb || o.bc;
    ax[i] = A[0]; ay[i] = A[1]; az[i] = A[2]; dx_[i] = B[0] - A[0]; dy_[i] = B[1] - A[1]; dz_[i] = B[2] - A[2];
    const l2 = dx_[i] ** 2 + dy_[i] ** 2 + dz_[i] ** 2; il[i] = l2 > 1e-12 ? 1 / l2 : 0;
    br[i] = o.sa ? o.sr : o.br; kk[i] = o.k; sb[i] = o.sub ? 1 : 0; fns.push(o.d);
  });
  const segDist = (i, x, y, z) => {
    const px = x - ax[i], py = y - ay[i], pz = z - az[i];
    let t = (px * dx_[i] + py * dy_[i] + pz * dz_[i]) * il[i]; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = px - dx_[i] * t, qy = py - dy_[i] * t, qz = pz - dz_[i] * t;
    return Math.sqrt(qx * qx + qy * qy + qz * qz) - br[i];
  };
  const hd = bs * 0.8660254 + 1e-9;
  const cnt = new Int32Array(NB + 1);
  const ranges = [];
  for (let i = 0; i < n; i++) {
    const R = margin + kk[i] + br[i];
    const lo = [Math.min(ax[i], ax[i] + dx_[i]), Math.min(ay[i], ay[i] + dy_[i]), Math.min(az[i], az[i] + dz_[i])];
    const hi = [Math.max(ax[i], ax[i] + dx_[i]), Math.max(ay[i], ay[i] + dy_[i]), Math.max(az[i], az[i] + dz_[i])];
    ranges.push([
      Math.max(0, Math.floor((lo[0] - R - min[0]) / bs)), Math.min(nbx - 1, Math.floor((hi[0] + R - min[0]) / bs)),
      Math.max(0, Math.floor((lo[1] - R - min[1]) / bs)), Math.min(nby - 1, Math.floor((hi[1] + R - min[1]) / bs)),
      Math.max(0, Math.floor((lo[2] - R - min[2]) / bs)), Math.min(nbz - 1, Math.floor((hi[2] + R - min[2]) / bs)), margin + kk[i]]);
  }
  const hit = (i, bi, bj, bk) => segDist(i, min[0] + (bi + 0.5) * bs, min[1] + (bj + 0.5) * bs, min[2] + (bk + 0.5) * bs) - hd <= ranges[i][6];
  for (let i = 0; i < n; i++) {
    const [i0, i1, j0, j1, k0, k1] = ranges[i];
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let q = i0; q <= i1; q++) if (hit(i, q, j, k)) cnt[q + nbx * (j + nby * k) + 1]++;
  }
  for (let b = 0; b < NB; b++) cnt[b + 1] += cnt[b];
  const list = new Int32Array(cnt[NB]);
  const fillp = cnt.slice(0, NB);
  for (let i = 0; i < n; i++) {
    const [i0, i1, j0, j1, k0, k1] = ranges[i];
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let q = i0; q <= i1; q++) if (hit(i, q, j, k)) list[fillp[q + nbx * (j + nby * k)]++] = i;
  }
  const brickOf = (x, y, z) => {
    const i = Math.floor((x - min[0]) / bs), j = Math.floor((y - min[1]) / bs), k = Math.floor((z - min[2]) / bs);
    if (i < 0 || j < 0 || k < 0 || i >= nbx || j >= nby || k >= nbz) return -1;
    return i + nbx * (j + nby * k);
  };
  const f = (x, y, z) => {
    const b = brickOf(x, y, z);
    if (b < 0) return margin;
    const s = cnt[b], e = cnt[b + 1];
    if (s === e) return margin;
    let d = 1e9;
    for (let q = s; q < e; q++) {
      const i = list[q];
      const px = x - ax[i], py = y - ay[i], pz = z - az[i];
      let t = (px * dx_[i] + py * dy_[i] + pz * dz_[i]) * il[i]; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = px - dx_[i] * t, qy = py - dy_[i] * t, qz = pz - dz_[i] * t;
      const bd = Math.sqrt(qx * qx + qy * qy + qz * qz) - br[i];
      const k = kk[i];
      if (sb[i] === 0) {
        if (bd > d + k) continue;
        const di = fns[i](x, y, z);
        d = k > 0 ? smin(d, di, k) : Math.min(d, di);
      } else {
        if (bd > k - d) continue;
        const di = fns[i](x, y, z);
        d = k > 0 ? smax(d, -di, k) : Math.max(d, -di);
      }
    }
    return d > margin ? margin : d;
  };
  f.listRange = (x, y, z, out) => { const b = brickOf(x, y, z); if (b < 0) { out[0] = out[1] = 0; } else { out[0] = cnt[b]; out[1] = cnt[b + 1]; } return out; };
  f.list = list;
  f.segDist = segDist;
  return f;
}

// ---------- narrow-band surface nets ----------
// f: sdf, min/max: bounds, h: voxel size. returns {pos:Float32Array, idx:Uint32Array}
export function surfaceNets(f, min, max, h) {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1, ny = Math.ceil((max[1] - min[1]) / h) + 1, nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const C = 4, H = h * C;
  const cnx = Math.ceil((nx - 1) / C) + 1, cny = Math.ceil((ny - 1) / C) + 1, cnz = Math.ceil((nz - 1) / C) + 1;
  const cv = new Float32Array(cnx * cny * cnz);
  for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++)
    cv[i + cnx * (j + cny * k)] = f(min[0] + i * H, min[1] + j * H, min[2] + k * H);
  const N = nx * ny * nz, sx = 1, sy = nx, sz = nx * ny;
  const v = new Float32Array(N);
  const thr = H * 1.732 * 1.35;
  const near = [];
  for (let k = 0; k < cnz - 1; k++) for (let j = 0; j < cny - 1; j++) for (let i = 0; i < cnx - 1; i++) {
    const c0 = i + cnx * (j + cny * k);
    let mn = 1e9;
    for (let c = 0; c < 8; c++) { const a = Math.abs(cv[c0 + (c & 1) + ((c >> 1) & 1) * cnx + ((c >> 2) & 1) * cnx * cny]); if (a < mn) mn = a; }
    const i0 = i * C, j0 = j * C, k0 = k * C, i1 = Math.min(i0 + C, nx - 1), j1 = Math.min(j0 + C, ny - 1), k1 = Math.min(k0 + C, nz - 1);
    if (mn < thr) { near.push(i0, j0, k0, i1, j1, k1); continue; }
    const val = cv[c0];
    for (let kk = k0; kk <= k1; kk++) for (let jj = j0; jj <= j1; jj++) { let p = i0 + sy * jj + sz * kk; for (let ii = i0; ii <= i1; ii++, p++) v[p] = val; }
  }
  const done = new Uint8Array(N);
  for (let q = 0; q < near.length; q += 6) {
    const i0 = near[q], j0 = near[q + 1], k0 = near[q + 2], i1 = near[q + 3], j1 = near[q + 4], k1 = near[q + 5];
    for (let kk = k0; kk <= k1; kk++) for (let jj = j0; jj <= j1; jj++) {
      let p = i0 + sy * jj + sz * kk;
      for (let ii = i0; ii <= i1; ii++, p++) { if (done[p]) continue; done[p] = 1; v[p] = f(min[0] + ii * h, min[1] + jj * h, min[2] + kk * h); }
    }
  }
  // vertices: one per cell with a sign change (cells scanned only inside near blocks)
  const vid = new Int32Array(N).fill(-1);
  const pos = [];
  const eOff = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cOff = [0, sx, sy, sx + sy, sz, sx + sz, sy + sz, sx + sy + sz];
  const cvv = new Float32Array(8);
  for (let q = 0; q < near.length; q += 6) {
    const i0 = near[q], j0 = near[q + 1], k0 = near[q + 2], i1 = near[q + 3], j1 = near[q + 4], k1 = near[q + 5];
    for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const p = i + sy * j + sz * k;
      if (vid[p] !== -1) continue;
      let mask = 0;
      for (let c = 0; c < 8; c++) { cvv[c] = v[p + cOff[c]]; if (cvv[c] < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      let ax = 0, ay = 0, az = 0, cnt = 0;
      for (let e = 0; e < 12; e++) {
        const a = eOff[e][0], b = eOff[e][1];
        const va = cvv[a], vb = cvv[b];
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        ax += (a & 1) + ((b & 1) - (a & 1)) * t;
        ay += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
        az += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
        cnt++;
      }
      vid[p] = pos.length / 3;
      pos.push(min[0] + (i + ax / cnt) * h, min[1] + (j + ay / cnt) * h, min[2] + (k + az / cnt) * h);
    }
  }
  // faces
  const idx = [];
  const P = pos;
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) { const t = b; b = d; d = t; }
    // split along the shorter diagonal
    const d1 = (P[a * 3] - P[c * 3]) ** 2 + (P[a * 3 + 1] - P[c * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[c * 3 + 2]) ** 2;
    const d2 = (P[b * 3] - P[d * 3]) ** 2 + (P[b * 3 + 1] - P[d * 3 + 1]) ** 2 + (P[b * 3 + 2] - P[d * 3 + 2]) ** 2;
    if (d1 <= d2) idx.push(a, b, c, a, c, d); else idx.push(a, b, d, b, c, d);
  };
  for (let q = 0; q < near.length; q += 6) {
    const i0 = near[q], j0 = near[q + 1], k0 = near[q + 2], i1 = near[q + 3], j1 = near[q + 4], k1 = near[q + 5];
    for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const p = i + sy * j + sz * k;
      const v0 = v[p], in0 = v0 < 0;
      // x edge (p -> p+sx): cells around it (j-1,k-1),(j,k-1),(j,k),(j-1,k)
      if (j > 0 && k > 0 && in0 !== (v[p + sx] < 0)) quad(vid[p - sy - sz], vid[p - sz], vid[p], vid[p - sy], !in0);
      if (i > 0 && k > 0 && in0 !== (v[p + sy] < 0)) quad(vid[p - sx - sz], vid[p - sx], vid[p], vid[p - sz], !in0);
      if (i > 0 && j > 0 && in0 !== (v[p + sz] < 0)) quad(vid[p - sx - sy], vid[p - sy], vid[p], vid[p - sx], !in0);
    }
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

// gradient (tetrahedral) of f at p
export function grad(f, x, y, z, e, out) {
  const a = f(x + e, y - e, z - e), b = f(x - e, y - e, z + e), c = f(x - e, y + e, z - e), d = f(x + e, y + e, z + e);
  out[0] = a - b - c + d; out[1] = -a - b + c + d; out[2] = -a + b - c + d;
  const l = Math.hypot(out[0], out[1], out[2]) || 1;
  out[0] /= l; out[1] /= l; out[2] /= l;
  return out;
}

// Build a part: sdf restricted by opts.clip (max'ed in), meshed at voxel h; attributes from the ops near each vertex.
// opts: { min, max, h, clip(d,x,y,z), boneCount, sigmaBone, sigmaMat, aoScale }
export function buildPart(ops, _unused, opts) {
  const { min, max, h } = opts;
  const aoS = opts.aoScale ?? 0.006;
  const band = h * 4 * 1.732 * 1.35;
  const margin = Math.max(band, aoS * 5) + h * 2;
  const pad = margin + 0.01;
  const bmin = [min[0] - pad, min[1] - pad, min[2] - pad], bmax = [max[0] + pad, max[1] + pad, max[2] + pad];
  const local = ops.filter((o) => {
    const dx = Math.max(bmin[0] - o.bc[0], 0, o.bc[0] - bmax[0]), dy = Math.max(bmin[1] - o.bc[1], 0, o.bc[1] - bmax[1]), dz = Math.max(bmin[2] - o.bc[2], 0, o.bc[2] - bmax[2]);
    return Math.hypot(dx, dy, dz) - o.br < o.k + margin;
  });
  const bs = Math.max(h * 4, 0.012);
  const base = makeBrickSDF(local, bmin, bmax, bs, margin);
  // AO can ignore some ops (e.g. the head shouldn't bake occlusion onto the chest: it moves)
  const aoBase = opts.aoSkip ? makeBrickSDF(local.filter((o) => !opts.aoSkip(o)), bmin, bmax, bs, margin) : base;
  const clip = opts.clip;
  const f = clip ? (x, y, z) => clip(base(x, y, z), x, y, z) : base;
  const { pos, idx } = surfaceNets(f, min, max, h);
  const nv = pos.length / 3;
  const nrm = new Float32Array(nv * 3);
  const g = [0, 0, 0];
  for (let i = 0; i < nv; i++) {
    let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const d = f(x, y, z);
    grad(f, x, y, z, h * 0.5, g);
    const st = Math.max(-h, Math.min(h, d));
    x -= g[0] * st; y -= g[1] * st; z -= g[2] * st;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    grad(f, x, y, z, h * 0.75, g);
    nrm[i * 3] = g[0]; nrm[i * 3 + 1] = g[1]; nrm[i * 3 + 2] = g[2];
  }
  const sb = opts.sigmaBone ?? 0.012, sm = opts.sigmaMat ?? 0.004;
  const skinIndex = new Uint16Array(nv * 4), skinWeight = new Float32Array(nv * 4);
  const fib = new Float32Array(nv * 3), md = new Float32Array(nv * 4), md2 = new Float32Array(nv * 4), anc = new Float32Array(nv * 3);
  const nb = opts.boneCount || 64;
  const bw = new Float64Array(nb);
  const ddv = new Float64Array(local.length);
  const rng = [0, 0];
  const L = base.list;
  const gidx = new Map(ops.map((o, i) => [o, i]));
  const sSeam = opts.seamSigma ?? h * 1.5;
  for (let i = 0; i < nv; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    base.listRange(x, y, z, rng);
    let dmin = 1e9, dom = -1;
    for (let q = rng[0]; q < rng[1]; q++) {
      const o = local[L[q]];
      if (o.sub) { ddv[q - rng[0]] = 1e9; continue; }
      const bd = base.segDist(L[q], x, y, z);
      const di = bd > Math.min(dmin, 0.01) + sb * 6 ? 1e9 : o.d(x, y, z);
      ddv[q - rng[0]] = di; if (di < dmin) { dmin = di; dom = q; }
    }
    // seam: second-nearest belly that runs a different way (or is fascia vs muscle) -> groove line between bellies
    let d2 = 1e9;
    if (dom >= 0) {
      const od = local[L[dom]];
      for (let q = rng[0]; q < rng[1]; q++) {
        if (q === dom) continue;
        const di = ddv[q - rng[0]]; if (di > 1e8 || di >= d2) continue;
        const o = local[L[q]];
        const par = (o.fib && od.fib) ? Math.abs(o.fib[0] * od.fib[0] + o.fib[1] * od.fib[1] + o.fib[2] * od.fib[2]) : 0;
        if (par < 0.85 || Math.abs((o.tendon || 0) - (od.tendon || 0)) > 0.5) d2 = di;
      }
    }
    bw.fill(0);
    let fx = 0, fy = 0, fz = 0, ten = 0, gum = 0, m2 = 0, m3 = 0, m4 = 0, wm = 0, fref = null;
    for (let q = rng[0]; q < rng[1]; q++) {
      const o0 = local[L[q]];
      if (o0.sub && o0.tendon) {   // tendon-tagged groove: paint only the carved surface itself (vertex lies inside the add union)
        if (dmin > -h * 0.6) continue;
        const ds = Math.abs(o0.d(x, y, z)); const w = Math.exp(-ds / sm);
        if (w > 1e-3) { wm += w; ten += w * o0.tendon; }
        continue;
      }
      const di = ddv[q - rng[0]]; if (di > 1e8) continue;
      const o = local[L[q]];
      if (o.skin !== false) bw[o.bone] += Math.exp(-(di - dmin) / sb);
      const w = Math.exp(-(di - dmin) / sm);
      if (w < 1e-4) continue;
      wm += w; ten += w * o.tendon; gum += w * o.gum; m2 += w * o.lip; m3 += w * o.flush; m4 += w * o.shade;
      if (o.fib) {
        let s = 1;
        if (fref) s = (o.fib[0] * fref[0] + o.fib[1] * fref[1] + o.fib[2] * fref[2]) < 0 ? -1 : 1; else fref = o.fib;
        fx += w * s * o.fib[0]; fy += w * s * o.fib[1]; fz += w * s * o.fib[2];
      }
    }
    const top = [-1, -1, -1, -1], tw = [0, 0, 0, 0];
    for (let b = 0; b < nb; b++) {
      const w = bw[b]; if (w <= 0) continue;
      for (let s = 0; s < 4; s++) if (w > tw[s]) { for (let t = 3; t > s; t--) { tw[t] = tw[t - 1]; top[t] = top[t - 1]; } tw[s] = w; top[s] = b; break; }
    }
    let sw = tw[0] + tw[1] + tw[2] + tw[3];
    if (sw <= 0) { top[0] = 0; tw[0] = 1; sw = 1; }
    if (opts.capBone !== undefined && y < opts.capBelowY && base(x, y, z) < -h * 1.2) { top[0] = opts.capBone; tw[0] = 1; top[1] = top[2] = top[3] = -1; tw[1] = tw[2] = tw[3] = 0; sw = 1; }
    for (let s = 0; s < 4; s++) { skinIndex[i * 4 + s] = Math.max(0, top[s]); skinWeight[i * 4 + s] = tw[s] / sw; }
    const fl = Math.hypot(fx, fy, fz) || 1;
    fib[i * 3] = fx / fl; fib[i * 3 + 1] = fy / fl; fib[i * 3 + 2] = fz / fl;
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    let occ = 0, wsum = 0;
    for (let s = 1; s <= 5; s++) {
      const dist = aoS * s;
      const ds = aoBase(x + nx * dist, y + ny * dist, z + nz * dist);
      occ += (dist - Math.min(dist, ds)) / dist * (1 / s); wsum += 1 / s;
    }
    md[i * 4] = wm > 0 ? ten / wm : 0;
    md[i * 4 + 1] = wm > 0 ? gum / wm : 0;
    md[i * 4 + 2] = Math.max(0, Math.min(1, 1 - 1.6 * occ / wsum));
    if (dom >= 0) {   // per-belly anchor: centre of the dominant op (closest axis point for cones/capsules)
      const od = local[L[dom]];
      if (od.sa) {
        const A = od.sa, Bv = od.sb, bx = Bv[0] - A[0], by = Bv[1] - A[1], bz = Bv[2] - A[2];
        const l2 = bx * bx + by * by + bz * bz;
        const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - A[0]) * bx + (y - A[1]) * by + (z - A[2]) * bz) / l2)) : 0;
        anc[i * 3] = A[0] + bx * t; anc[i * 3 + 1] = A[1] + by * t; anc[i * 3 + 2] = A[2] + bz * t;
      } else { anc[i * 3] = od.bc[0]; anc[i * 3 + 1] = od.bc[1]; anc[i * 3 + 2] = od.bc[2]; }
    } else { anc[i * 3] = x; anc[i * 3 + 1] = y; anc[i * 3 + 2] = z; }
    md[i * 4 + 3] = dom >= 0 ? ((gidx.get(local[L[dom]]) ?? 0) * 0.6180339887) % 1 : 0.5;   // belly id (stable across parts)
    md2[i * 4] = d2 < 1e8 ? Math.exp(-Math.max(0, d2 - dmin) / sSeam) : 0;                   // seam between bellies (was lip)
    md2[i * 4 + 1] = wm > 0 ? m3 / wm : 0;
    // curvature-ish cavity: sdf a little inside vs expected
    const ci = base(x - nx * h * 2, y - ny * h * 2, z - nz * h * 2);
    md2[i * 4 + 2] = Math.max(-1, Math.min(1, (ci + h * 2) / (h * 2)));
    // signed mid-scale curvature (SDF Laplacian): convex +, concave -
    const cr = opts.curvR ?? 0.012, f0c = base(x, y, z);
    const lap = (base(x + cr, y, z) + base(x - cr, y, z) + base(x, y + cr, z) + base(x, y - cr, z) + base(x, y, z + cr) + base(x, y, z - cr) - 6 * f0c) / (cr * cr);
    md2[i * 4 + 3] = Math.max(-1, Math.min(1, lap * cr * 0.5));
  }
  if (opts.displace) displaceFibres(pos, nrm, fib, md, idx, opts.displace);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.setAttribute('fibre', new THREE.BufferAttribute(fib, 3));
  geo.setAttribute('mdata', new THREE.BufferAttribute(md, 4));
  geo.setAttribute('mdata2', new THREE.BufferAttribute(md2, 4));
  geo.setAttribute('manchor', new THREE.BufferAttribute(anc, 3));
  geo.setIndex(new THREE.BufferAttribute(nv > 65535 ? idx : new Uint16Array(idx), 1));
  geo.computeBoundingSphere();
  return geo;
}

// region helpers (negative inside)
export const boxRegion = (min, max) => (x, y, z) => {
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
  const qx = Math.abs(x - cx) - (max[0] - min[0]) / 2, qy = Math.abs(y - cy) - (max[1] - min[1]) / 2, qz = Math.abs(z - cz) - (max[2] - min[2]) / 2;
  return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
};

// sculpted muscle-bundle relief: ridges running along each vertex's fibre direction, none on fascia plates.
// Normals are re-derived from the displaced mesh and blended with the SDF normals.
const vh = (x, y, z) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let xf = x - xi, yf = y - yi, zf = z - zi;
  xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(vh(xi, yi, zi), vh(xi + 1, yi, zi), xf), l(vh(xi, yi + 1, zi), vh(xi + 1, yi + 1, zi), xf), yf),
    l(l(vh(xi, yi, zi + 1), vh(xi + 1, yi, zi + 1), xf), l(vh(xi, yi + 1, zi + 1), vh(xi + 1, yi + 1, zi + 1), xf), yf), zf);
}
function displaceFibres(pos, nrm, fib, md, idx, { amp = 0.001, freq = 60 } = {}) {
  const nv = pos.length / 3;
  for (let i = 0; i < nv; i++) {
    const plate = Math.min(1, Math.max(0, md[i * 4])), gum = Math.min(1, Math.max(0, md[i * 4 + 1])), ao = md[i * 4 + 2];
    const k = (1 - plate) * (1 - gum) * (0.35 + 0.65 * ao);
    if (k < 0.02) continue;
    const fx = fib[i * 3], fy = fib[i * 3 + 1], fz = fib[i * 3 + 2];
    let x = pos[i * 3] * freq, y = pos[i * 3 + 1] * freq, z = pos[i * 3 + 2] * freq;
    const a = (x * fx + y * fy + z * fz) * 0.88;
    x -= fx * a; y -= fy * a; z -= fz * a;
    const n1 = vnoise3(x, y, z), n2 = vnoise3(x * 2.3 + 5.1, y * 2.3, z * 2.3);
    const ridge = (1 - Math.abs(n1 * 2 - 1)) * 0.75 + (1 - Math.abs(n2 * 2 - 1)) * 0.25;
    const d = (ridge - 0.55) * amp * k;
    pos[i * 3] += nrm[i * 3] * d; pos[i * 3 + 1] += nrm[i * 3 + 1] * d; pos[i * 3 + 2] += nrm[i * 3 + 2] * d;
  }
  // geometric normals of the displaced surface, blended with the SDF normals
  const gn = new Float32Array(nv * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { gn[o] += nx; gn[o + 1] += ny; gn[o + 2] += nz; }
  }
  for (let i = 0; i < nv; i++) {
    const l = Math.hypot(gn[i * 3], gn[i * 3 + 1], gn[i * 3 + 2]) || 1;
    let x = gn[i * 3] / l * 0.65 + nrm[i * 3] * 0.35, y = gn[i * 3 + 1] / l * 0.65 + nrm[i * 3 + 1] * 0.35, z = gn[i * 3 + 2] / l * 0.65 + nrm[i * 3 + 2] * 0.35;
    const m = Math.hypot(x, y, z) || 1;
    nrm[i * 3] = x / m; nrm[i * 3 + 1] = y / m; nrm[i * 3 + 2] = z / m;
  }
}
