// WORLD ground: town floor (cobbles / plaza flagstones / yards from a painted town map), the canal with stone
// embankments and arched bridges, farmland terrain outside the wall (painted landuse map: strip fields, dirt roads,
// hedgerows, forests, farmsteads), rolling hills to ~6 km and a hazy mountain ring at ~9 km.
import * as THREE from 'three';
import { GB } from './geom.js';
import { Rng, fbm, ridged, vnoise, lin, smooth, clamp } from './util.js';
import { rasterLot } from './plan.js';

const TOWN_EXT = 400;       // town map covers [-400, 400]^2
const LAND_EXT = 1800;      // landuse map covers [-1800, 1800]^2

// ------------------------------------------------------------------------------------------------ heights
export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  if (r < 402) return 0;
  const t = smooth(402, 700, r);
  let h = t * 5 * (fbm(x / 420 + 11, z / 420 - 3, 3, 5) - 0.5) * 2;
  h += smooth(900, 3200, r) * 95 * (fbm(x / 1500 + 2, z / 1500 + 9, 4, 8) - 0.35);
  h += smooth(2200, 5200, r) * 240 * (ridged(x / 2600, z / 2600, 4, 12) - 0.3);
  // keep a gentle bowl so the far hills rise towards the horizon
  h += smooth(1500, 6000, r) * 60;
  return h;
}

// ------------------------------------------------------------------------------------------------ town map
function* makeTownMapGen(plan, out) {
  // R: soft street mask (distance to street centre lines), G: plaza / squares, B: canal (crisp), from JS -> DataTexture
  const N = 2048, S = N / (2 * TOWN_EXT);
  const data = new Uint8Array(N * N * 4);
  // A = distance to the nearest street centre line (5 cm units, 255 = far / not a street)
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const seg = (ax, az, bx, bz, hw, soft, ch, test) => {
    const pad = hw + soft + 0.5;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad + TOWN_EXT) * S)), i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + pad + TOWN_EXT) * S));
    const k0 = Math.max(0, Math.floor((Math.min(az, bz) - pad + TOWN_EXT) * S)), k1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + pad + TOWN_EXT) * S));
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
    for (let k = k0; k <= k1; k++) {
      const z = (k + 0.5) / S - TOWN_EXT;
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) / S - TOWN_EXT;
        let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + dx * t - x, qz = az + dz * t - z;
        const d = Math.sqrt(qx * qx + qz * qz);
        let v = soft > 0 ? (hw + soft * 0.5 - d) / soft : (d < hw ? 1 : 0);
        if (v <= 0) continue;
        if (test && !test(x, z)) continue;
        v = Math.min(255, Math.round(v * 255));
        const o = (k * N + i) * 4 + ch;
        if (v > data[o]) data[o] = v;
        if (ch === 0) { const dq = Math.min(254, Math.round(d * 20)); const oa = (k * N + i) * 4 + 3; if (dq < data[oa]) data[oa] = dq; }
      }
    }
  };
  for (const st of plan.streets) {
    const p = st.poly.pts;
    for (let j = 1; j < p.length; j++) { seg(p[j - 1][0], p[j - 1][1], p[j][0], p[j][1], st.w / 2, 1.4, 0, null); if (j % 12 === 0) yield; }
    yield;
  }
  const cp = plan.canal.poly.pts;
  const notBridge = (x, z) => { const c = plan.cellIdx(x, z); return c < 0 || plan.street[c] !== 1; };
  for (let j = 1; j < cp.length; j++) { seg(cp[j - 1][0], cp[j - 1][1], cp[j][0], cp[j][1], plan.canal.w / 2 + 0.1, 0, 2, notBridge); if (j % 12 === 0) yield; }
  // plaza / squares from the 1 m raster
  const G = 800;
  for (let cz = 0; cz < G; cz++) for (let cx = 0; cx < G; cx++) {
    if (cx === 0 && cz % 40 === 0) yield;
    if (plan.street[cz * G + cx] !== 2) continue;
    const i0 = Math.floor(cx * S), k0 = Math.floor(cz * S), i1 = Math.floor((cx + 1) * S), k1 = Math.floor((cz + 1) * S);
    for (let k = k0; k < k1; k++) for (let i = i0; i < i1; i++) { const o = (k * N + i) * 4; data[o + 1] = 255; data[o] = 255; }
  }
  yield;
  const tMap = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tMap.colorSpace = THREE.NoColorSpace; tMap.anisotropy = 8; tMap.generateMipmaps = true;
  tMap.minFilter = THREE.LinearMipmapLinearFilter; tMap.magFilter = THREE.LinearFilter;
  tMap.wrapS = tMap.wrapT = THREE.ClampToEdgeWrapping;
  tMap.needsUpdate = true;
  // contact AO from building footprints
  const A = 1024, SA = A / (2 * TOWN_EXT);
  const ca = document.createElement('canvas'); ca.width = ca.height = A;
  const ga = ca.getContext('2d');
  ga.fillStyle = '#fff'; ga.fillRect(0, 0, A, A);
  ga.fillStyle = 'rgba(0,0,0,0.9)';
  for (const l of plan.lots) {
    ga.save(); ga.translate((l.x + TOWN_EXT) * SA, (l.z + TOWN_EXT) * SA); ga.rotate(l.a);
    ga.fillRect((-l.w / 2 - 0.25) * SA, (-l.d / 2 - 0.25) * SA, (l.w + 0.5) * SA, (l.d + 0.9) * SA); ga.restore();
  }
  // the wall's foot
  ga.strokeStyle = 'rgba(0,0,0,0.7)'; ga.lineWidth = 7 * SA; ga.beginPath(); ga.arc(A / 2, A / 2, 381 * SA, 0, Math.PI * 2); ga.stroke();
  {
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = A;
    const gt = tmp.getContext('2d'); gt.filter = 'blur(1.6px)'; gt.drawImage(ca, 0, 0);
    ga.globalCompositeOperation = 'copy'; ga.drawImage(tmp, 0, 0); ga.globalCompositeOperation = 'source-over';
  }
  const tAO = new THREE.CanvasTexture(ca);
  tAO.colorSpace = THREE.NoColorSpace; tAO.flipY = false; tAO.minFilter = THREE.LinearMipmapLinearFilter; tAO.magFilter = THREE.LinearFilter;
  out.tMap = tMap; out.tAO = tAO;
}

// ------------------------------------------------------------------------------------------------ landuse map
function* makeLandMapGen(rng, out) {
  const N = 2048, S = N / (2 * LAND_EXT);
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const dv = document.createElement('canvas'); dv.width = dv.height = 1024; // data: R angle, G stripe strength, B type
  const gd = dv.getContext('2d');
  const SD = 1024 / (2 * LAND_EXT);
  const X = (x) => (x + LAND_EXT) * S, Z = (z) => (z + LAND_EXT) * S;
  // meadow base
  g.fillStyle = '#6f7a45'; g.fillRect(0, 0, N, N);
  gd.fillStyle = 'rgb(0,0,40)'; gd.fillRect(0, 0, 1024, 1024);
  const crops = [
    ['#b59a55', 0.9, 90], ['#c4a862', 0.8, 90], ['#8f8a48', 0.7, 90], ['#6d6a3a', 0.6, 90], // wheat/barley/rye/stubble
    ['#5d6b35', 0.7, 110], ['#71803f', 0.5, 110], ['#4f5e2e', 0.8, 110],                    // green crops
    ['#6b5237', 1.0, 150], ['#7a5d3e', 1.0, 150], ['#5a4530', 0.9, 150],                    // ploughed
    ['#7c874c', 0.2, 40], ['#667240', 0.15, 40],                                              // meadow / fallow
  ];
  const hedges = [];
  const fields = [];
  // radial blocks between ring roads, subdivided into long strips (medieval open fields)
  const rings = [412, 520, 660, 820, 1000, 1200, 1420, 1650, 1800];
  for (let ri = 0; ri + 1 < rings.length; ri++) {
    const r0 = rings[ri], r1 = rings[ri + 1];
    const nA = Math.round((Math.PI * 2 * (r0 + r1) / 2) / rng.range(150, 260));
    const off = rng.range(0, 1);
    for (let ai = 0; ai < nA; ai++) {
      const a0 = ((ai + off) / nA) * Math.PI * 2, a1 = ((ai + 1 + off) / nA) * Math.PI * 2;
      if (rng.chance(0.06)) continue; // wild patch
      const nS = rng.int(3, 9);
      const radialStrips = rng.chance(0.5);
      for (let si = 0; si < nS; si++) {
        let p;
        if (radialStrips) {
          const b0 = a0 + (a1 - a0) * (si / nS), b1 = a0 + (a1 - a0) * ((si + 1) / nS);
          p = [[b0, r0], [b1, r0], [b1, r1], [b0, r1]];
        } else {
          const q0 = r0 + (r1 - r0) * (si / nS), q1 = r0 + (r1 - r0) * ((si + 1) / nS);
          p = [[a0, q0], [a1, q0], [a1, q1], [a0, q1]];
        }
        const pts = p.map(([a, r]) => [Math.cos(a) * r + (vnoise(a * 9, r / 60, 3) - 0.5) * 8, Math.sin(a) * r + (vnoise(r / 60, a * 9, 4) - 0.5) * 8]);
        const c = rng.pick(crops);
        const ang = radialStrips ? (a0 + a1) / 2 : (a0 + a1) / 2 + Math.PI / 2;
        fields.push({ pts, c, ang });
      }
      hedges.push([[Math.cos(a0) * r0, Math.sin(a0) * r0], [Math.cos(a0) * r1, Math.sin(a0) * r1]]);
    }
    const arc = []; for (let k = 0; k <= 180; k++) { const a = (k / 180) * Math.PI * 2; arc.push([Math.cos(a) * r1, Math.sin(a) * r1]); }
    if (ri % 2 === 1) hedges.push(arc);
  }
  yield;
  let nf = 0;
  for (const f of fields) {
    if (++nf % 150 === 0) yield;
    g.fillStyle = f.c[0];
    g.beginPath(); f.pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.closePath(); g.fill();
    const ang = ((f.ang % Math.PI) + Math.PI) % Math.PI;
    gd.fillStyle = `rgb(${Math.round((ang / Math.PI) * 255)},${Math.round(f.c[1] * 255)},${f.c[2]})`;
    gd.beginPath(); f.pts.forEach(([x, z], i) => (i ? gd.lineTo((x + LAND_EXT) * SD, (z + LAND_EXT) * SD) : gd.moveTo((x + LAND_EXT) * SD, (z + LAND_EXT) * SD))); gd.closePath(); gd.fill();
  }
  // field margins (thin grassy borders)
  g.strokeStyle = 'rgba(95,105,60,0.8)'; g.lineWidth = 1.2;
  for (const f of fields) { g.beginPath(); f.pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.closePath(); g.stroke(); }
  yield;
  // forests (noise blobs beyond ~800 m)
  const forest = [];
  for (let k = 0; k < 9000; k++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(700, 1800);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const f = fbm(x / 380, z / 380, 3, 77);
    if (f > 0.6 - smooth(700, 1800, r) * 0.12) forest.push([x, z]);
  }
  g.fillStyle = '#2f3a20';
  for (const [x, z] of forest) { g.beginPath(); g.arc(X(x), Z(z), 9 * S * 2.2, 0, Math.PI * 2); g.fill(); }
  gd.fillStyle = 'rgb(0,0,200)';
  for (const [x, z] of forest) { gd.beginPath(); gd.arc((x + LAND_EXT) * SD, (z + LAND_EXT) * SD, 9 * SD * 2.2, 0, Math.PI * 2); gd.fill(); }
  yield;
  // hedgerows
  g.strokeStyle = '#3a4526'; g.lineWidth = 3.2 * S; g.lineCap = 'round';
  for (const h of hedges) { g.beginPath(); h.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke(); }
  // roads: ring road around the wall + radial roads from the gates + a few winding tracks
  const roads = [];
  const ringRoad = []; for (let k = 0; k <= 240; k++) { const a = (k / 240) * Math.PI * 2; const r = 416 + (vnoise(a * 3, 1, 9) - 0.5) * 6; ringRoad.push([Math.cos(a) * r, Math.sin(a) * r]); }
  roads.push({ pts: ringRoad, w: 7 });
  const radialRoad = (a0, len, w, wob) => {
    const pts = []; let a = a0;
    for (let r = 398; r < len; r += 20) { a += (vnoise(r / 200, a0 * 5, 21) - 0.5) * wob; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    roads.push({ pts, w });
  };
  radialRoad(Math.PI / 2, 2600, 9, 0.02);     // south road from the outer gate
  radialRoad(-Math.PI / 2, 2600, 9, 0.02);    // north road
  for (const a of [0.2, 1.1, 2.3, 2.9, 3.7, 4.4, 5.3, 5.9]) radialRoad(a, 1800, 4.5, 0.06);
  for (const rd of roads) {
    g.strokeStyle = '#8a7556'; g.lineWidth = rd.w * S + 1; g.beginPath(); rd.pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke();
    g.strokeStyle = '#9c8662'; g.lineWidth = rd.w * S * 0.55; g.beginPath(); rd.pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke();
    gd.strokeStyle = 'rgb(0,0,250)'; gd.lineWidth = rd.w * SD + 1; gd.beginPath(); rd.pts.forEach(([x, z], i) => (i ? gd.lineTo((x + LAND_EXT) * SD, (z + LAND_EXT) * SD) : gd.moveTo((x + LAND_EXT) * SD, (z + LAND_EXT) * SD))); gd.stroke();
  }
  yield;
  // trampled apron around the wall base
  g.strokeStyle = 'rgba(120,105,80,0.9)'; g.lineWidth = 16 * S; g.beginPath(); g.arc(N / 2, N / 2, 403 * S, 0, Math.PI * 2); g.stroke();
  const tLand = new THREE.CanvasTexture(cv);
  tLand.colorSpace = THREE.SRGBColorSpace; tLand.flipY = false; tLand.anisotropy = 8; tLand.minFilter = THREE.LinearMipmapLinearFilter;
  const tLandD = new THREE.CanvasTexture(dv);
  tLandD.colorSpace = THREE.NoColorSpace; tLandD.flipY = false; tLandD.minFilter = THREE.LinearFilter; tLandD.magFilter = THREE.NearestFilter; tLandD.generateMipmaps = false;
  Object.assign(out, { tLand, tLandD, forest, hedges, roads, fields });
}

// ------------------------------------------------------------------------------------------------ shaders
export const GROUND_GLSL = /* glsl */`
uniform sampler2D tMap;
uniform sampler2D tAO;
uniform sampler2D tLand;
uniform sampler2D tLandD;
vec3 voroG(vec2 p) {
  vec2 ip = floor(p), fp = fract(p);
  float F1 = 9.0, F2 = 9.0; vec2 id = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(ip + g) * 0.75 + 0.125;
    vec2 r = g + o - fp; float d = dot(r, r);
    if (d < F1) { F2 = F1; F1 = d; id = ip + g; } else if (d < F2) F2 = d;
  }
  return vec3(sqrt(F1), sqrt(F2) - sqrt(F1), hash12(id));
}
Surf townGround(vec2 w) {
  vec2 muv = (w + 400.0) / 800.0;
  vec4 m = texture(tMap, muv);
  float ao = texture(tAO, muv).r;
  float lod = smoothstep(0.02, 0.07, gPx);
  // yard: packed earth, straw, grass tufts
  float n1 = nM(w * 0.05), n2 = nH(w * 0.23), n3 = nF(w * 0.9);
  vec3 dirt = mix(vec3(0.16, 0.125, 0.085), vec3(0.22, 0.18, 0.12), n2) * (0.8 + 0.3 * n3);
  float grass = smoothstep(0.45, 0.7, n1 + 0.2 * n2);
  vec3 yard = mix(dirt, vec3(0.09, 0.12, 0.045) * (0.7 + 0.6 * n3), grass * 0.85);
  Surf s = surfInit(yard, 0.95);
  s.h = (n2 - 0.5) * 0.02;
  // cobbles
  float street = m.r;
  if (street > 0.02) {
    // street-aligned frame from the centre-line distance field (A)
    float dc = m.a * 12.75;
    const float E = 0.75 / 800.0;
    vec2 gr = vec2(texture(tMap, muv + vec2(E, 0.0)).a - texture(tMap, muv - vec2(E, 0.0)).a, texture(tMap, muv + vec2(0.0, E)).a - texture(tMap, muv - vec2(0.0, E)).a);
    vec2 acr = length(gr) > 1e-5 ? normalize(gr) : vec2(1.0, 0.0);
    vec2 alo = vec2(-acr.y, acr.x);
    float along = dot(w, alo);
    vec3 v = voroG(w / 0.24);
    float stone = smoothstep(0.03, 0.16, v.y);
    float vz = mix(v.z, 0.5, lod);
    vec3 sc = mix(vec3(0.2, 0.19, 0.175), vec3(0.3, 0.27, 0.23), vz) * (0.7 + 0.5 * mix(hash12(vec2(v.z, 3.1)), 0.5, lod));
    sc = mix(sc, sc * vec3(0.8, 0.85, 1.0), step(0.8, v.z) * 0.6 * (1.0 - lod));
    sc *= 0.85 + 0.25 * n2;
    vec3 gap = vec3(0.07, 0.06, 0.05) * (0.8 + 0.5 * n3);
    vec3 cob = mix(gap, sc * (0.75 + 0.35 * (1.0 - v.x)), mix(stone, 0.8, lod));
    // gutters: soft street edge -> darker, damp
    float gut = 1.0 - smoothstep(0.35, 0.8, street);
    cob *= 1.0 - 0.35 * gut;
    // wear: lighter polished track in the middle, dirt at edges
    cob = mix(cob, dirt * 0.9, (1.0 - smoothstep(0.2, 0.6, street)) * 0.5);
    float rough = mix(0.95, 0.84, stone);
    float hh = (stone * 0.03 * (1.0 - v.x)) * (1.0 - lod);
    // repair patches / batches of setts (3-8 m) -> the paving reads at distance
    float rpat = nL(w * 0.035 + 7.0);
    cob *= 0.82 + 0.36 * smoothstep(0.3, 0.75, rpat);
    cob = mix(cob, cob * vec3(1.08, 1.0, 0.9), smoothstep(0.55, 0.8, nM(w * 0.06)) * 0.6);
    // wheel-track slabs: two pale strips of flat granite either side of the centre line
    float tr = (1.0 - smoothstep(0.22, 0.34, abs(dc - 0.8))) * 0.85;
    if (tr > 0.0) {
      float sl = fract(along / 1.15 + hash12(vec2(floor(dc), 3.0)));
      float joint = smoothstep(0.0, 0.03, sl) * (1.0 - smoothstep(0.97, 1.0, sl));
      float id = floor(along / 1.15);
      vec3 slab = vec3(0.27, 0.255, 0.235) * (0.85 + 0.25 * hash12(vec2(id, floor(dc * 2.0)))) * (0.85 + 0.2 * n2);
      float rut = 1.0 - smoothstep(0.03, 0.09, abs(dc - 0.8));
      slab *= 1.0 - 0.3 * rut;
      slab *= mix(0.55, 1.0, mix(joint, 1.0, lod));
      cob = mix(cob, slab, tr);
      rough = mix(rough, 0.78 - 0.1 * rut, tr);
      hh = mix(hh, 0.012 * joint * (1.0 - lod) - 0.01 * rut, tr);
    }
    // central drain channel (Mittelrinne): a dark, damp V of flat slabs along the centre line
    float ch = 1.0 - smoothstep(0.2, 0.3, dc);
    if (ch > 0.0) {
      float cs = fract(along / 0.55);
      float cj = smoothstep(0.0, 0.06, cs) * (1.0 - smoothstep(0.94, 1.0, cs));
      vec3 cc = vec3(0.1, 0.095, 0.09) * (0.8 + 0.4 * hash12(vec2(floor(along / 0.55), 4.0))) * mix(0.6, 1.0, mix(cj, 1.0, lod));
      cob = mix(cob, cc, ch);
      rough = mix(rough, 0.45, ch);
      hh = mix(hh, -0.03 + dc * 0.08, ch);
    }
    // central wear: smoother, paler
    cob = mix(cob, cob * 1.08, (1.0 - smoothstep(0.3, 2.2, dc)) * 0.5);
    // gutter band along the facades: flat slabs, dark and damp, puddles
    float gutter = (1.0 - smoothstep(0.62, 0.93, street)) * smoothstep(0.5, 0.58, street);
    // kerb / doorstep band: pale dressed stone right against the facades (35 cm)
    float kerb = smoothstep(0.26, 0.32, street) * (1.0 - smoothstep(0.5, 0.56, street));
    if (kerb > 0.0) {
      float ks = fract(along / 0.95);
      float kj = smoothstep(0.0, 0.04, ks) * (1.0 - smoothstep(0.96, 1.0, ks));
      vec3 kc = vec3(0.38, 0.355, 0.31) * (0.85 + 0.25 * hash12(vec2(floor(along / 0.95), 7.0))) * mix(0.6, 1.0, mix(kj, 1.0, lod)) * (0.8 + 0.25 * n2);
      cob = mix(cob, kc, kerb);
      rough = mix(rough, 0.8, kerb);
      hh = mix(hh, 0.04 * kj * (1.0 - lod) + 0.02, kerb);
    }
    if (gutter > 0.0) {
      float gs = fract(along / 0.7);
      float gj = smoothstep(0.0, 0.05, gs) * (1.0 - smoothstep(0.95, 1.0, gs));
      vec3 gc = vec3(0.16, 0.15, 0.14) * (0.8 + 0.4 * hash12(vec2(floor(along / 0.7), 9.0))) * mix(0.6, 1.0, mix(gj, 1.0, lod));
      cob = mix(cob, gc, gutter);
      rough = mix(rough, 0.72, gutter);
      hh = mix(hh, -0.02 + 0.008 * gj * (1.0 - lod), gutter);
    }
    float puddle = smoothstep(0.66, 0.74, nM(w * 0.09 + 3.0)) * (0.3 + 0.7 * gutter);
    cob = mix(cob, cob * 0.45, puddle * 0.8);
    rough = mix(rough, 0.18, puddle);
    // grime / dirt swept against the houses
    cob = mix(cob, dirt * 0.7, (1.0 - smoothstep(0.15, 0.55, street)) * 0.7);
    float k = smoothstep(0.02, 0.25, street);
    s.alb = mix(s.alb, cob, k);
    s.rough = mix(s.rough, rough, k);
    s.h = mix(s.h, hh * (1.0 - puddle), k);
  }
  // plaza flagstones
  if (m.g > 0.5) {
    vec2 q = w / vec2(0.9, 0.62);
    q.x += 0.5 * mod(floor(q.y), 2.0) + 0.3 * hash12(vec2(floor(q.y), 1.0));
    vec2 f = fract(q), id = floor(q);
    float e = min(min(f.x, 1.0 - f.x) * 0.9, min(f.y, 1.0 - f.y) * 0.62);
    float h = hash12(id);
    vec3 fc = mix(vec3(0.3, 0.28, 0.25), vec3(0.4, 0.37, 0.32), h) * (0.8 + 0.3 * n2);
    fc *= mix(0.55, 1.0, mix(smoothstep(0.0, 0.03, e), 1.0, lod));
    s.alb = mix(s.alb, fc, smoothstep(0.5, 0.7, m.g));
    s.rough = 0.88;
    s.h = 0.01 * smoothstep(0.0, 0.03, e) * (1.0 - lod);
  }
  s.alb *= mix(0.42, 1.0, ao);
  s.ao = mix(0.5, 1.0, ao);
  if (m.b > 0.5 && vWPos.y > -0.5) discard;
  return s;
}
Surf terrain(vec2 w) {
  float r = length(w);
  vec2 luv = (w + ${LAND_EXT.toFixed(1)}) / ${(2 * LAND_EXT).toFixed(1)};
  float inMap = step(max(abs(w.x), abs(w.y)), ${(LAND_EXT - 10).toFixed(1)});
  vec3 base = texture(tLand, luv).rgb;
  vec4 dat = texture(tLandD, luv);
  float n1 = nL(w * 0.002), n2 = nM(w * 0.02), n3 = nH(w * 0.11), n4 = nF(w * 0.6);
  // far procedural cover: meadow / forest / rock blend
  vec3 far = mix(vec3(0.09, 0.11, 0.05), vec3(0.14, 0.15, 0.08), n2);
  far = mix(far, vec3(0.035, 0.05, 0.025), smoothstep(0.45, 0.65, nL(w * 0.0012 + 3.0)));
  far = mix(far, vec3(0.2, 0.18, 0.15), smoothstep(0.35, 0.8, (vWPos.y - 120.0) / 200.0) * (0.5 + 0.5 * n2));
  vec3 c = mix(far, base, inMap);
  float type = dat.b;
  // crop rows
  float ang = dat.r * 3.14159;
  vec2 dir = vec2(cos(ang), sin(ang));
  float across = dot(w, vec2(-dir.y, dir.x));
  float rows = abs(fract(across / 0.9) - 0.5);
  float rowsAA = 1.0 - smoothstep(0.04, 0.3, gPx);
  float strength = dat.g * inMap * step(type, 0.7);
  c *= 1.0 - strength * 0.28 * (1.0 - smoothstep(0.15, 0.35, rows)) * rowsAA;
  c *= 1.0 - strength * 0.12 * smoothstep(0.3, 0.7, nH(vec2(dot(w, dir) * 0.02, across * 0.1)));
  // big-scale patchiness + fine noise
  c *= 0.85 + 0.3 * n1;
  c *= 0.88 + 0.2 * n3 + 0.1 * (n4 - 0.5);
  Surf s = surfInit(c, 0.95);
  s.h = (n3 - 0.5) * 0.05 + strength * 0.04 * (1.0 - smoothstep(0.15, 0.35, rows)) * rowsAA;
  return s;
}
Surf surf() {
  if (vMat.x < 0.5) return townGround(vWPos.xz);
  if (vMat.x < 1.5) return terrain(vWPos.xz);
  // 2: water (canal)
  vec2 w = vWPos.xz;
  float n = nH(w * 0.15 + vec2(uTime * 0.02, uTime * 0.013)) + nF(w * 0.6 - uTime * 0.05) * 0.5;
  Surf s = surfInit(vec3(0.03, 0.045, 0.035), 0.06);
  s.h = n * 0.06;
  vec3 R = reflect(-gVW, vec3(0.0, 1.0, 0.0));
  float fres = 0.03 + 0.97 * pow(1.0 - clamp(gVW.y, 0.0, 1.0), 5.0);
  s.emis = skyRefl(R, (n - 0.7) * 0.2) * fres * 0.7;
  return s;
}
`;

// ------------------------------------------------------------------------------------------------ build
export function buildGround(ctx, shared, plan, solids) {
  const rng = new Rng(555);
  const group = new THREE.Group(); group.name = 'ground';
  const out = { group, land: null, tMap: null, tAO: null };
  const mat = shared.groundMat;
  // --- town disc ---
  {
    const gb = new GB(20000);
    gb.set({ mat: 0, col: [1, 1, 1] });
    const rings = [0, 60, 120, 180, 240, 300, 350, 400.5];
    const seg = 128;
    for (let ri = 0; ri + 1 < rings.length; ri++) {
      const r0 = rings[ri], r1 = rings[ri + 1];
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
        const p = (a, r) => [Math.cos(a) * r, 0, Math.sin(a) * r];
        if (r0 === 0) gb.poly([p(a0, r1), [0, 0, 0], p(a1, r1)].reverse().reverse(), null, [0, 1, 0]);
        else gb.poly([p(a0, r1), p(a0, r0), p(a1, r0), p(a1, r1)].reverse().reverse(), null, [0, 1, 0]);
      }
    }
    const mesh = new THREE.Mesh(gb.build(), mat);
    // ensure faces point up
    fixUp(mesh.geometry);
    mesh.receiveShadow = true; mesh.name = 'town-ground';
    group.add(mesh);
  }
  // --- canal: embankments, coping, water, bridges ---
  const canal = plan.canal;
  {
    const gb = new GB(20000);
    const pts = canal.poly.pts;
    const hw = canal.w / 2;
    const off = (i, s) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const tx = b[0] - a[0], tz = b[1] - a[1], L = Math.hypot(tx, tz) || 1;
      return [pts[i][0] + (-tz / L) * s, pts[i][1] + (tx / L) * s];
    };
    const inTown = (p) => Math.hypot(p[0], p[1]) < 377;
    let dist = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      if (!inTown(pts[i]) || !inTown(pts[i + 1])) continue;
      const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      for (const side of [-1, 1]) {
        const A = off(i, side * hw), B = off(i + 1, side * hw);
        const Ao = off(i, side * (hw + 0.7)), Bo = off(i + 1, side * (hw + 0.7));
        gb.set({ mat: 4, p2: 0.42, col: lin(0x8f8574), id: 0 });
        // wall facing the canal (towards -side normal)
        if (side < 0) gb.poly([[A[0], canal.bedY, A[1]], [B[0], canal.bedY, B[1]], [B[0], 0.14, B[1]], [A[0], 0.14, A[1]]]);
        else gb.poly([[B[0], canal.bedY, B[1]], [A[0], canal.bedY, A[1]], [A[0], 0.14, A[1]], [B[0], 0.14, B[1]]]);
        // coping
        gb.set({ mat: 4, p2: 0.3, col: lin(0xa39a88) });
        const up = side > 0 ? [[A[0], 0.14, A[1]], [Ao[0], 0.14, Ao[1]], [Bo[0], 0.14, Bo[1]], [B[0], 0.14, B[1]]] : [[B[0], 0.14, B[1]], [Bo[0], 0.14, Bo[1]], [Ao[0], 0.14, Ao[1]], [A[0], 0.14, A[1]]];
        gb.poly(up, null, [0, 1, 0]);
        gb.poly(side > 0 ? [[Ao[0], 0, Ao[1]], [Bo[0], 0, Bo[1]], [Bo[0], 0.14, Bo[1]], [Ao[0], 0.14, Ao[1]]] : [[Bo[0], 0, Bo[1]], [Ao[0], 0, Ao[1]], [Ao[0], 0.14, Ao[1]], [Bo[0], 0.14, Bo[1]]]);
      }
      dist += seg;
    }
    const stoneMesh = new THREE.Mesh(gb.build(), shared.buildingMat);
    fixWinding(stoneMesh.geometry);
    stoneMesh.castShadow = true; stoneMesh.receiveShadow = true; stoneMesh.name = 'canal-walls';
    group.add(stoneMesh);
    // water
    const gw = new GB(4000);
    gw.set({ mat: 2 });
    for (let i = 0; i + 1 < pts.length; i++) {
      if (!inTown(pts[i]) && !inTown(pts[i + 1])) continue;
      const A = off(i, -hw - 0.1), B = off(i + 1, -hw - 0.1), C = off(i + 1, hw + 0.1), D = off(i, hw + 0.1);
      gw.poly([[A[0], canal.waterY, A[1]], [B[0], canal.waterY, B[1]], [C[0], canal.waterY, C[1]], [D[0], canal.waterY, D[1]]], null, [0, 1, 0]);
    }
    const water = new THREE.Mesh(gw.build(), mat);
    fixUp(water.geometry);
    water.receiveShadow = true; water.name = 'canal-water';
    group.add(water);
    // bridges
    const gbb = new GB(20000);
    for (const br of plan.bridges) buildBridge(gbb, br, canal, solids);
    if (gbb.count) { const m = new THREE.Mesh(gbb.build(), shared.buildingMat); m.castShadow = m.receiveShadow = true; m.name = 'bridges'; group.add(m); }
  }
  ctx.scene.add(group);
  // ---------------- deferred (time-sliced) parts ----------------
  // the town map (streets / paving / contact AO) is its own job so it can run before everything else
  out.mapJob = function* () {
    const o2 = {};
    yield* makeTownMapGen(plan, o2);
    out.tMap = o2.tMap; out.tAO = o2.tAO;
    shared.groundUniforms.tMap.value = o2.tMap; shared.groundUniforms.tAO.value = o2.tAO;
  };
  out.jobs = function* () {
  {
    const land = {};
    yield* makeLandMapGen(rng, land);
    out.land = land;
    shared.groundUniforms.tLand.value = land.tLand; shared.groundUniforms.tLandD.value = land.tLandD;
    yield 'landmap';
  }
  // --- terrain outside the wall (16 sectors) ---
  {
    const radii = [400];
    while (radii[radii.length - 1] < 6500) { const r = radii[radii.length - 1]; radii.push(r + Math.max(4, r * 0.016)); }
    const NA = 768, sectors = 16;
    // heights once on the polar grid, normals from grid neighbours (no extra noise evaluations)
    const NRr = radii.length;
    const hGrid = new Float32Array(NRr * (NA + 1)), nGrid = new Float32Array(NRr * (NA + 1) * 3);
    for (let i = 0; i < NRr; i++) { for (let k = 0; k <= NA; k++) { const a = (k / NA) * Math.PI * 2; hGrid[i * (NA + 1) + k] = terrainHeight(Math.cos(a) * radii[i], Math.sin(a) * radii[i]); } if (i % 6 === 5) yield; }
    for (let i = 0; i < NRr; i++) for (let k = 0; k <= NA; k++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(NRr - 1, i + 1), ka = (k + NA - 1) % NA, kb = (k + 1) % NA;
      const a = (k / NA) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const dr = radii[i1] - radii[i0], dh_r = (hGrid[i1 * (NA + 1) + k] - hGrid[i0 * (NA + 1) + k]) / dr;
      const arc = radii[i] * (4 * Math.PI / NA), dh_t = (hGrid[i * (NA + 1) + kb] - hGrid[i * (NA + 1) + ka]) / arc;
      // gradient in world: radial (ca, sa), tangential (-sa, ca)
      const gx = dh_r * ca - dh_t * sa, gz = dh_r * sa + dh_t * ca;
      const l = Math.hypot(gx, 1, gz);
      const o = (i * (NA + 1) + k) * 3; nGrid[o] = -gx / l; nGrid[o + 1] = 1 / l; nGrid[o + 2] = -gz / l;
    }
    // south sectors (towards the outer gate / the fight) first
    const order = [...Array(sectors).keys()].sort((p, q) => Math.abs(((p + 0.5) / sectors) * 360 - 90) - Math.abs(((q + 0.5) / sectors) * 360 - 90));
    for (const sI of order) {
      yield;
      const k0 = (sI * NA) / sectors, k1 = ((sI + 1) * NA) / sectors;
      const nk = k1 - k0 + 1, nr = radii.length;
      const pos = new Float32Array(nk * nr * 3), nrm = new Float32Array(nk * nr * 3);
      for (let i = 0; i < nr; i++) for (let k = 0; k < nk; k++) {
        const a = ((k0 + k) / NA) * Math.PI * 2, r = radii[i];
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const o = (i * nk + k) * 3;
        pos[o] = x; pos[o + 1] = hGrid[i * (NA + 1) + k0 + k]; pos[o + 2] = z;
        const n = nGrid.subarray((i * (NA + 1) + k0 + k) * 3, (i * (NA + 1) + k0 + k) * 3 + 3);
        nrm[o] = n[0]; nrm[o + 1] = n[1]; nrm[o + 2] = n[2];
      }
      const idx = new Uint32Array((nr - 1) * (nk - 1) * 6);
      let q6 = 0;
      for (let i = 0; i + 1 < nr; i++) for (let k = 0; k + 1 < nk; k++) {
        const a = i * nk + k, b = a + 1, c = a + nk, d = c + 1;
        idx[q6++] = a; idx[q6++] = c; idx[q6++] = b; idx[q6++] = b; idx[q6++] = c; idx[q6++] = d;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      const n = nk * nr;
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      g.setAttribute('aUV', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
      const am = new Float32Array(n * 4); for (let q = 0; q < n; q++) am[q * 4] = 1;
      g.setAttribute('aMat', new THREE.BufferAttribute(am, 4));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      fixUp(g);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true; mesh.name = 'terrain' + sI;
      group.add(mesh);
    }
  }
  yield 'terrain';
  // --- mountain ring ---
  {
    const NA = 720, rows = 5;
    const pos = [], col = [], idx = [];
    for (let k = 0; k <= NA; k++) {
      const a = (k / NA) * Math.PI * 2;
      const hBase = 380 + 900 * Math.pow(ridged(Math.cos(a) * 3.1 + 7, Math.sin(a) * 3.1, 5, 41), 1.6) + 250 * fbm(Math.cos(a) * 9, Math.sin(a) * 9, 3, 13);
      for (let j = 0; j < rows; j++) {
        const t = j / (rows - 1);
        const r = 9400 - t * 1400 + (vnoise(a * 20, j, 3) - 0.5) * 300;
        const y = t === 0 ? -50 : hBase * Math.pow(t, 0.8) * (0.85 + 0.3 * vnoise(a * 40, j * 3, 9));
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
        const snow = smooth(0.62, 0.9, y / 1300);
        const c = [0.07 + 0.2 * snow, 0.08 + 0.2 * snow, 0.09 + 0.22 * snow];
        col.push(...c);
      }
    }
    for (let k = 0; k < NA; k++) for (let j = 0; j + 1 < rows; j++) {
      const a = k * rows + j, b = (k + 1) * rows + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    m.name = 'mountains'; m.frustumCulled = false;
    group.add(m);
  }
  yield 'mountains';
  };
  return out;
}

function buildBridge(gb, br, canal, solids) {
  // find the canal tangent at the crossing to size the skewed span
  const P = canal.poly.pts;
  let best = 1e9, tx = 1, tz = 0;
  for (let i = 1; i < P.length; i++) {
    const mx = (P[i][0] + P[i - 1][0]) / 2, mz = (P[i][1] + P[i - 1][1]) / 2;
    const d = Math.hypot(mx - br.x, mz - br.z);
    if (d < best) { best = d; const L = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); tx = (P[i][0] - P[i - 1][0]) / L; tz = (P[i][1] - P[i - 1][1]) / L; }
  }
  if (Math.hypot(br.x, br.z) > 372) return;
  const sinA = Math.abs(br.dx * tz - br.dz * tx) || 0.3;
  const span = (canal.w + 1.6) / Math.max(0.35, sinA) + 3;
  const W = br.w;
  const a = Math.atan2(br.dz, br.dx) - Math.PI / 2; // local +z along the street
  // local z = street dir: ez = (-sin f, cos f) = (dx, dz) -> f = atan2(-dx, dz)
  gb.frame(br.x, 0, br.z, Math.atan2(-br.dx, br.dz));
  const hl = span / 2, hw = W / 2;
  const stone = lin(0xa0957f);
  gb.set({ mat: 4, p2: 0.38, col: stone, id: 0 });
  // deck slab edges (the top is the street surface = town ground at y 0, we add a thin cobble-coloured slab)
  gb.box(-hw, -0.9, -hl, hw, 0.02, hl, 1 | 2);
  // parapets
  gb.set({ mat: 4, p2: 0.3, col: lin(0xb0a590) });
  for (const s of [-1, 1]) {
    const x0 = s * hw - (s > 0 ? 0.55 : 0), x1 = s * hw + (s < 0 ? 0.55 : 0);
    gb.box(Math.min(x0, x1), 0, -hl, Math.max(x0, x1), 1.0, hl, 63 & ~8);
    gb.box(Math.min(x0, x1) - 0.08, 1.0, -hl - 0.1, Math.max(x0, x1) + 0.08, 1.14, hl + 0.1, 63 & ~8);
    const c = solids.addBox(gb.wx(s * hw, 0), 0.57, gb.wz(s * hw, 0), 0.3, 0.57, hl, Math.atan2(-br.dx, br.dz), 'prop', null);
    void c;
  }
  // arch underside (segmental barrel vault) visible from the water
  gb.set({ mat: 4, p2: 0.34, col: lin(0x8a806c) });
  const n = 10, rise = 1.8, yb = canal.waterY - 0.2, yTop = -0.9;
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    const z0 = -hl + span * t0, z1 = -hl + span * t1;
    const y0 = yb + (yTop - yb - 0.2) * Math.sin(Math.PI * t0) * 0 + (yTop - yb) * Math.pow(Math.sin(Math.PI * t0), 0.5) , y1 = yb + (yTop - yb) * Math.pow(Math.sin(Math.PI * t1), 0.5);
    const two = (q) => { gb.poly(q); gb.poly(q.slice().reverse()); };
    two([[-hw, y0, z0], [-hw, y1, z1], [hw, y1, z1], [hw, y0, z0]]);
    two([[hw, y0, z0], [hw, y1, z1], [hw, 0, z1], [hw, 0, z0]]);
    two([[-hw, y0, z0], [-hw, 0, z0], [-hw, 0, z1], [-hw, y1, z1]]);
  }
  void rise; void a;
  gb.frame();
}

// make every triangle's winding agree with its vertex normal (robust against my polygon orders)
function fixWinding(g) {
  const p = g.attributes.position.array, n = g.attributes.normal.array, I = g.index.array;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[a] + cy * n[a + 1] + cz * n[a + 2] < 0) { const q = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = q; }
  }
}
function fixUp(g) {
  const p = g.attributes.position.array, n = g.attributes.normal.array, I = g.index.array;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = p[b] - p[a], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vz = p[c + 2] - p[a + 2];
    const cy = uz * vx - ux * vz;
    if (cy < 0) { const q = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = q; }
  }
  for (let i = 0; i < n.length; i += 3) if (n[i + 1] < 0) { n[i] *= -1; n[i + 1] *= -1; n[i + 2] *= -1; }
}
export { fixWinding };
