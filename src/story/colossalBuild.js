// Builds the giant's meshes (as plain typed arrays) — runs inside workers (colossalWorker.js) in parallel,
// or on the main thread as a fallback.
import { buildPart, boxRegion } from './sculpt.js';
import { buildSkeletonDefs, sculptColossal, sculptHair, ARM, H, HAIR_HEM } from './colossalBody.js';

export const BUILD_VERSION = 'colossal-v19';
export const PARTS = ['body', 'head', 'handL', 'handR'];   // (hair retired with the smiling titan)
// low-poly shadow-caster proxies ('<part>~s'): ~3x coarser and eroded slightly so they sit just inside the hi-res skin
export const SHADOW_PARTS = ['body~s', 'head~s', 'handL~s', 'handR~s'];

let cache = null;
function setup() {
  if (cache) return cache;
  const { bones, index: bi } = buildSkeletonDefs();
  const { ops } = sculptColossal(bi);
  const hair = sculptHair(bi).ops;
  const headBox = { min: [-0.12, 1.5, -0.15], max: [0.12, 1.94, 0.18] };
  const rHead = boxRegion(headBox.min, headBox.max);
  const handReg = (side) => {
    const W = side > 0 ? ARM.wrist : [-ARM.wrist[0], ARM.wrist[1], ARM.wrist[2]];
    const F = side > 0 ? ARM.dir : [-ARM.dir[0], ARM.dir[1], ARM.dir[2]];
    const c = [W[0] + F[0] * 0.13, W[1] + F[1] * 0.13, W[2] + F[2] * 0.13];
    return (x, y, z) => Math.max(-((x - W[0]) * F[0] + (y - W[1]) * F[1] + (z - W[2]) * F[2] - 0.004), Math.hypot(x - c[0], y - c[1], z - c[2]) - 0.21);
  };
  const rHL = handReg(1), rHR = handReg(-1);
  const bbox = (list, filter, pad) => {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const o of list) if (!o.sub && filter(o)) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], o.bc[a] - o.br); mx[a] = Math.max(mx[a], o.bc[a] + o.br); }
    return { min: mn.map((v) => v - pad), max: mx.map((v) => v + pad) };
  };
  cache = { bones, bi, ops, hair, headBox, rHead, rHL, rHR, bbox };
  return cache;
}

export function buildPartArrays(name, q = 1) {
  if (name.endsWith('~s')) return buildShadowProxy(name.slice(0, -2), q);
  const { bones, ops, hair, headBox, rHead, rHL, rHR, bbox, bi } = setup();
  const nb = bones.length;
  const OV = 0.02, SH = 0.0012;
  let geo;
  if (name === 'body') {
    const bb = bbox(ops, (o) => !o.part, 0.02);
    bb.max[1] = Math.min(bb.max[1], headBox.max[1]);
    const clip = (d, x, y, z) => {
      const a = rHead(x, y, z), b = rHL(x, y, z), c = rHR(x, y, z);
      const dd = (a < 0 || b < 0 || c < 0) ? d + SH : d;
      return Math.max(dd, -(a + OV), -(b + OV), -(c + OV));
    };
    geo = buildPart(ops, null, { ...bb, h: 0.0068 * q, clip, boneCount: nb, sigmaBone: 0.02, aoScale: 0.011, aoSkip: (o) => o.part === 'head', displace: { amp: 0.0022, freq: 34 }, curvR: 0.012 });
  } else if (name === 'head') {
    geo = buildPart(ops, null, { min: headBox.min.map((v) => v - 0.014), max: headBox.max.map((v) => v + 0.014), h: 0.0024 * q, clip: (d, x, y, z) => Math.max(d, rHead(x, y, z)), boneCount: nb, sigmaBone: 0.009, sigmaMat: 0.003, aoScale: 0.0045, capBone: bi.neck, capBelowY: headBox.min[1] + 0.03, displace: { amp: 0.0011, freq: 85 }, curvR: 0.005 });
  } else if (name === 'handL' || name === 'handR') {
    const bb = bbox(ops, (o) => o.part === name, 0.01);
    const reg = name === 'handL' ? rHL : rHR;
    geo = buildPart(ops, null, { ...bb, h: 0.0032 * q, clip: (d, x, y, z) => Math.max(d, reg(x, y, z)), boneCount: nb, sigmaBone: 0.006, aoScale: 0.0045, curvR: 0.005 });
  } else if (name === 'hair') {
    const bb = bbox(hair, () => true, 0.01);
    const hemY = H(0, HAIR_HEM, 0)[1];
    geo = buildPart(hair, null, { ...bb, h: 0.003 * q, clip: (d, x, y) => Math.max(d, hemY - y), boneCount: nb, sigmaBone: 0.02, sigmaMat: 0.006, aoScale: 0.006 });
  }
  const out = { name };
  for (const k of Object.keys(geo.attributes)) out[k] = geo.attributes[k].array;
  out.index = geo.index.array;
  return out;
}

// shadow proxy: same regions/skinning as the visible part, coarse voxels, eroded by ~1.5 voxels of the fine mesh
function buildShadowProxy(name, q) {
  const { bones, ops, headBox, rHead, rHL, rHR, bbox, bi } = setup();
  const nb = bones.length, OV = 0.012, SH = 0.0016, E = 0.004;
  let geo;
  if (name === 'body') {
    const bb = bbox(ops, (o) => !o.part, 0.02);
    bb.max[1] = Math.min(bb.max[1], headBox.max[1]);
    const clip = (d, x, y, z) => {
      const a = rHead(x, y, z), b = rHL(x, y, z), c = rHR(x, y, z);
      const dd = (a < 0 || b < 0 || c < 0) ? d + SH : d;
      return Math.max(dd + E, -(a + OV), -(b + OV), -(c + OV));
    };
    geo = buildPart(ops, null, { ...bb, h: 0.0068 * q, clip, boneCount: nb, sigmaBone: 0.02, aoScale: 0.004 });
  } else if (name === 'head') {
    geo = buildPart(ops, null, { min: headBox.min.map((v) => v - 0.014), max: headBox.max.map((v) => v + 0.014), h: 0.0024 * q, clip: (d, x, y, z) => Math.max(d + E * 0.6, rHead(x, y, z)), boneCount: nb, sigmaBone: 0.009, aoScale: 0.004, capBone: bi.neck, capBelowY: headBox.min[1] + 0.03 });
  } else {
    const bb = bbox(ops, (o) => o.part === name, 0.01);
    const reg = name === 'handL' ? rHL : rHR;
    geo = buildPart(ops, null, { ...bb, h: 0.0032 * q, clip: (d, x, y, z) => Math.max(d + E * 0.5, reg(x, y, z)), boneCount: nb, sigmaBone: 0.006, aoScale: 0.004 });
  }
  const out = { name: name + '~s' };
  for (const k of Object.keys(geo.attributes)) out[k] = geo.attributes[k].array;
  out.index = geo.index.array;
  return out;
}
