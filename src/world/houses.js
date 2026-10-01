// WORLD: Shiganshina houses. Timber-framed / plastered / stone houses with jettied upper floors, steep clay-tile
// roofs (gable to street or eaves to street), attic bands in the gables, dormers, chimneys; plus the church, town
// hall, garrison barracks and guard houses. Emits geometry into per-chunk GB builders and convex colliders.
import * as THREE from 'three';
import { Rng, lin, mixc, scalec } from './util.js';

export const MAT = { FACADE: 0, ROOF: 1, WOOD: 2, BRICK: 3, STONE: 4, IRON: 5, RUBBLE: 6 };
export const TS = { PLASTER: 0, TIMBER: 1, TIMBER_RICH: 2, TIMBER_DENSE: 3, STONE: 4, CHURCH: 5 };
const bitsOf = (fl, ts, wst, { gable = false, side = false, door = false, shop = false, mask = 0 } = {}) =>
  fl + 8 * ts + 64 * wst + 256 * ((gable ? 1 : 0) | (side ? 2 : 0) | (door ? 4 : 0) | (shop ? 8 : 0)) + 4096 * (mask & 4095);
let DECOR = null;
// window mask for a face of nb bays from a per-house column pattern (bit i = bay i has a window)
function maskOf(cols, nb, r, p) {
  let m = 0;
  for (let i = 0; i < Math.min(nb, 12); i++) if (cols[i % cols.length] && r.chance(p)) m |= 1 << i;
  if (!m && nb > 0) m = 1 << Math.floor(nb / 2);
  return m;
}
// flower boxes under the windows of a face (local frame of the house): A -> B along the face, outward normal n
function flowerBoxes(gb, mask, nb, bay, ax, az, ux, uz, nx, nz, ySill, ww, r) {
  for (let i = 0; i < Math.min(nb, 12); i++) {
    if (!(mask & (1 << i)) || !r.chance(0.55)) continue;
    const u = (i + 0.5) * bay;
    const lx = ax + ux * u + nx * 0.13, lz = az + uz * u + nz * 0.13;
    DECOR.flowers.push({ x: gb.wx(lx, lz), y: ySill, z: gb.wz(lx, lz), a: Math.atan2(-(uz * gb.ca + ux * gb.sa), ux * gb.ca - uz * gb.sa), w: ww + 0.12, c: r.int(0, 3) });
  }
}

// lively Rothenburg / anime plaster colours (cream, ochre, butter yellow, pale rose, salmon, sky blue-grey, sage, white)
const PLASTER = [0xf4e8cc, 0xecc98a, 0xf1dc92, 0xeec6b8, 0xf6f2e8, 0xd6e0e4, 0xe9b595, 0xdfe2c8, 0xf2dcae, 0xe6d2c0, 0xf7e2a8, 0xd9c6e0].map(lin);
// clean fired terracotta with a few darker / browner roofs
const ROOFS = [0xb0502e, 0x9c4428, 0xbf6236, 0xa84a2c, 0x8a4630, 0xc8703e, 0x93402a, 0x7e4a38].map(lin);
const STONE_T = [0xb8ab94, 0xa89c88, 0xc2b69e, 0x9a9080].map(lin);

// build one lot into gb (its chunk builder); returns the building record (id = lot.id + 1, 0 = never collapses)
export function buildLot(plan, lot, gb, solids, decor) {
  DECOR = decor;
  const id = lot.id + 1;
  const b = { id, lot, kind: lot.kind, destroyed: false, hp: 1, solids: [], box: new THREE.Box3(), center: new THREE.Vector3(), height: 0 };
  gb.set({ id });
  const r = new Rng(1000 + lot.id * 7919);
  let info;
  if (lot.kind === 'church') info = buildChurch(gb, lot, r, solids, b);
  else if (lot.kind === 'townhall') info = buildHall(gb, lot, r, solids, b, true);
  else if (lot.kind === 'barracks') info = buildBarracks(gb, lot, r, solids, b);
  else if (lot.kind === 'guard') info = buildHall(gb, lot, r, solids, b, false);
  else if (lot.kind === 'gatechurch') info = buildGateChurch(gb, lot, r, solids, b);
  else if (lot.kind === 'guildflat') info = buildGuildFlat(gb, lot, r, solids, b);
  else if (lot.kind === 'watchtower' || lot.kind === 'belfry') info = buildLookoutTower(gb, lot, r, solids, b);
  else info = buildHouse(gb, lot, r, solids, b);
  gb.frame();
  b.height = info.height;
  b.center.set(lot.x, info.height / 2, lot.z);
  const ext = Math.hypot(lot.w, lot.d) / 2 + 1;
  b.box.set(new THREE.Vector3(lot.x - ext, 0, lot.z - ext), new THREE.Vector3(lot.x + ext, info.height, lot.z + ext));
  b.radius = ext;
  b.foot = info.foot;
  b.chimneys = info.chimneys || [];
  return b;
}

export function buildTown(plan, gbFor, solids) {
  const buildings = [];
  buildings.decor = { flowers: [], lanterns: [] };
  for (const lot of plan.lots) buildings.push(buildLot(plan, lot, gbFor(lot.x, lot.z), solids, buildings.decor));
  return buildings;
}

// ---------------------------------------------------------------------------------------------------------------
function roofGeom(gb, o) {
  // o: {axis: 0 (ridge along local x) | 2 (along z), x0,x1,z0,z1 (wall footprint), y (eave wall top), pitch, eave, verge,
  //     tint, slate, hip (0..0.45: half-hip / Kruppelwalm cut as a fraction of the roof height)}
  // Built in a canonical frame (ridge along a, slopes facing +-b) and mapped to the house frame; the axis-2 mapping is a
  // mirror, so polygon orders are reversed there. Sets o.hipY (top of the gable walls).
  const { axis, x0, x1, z0, z1, y, pitch, eave = 0.45, verge = 0.32, tint, slate = false, hip = 0 } = o;
  const A0 = axis === 0 ? x0 : z0, A1 = axis === 0 ? x1 : z1, B0 = axis === 0 ? z0 : x0, B1 = axis === 0 ? z1 : x1;
  const map = axis === 0 ? (p) => p : (p) => [p[2], p[1], p[0]];
  const poly = (pts, o = null) => gb.poly(axis === 0 ? pts : pts.map(map).reverse(), o ? map(o) : null);
  const tp = Math.tan(pitch);
  const th = 0.34; // roof build-up: rafters + battens + tiles -> visible eave / verge thickness
  const bc = (B0 + B1) / 2, hs = (B1 - B0) / 2;
  const ridgeY = y + hs * tp, ye = y - eave * tp;
  const aa = A0 - verge, ab = A1 + verge, bF = B1 + eave, bB = B0 - eave;
  const hipY = hip > 0 ? y + (ridgeY - y) * (1 - hip) : ridgeY;
  const dh = hip > 0 ? (ridgeY - hipY) / tp : 0;
  const cF = bc + (ridgeY - hipY) / tp, cB = bc - (ridgeY - hipY) / tp;
  gb.set({ mat: 1, p0: 0, p1: 0, p2: 0, p3: slate ? 2 : 0, col: tint });
  // uv origin at the eave corner of each slope: tile courses start at the eave and continue across the hip cut
  const oF = axis === 0 ? [aa, ye, bF] : [ab, ye, bF], oB = axis === 0 ? [ab, ye, bB] : [aa, ye, bB];
  poly([[aa, ye, bF], [ab, ye, bF], [ab, hipY, cF], [aa, hipY, cF]], oF);
  poly([[ab, ye, bB], [aa, ye, bB], [aa, hipY, cB], [ab, hipY, cB]], oB);
  if (hip > 0) {
    poly([[aa, hipY, cF], [ab, hipY, cF], [ab - dh, ridgeY, bc], [aa + dh, ridgeY, bc]], oF);
    poly([[ab, hipY, cB], [aa, hipY, cB], [aa + dh, ridgeY, bc], [ab - dh, ridgeY, bc]], oB);
    poly([[ab, hipY, cF], [ab, hipY, cB], [ab - dh, ridgeY, bc]]);
    poly([[aa, hipY, cB], [aa, hipY, cF], [aa + dh, ridgeY, bc]]);
  }
  // undersides (dark rafters), fascia boards, bargeboards
  gb.set({ mat: 2, p3: 0, col: scalec(lin(0x5a3a26), 0.55) });
  poly([[ab, ye - th, bF], [aa, ye - th, bF], [aa, hipY - th, cF], [ab, hipY - th, cF]]);
  poly([[aa, ye - th, bB], [ab, ye - th, bB], [ab, hipY - th, cB], [aa, hipY - th, cB]]);
  gb.set({ col: scalec(lin(0x4a3020), 0.8) });
  poly([[aa, ye - th, bF], [ab, ye - th, bF], [ab, ye, bF], [aa, ye, bF]]);
  poly([[ab, ye - th, bB], [aa, ye - th, bB], [aa, ye, bB], [ab, ye, bB]]);
  poly([[ab, ye - th, bF], [ab, hipY - th, cF], [ab, hipY, cF], [ab, ye, bF]]);
  poly([[ab, hipY - th, cB], [ab, ye - th, bB], [ab, ye, bB], [ab, hipY, cB]]);
  poly([[aa, hipY - th, cF], [aa, ye - th, bF], [aa, ye, bF], [aa, hipY, cF]]);
  poly([[aa, ye - th, bB], [aa, hipY - th, cB], [aa, hipY, cB], [aa, ye, bB]]);
  if (hip > 0) {
    poly([[A1, hipY - 0.06, cB], [ab, hipY - 0.06, cB], [ab, hipY - 0.06, cF], [A1, hipY - 0.06, cF]]);
    poly([[aa, hipY - 0.06, cB], [A0, hipY - 0.06, cB], [A0, hipY - 0.06, cF], [aa, hipY - 0.06, cF]]);
  }
  // ridge cap (half-round tiles), and on hips along the hip edges
  gb.set({ mat: 1, p3: 1, col: scalec(tint, 0.85) });
  const rc = 0.19, rr = 0.17;
  const ra = aa + dh, rb = ab - dh;
  poly([[ra, ridgeY - 0.03, bc + rc], [rb, ridgeY - 0.03, bc + rc], [rb, ridgeY + rr, bc], [ra, ridgeY + rr, bc]]);
  poly([[rb, ridgeY - 0.03, bc - rc], [ra, ridgeY - 0.03, bc - rc], [ra, ridgeY + rr, bc], [rb, ridgeY + rr, bc]]);
  if (hip > 0) {
    for (const [ea, ra2] of [[ab, rb], [aa, ra]]) {
      for (const [ce, sgn] of [[cF, 1], [cB, -1]]) {
        const s = ea > ra2 ? 1 : -1;
        const q = [[ea, hipY + 0.05, ce], [ra2, ridgeY + 0.05, bc], [ra2, ridgeY + rr, bc], [ea, hipY + rr, ce]];
        poly(q); poly(q.slice().reverse());
        void s; void sgn;
      }
    }
  }
  o.hipY = hipY;
  return ridgeY;
}

// gable end: stack of trapezoid bands with facade pattern (bays aligned with the wall below)
function gableGeom(gb, { ax, az, bx, bz, y, rise, bayW, ts, wst, fh = 2.7, jettyN = 0, nx = 0, nz = 0, cut = rise }) {
  // A (left) -> B (right) seen from outside; the gable apex is above the midpoint
  const W = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / W, uz = (bz - az) / W;
  let yb = y;
  let k = 0;
  while (yb < y + cut - 0.05) {
    const yt = Math.min(y + cut, yb + fh);
    const inset = (h) => ((h - y) / rise) * (W / 2);
    const i0 = inset(yb), i1 = inset(yt);
    const off = jettyN * (k + 1);
    const ox = nx * off, oz = nz * off;
    const P = [
      [ax + ux * i0 + ox, yb, az + uz * i0 + oz], [bx - ux * i0 + ox, yb, bz - uz * i0 + oz],
      [bx - ux * i1 + ox, yt, bz - uz * i1 + oz], [ax + ux * i1 + ox, yt, az + uz * i1 + oz],
    ];
    gb.set({ mat: 0, p0: W, p1: yt - yb, p2: bayW, p3: bitsOf(k + 3, ts, wst, { gable: true }) });
    if (i1 >= W / 2 - 0.01) gb.poly([P[0], P[1], P[2]], [ax + ox, yb, az + oz]);
    else gb.poly(P, [ax + ox, yb, az + oz]);
    yb = yt; k++;
  }
}

function chimney(gb, x, z, yBase, yTop, s = 0.38) {
  gb.set({ mat: 3, p0: 0, p1: 0, p2: yTop - yBase, p3: 0, col: lin(0x9a5a44) });
  gb.box(x - s, yBase, z - s * 1.25, x + s, yTop, z + s * 1.25, 1 | 2 | 16 | 32);
  // corbelled brick band + stone cap slab
  gb.box(x - s - 0.06, yTop - 0.35, z - s * 1.25 - 0.06, x + s + 0.06, yTop - 0.2, z + s * 1.25 + 0.06, 63);
  gb.set({ mat: 4, p2: 0.2, col: lin(0x77706a) });
  gb.box(x - s - 0.1, yTop, z - s * 1.25 - 0.1, x + s + 0.1, yTop + 0.14, z + s * 1.25 + 0.1, 63);
  // clay pots (sooty rims)
  const h = ((x * 13.1 + z * 7.7) % 1 + 1) % 1;
  if (h < 0.6) {
    gb.set({ mat: 3, p2: 0.45, col: lin(0x8a4a34) });
    gb.cyl(x, z - s * 0.5, yTop + 0.14, yTop + 0.55, 0.13, 0.1, 6, false);
    if (h < 0.3) gb.cyl(x, z + s * 0.5, yTop + 0.14, yTop + 0.5, 0.13, 0.1, 6, false);
  }
}

function dormer(gb, { x, zEave, yEave, pitch, dir, w, tint, ts, wst, plaster }) {
  // dormer on a slope whose eave line is at z = zEave (local), slope rising towards -dir*z
  const tp = Math.tan(pitch);
  const hw = w / 2;
  const up = 1.2 + 0.25; // front wall height
  const zF = zEave - dir * 0.9;          // dormer front, set back from the eave
  const yF = yEave + 0.9 * tp - 0.1;     // roof surface height at the front
  const depth = (up + 0.6) / tp + 0.3;   // run back until it meets the slope
  const zB = zF - dir * depth;
  // front wall (facade with one window)
  gb.set({ mat: 0, p0: w, p1: up, p2: w, p3: bitsOf(2, ts === 0 ? 0 : 0, wst), col: plaster });
  if (dir > 0) gb.wall(x - hw, zF, x + hw, zF, yF, yF + up); else gb.wall(x + hw, zF, x - hw, zF, yF, yF + up);
  // cheeks
  gb.set({ mat: 2, p3: 0, col: scalec(lin(0x4a3322), 0.8) });
  const yTop = yF + up;
  if (dir > 0) {
    gb.poly([[x + hw, yF, zF], [x + hw, yTop, zB], [x + hw, yTop, zF]]);
    gb.poly([[x - hw, yF, zF], [x - hw, yTop, zF], [x - hw, yTop, zB]]);
  } else {
    gb.poly([[x - hw, yF, zF], [x - hw, yTop, zB], [x - hw, yTop, zF]]);
    gb.poly([[x + hw, yF, zF], [x + hw, yTop, zF], [x + hw, yTop, zB]]);
  }
  // little gable roof (ridge along z)
  const rp = pitch * 0.95, rt = Math.tan(rp), e = 0.2;
  const ry = yTop + (hw + e * 0.5) * rt * 0.9;
  gb.set({ mat: 1, p3: 0, col: tint });
  const zf2 = zF + dir * 0.25;
  if (dir > 0) {
    gb.poly([[x + hw + e, yTop - e * rt * 0.5, zf2], [x + hw + e, yTop - e * rt * 0.5, zB], [x, ry, zB], [x, ry, zf2]]);
    gb.poly([[x - hw - e, yTop - e * rt * 0.5, zB], [x - hw - e, yTop - e * rt * 0.5, zf2], [x, ry, zf2], [x, ry, zB]]);
    gb.set({ mat: 0, p0: w, p1: ry - yTop, p2: w, p3: bitsOf(4, ts, wst, { gable: true }), col: plaster });
    gb.poly([[x - hw, yTop, zF], [x + hw, yTop, zF], [x, ry - 0.05, zF]]);
    const yl = yTop - e * rt * 0.5;
    gb.set({ mat: 2, p3: 0, col: scalec(lin(0x4a3020), 0.8) });
    gb.poly([[x - hw - e, yl - 0.15, zf2], [x, ry - 0.15, zf2], [x, ry, zf2], [x - hw - e, yl, zf2]]);
    gb.poly([[x, ry - 0.15, zf2], [x + hw + e, yl - 0.15, zf2], [x + hw + e, yl, zf2], [x, ry, zf2]]);
  } else {
    gb.poly([[x - hw - e, yTop - e * rt * 0.5, zf2], [x - hw - e, yTop - e * rt * 0.5, zB], [x, ry, zB], [x, ry, zf2]]);
    gb.poly([[x + hw + e, yTop - e * rt * 0.5, zB], [x + hw + e, yTop - e * rt * 0.5, zf2], [x, ry, zf2], [x, ry, zB]]);
    gb.set({ mat: 0, p0: w, p1: ry - yTop, p2: w, p3: bitsOf(4, ts, wst, { gable: true }), col: plaster });
    gb.poly([[x + hw, yTop, zF], [x - hw, yTop, zF], [x, ry - 0.05, zF]]);
    const yl = yTop - e * rt * 0.5;
    gb.set({ mat: 2, p3: 0, col: scalec(lin(0x4a3020), 0.8) });
    gb.poly([[x + hw + e, yl - 0.15, zf2], [x, ry - 0.15, zf2], [x, ry, zf2], [x + hw + e, yl, zf2]]);
    gb.poly([[x, ry - 0.15, zf2], [x - hw - e, yl - 0.15, zf2], [x - hw - e, yl, zf2], [x, ry, zf2]]);
  }
}

// ---------------------------------------------------------------------------------------------------------------
function buildHouse(gb, lot, r, solids, b) {
  const main = !!lot.main;
  const back = lot.kind === 'back', shed = lot.kind === 'shed';
  const W = lot.w, D = lot.d;
  const setback = r.range(-0.3, 0.2);
  gb.frame(lot.x, 0, lot.z, lot.a);
  const nFl = shed ? r.int(1, 2) : back ? r.int(2, 3) : main ? r.wpick([[2, 3], [4, 4], [2, 5]]) : r.wpick([[2, 2], [5, 3], [3, 4], [0.6, 5]]);
  const timber = !shed && r.chance(main ? 0.62 : 0.55);
  const tsUp = timber ? r.wpick([[4, TS.TIMBER], [3, TS.TIMBER_RICH], [1.2, TS.TIMBER_DENSE]]) : TS.PLASTER;
  const tsGround = shed ? TS.TIMBER : r.wpick([[timber ? 2 : 4, TS.PLASTER], [main ? 3 : 1.5, TS.STONE], [timber ? 2.5 : 0.5, tsUp]]);
  const wst = r.wpick([[5, 0], [2.5, 1], [1.3, 2], [0.8, 3]]);
  const plaster = scalec(r.pick(PLASTER), r.range(0.9, 1.0));
  const stoneTint = scalec(r.pick(STONE_T), r.range(0.8, 1.0));
  const roofTint = scalec(r.pick(ROOFS), r.range(0.9, 1.1));
  const jetty = timber ? r.range(0.3, 0.5) : r.chance(0.3) ? 0.18 : 0;
  const backJetty = timber && r.chance(0.4);
  const gableFront = W < 9.5 ? r.chance(0.62) : r.chance(0.25);
  const pitch = (r.range(50, 60) * Math.PI) / 180;
  const fh0 = shed ? r.range(2.8, 3.4) : r.range(3.3, 3.9), fhU = r.range(2.75, 3.1);
  const bayTarget = timber ? r.range(1.15, 1.45) : r.range(2.2, 2.8);
  const zf0 = D / 2 + setback, zb0 = -D / 2;
  let y = 0;
  let top = null;
  // per-house window columns (windows line up floor to floor like real facades)
  const colsF = [], colsB = [], colsS = [];
  for (let i = 0; i < 12; i++) { colsF.push(r.chance(timber ? 0.8 : 0.9)); colsB.push(r.chance(0.6)); colsS.push(r.chance(0.35)); }
  const flowers = !shed && r.chance(timber ? 0.45 : 0.6);
  for (let fl = 0; fl < nFl; fl++) {
    const fh = fl === 0 ? fh0 : fhU;
    const jf = fl * jetty, jb = backJetty ? fl * jetty * 0.7 : 0;
    const x0 = -W / 2, x1 = W / 2, z0 = zb0 - jb, z1 = zf0 + jf;
    const ts = fl === 0 ? tsGround : tsUp;
    const tint = ts === TS.STONE ? stoneTint : plaster;
    const fw = x1 - x0, fd = z1 - z0;
    const bayF = fw / Math.max(1, Math.round(fw / (ts === TS.STONE ? bayTarget * 1.6 : bayTarget)));
    const bayS = fd / Math.max(1, Math.round(fd / (ts === TS.STONE ? bayTarget * 1.6 : bayTarget * 1.2)));
    gb.set({ mat: 0, col: tint, p1: fh });
    const nbF = Math.max(1, Math.round(fw / bayF)), nbS = Math.max(1, Math.round(fd / bayS));
    const mF = maskOf(colsF, nbF, r, 0.93), mB = maskOf(colsB, nbF, r, 0.9), mL = maskOf(colsS, nbS, r, 0.9), mR = maskOf(colsS.slice().reverse(), nbS, r, 0.9);
    // front
    gb.set({ p0: fw, p2: bayF, p3: bitsOf(fl, ts, wst, { door: fl === 0 && !shed, mask: mF }) });
    gb.wall(x0, z1, x1, z1, y, y + fh);
    // back
    gb.set({ p3: bitsOf(fl, ts, wst, { door: fl === 0 && (shed || r.chance(0.3)), mask: mB }) });
    gb.wall(x1, z0, x0, z0, y, y + fh);
    // sides (party walls: few windows)
    gb.set({ p0: fd, p2: bayS, p3: bitsOf(fl, ts, wst, { side: true, mask: mR }) });
    gb.wall(x1, z1, x1, z0, y, y + fh);
    gb.set({ p3: bitsOf(fl, ts, wst, { side: true, mask: mL }) });
    gb.wall(x0, z0, x0, z1, y, y + fh);
    if (flowers && fl > 0 && ts !== TS.STONE) {
      const tim = ts >= 1 && ts <= 3;
      const ww = tim ? Math.min(bayF - 0.33, 1.05) : Math.min(0.95, bayF * 0.4);
      const ys = y + (tim ? 0.88 : 0.92) - 0.02;
      flowerBoxes(gb, mF, nbF, bayF, x0, z1, 1, 0, 0, 1, ys, ww, r);
    }
    // jetty: joist band + soffit under the overhang
    if (fl > 0 && jetty > 0) {
      const zPrev = zf0 + (fl - 1) * jetty;
      gb.set({ mat: 2, p0: 0, p1: 0, p2: 0, p3: 1, col: woodTint(wst) });
      gb.wall(x0, z1 + 0.04, x1, z1 + 0.04, y - 0.3, y + 0.02);
      gb.set({ p3: 0 });
      gb.poly([[x0, y - 0.3, zPrev], [x1, y - 0.3, zPrev], [x1, y - 0.3, z1 + 0.04], [x0, y - 0.3, z1 + 0.04]]);
      if (backJetty) {
        const zbPrev = zb0 - (fl - 1) * jetty * 0.7;
        gb.set({ p3: 1 }); gb.wall(x1, z0 - 0.04, x0, z0 - 0.04, y - 0.3, y + 0.02);
        gb.set({ p3: 0 }); gb.poly([[x0, y - 0.3, z0 - 0.04], [x1, y - 0.3, z0 - 0.04], [x1, y - 0.3, zbPrev], [x0, y - 0.3, zbPrev]]);
      }
    }
    top = { x0, x1, z0, z1, bayF, bayS, ts };
    y += fh;
  }
  // string course / eave cornice under the roof
  const { x0, x1, z0, z1 } = top;
  gb.set({ mat: 2, p0: 0, p1: 0, p2: 0, p3: 0, col: woodTint(wst) });
  gb.box(x0 - 0.06, y - 0.16, z0 - 0.06, x1 + 0.06, y + 0.02, z1 + 0.06, 1 | 2 | 16 | 32);
  // roof
  const axis = gableFront ? 2 : 0;
  const slate = !shed && r.chance(0.07);
  const hip = !shed && r.chance(0.22) ? r.range(0.18, 0.3) : 0;
  const ro = { axis, x0, x1, z0, z1, y, pitch, tint: slate ? lin(0x3e4146) : roofTint, slate, eave: r.range(0.4, 0.65), verge: r.range(0.3, 0.45), hip };
  const ridgeY = roofGeom(gb, ro);
  const rise = ridgeY - y, cut = ro.hipY - y;
  const gts = timber ? tsUp : TS.PLASTER;
  const jN = 0;
  gb.set({ col: plaster });
  if (axis === 0) {
    // gables at +x (right, facing +x) and -x
    gableGeom(gb, { ax: x1, az: z1, bx: x1, bz: z0, y, rise, cut, bayW: top.bayS, ts: gts, wst });
    gableGeom(gb, { ax: x0, az: z0, bx: x0, bz: z1, y, rise, cut, bayW: top.bayS, ts: gts, wst });
  } else {
    gableGeom(gb, { ax: x0, az: z1, bx: x1, bz: z1, y, rise, cut, bayW: top.bayF, ts: gts, wst, jettyN: jN, nx: 0, nz: 1 });
    gableGeom(gb, { ax: x1, az: z0, bx: x0, bz: z0, y, rise, cut, bayW: top.bayF, ts: gts, wst });
    // hoist beam with pulley block under the front gable apex (goods lifted to the attic)
    if (!hip && r.chance(0.4) && rise > 4) {
      const hy = y + rise * 0.78;
      gb.set({ mat: 2, p3: 0, col: woodTint(wst) });
      gb.box(-0.14, hy - 0.16, z1 - 0.4, 0.14, hy + 0.16, z1 + 1.3, 63);
      gb.set({ mat: 5, col: lin(0x222018) });
      gb.box(-0.1, hy - 0.5, z1 + 1.0, 0.1, hy - 0.16, z1 + 1.2, 63);
      gb.box(-0.012, hy - 3.5, z1 + 1.09, 0.012, hy - 0.5, z1 + 1.11, 1 | 2 | 16 | 32);
    }
  }
  // dormers
  const tp = Math.tan(pitch);
  if (!shed && rise > 3.2) {
    if (axis === 0) {
      const n = Math.max(0, Math.min(3, Math.floor((x1 - x0) / 3.6) - (r.chance(0.35) ? 1 : 0)));
      for (let i = 0; i < n; i++) {
        const x = x0 + (x1 - x0) * ((i + 0.5) / n) + r.range(-0.3, 0.3);
        dormer(gb, { x, zEave: z1, yEave: y, pitch, dir: 1, w: r.range(1.5, 2.1), tint: roofTint, ts: gts, wst, plaster });
      }
      if (r.chance(0.5)) {
        const x = r.range(x0 + 1.5, x1 - 1.5);
        dormer(gb, { x, zEave: z0, yEave: y, pitch, dir: -1, w: r.range(1.3, 1.7), tint: roofTint, ts: gts, wst, plaster });
      }
    }
  }
  // chimneys
  const chimneys = [];
  const nCh = shed ? 0 : r.int(1, 2);
  for (let i = 0; i < nCh; i++) {
    let cx, cz, yb;
    if (axis === 0) { cx = r.range(x0 + 1, x1 - 1); cz = (z0 + z1) / 2 + r.range(-1.2, 1.2); yb = y + (Math.abs(z1 - z0) / 2 - Math.abs(cz - (z0 + z1) / 2)) * tp - 0.5; }
    else { cz = r.range(z0 + 1.2, z1 - 1.2); cx = (x0 + x1) / 2 + r.range(-1.2, 1.2); yb = y + (Math.abs(x1 - x0) / 2 - Math.abs(cx - (x0 + x1) / 2)) * tp - 0.5; }
    const yt = ridgeY + r.range(0.6, 1.5);
    chimney(gb, cx, cz, yb, yt);
    chimneys.push([gb.wx(cx, cz), yt, gb.wz(cx, cz)]);
  }
  // colliders: body box (max footprint) + roof prism
  const cxL = 0, czL = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  const wcx = gb.wx(cxL, czL), wcz = gb.wz(cxL, czL);
  b.solids.push(solids.addBox(wcx, y / 2, wcz, hx, y / 2, hz, lot.a, 'building', b));
  b.solids.push(solids.addRoof(wcx, wcz, lot.a, y - 0.05, ridgeY, axis, (axis === 0 ? hx : hz) + 0.3, (axis === 0 ? hz : hx) + 0.45, 'building', b));
  b.eaveY = y; b.ridgeY = ridgeY; b.floors = nFl; b.roofTint = roofTint; b.plaster = plaster; b.timber = timber; b.wst = wst;
  return { height: ridgeY + 1, foot: { hx, hz, cz: czL }, chimneys };
}

function woodTint(wst) { return [lin(0x3a2416), lin(0x55351f), lin(0x6e2418), lin(0x33302c)][wst]; }

// ---------------------------------------------------------------------------------------------------------------
function buildChurch(gb, lot, r, solids, b) {
  gb.frame(lot.x, 0, lot.z, lot.a);
  // local: nave along z (front/tower at +z facing the plaza), width along x
  const W = 16, L = 34, H = 15;
  const stone = lin(0xb9ac93), stoneD = lin(0x9e927c);
  const z1 = lot.d / 2 - 9, z0 = z1 - L; // tower occupies z1..z1+9
  const x0 = -W / 2, x1 = W / 2;
  gb.set({ mat: 0, col: stone, p1: H });
  const bayN = 6;
  // nave walls (church style, lancet windows)
  gb.set({ p0: L, p2: L / bayN, p3: bitsOf(0, TS.CHURCH, 0, { side: false }) });
  gb.wall(x1, z1, x1, z0, 0, H);
  gb.wall(x0, z0, x0, z1, 0, H);
  gb.set({ p0: W, p2: W / 3, p3: bitsOf(0, TS.CHURCH, 0) });
  gb.wall(x0, z1, x1, z1, 0, H);
  // apse (half octagon at the back)
  const ar = W / 2;
  const apse = [];
  for (let i = 0; i <= 4; i++) { const a = Math.PI + (i / 4) * Math.PI; apse.push([Math.cos(a) * ar, z0 + Math.sin(a) * ar * 1.0]); }
  for (let i = 0; i < 4; i++) {
    const [ax, az] = apse[i], [bx, bz] = apse[i + 1];
    const w = Math.hypot(bx - ax, bz - az);
    gb.set({ p0: w, p2: w, p3: bitsOf(0, TS.CHURCH, 0) });
    gb.set({ p0: w + 2, p2: (w + 2) / 3 });
    gb.wall(bx, bz, ax, az, 0, H);
  }
  // buttresses
  gb.set({ mat: 4, p2: 0.42, col: stoneD });
  for (let i = 0; i <= bayN; i++) {
    const z = z0 + (i / bayN) * L;
    for (const s of [-1, 1]) {
      const xw = s * W / 2;
      gb.box(Math.min(xw, xw + s * 1.4), 0, z - 0.6, Math.max(xw, xw + s * 1.4), H * 0.8, z + 0.6, 63 & ~8);
      gb.box(Math.min(xw, xw + s * 0.8), H * 0.8, z - 0.5, Math.max(xw, xw + s * 0.8), H + 0.6, z + 0.5, 63 & ~8);
    }
  }
  // cornice
  gb.box(x0 - 0.25, H - 0.3, z0, x1 + 0.25, H + 0.1, z1, 1 | 2 | 4);
  // nave roof (steep, dark tiles) ridge along z
  const pitch = (58 * Math.PI) / 180;
  const ridge = roofGeom(gb, { axis: 2, x0, x1, z0: z0 - 0.2, z1, y: H, pitch, tint: lin(0x6a3b2c), eave: 0.5, verge: 0.2 });
  gableGeom(gb, { ax: x1, az: z0 - 0.2, bx: x0, bz: z0 - 0.2, y: H, rise: ridge - H, bayW: W / 3, ts: TS.STONE, wst: 0 });
  // apse roof: half cone as fan of triangles
  gb.set({ mat: 1, p3: 0, col: lin(0x6a3b2c) });
  const ay = H + ar * Math.tan(pitch) * 0.9;
  for (let i = 0; i < 4; i++) {
    const [ax, az] = apse[i], [bx, bz] = apse[i + 1];
    const e = 1.08;
    gb.poly([[bx * e, H - 0.2, z0 + (bz - z0) * e], [ax * e, H - 0.2, z0 + (az - z0) * e], [0, ay, z0]]);
  }
  // ---- tower at the front ----
  const T = 9, tz0 = z1, tz1 = z1 + T, tx0 = -T / 2, tx1 = T / 2;
  const TH = 30;
  const levels = [[0, 9, TS.STONE], [9, 18, TS.CHURCH], [18, TH, TS.CHURCH]];
  for (const [ya, yb, ts] of levels) {
    gb.set({ mat: 0, col: stone, p0: T, p1: yb - ya, p2: T / (ts === TS.CHURCH ? 3 : 3), p3: bitsOf(ya === 0 ? 0 : 1, ts, 0, { door: ya === 0 }) });
    gb.wall(tx0, tz1, tx1, tz1, ya, yb); gb.wall(tx1, tz0, tx0, tz0, ya, yb);
    gb.wall(tx1, tz1, tx1, tz0, ya, yb); gb.wall(tx0, tz0, tx0, tz1, ya, yb);
    gb.set({ mat: 4, p2: 0.4, col: stoneD });
    gb.box(tx0 - 0.3, yb - 0.35, tz0 - 0.3, tx1 + 0.3, yb + 0.05, tz1 + 0.3, 63 & ~8);
  }
  // corner buttresses of the tower
  gb.set({ mat: 4, p2: 0.42, col: stoneD });
  for (const [sx, sz] of [[tx0, tz0], [tx1, tz0], [tx0, tz1], [tx1, tz1]]) gb.box(sx - 0.8, 0, sz - 0.8, sx + 0.8, 20, sz + 0.8, 63 & ~8);
  // spire: octagonal slate spire with 4 small corner pinnacles
  const sy0 = TH, sy1 = TH + 24;
  gb.set({ mat: 1, p3: 2, col: lin(0x3f4a4c) });
  const sr = T / 2 + 0.2, n = 8;
  const zc = (tz0 + tz1) / 2;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + Math.PI / 8, a1 = ((i + 1) / n) * Math.PI * 2 + Math.PI / 8;
    gb.poly([[Math.cos(a1) * sr, sy0, zc + Math.sin(a1) * sr], [Math.cos(a0) * sr, sy0, zc + Math.sin(a0) * sr], [0, sy1, zc]]);
  }
  for (const [sx, sz] of [[tx0 + 0.6, tz0 + 0.6], [tx1 - 0.6, tz0 + 0.6], [tx0 + 0.6, tz1 - 0.6], [tx1 - 0.6, tz1 - 0.6]]) {
    gb.set({ mat: 4, p2: 0.3, col: stoneD }); gb.box(sx - 0.5, TH, sz - 0.5, sx + 0.5, TH + 2.2, sz + 0.5, 63 & ~8);
    gb.set({ mat: 1, p3: 2, col: lin(0x3f4a4c) });
    for (let i = 0; i < 4; i++) { const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4, a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4; gb.poly([[sx + Math.cos(a1) * 0.75, TH + 2.2, sz + Math.sin(a1) * 0.75], [sx + Math.cos(a0) * 0.75, TH + 2.2, sz + Math.sin(a0) * 0.75], [sx, TH + 5.5, sz]]); }
  }
  // finial cross
  gb.set({ mat: 5, col: lin(0x3a3226) });
  gb.box(-0.08, sy1, zc - 0.08, 0.08, sy1 + 2.4, zc + 0.08);
  gb.box(-0.7, sy1 + 1.5, zc - 0.07, 0.7, sy1 + 1.66, zc + 0.07);
  // colliders
  const wc = (lx, lz) => [gb.wx(lx, lz), gb.wz(lx, lz)];
  let [cx, cz] = wc(0, (z0 + z1) / 2);
  b.solids.push(solids.addBox(cx, H / 2, cz, W / 2, H / 2, L / 2, lot.a, 'building', b));
  b.solids.push(solids.addRoof(cx, cz, lot.a, H, ridge, 2, L / 2, W / 2 + 0.5, 'building', b));
  [cx, cz] = wc(0, zc);
  b.solids.push(solids.addBox(cx, TH / 2, cz, T / 2 + 0.3, TH / 2, T / 2 + 0.3, lot.a, 'building', b));
  b.solids.push(solids.addSpire(cx, cz, lot.a, TH, sy1, T / 2, 'building', b));
  [cx, cz] = wc(0, z0 - ar / 2);
  b.solids.push(solids.addBox(cx, H / 2, cz, ar, H / 2, ar / 2, lot.a, 'building', b));
  b.spireTop = new THREE.Vector3(cx, sy1, cz);
  b.eaveY = H; b.ridgeY = ridge; b.tough = 6;
  return { height: sy1 + 2.4, foot: { hx: W / 2, hz: L / 2 } };
}

// town hall (stepped gables, arcade) / guard house (stone, hipped)
function buildHall(gb, lot, r, solids, b, townhall) {
  gb.frame(lot.x, 0, lot.z, lot.a);
  const W = lot.w, D = lot.d;
  const x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;
  const stone = townhall ? lin(0xc4b494) : lin(0xa99d88);
  const floors = townhall ? [4.6, 3.8, 3.6] : [4, 3.4, 3.4];
  let y = 0;
  floors.forEach((fh, fl) => {
    const ts = fl === 0 || !townhall ? TS.STONE : TS.PLASTER;
    const tint = ts === TS.STONE ? stone : lin(0xe9dcc0);
    gb.set({ mat: 0, col: tint, p1: fh });
    const bf = W / Math.round(W / 3.2), bs = D / Math.round(D / 3.2);
    gb.set({ p0: W, p2: bf, p3: bitsOf(fl, ts, 1, { door: fl === 0 }) }); gb.wall(x0, z1, x1, z1, y, y + fh);
    gb.set({ p3: bitsOf(fl, ts, 1, { door: fl === 0 && !townhall }) }); gb.wall(x1, z0, x0, z0, y, y + fh);
    gb.set({ p0: D, p2: bs, p3: bitsOf(fl, ts, 1) }); gb.wall(x1, z1, x1, z0, y, y + fh); gb.wall(x0, z0, x0, z1, y, y + fh);
    gb.set({ mat: 4, p2: 0.3, col: scalec(stone, 0.85) });
    gb.box(x0 - 0.15, y + fh - 0.25, z0 - 0.15, x1 + 0.15, y + fh + 0.05, z1 + 0.15, 1 | 2 | 16 | 32 | 4 | 8);
    y += fh;
  });
  const pitch = (56 * Math.PI) / 180;
  const roofT = townhall ? lin(0x7d3a28) : lin(0x5b5550);
  const ridge = roofGeom(gb, { axis: 0, x0, x1, z0, z1, y, pitch, tint: roofT, eave: 0.3, verge: townhall ? 0.05 : 0.3 });
  const rise = ridge - y;
  if (townhall) {
    // stepped gables at both ends (stone steps rising above the roof line)
    for (const s of [-1, 1]) {
      const xg = s * W / 2;
      const steps = 7;
      for (let i = 0; i < steps; i++) {
        const h0 = y + (i / steps) * rise, h1 = y + ((i + 1) / steps) * rise + 0.7;
        const half = D / 2 * (1 - i / steps);
        gb.set({ mat: 0, col: stone, p0: half * 2, p1: h1 - h0, p2: half * 2 / Math.max(1, Math.round(half * 2 / 3)), p3: bitsOf(3, TS.STONE, 1, { gable: true }) });
        const xa = xg - 0.4, xb = xg + 0.4;
        gb.box(xa, h0, -half, xb, h1, half, s > 0 ? 1 | 4 | 16 | 32 : 2 | 4 | 16 | 32);
      }
    }
    // arcade piers on the front at ground floor (visual)
    gb.set({ mat: 4, p2: 0.35, col: scalec(stone, 0.9) });
    const n = Math.round(W / 3.2);
    for (let i = 0; i <= n; i++) { const x = x0 + (i / n) * W; gb.box(x - 0.35, 0, z1, x + 0.35, floors[0], z1 + 0.5, 63 & ~8); }
    // small clock turret on the ridge
    gb.set({ mat: 0, col: lin(0xe9dcc0), p0: 2.4, p1: 3, p2: 2.4, p3: bitsOf(2, TS.PLASTER, 1) });
    gb.box(-1.2, ridge - 1.5, -1.2, 1.2, ridge + 2.5, 1.2, 1 | 2 | 16 | 32);
    gb.set({ mat: 1, p3: 2, col: lin(0x3f4a4c) });
    for (let i = 0; i < 4; i++) { const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4, a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4; gb.poly([[Math.cos(a1) * 2.0, ridge + 2.5, Math.sin(a1) * 2.0], [Math.cos(a0) * 2.0, ridge + 2.5, Math.sin(a0) * 2.0], [0, ridge + 7.5, 0]]); }
  } else {
    gableGeom(gb, { ax: x1, az: z1, bx: x1, bz: z0, y, rise, bayW: D / 2, ts: TS.STONE, wst: 1 });
    gableGeom(gb, { ax: x0, az: z0, bx: x0, bz: z1, y, rise, bayW: D / 2, ts: TS.STONE, wst: 1 });
  }
  const cx = gb.wx(0, 0), cz = gb.wz(0, 0);
  b.solids.push(solids.addBox(cx, y / 2, cz, W / 2, y / 2, D / 2, lot.a, 'building', b));
  b.solids.push(solids.addRoof(cx, cz, lot.a, y, ridge, 0, W / 2 + 0.3, D / 2 + 0.3, 'building', b));
  b.eaveY = y; b.ridgeY = ridge; b.tough = 3;
  return { height: ridge + (townhall ? 7.5 : 1), foot: { hx: W / 2, hz: D / 2 } };
}

function buildBarracks(gb, lot, r, solids, b) {
  gb.frame(lot.x, 0, lot.z, lot.a);
  const W = lot.w, D = lot.d; // w along local x, d along local z (front +z faces the avenue)
  const stone = lin(0xa89a82);
  const wings = [
    [-W / 2, D / 2 - 11, W / 2, D / 2],       // front wing
    [-W / 2, -D / 2, -W / 2 + 11, D / 2 - 11], // left wing
    [W / 2 - 11, -D / 2, W / 2, D / 2 - 11],   // right wing
  ];
  const floors = [4, 3.4, 3.4];
  let ridgeMax = 0;
  for (const [x0, z0, x1, z1] of wings) {
    let y = 0;
    floors.forEach((fh, fl) => {
      const ts = fl === 0 ? TS.STONE : TS.PLASTER;
      gb.set({ mat: 0, col: ts === TS.STONE ? stone : lin(0xd8ccb0), p1: fh });
      const w = x1 - x0, d = z1 - z0;
      gb.set({ p0: w, p2: w / Math.max(1, Math.round(w / 3)), p3: bitsOf(fl, ts, 3, { door: fl === 0 }) }); gb.wall(x0, z1, x1, z1, y, y + fh);
      gb.set({ p3: bitsOf(fl, ts, 3) }); gb.wall(x1, z0, x0, z0, y, y + fh);
      gb.set({ p0: d, p2: d / Math.max(1, Math.round(d / 3)) }); gb.wall(x1, z1, x1, z0, y, y + fh); gb.wall(x0, z0, x0, z1, y, y + fh);
      y += fh;
    });
    const axis = x1 - x0 > z1 - z0 ? 0 : 2;
    const ridge = roofGeom(gb, { axis, x0, x1, z0, z1, y, pitch: (48 * Math.PI) / 180, tint: lin(0x5e3a2c), eave: 0.4, verge: 0.2 });
    const rise = ridge - y;
    if (axis === 0) { gableGeom(gb, { ax: x1, az: z1, bx: x1, bz: z0, y, rise, bayW: 3, ts: TS.PLASTER, wst: 3 }); gableGeom(gb, { ax: x0, az: z0, bx: x0, bz: z1, y, rise, bayW: 3, ts: TS.PLASTER, wst: 3 }); }
    else { gableGeom(gb, { ax: x0, az: z1, bx: x1, bz: z1, y, rise, bayW: 3, ts: TS.PLASTER, wst: 3 }); gableGeom(gb, { ax: x1, az: z0, bx: x0, bz: z0, y, rise, bayW: 3, ts: TS.PLASTER, wst: 3 }); }
    const cxl = (x0 + x1) / 2, czl = (z0 + z1) / 2;
    const cx = gb.wx(cxl, czl), cz = gb.wz(cxl, czl);
    b.solids.push(solids.addBox(cx, y / 2, cz, (x1 - x0) / 2, y / 2, (z1 - z0) / 2, lot.a, 'building', b));
    b.solids.push(solids.addRoof(cx, cz, lot.a, y, ridge, axis, (axis === 0 ? x1 - x0 : z1 - z0) / 2 + 0.2, (axis === 0 ? z1 - z0 : x1 - x0) / 2 + 0.4, 'building', b));
    ridgeMax = Math.max(ridgeMax, ridge);
    b.eaveY = y;
  }
  // courtyard wall at the back
  gb.set({ mat: 4, p2: 0.4, col: stone });
  gb.box(-W / 2 + 11, 0, -D / 2, W / 2 - 11, 3.2, -D / 2 + 0.8);
  // flag pole
  gb.set({ mat: 5, col: lin(0x2c2a28) });
  const fx = 0, fz = D / 2 + 3;
  gb.box(fx - 0.1, 0, fz - 0.1, fx + 0.1, 16, fz + 0.1);
  b.flag = new THREE.Vector3(gb.wx(fx, fz), 16, gb.wz(fx, fz));
  b.ridgeY = ridgeMax; b.tough = 3;
  return { height: ridgeMax + 1, foot: { hx: W / 2, hz: D / 2 } };
}

// lathe helper (local frame): profile [[r, y], ...] bottom -> top around (cx, cz), seg sides
function latheL(gb, cx, cz, prof, seg, rot = 0) {
  for (let i = 0; i + 1 < prof.length; i++) {
    const [r0, y0] = prof[i], [r1, y1] = prof[i + 1];
    for (let k = 0; k < seg; k++) {
      const a0 = rot + (k / seg) * Math.PI * 2, a1 = rot + ((k + 1) / seg) * Math.PI * 2;
      const P = (a, r, y) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      if (r1 < 1e-3) gb.poly([P(a1, r0, y0), P(a0, r0, y0), P(a0, 0, y1)]);
      else if (r0 < 1e-3) gb.poly([P(a1, r1, y1), P(a0, 0, y0), P(a0, r1, y1)].reverse().reverse());
      else gb.poly([P(a1, r0, y0), P(a0, r0, y0), P(a0, r1, y1), P(a1, r1, y1)]);
    }
  }
}

// baroque church with a tall bell tower and onion dome beside the outer gate (hero landmark)
function buildGateChurch(gb, lot, r, solids, b) {
  gb.frame(lot.x, 0, lot.z, lot.a);
  const W = lot.w, L = lot.d - 9;           // nave width (local x) / length (local z)
  const stone = lin(0xc9bda2), plaster = lin(0xe8dcc4), stoneD = lin(0xa89c84);
  const z1 = lot.d / 2 - 9, z0 = z1 - L;    // tower at the front (+z)
  const x0 = -W / 2, x1 = W / 2, H = 13;
  gb.set({ mat: 0, col: plaster, p1: H });
  gb.set({ p0: L, p2: L / 5, p3: bitsOf(0, TS.CHURCH, 0) });
  gb.wall(x1, z1, x1, z0, 0, H); gb.wall(x0, z0, x0, z1, 0, H);
  gb.set({ p0: W, p2: W / 3, p3: bitsOf(0, TS.CHURCH, 0) });
  gb.wall(x1, z0, x0, z0, 0, H);
  // pilasters + cornice
  gb.set({ mat: 4, p2: 0.42, col: stone });
  for (let i = 0; i <= 5; i++) { const z = z0 + (i / 5) * L; for (const s of [-1, 1]) gb.box(Math.min(s * W / 2, s * (W / 2 + 0.6)), 0, z - 0.5, Math.max(s * W / 2, s * (W / 2 + 0.6)), H, z + 0.5, 63 & ~8); }
  gb.box(x0 - 0.5, H - 0.6, z0 - 0.5, x1 + 0.5, H + 0.1, z1, 1 | 2 | 4 | 8 | 32);
  const ridge = roofGeom(gb, { axis: 2, x0, x1, z0: z0 - 0.3, z1, y: H + 0.1, pitch: (52 * Math.PI) / 180, tint: lin(0x6e3a2a), eave: 0.5, verge: 0.3 });
  gableGeom(gb, { ax: x1, az: z0 - 0.3, bx: x0, bz: z0 - 0.3, y: H + 0.1, rise: ridge - H - 0.1, bayW: W / 3, ts: TS.PLASTER, wst: 0 });
  // tower: 3 stages with cornices, belfry, clock
  const T = 8.4, tz0 = z1, tz1 = z1 + T, tx0 = -T / 2, tx1 = T / 2, zc = (tz0 + tz1) / 2;
  const stages = [[0, 12, TS.STONE, 0], [12, 22, TS.PLASTER, 1], [22, 31, TS.CHURCH, 2]];
  for (const [ya, yb, ts, k] of stages) {
    const inset = k * 0.35;
    const a0 = tx0 + inset, a1 = tx1 - inset, c0 = tz0 + inset, c1 = tz1 - inset;
    const w = a1 - a0;
    gb.set({ mat: 0, col: ts === TS.PLASTER ? plaster : stone, p0: w, p1: yb - ya, p2: ts === TS.CHURCH ? w / 3 : w / 2, p3: bitsOf(k === 0 ? 0 : 1, ts, 0, { door: k === 0 }) });
    gb.wall(a0, c1, a1, c1, ya, yb); gb.wall(a1, c0, a0, c0, ya, yb);
    gb.wall(a1, c1, a1, c0, ya, yb); gb.wall(a0, c0, a0, c1, ya, yb);
    gb.set({ mat: 4, p2: 0.35, col: stone });
    gb.box(a0 - 0.45, yb - 0.55, c0 - 0.45, a1 + 0.45, yb, c1 + 0.45, 63);
    // corner pilasters
    for (const [px, pz] of [[a0, c0], [a1, c0], [a0, c1], [a1, c1]]) gb.box(px - 0.35, ya, pz - 0.35, px + 0.35, yb - 0.55, pz + 0.35, 63 & ~8);
  }
  // clock faces on the middle stage
  gb.set({ mat: 5, col: lin(0x2a2a2a) });
  const cy = 18.2;
  for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const d = T / 2 - 0.35 + 0.06;
    const pts = [];
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; const u = Math.cos(a) * 1.3, v = Math.sin(a) * 1.3; pts.push([nx * d + (nz !== 0 ? u * nz : 0), cy + v, zc + nz * d + (nx !== 0 ? -u * nx : 0)]); }
    gb.poly(pts);
  }
  gb.set({ mat: 4, p2: 0.3, col: lin(0xd8c89a) });
  // octagonal lantern drum + onion dome + lantern + spike
  const top = 31;
  const oct = 8, rot = Math.PI / 8;
  gb.set({ mat: 0, col: plaster, p0: 2.2, p1: 4.2, p2: 2.2, p3: bitsOf(3, TS.PLASTER, 0) });
  const rd = 3.3;
  for (let k = 0; k < oct; k++) {
    const a0 = rot + (k / oct) * Math.PI * 2, a1 = rot + ((k + 1) / oct) * Math.PI * 2;
    gb.poly([[Math.cos(a1) * rd, top, zc + Math.sin(a1) * rd], [Math.cos(a0) * rd, top, zc + Math.sin(a0) * rd], [Math.cos(a0) * rd, top + 4.2, zc + Math.sin(a0) * rd], [Math.cos(a1) * rd, top + 4.2, zc + Math.sin(a1) * rd]]);
  }
  gb.set({ mat: 1, p3: 2, col: lin(0x3a4a44) });
  const dome = [[3.7, top + 4.2], [4.3, top + 5.2], [4.5, top + 6.6], [4.0, top + 8.2], [2.8, top + 9.6], [1.3, top + 10.8], [0.55, top + 11.8], [0.5, top + 12.3]];
  latheL(gb, 0, zc, dome, 16);
  // lantern
  gb.set({ mat: 0, col: plaster, p0: 1, p1: 2.4, p2: 1, p3: bitsOf(3, TS.PLASTER, 0) });
  latheL(gb, 0, zc, [[1.0, top + 12.3], [1.0, top + 14.4]], 8, rot);
  gb.set({ mat: 1, p3: 2, col: lin(0x3a4a44) });
  latheL(gb, 0, zc, [[1.3, top + 14.4], [1.1, top + 15.0], [0.6, top + 15.8], [0.25, top + 16.6], [0.0, top + 19.5]], 8);
  gb.set({ mat: 5, col: lin(0x8a6a2a) });
  latheL(gb, 0, zc, [[0.28, top + 19.2], [0.28, top + 19.8], [0.0, top + 20.4]], 6);
  gb.box(-0.05, top + 19.8, zc - 0.05, 0.05, top + 21.6, zc + 0.05);
  gb.box(-0.45, top + 20.9, zc - 0.04, 0.45, top + 21.0, zc + 0.04);
  // colliders
  const wc = (lx, lz) => [gb.wx(lx, lz), gb.wz(lx, lz)];
  let [cx, cz] = wc(0, (z0 + z1) / 2);
  b.solids.push(solids.addBox(cx, H / 2, cz, W / 2 + 0.3, H / 2, L / 2, lot.a, 'building', b));
  b.solids.push(solids.addRoof(cx, cz, lot.a, H, ridge, 2, L / 2, W / 2 + 0.5, 'building', b));
  [cx, cz] = wc(0, zc);
  b.solids.push(solids.addBox(cx, top / 2, cz, T / 2 + 0.4, top / 2, T / 2 + 0.4, lot.a, 'building', b));
  b.solids.push(solids.addBox(cx, top + 6, cz, 4.2, 6, 4.2, lot.a, 'building', b));
  b.solids.push(solids.addSpire(cx, cz, lot.a, top + 12, top + 20, 1.3, 'building', b));
  b.spireTop = new THREE.Vector3(cx, top + 21.6, cz);
  b.eaveY = H; b.ridgeY = top + 12; b.tough = 5;
  return { height: top + 21.6, foot: { hx: W / 2, hz: L / 2 } };
}

// ---------------------------------------------------------------------------------------------------------------
// flat vantage buildings (fight start / respawn perches): guild hall with a parapeted roof terrace, lookout towers
function parapetRing(gb, solids, b, lot, x0, z0, x1, z1, y, h, t, mat, col, merlons = false) {
  gb.set({ mat, p2: 0.32, col });
  const seg = (ax0, az0, ax1, az1) => {
    if (!merlons) { gb.box(ax0, y, az0, ax1, y + h, az1, 63 & ~8); return; }
    gb.box(ax0, y, az0, ax1, y + h * 0.55, az1, 63 & ~8);
    const along = ax1 - ax0 > az1 - az0, L = along ? ax1 - ax0 : az1 - az0;
    const n = Math.max(1, Math.floor(L / 1.7));
    for (let i = 0; i < n; i++) {
      const c0 = (along ? ax0 : az0) + (L * (i + 0.2)) / n, c1 = (along ? ax0 : az0) + (L * (i + 0.75)) / n;
      if (along) gb.box(c0, y + h * 0.55, az0, c1, y + h, az1, 63 & ~8); else gb.box(ax0, y + h * 0.55, c0, ax1, y + h, c1, 63 & ~8);
    }
  };
  seg(x0, z1 - t, x1, z1); seg(x0, z0, x1, z0 + t); seg(x0, z0 + t, x0 + t, z1 - t); seg(x1 - t, z0 + t, x1, z1 - t);
  // collision (walls only; the walkable floor is the body box top)
  const add = (cx, cz, hx, hz) => b.solids.push(solids.addBox(gb.wx(cx, cz), y + h / 2, gb.wz(cx, cz), hx, h / 2, hz, lot.a, 'building', b));
  add((x0 + x1) / 2, z1 - t / 2, (x1 - x0) / 2, t / 2); add((x0 + x1) / 2, z0 + t / 2, (x1 - x0) / 2, t / 2);
  add(x0 + t / 2, (z0 + z1) / 2, t / 2, (z1 - z0) / 2); add(x1 - t / 2, (z0 + z1) / 2, t / 2, (z1 - z0) / 2);
}

function flag(gb, x, z, y0, h, col) {
  gb.set({ mat: 5, col: lin(0x2a2622), p2: 0, p3: 0 });
  gb.box(x - 0.06, y0, z - 0.06, x + 0.06, y0 + h, z + 0.06, 1 | 2 | 16 | 32 | 4);
  gb.set({ mat: 7, col, p3: 0 });
  const q = [[x + 0.06, y0 + h - 1.5, z], [x + 2.3, y0 + h - 1.6, z + 0.15], [x + 2.3, y0 + h - 0.15, z + 0.15], [x + 0.06, y0 + h - 0.05, z]];
  gb.poly(q); gb.poly(q.slice().reverse());
}

function buildGuildFlat(gb, lot, r, solids, b) {
  gb.frame(lot.x, 0, lot.z, lot.a);
  const W = lot.w, D = lot.d, H = lot.top;
  const x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;
  const stone = lin(0xc6b89c), plaster = r.pick([lin(0xe8d7b0), lin(0xdcc3a0), lin(0xece2cc)]);
  const f0 = 4.4, nUp = Math.max(1, Math.round((H - f0 - 0.6) / 3.4)), fu = (H - f0 - 0.6) / nUp;
  let y = 0;
  for (let fl = 0; fl <= nUp; fl++) {
    const fh = fl === 0 ? f0 : fu;
    const ts = fl === 0 ? TS.STONE : TS.PLASTER;
    gb.set({ mat: 0, col: ts === TS.STONE ? stone : plaster, p1: fh });
    const bf = W / Math.max(1, Math.round(W / 2.6)), bs = D / Math.max(1, Math.round(D / 2.6));
    gb.set({ p0: W, p2: bf, p3: bitsOf(fl, ts, 1, { door: fl === 0 }) }); gb.wall(x0, z1, x1, z1, y, y + fh);
    gb.set({ p3: bitsOf(fl, ts, 1) }); gb.wall(x1, z0, x0, z0, y, y + fh);
    gb.set({ p0: D, p2: bs, p3: bitsOf(fl, ts, 1, { side: fl > 0 }) }); gb.wall(x1, z1, x1, z0, y, y + fh); gb.wall(x0, z0, x0, z1, y, y + fh);
    // string course
    gb.set({ mat: 4, p2: 0.3, col: stone });
    gb.box(x0 - 0.12, y + fh - 0.22, z0 - 0.12, x1 + 0.12, y + fh + 0.02, z1 + 0.12, 63);
    y += fh;
  }
  // attic band + cornice, then the roof terrace at H with a parapet
  gb.set({ mat: 4, p2: 0.4, col: stone });
  gb.box(x0, y, z0, x1, H, z1, 1 | 2 | 16 | 32);
  gb.box(x0 - 0.35, H - 0.3, z0 - 0.35, x1 + 0.35, H, z1 + 0.35, 63 & ~4);
  gb.set({ mat: 4, p2: 0.55, col: lin(0x9a9282) });
  gb.poly([[x0, H, z1], [x1, H, z1], [x1, H, z0], [x0, H, z0]]);
  // low curb parapet (0.7 m) with a coping ring - keeps third-person cameras clear
  parapetRing(gb, solids, b, lot, x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2, H, 0.62, 0.45, 4, stone);
  gb.set({ mat: 4, p2: 0.3, col: lin(0xd2c6ac) });
  for (const [a0, c0, a1, c1] of [[x0 - 0.3, z1 - 0.3, x1 + 0.3, z1 + 0.3], [x0 - 0.3, z0 - 0.3, x1 + 0.3, z0 + 0.3], [x0 - 0.3, z0 + 0.3, x0 + 0.3, z1 - 0.3], [x1 - 0.3, z0 + 0.3, x1 + 0.3, z1 - 0.3]]) gb.box(a0, H + 0.62, c0, a1, H + 0.72, c1, 63);
  // roof access kiosk in a back corner + flag
  gb.set({ mat: 0, col: plaster, p0: 2.6, p1: 2.6, p2: 2.6, p3: bitsOf(0, TS.PLASTER, 1, { door: true }) });
  // in the corner farthest from the outer gate (keeps the view to the fight clear)
  let kx = x1 - 1.9, kz = z0 + 1.8, kd = -1;
  for (const [cx2, cz2] of [[x1 - 1.9, z0 + 1.8], [x0 + 1.9, z0 + 1.8], [x1 - 1.9, z1 - 1.8], [x0 + 1.9, z1 - 1.8]]) {
    const d = Math.hypot(gb.wx(cx2, cz2), gb.wz(cx2, cz2) - 380);
    if (d > kd) { kd = d; kx = cx2; kz = cz2; }
  }
  gb.box(kx - 1.3, H, kz - 1.3, kx + 1.3, H + 2.6, kz + 1.3, 1 | 2 | 16 | 32);
  gb.set({ mat: 1, p3: 2, col: lin(0x3f4a4c) });
  for (let i = 0; i < 4; i++) { const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4, a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4; gb.poly([[kx + Math.cos(a1) * 2.0, H + 2.6, kz + Math.sin(a1) * 2.0], [kx + Math.cos(a0) * 2.0, H + 2.6, kz + Math.sin(a0) * 2.0], [kx, H + 4.0, kz]]); }
  flag(gb, x0 + 1.2, z0 + 1.2, H, 6, r.pick([lin(0x8a1c1c), lin(0x2a4a7a), lin(0x2f5a2a)]));
  b.solids.push(solids.addBox(gb.wx(0, 0), H / 2, gb.wz(0, 0), W / 2, H / 2, D / 2, lot.a, 'building', b));
  b.solids.push(solids.addBox(gb.wx(kx, kz), H + 1.3, gb.wz(kx, kz), 1.3, 1.3, 1.3, lot.a, 'building', b));
  b.eaveY = H; b.ridgeY = H + 1.3; b.tough = 3;
  return { height: H + 6, foot: { hx: W / 2, hz: D / 2 } };
}

function buildLookoutTower(gb, lot, r, solids, b) {
  gb.frame(lot.x, 0, lot.z, lot.a);
  const belfry = lot.kind === 'belfry';
  const T = lot.w, H = lot.top, hw = T / 2;
  const stone = lin(0xb9ad95), stoneD = lin(0x9d917c), plaster = lin(0xe6d8bc);
  const stages = belfry ? [[0, 10, TS.STONE, 0], [10, 18.5, TS.PLASTER, 1], [18.5, H - 1.4, TS.CHURCH, 2]] : [[0, 8, TS.STONE, 0], [8, 15.5, TS.STONE, 1], [15.5, H - 2.4, TS.STONE, 2]];
  for (const [ya, yb, ts, k] of stages) {
    gb.set({ mat: 0, col: ts === TS.PLASTER ? plaster : stone, p0: T, p1: yb - ya, p2: ts === TS.CHURCH ? T / 2 : T / 3, p3: bitsOf(k === 0 ? 0 : 1, ts, belfry ? 0 : 3, { door: k === 0, side: !belfry && k > 0 }) });
    gb.wall(-hw, hw, hw, hw, ya, yb); gb.wall(hw, -hw, -hw, -hw, ya, yb);
    gb.wall(hw, hw, hw, -hw, ya, yb); gb.wall(-hw, -hw, -hw, hw, ya, yb);
    gb.set({ mat: 4, p2: 0.35, col: stoneD });
    gb.box(-hw - 0.3, yb - 0.4, -hw - 0.3, hw + 0.3, yb, hw + 0.3, 63);
    for (const [px, pz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) gb.box(px - 0.4, ya, pz - 0.4, px + 0.4, yb - 0.4, pz + 0.4, 63 & ~8);
  }
  const top = stages[2][1];
  let pw;
  if (belfry) {
    // clock faces + flat lead roof with a stone parapet and an iron rail
    gb.set({ mat: 5, col: lin(0x2a2a2a) });
    for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const d = hw + 0.05, pts = [];
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; const u = Math.cos(a) * 1.25, v = Math.sin(a) * 1.25; pts.push([nx * d + (nz !== 0 ? u * nz : 0), 14.5 + v, nz * d + (nx !== 0 ? -u * nx : 0)]); }
      gb.poly(pts);
    }
    gb.set({ mat: 4, p2: 0.4, col: stone });
    gb.box(-hw - 0.5, top, -hw - 0.5, hw + 0.5, H, hw + 0.5, 63 & ~4);
    gb.set({ mat: 5, col: lin(0x3c4044) });
    gb.poly([[-hw - 0.5, H, hw + 0.5], [hw + 0.5, H, hw + 0.5], [hw + 0.5, H, -hw - 0.5], [-hw - 0.5, H, -hw - 0.5]]);
    pw = hw + 0.5;
    parapetRing(gb, solids, b, lot, -pw, -pw, pw, pw, H, 0.7, 0.4, 4, stone);
    gb.set({ mat: 5, col: lin(0x1c1b1a) });
    flag(gb, -pw + 0.6, -pw + 0.6, H, 5, lin(0x7a1a1a));
  } else {
    // corbelled machicolation band carrying a wider fighting platform with merlons
    const cb = hw + 0.7;
    gb.set({ mat: 4, p2: 0.4, col: stoneD });
    for (let i = 0; i < 3; i++) { const e = hw + 0.25 * (i + 1); gb.box(-e, top + i * 0.45, -e, e, top + (i + 1) * 0.45, e, 63 & ~4); }
    gb.set({ mat: 4, p2: 0.4, col: stone });
    gb.box(-cb, top + 1.35, -cb, cb, H, cb, 63 & ~4);
    gb.set({ mat: 4, p2: 0.5, col: lin(0x8f887a) });
    gb.poly([[-cb, H, cb], [cb, H, cb], [cb, H, -cb], [-cb, H, -cb]]);
    pw = cb;
    parapetRing(gb, solids, b, lot, -cb, -cb, cb, cb, H, 0.75, 0.45, 4, stone, true);
    flag(gb, cb - 0.8, -cb + 0.8, H, 6.5, lin(0x2a4a7a));
  }
  const cx = gb.wx(0, 0), cz = gb.wz(0, 0);
  b.solids.push(solids.addBox(cx, top / 2, cz, hw + 0.3, top / 2, hw + 0.3, lot.a, 'building', b));
  b.solids.push(solids.addBox(cx, (top + H) / 2, cz, pw, (H - top) / 2, pw, lot.a, 'building', b));
  b.eaveY = H; b.ridgeY = H + 1.5; b.tough = 4;
  b.spireTop = new THREE.Vector3(cx, H, cz);
  return { height: H + 6.5, foot: { hx: pw, hz: pw } };
}
