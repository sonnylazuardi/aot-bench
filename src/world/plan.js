// WORLD: Shiganshina town plan (pure data). Streets as polylines, a canal, the plaza, special buildings and house lots
// packed along street frontages using a 1 m occupancy raster. Deterministic (seeded).
import { LAYOUT } from '../core/layout.js';
import { Rng, fbm, vnoise, segDist, clamp } from './util.js';

export const GRID = { min: -400, res: 1, n: 800 }; // 1 m cells over [-400, 400]^2
const G = GRID;
const cellIdx = (x, z) => {
  const i = Math.floor((x - G.min) / G.res), k = Math.floor((z - G.min) / G.res);
  return i < 0 || k < 0 || i >= G.n || k >= G.n ? -1 : k * G.n + i;
};

// ---------------- polylines ----------------
export class Poly {
  constructor(pts, closed = false) {
    this.pts = pts; this.closed = closed;
    if (closed) this.pts = [...pts, pts[0]];
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.pts[i][0] - this.pts[i - 1][0], this.pts[i][1] - this.pts[i - 1][1]));
    this.len = this.cum[this.cum.length - 1];
  }
  at(s) { // -> [x, z, tx, tz]
    s = clamp(s, 0, this.len);
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    const a = this.pts[lo], b = this.pts[hi];
    const L = this.cum[hi] - this.cum[lo] || 1e-6, t = (s - this.cum[lo]) / L;
    const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, tx, tz];
  }
  dist(x, z) {
    let d = Infinity;
    for (let i = 1; i < this.pts.length; i++) d = Math.min(d, segDist(x, z, this.pts[i - 1][0], this.pts[i - 1][1], this.pts[i][0], this.pts[i][1]));
    return d;
  }
}

// Chaikin smoothing
function smoothPts(pts, it = 2, closed = false) {
  for (let k = 0; k < it; k++) {
    const out = closed ? [] : [pts[0]];
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}

// ---------------- the plan ----------------
export function makePlan(seed = 1847) {
  const rng = new Rng(seed);
  const R = LAYOUT.wall.radius;
  const plaza = LAYOUT.plaza;
  const street = new Uint8Array(G.n * G.n);   // 0 free, 1 street, 2 plaza/square, 3 canal, 4 wall zone / outside, 5 reserved open
  const occ = new Int32Array(G.n * G.n).fill(-1); // building owner
  const streets = [];

  // wall zone: everything beyond the lane along the wall
  for (let k = 0; k < G.n; k++) {
    const z = G.min + (k + 0.5) * G.res;
    const rr = (R - 2.5) * (R - 2.5) - z * z;
    const half = rr > 0 ? Math.sqrt(rr) : -1;
    for (let i = 0; i < G.n; i++) {
      const x = G.min + (i + 0.5) * G.res;
      if (x > half || x < -half) street[k * G.n + i] = 4;
    }
  }

  const paint = (poly, w, val) => {
    const hw = w / 2;
    for (let j = 1; j < poly.pts.length; j++) {
      const [ax, az] = poly.pts[j - 1], [bx, bz] = poly.pts[j];
      const x0 = Math.min(ax, bx) - hw - 1, x1 = Math.max(ax, bx) + hw + 1, z0 = Math.min(az, bz) - hw - 1, z1 = Math.max(az, bz) + hw + 1;
      for (let z = Math.floor(z0); z <= z1; z++) for (let x = Math.floor(x0); x <= x1; x++) {
        const c = cellIdx(x + 0.5, z + 0.5); if (c < 0) continue;
        if (segDist(x + 0.5, z + 0.5, ax, az, bx, bz) <= hw) { const cur = street[c]; if (val === 3) { if (cur !== 4) street[c] = 3; } else if (cur === 0) street[c] = val; }
      }
    }
  };
  const addStreet = (pts, w, kind, closed = false) => {
    const poly = new Poly(pts, closed);
    const s = { poly, w, kind, id: streets.length };
    streets.push(s);
    paint(poly, w, 1);
    return s;
  };

  // --- canal (east-west across the northern half), water at y = -2.4, embankments ---
  let canalPts = [[-R - 6, -52], [-300, -78], [-220, -104], [-140, -92], [-60, -106], [0, -118], [70, -132], [150, -126], [230, -142], [310, -130], [R + 6, -150]];
  canalPts = smoothPts(canalPts, 3);
  const canal = { poly: new Poly(canalPts), w: 13, waterY: -2.3, bedY: -3.6 };

  // --- main avenue ---
  const avenue = addStreet([[0, R + 2], [0, -R - 2]].map(([x, z]) => [x, z]), LAYOUT.mainStreet.width, 'avenue');
  // --- wall lane and ring road ---
  const ringPts = (r, amp, sd, n = 180) => {
    const pts = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const rr = r + amp * (fbm(Math.cos(a) * 2 + 5, Math.sin(a) * 2 + sd, 3, sd) - 0.5) * 2; pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
    return pts;
  };
  addStreet(ringPts(R - 8.5, 0.5, 3), 7, 'walllane', true);
  const ring3 = addStreet(ringPts(338, 5, 11), 9, 'ring', true);
  // --- plaza (irregular) ---
  const plazaPts = [];
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; const r = plaza.radius + 7 * (vnoise(Math.cos(a) * 1.6 + 3, Math.sin(a) * 1.6, 77) - 0.5) * 2; plazaPts.push([plaza.x + Math.cos(a) * r, plaza.z + Math.sin(a) * r * 0.9]); }
  const plazaPoly = new Poly(plazaPts, true);
  // fill plaza
  for (let z = plaza.z - 60; z < plaza.z + 60; z++) for (let x = plaza.x - 60; x < plaza.x + 60; x++) {
    if (pointInPoly(x + 0.5, z + 0.5, plazaPts)) { const c = cellIdx(x + 0.5, z + 0.5); if (c >= 0) street[c] = 2; }
  }
  // gate squares
  const fillRect = (x0, z0, x1, z1, v) => { for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) { const c = cellIdx(x + 0.5, z + 0.5); if (c >= 0 && street[c] !== 4) street[c] = v; } };
  fillRect(-34, 326, 34, 380, 2);
  fillRect(-28, -380, 28, -334, 2);

  // --- radial streets from the plaza out to the ring road ---
  const radialAngles = [8, 40, 68, 118, 146, 176, 204, 232, 300, 328].map((d) => (d + rng.range(-5, 5)) * Math.PI / 180);
  const radials = [];
  for (const a0 of radialAngles) {
    const pts = [];
    const ph = rng.range(0, 6.28), amp = rng.range(0.08, 0.2);
    for (let r = plaza.radius - 4; r <= 342; r += 6) {
      const a = a0 + amp * Math.sin(r / 70 + ph) + 0.05 * (vnoise(r / 25, a0 * 3, 5) - 0.5);
      pts.push([plaza.x + Math.cos(a) * r, plaza.z * (1 - r / 360) + Math.sin(a) * r]);
    }
    radials.push(addStreet(pts, rng.range(7, 9), 'street'));
  }
  // --- middle ring streets (arcs, some segments omitted) ---
  const ringStreet = (r0, w, sd, skipP) => {
    const n = 220; let cur = [];
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r0 + 14 * (fbm(Math.cos(a) * 1.5 + sd, Math.sin(a) * 1.5, 3, sd) - 0.5) * 2;
      const p = [Math.cos(a) * rr, Math.sin(a) * rr + 20 * (1 - r0 / 360)];
      // gaps: omit short arcs deterministically (never across the avenue)
      const gap = vnoise(a * 2.2, sd, 91) < skipP && Math.abs(Math.cos(a)) > 0.25;
      if (gap) { if (cur.length > 3) out.push(cur); cur = []; } else cur.push(p);
    }
    if (cur.length > 3) out.push(cur);
    for (const pts of out) addStreet(pts, w, 'ring');
  };
  ringStreet(128, 8, 21, 0.18);
  ringStreet(236, 7.5, 37, 0.22);

  // --- lanes: subdivide blocks between radials with short curved lanes (radial + tangential) ---
  const bands = [[plaza.radius + 12, 128], [128, 236], [236, 338]];
  const angs = [...radialAngles, Math.PI / 2, Math.PI * 1.5].sort((a, b) => a - b);
  for (let bi = 0; bi < bands.length; bi++) {
    const [r0, r1] = bands[bi];
    const rm = (r0 + r1) / 2;
    for (let i = 0; i < angs.length; i++) {
      const aA = angs[i], aB = i + 1 < angs.length ? angs[i + 1] : angs[0] + Math.PI * 2;
      const arc = (aB - aA) * rm;
      const k = Math.max(0, Math.round(arc / 62) - 1);
      for (let j = 1; j <= k; j++) {
        const a = aA + (aB - aA) * (j / (k + 1)) + rng.range(-0.03, 0.03);
        const pts = [];
        const bend = rng.range(-0.12, 0.12);
        for (let r = r0 - 3; r <= r1 + 3; r += 5) { const t = (r - r0) / (r1 - r0); pts.push([Math.cos(a + bend * Math.sin(t * Math.PI)) * r, Math.sin(a + bend * Math.sin(t * Math.PI)) * r + 20 * (1 - r / 360)]); }
        if (rng.chance(0.88)) addStreet(pts, rng.range(4.2, 5.5), 'lane');
      }
      // tangential lane across the middle of the block when the band is deep
      if (r1 - r0 > 80 && rng.chance(0.8)) {
        const pts = [];
        const wob = rng.range(-8, 8);
        for (let a = aA - 0.01; a <= aB + 0.01; a += 4 / rm) pts.push([Math.cos(a) * (rm + wob * Math.sin((a - aA) / (aB - aA) * Math.PI)), Math.sin(a) * (rm + wob * Math.sin((a - aA) / (aB - aA) * Math.PI)) + 20 * (1 - rm / 360)]);
        if (pts.length > 2) addStreet(pts, rng.range(4.2, 5.2), 'lane');
      }
    }
  }
  // canal (after streets: water overrides the street raster; bridges handled separately)
  paint(canal.poly, canal.w + 2.4, 3);
  // bridges: where streets cross the canal
  const bridges = [];
  for (const s of streets) {
    for (let j = 1; j < s.poly.pts.length; j++) {
      const a = s.poly.pts[j - 1], b = s.poly.pts[j];
      for (let q = 1; q < canal.poly.pts.length; q++) {
        const c = canal.poly.pts[q - 1], d = canal.poly.pts[q];
        const hit = segInter(a, b, c, d);
        if (hit) {
          const [x, z] = hit;
          if (bridges.some((br) => Math.hypot(br.x - x, br.z - z) < 20)) continue;
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          bridges.push({ x, z, dx: (b[0] - a[0]) / L, dz: (b[1] - a[1]) / L, w: Math.min(s.w + 2, 18), span: canal.w + 5, street: s.id });
        }
      }
    }
  }
  // bridge decks are street again in the raster
  for (const br of bridges) {
    const hw = br.w / 2, hl = br.span / 2 + 1;
    for (let z = Math.floor(br.z - 20); z < br.z + 20; z++) for (let x = Math.floor(br.x - 20); x < br.x + 20; x++) {
      const dx = x + 0.5 - br.x, dz = z + 0.5 - br.z;
      const along = dx * br.dx + dz * br.dz, across = -dx * br.dz + dz * br.dx;
      if (Math.abs(along) <= hl && Math.abs(across) <= hw) { const c = cellIdx(x + 0.5, z + 0.5); if (c >= 0) street[c] = 1; }
    }
  }

  // ---------------- reserved special buildings ----------------
  const specials = [];
  const lots = [];
  const reserve = (lot) => {
    lot.id = lots.length; lots.push(lot);
    rasterLot(lot, (c) => { occ[c] = lot.id; });
    return lot;
  };
  // church: east side of the plaza, nave along x, tower facing the plaza (west)
  const church = reserve({ kind: 'church', x: plaza.x + 38, z: plaza.z + 2, a: Math.PI / 2, w: 17, d: 46, floors: 0 });
  specials.push(church);
  // clear the church footprint of plaza marks so it is solid
  // town hall: west side of the plaza facing east
  const hall = reserve({ kind: 'townhall', x: plaza.x - 50, z: plaza.z + 4, a: -Math.PI / 2, w: 26, d: 16, floors: 3 });
  specials.push(hall);
  // garrison barracks near the outer gate, east of the avenue
  const barr = reserve({ kind: 'barracks', x: 53, z: 298, a: Math.PI / 2, w: 44, d: 30, floors: 3 });
  specials.push(barr);
  // gate towers / guard houses flanking the gate squares (west side)
  // baroque bell-tower church right inside the outer gate (reference: tower beside the wall)
  specials.push(reserve({ kind: 'gatechurch', x: -52, z: 306, a: -Math.PI / 2, w: 15, d: 32, floors: 0 }));
  specials.push(reserve({ kind: 'guard', x: 40, z: -318, a: Math.PI / 2, w: 20, d: 14, floors: 3 }));
  // flat vantage buildings 145-235 m in front of the breach, around the avenue (fight start / respawn perches)
  const vantage = [];
  const clearRect = (lot) => {
    let ok = true;
    rasterLot(lot, (c) => { if (street[c] !== 0 || occ[c] >= 0) ok = false; }, -1.0);
    return ok;
  };
  for (const t of [
    { kind: 'watchtower', x: -24, z: 226, w: 7.5, d: 7.5, top: 24 },
    { kind: 'guildflat', x: 27, z: 202, w: 16, d: 12, top: 15.2 },
    { kind: 'belfry', x: 30, z: 160, w: 8, d: 8, top: 27 },
    { kind: 'guildflat', x: -29, z: 170, w: 14, d: 11, top: 12.8 },
  ]) {
    let placed = null;
    for (let rad = 0; rad <= 36 && !placed; rad += 2) {
      const n = rad === 0 ? 1 : Math.round(rad * 1.5);
      for (let k = 0; k < n && !placed; k++) {
        const ang = (k / n) * Math.PI * 2;
        const x = t.x + Math.cos(ang) * rad, z = t.z + Math.sin(ang) * rad;
        const lot = { ...t, x, z, a: x < 0 ? -Math.PI / 2 : Math.PI / 2, floors: 0 };
        if (clearRect(lot)) placed = lot;
      }
    }
    if (placed) { specials.push(reserve(placed)); vantage.push(placed); }
  }

  // ---------------- lots along streets ----------------
  // inlined raster test with early exit (hot: ~40k calls)
  const lotFits = (lot, prev, allowOcc = 3) => {
    const ca = Math.cos(lot.a), sa = Math.sin(lot.a);
    const hw = lot.w / 2 - 0.35, hd = lot.d / 2 - 0.35;
    // corners + centre first: most rejections are street overlaps
    for (const [u, v] of [[0, 0], [hw, hd], [-hw, hd], [hw, -hd], [-hw, -hd], [0, hd], [0, -hd]]) {
      const c = cellIdx(lot.x + u * ca - v * sa, lot.z + u * sa + v * ca);
      if (c < 0 || street[c] !== 0) return false;
    }
    const ext = Math.abs(ca) * hw + Math.abs(sa) * hd, extz = Math.abs(sa) * hw + Math.abs(ca) * hd;
    let bad = 0;
    const z0 = Math.floor(lot.z - extz), z1 = lot.z + extz, x0 = Math.floor(lot.x - ext), x1 = lot.x + ext;
    for (let z = z0; z <= z1; z++) {
      const pz = z + 0.5 - lot.z;
      const row = (z + 0.5 - G.min) | 0;
      if (row < 0 || row >= G.n) return false;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - lot.x;
        const lx = px * ca + pz * sa, lz = -px * sa + pz * ca;
        if (lx > hw || lx < -hw || lz > hd || lz < -hd) continue;
        const col = (x + 0.5 - G.min) | 0;
        if (col < 0 || col >= G.n) return false;
        const c = row * G.n + col;
        if (street[c] !== 0) return false;
        const o = occ[c];
        if (o >= 0 && o !== prev && ++bad > allowOcc) return false;
      }
    }
    return true;
  };
  const order = ['avenue', 'ring', 'street', 'walllane', 'lane'];
  const plazaStreet = { poly: new Poly(plazaPts, true), w: 1.5, kind: 'plaza', id: streets.length };
  const frontages = [plazaStreet, ...streets.slice().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))];
  for (const st of frontages) {
    for (const side of [-1, 1]) {
      if (st.kind === 'plaza' && side === 1) continue;
      let s = rng.range(0, 3), prev = -1;
      const big = st.kind === 'avenue' || st.kind === 'plaza';
      while (s < st.poly.len - 3) {
        const w = big ? rng.range(7.5, 13) : st.kind === 'lane' ? rng.range(5, 8.5) : rng.range(5.5, 10.5);
        const [px, pz, tx, tz] = st.poly.at(s + w / 2);
        const nx = -tz * side, nz = tx * side; // away from the street
        const a = Math.atan2(nx, -nz);         // lot local +z faces the street
        const front = st.w / 2 + 0.25;
        let placed = null;
        const d0 = big ? rng.range(12, 17) : rng.range(9, 15);
        for (const d of [d0, d0 * 0.8, d0 * 0.62, 6.5]) {
          if (d < 6) continue;
          const lot = { kind: 'house', x: px + nx * (front + d / 2), z: pz + nz * (front + d / 2), a, w, d, street: st.id, main: big };
          if (lotFits(lot, prev)) { placed = lot; break; }
        }
        if (placed) {
          const L = reserve(placed); prev = L.id;
          s += w - rng.range(0, 0.2);
        } else { s += 1.5; prev = -1; }
      }
    }
  }
  // ---------------- back-lot fill (block interiors) ----------------
  // nearest-street direction on a 4 m grid (orients back buildings like their neighbours)
  const DN = 200, dirD = new Float32Array(DN * DN).fill(1e9), dirA = new Float32Array(DN * DN);
  for (const st of streets) {
    const p = st.poly.pts;
    for (let j = 1; j < p.length; j++) {
      const [ax, az] = p[j - 1], [bx, bz] = p[j];
      const ang = Math.atan2(bz - az, bx - ax);
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - 24 + 400) / 4)), i1 = Math.min(DN - 1, Math.floor((Math.max(ax, bx) + 24 + 400) / 4));
      const k0 = Math.max(0, Math.floor((Math.min(az, bz) - 24 + 400) / 4)), k1 = Math.min(DN - 1, Math.floor((Math.max(az, bz) + 24 + 400) / 4));
      for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
        const d = segDist(i * 4 - 398, k * 4 - 398, ax, az, bx, bz);
        if (d < dirD[k * DN + i]) { dirD[k * DN + i] = d; dirA[k * DN + i] = ang; }
      }
    }
  }
  const nearestStreetDir = (x, z) => dirA[clamp(Math.floor((z + 400) / 4), 0, DN - 1) * DN + clamp(Math.floor((x + 400) / 4), 0, DN - 1)];
  const yards = [];
  for (let t = 0; t < 9000; t++) {
    const r = Math.sqrt(rng.next()) * 355, th = rng.range(0, Math.PI * 2);
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    const c = cellIdx(x, z);
    if (c < 0 || street[c] !== 0 || occ[c] >= 0) continue;
    const dir = nearestStreetDir(x, z);
    const w = rng.range(5.5, 10), d = rng.range(6.5, 11);
    const lot = { kind: rng.chance(0.22) ? 'shed' : 'back', x, z, a: dir + (rng.chance(0.5) ? 0 : Math.PI / 2), w, d };
    if (lotFits(lot, -1, 0)) {
      // keep ~30% of the interior free as yards / gardens
      if (vnoise(x / 23, z / 23, 404) < 0.3) { yards.push([x, z]); continue; }
      reserve(lot);
    }
  }
  // trees in free yard cells (not street, not occupied), away from buildings
  const trees = [];
  for (let t = 0; t < 7000 && trees.length < 520; t++) {
    const r = Math.sqrt(rng.next()) * 360, th = rng.range(0, Math.PI * 2);
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    let ok = true;
    for (let dz = -3; dz <= 3 && ok; dz += 1.5) for (let dx = -3; dx <= 3 && ok; dx += 1.5) {
      const c = cellIdx(x + dx, z + dz); if (c < 0 || street[c] !== 0 || occ[c] >= 0) ok = false;
    }
    if (ok && !trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 5)) trees.push([x, z, rng.range(0.7, 1.25)]);
  }
  // plaza trees (a few lindens around the edge)
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.62 + i * 0.12);
    const x = plaza.x + Math.cos(a) * (plaza.radius - 9), z = plaza.z + Math.sin(a) * (plaza.radius - 9) * 0.9;
    if (Math.abs(x) > 12) trees.push([x, z, 1.15]);
  }

  return {
    streets, avenue, ring: ring3, radials, canal, bridges, plaza: { ...plaza, pts: plazaPts, poly: plazaPoly },
    lots, specials, vantage, trees, yards, street, occ, cellIdx,
  };
}

// rasterise a lot rectangle (local w along x, d along z, rotated by a about Y, centre x,z) -> callback(cellIndex)
export function rasterLot(lot, fn, shrink = 0) {
  const ca = Math.cos(lot.a), sa = Math.sin(lot.a);
  const hw = lot.w / 2 - shrink, hd = lot.d / 2 - shrink;
  const ext = Math.abs(ca) * hw + Math.abs(sa) * hd, extz = Math.abs(sa) * hw + Math.abs(ca) * hd;
  for (let z = Math.floor(lot.z - extz); z <= lot.z + extz; z++) for (let x = Math.floor(lot.x - ext); x <= lot.x + ext; x++) {
    const px = x + 0.5 - lot.x, pz = z + 0.5 - lot.z;
    // world -> local: lx = px*ca + pz*sa ; lz = -px*sa + pz*ca
    const lx = px * ca + pz * sa, lz = -px * sa + pz * ca;
    if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) { const c = cellIdx(x + 0.5, z + 0.5); if (c >= 0) fn(c, x + 0.5, z + 0.5); }
  }
}

export function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function segInter(a, b, c, d) {
  const r0 = b[0] - a[0], r1 = b[1] - a[1], s0 = d[0] - c[0], s1 = d[1] - c[1];
  const den = r0 * s1 - r1 * s0;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s1 - (c[1] - a[1]) * s0) / den;
  const u = ((c[0] - a[0]) * r1 - (c[1] - a[1]) * r0) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + r0 * t, a[1] + r1 * t];
}
