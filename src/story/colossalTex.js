// One-time procedural texture for the Colossal's muscle/fascia shader (generated once at load in a worker, mipmapped).
// "Combed" muscle strands: texture X = across the fibres, Y = along them (the shader maps Y with a ~7x stretch, so a
// tile is a long strip of parallel strands). Strands wander a little, swell/pinch and occasionally merge — never cells.
//   R  coarse fascicle profile (1 = bundle crest, 0 = dark gap between bundles)
//   G  fine strand profile (~110 strands / tile)
//   B  per-bundle random value (tint / wetness variation)
//   A  vein network (1 on a vein) for the pale fascia plates

function hash2(i, j, s) {
  let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// tileable jittered-grid Voronoi (for the vein network only): returns [F1, F2, id] in cell units
function makeVoronoi(N, seed, jit = 0.85) {
  const px = new Float32Array(N * N), py = new Float32Array(N * N), id = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    px[k] = i + 0.5 + (hash2(i, j, seed) - 0.5) * jit;
    py[k] = j + 0.5 + (hash2(i, j, seed + 7) - 0.5) * jit;
    id[k] = hash2(i, j, seed + 13);
  }
  const out = [0, 0, 0];
  return (x, y) => {
    const fx = x * N, fy = y * N;
    const ci = Math.floor(fx), cj = Math.floor(fy);
    let f1 = 1e9, f2 = 1e9, best = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      let ii = ci + di, jj = cj + dj, ox = 0, oy = 0;
      if (ii < 0) { ii += N; ox = -N; } else if (ii >= N) { ii -= N; ox = N; }
      if (jj < 0) { jj += N; oy = -N; } else if (jj >= N) { jj -= N; oy = N; }
      const k = jj * N + ii;
      const dx = px[k] + ox - fx, dy = py[k] + oy - fy;
      const d = dx * dx + dy * dy;
      if (d < f1) { f2 = f1; f1 = d; best = k; } else if (d < f2) f2 = d;
    }
    out[0] = Math.sqrt(f1); out[1] = Math.sqrt(f2); out[2] = id[best];
    return out;
  };
}

// tileable 2D value noise, periods PX x PY lattice cells
function makeNoise(PX, PY, seed) {
  const v = new Float32Array(PX * PY);
  for (let j = 0; j < PY; j++) for (let i = 0; i < PX; i++) v[j * PX + i] = hash2(i, j, seed);
  return (x, y) => {
    const fx = x * PX, fy = y * PY;
    const i0 = Math.floor(fx), j0 = Math.floor(fy);
    let tx = fx - i0, ty = fy - j0;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = ((i0 % PX) + PX) % PX, b = ((j0 % PY) + PY) % PY, i1 = (a + 1) % PX, j1 = (b + 1) % PY;
    const v00 = v[b * PX + a], v10 = v[b * PX + i1], v01 = v[j1 * PX + a], v11 = v[j1 * PX + i1];
    const top = v00 + (v10 - v00) * tx, bot = v01 + (v11 - v01) * tx;
    return top + (bot - top) * ty;
  };
}

// periodic 1D partition of [0,1) into n strands of random width: lookup -> (index, t in strand)
function makePartition(n, seed, LUT = 8192) {
  const w = []; let sum = 0;
  for (let i = 0; i < n; i++) { const x = 0.45 + hash2(i, 0, seed) * 1.1; w.push(x); sum += x; }
  const edges = [0]; for (let i = 0; i < n; i++) edges.push(edges[i] + w[i] / sum);
  const idx = new Uint16Array(LUT); let k = 0;
  for (let i = 0; i < LUT; i++) { const x = (i + 0.5) / LUT; while (edges[k + 1] < x) k++; idx[i] = k; }
  const out = [0, 0, 0];
  return (x) => {
    x -= Math.floor(x);
    const i = idx[Math.min(LUT - 1, (x * LUT) | 0)];
    let j = i; if (x < edges[j]) j--; else if (x >= edges[j + 1]) j++;
    j = Math.max(0, Math.min(n - 1, j));
    out[0] = j; out[1] = (x - edges[j]) / (edges[j + 1] - edges[j]); out[2] = edges[j + 1] - edges[j];
    return out;
  };
}

export function generateMuscleData(S = 1024) {
  const data = new Uint8Array(S * S * 4);
  // three nested strand levels across the tile: fascicle GROUPS (subtle), STRANDS (the readable striation), FIBRES (micro)
  const NG = 11, NC = 46, NF = 150;
  const pG = makePartition(NG, 7), pC = makePartition(NC, 11), pF = makePartition(NF, 23), pF2 = makePartition(Math.round(NF * 0.8), 29);
  // warps: slow along the fibre (Y), so strands wave gently; every noise is periodic in both axes
  const wA = makeNoise(4, 3, 71), wB = makeNoise(12, 5, 73), wC = makeNoise(40, 9, 75);
  const gapN = makeNoise(NC, 6, 81), fineN = makeNoise(NF, 4, 83), lenN = makeNoise(NF, 14, 85), grpN = makeNoise(NG, 4, 87);
  const vV1 = makeVoronoi(5, 51, 0.95), vV2 = makeVoronoi(13, 61, 0.95);
  const inv = 1 / S;
  const rowGW = new Float32Array(NC), rowGD = new Float32Array(NC), rowFN = new Float32Array(NF), rowLN = new Float32Array(NF), rowGG = new Float32Array(NG);
  const gid = new Float32Array(NG); for (let i = 0; i < NG; i++) gid[i] = hash2(i, 2, 91);
  const cid = new Float32Array(NC); for (let i = 0; i < NC; i++) cid[i] = hash2(i, 3, 97);
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) * inv;
    for (let i = 0; i < NG; i++) rowGG[i] = 0.3 + 0.7 * grpN((i + 0.5) / NG, v);
    for (let i = 0; i < NC; i++) { rowGW[i] = 0.14 + 0.14 * gapN((i + 0.5) / NC, v); rowGD[i] = 0.3 + 0.7 * gapN((i + 0.5) / NC, v + 0.5); }
    for (let i = 0; i < NF; i++) { rowFN[i] = 0.18 + 0.12 * fineN((i + 0.5) / NF, v); rowLN[i] = 0.85 + 0.15 * lenN((i + 0.5) / NF, v); }
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) * inv;
      const xw = u + (wA(u, v) - 0.5) * 0.05 + (wB(u, v) - 0.5) * 0.014;
      // fascicle groups: only a soft, shallow valley between groups
      const g = pG(xw); const gt = Math.min(g[1], 1 - g[1]);
      const gv = 1 - rowGG[g[0]] * (1 - Math.min(1, gt / 0.12)) ** 2;
      // strands: domed, gap depth varying along the length (strands merge / split)
      const c = pC(xw + (wC(u, v) - 0.5) * 0.004); const ci = c[0], ct = c[1];
      const edge = Math.min(ct, 1 - ct);
      const dome = Math.sqrt(Math.max(0, 1 - Math.pow(1 - 2 * edge, 2)));
      const gap = Math.min(1, edge / rowGW[ci]);
      const R = (1 - rowGD[ci] * (1 - gap * gap)) * (0.6 + 0.4 * dome) * gv;
      // micro fibres (two interleaved partitions so they never look ruled)
      const xf = xw + (wC(u, v) - 0.5) * 0.008;
      const f = pF(xf); const fe = Math.min(f[1], 1 - f[1]);
      const f2 = pF2(xf + 0.37); const fe2 = Math.min(f2[1], 1 - f2[1]);
      const sF = Math.min(1, fe / rowFN[f[0]]);
      const sF2 = Math.min(1, fe2 / 0.22);
      const G = (0.4 + 0.6 * Math.sqrt(sF)) * (0.75 + 0.25 * Math.sqrt(sF2)) * rowLN[f[0]];
      const B = gid[g[0]] * 0.55 + cid[ci] * 0.45;
      // veins: thin lines along warped Voronoi edges (big branches + small capillaries)
      const e1 = vV1(u, v), e2 = vV2(u, v);
      const l1 = Math.max(0, 1 - (e1[1] - e1[0]) / 0.06), l2 = Math.max(0, 1 - (e2[1] - e2[0]) / 0.09);
      const A = Math.min(1, l1 * l1 + 0.55 * l2 * l2 * (0.4 + 0.6 * e2[2]));
      const o = (y * S + x) * 4;
      data[o] = R * 255; data[o + 1] = G * 255; data[o + 2] = B * 255; data[o + 3] = A * 255;
    }
  }
  return data;
}
