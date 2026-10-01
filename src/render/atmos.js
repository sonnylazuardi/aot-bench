// RENDER builder. Physical atmosphere model (Rayleigh + Mie + ozone, single scattering + approx multiple scattering)
// baked on the CPU into a small sky-view LUT (DataTexture, shared by sky dome, clouds, fog and env map), plus the
// shared GLSL for sky radiance and the height fog with sun in-scattering that is patched into every three material.
import * as THREE from 'three';

const RG = 6360, RT = 6460;               // km
const BR = [5.802e-3, 13.558e-3, 33.1e-3]; // rayleigh scattering /km
const BMS = 3.996e-3, BME = 4.40e-3;      // mie scattering / extinction /km
const BO = [0.650e-3, 1.881e-3, 0.085e-3];// ozone absorption /km
const HR = 8.0, HM = 1.2;

export const LUT_W = 128, LUT_H = 64;

function raySphereFar(ox, oy, oz, dx, dy, dz, r) {
  const b = ox * dx + oy * dy + oz * dz, c = ox * ox + oy * oy + oz * oz - r * r, d = b * b - c;
  if (d < 0) return -1;
  return -b + Math.sqrt(d);
}
function raySphereNear(ox, oy, oz, dx, dy, dz, r) {
  const b = ox * dx + oy * dy + oz * dz, c = ox * ox + oy * oy + oz * oz - r * r, d = b * b - c;
  if (d < 0) return -1;
  const t = -b - Math.sqrt(d);
  return t;
}

// transmittance table T(h, mu_s): h in [0,100] km (sqrt spaced), mu_s in [-0.25, 1]
const TH = 40, TM = 64;
const _tCache = new Map();
function buildTransmittance(mie) {
  if (_tCache.has(mie)) return _tCache.get(mie);
  const tab = new Float32Array(TH * TM * 3);
  for (let j = 0; j < TH; j++) {
    const h = Math.pow(j / (TH - 1), 2) * 100;
    for (let i = 0; i < TM; i++) {
      const mu = -0.25 + 1.25 * i / (TM - 1);
      const ox = 0, oy = RG + h, oz = 0;
      const dx = Math.sqrt(Math.max(0, 1 - mu * mu)), dy = mu, dz = 0;
      const k = (j * TM + i) * 3;
      const tg = raySphereNear(ox, oy, oz, dx, dy, dz, RG);
      if (tg > 0) { tab[k] = tab[k + 1] = tab[k + 2] = 0; continue; }
      const t = raySphereFar(ox, oy, oz, dx, dy, dz, RT);
      const N = 20, dt = t / N; let r = 0, m = 0, o = 0;
      for (let s = 0; s < N; s++) {
        const tt = (s + 0.5) * dt;
        const px = ox + dx * tt, py = oy + dy * tt;
        const hh = Math.sqrt(px * px + py * py) - RG;
        r += Math.exp(-hh / HR) * dt; m += Math.exp(-hh / HM) * dt; o += Math.max(0, 1 - Math.abs(hh - 25) / 15) * dt;
      }
      for (let c = 0; c < 3; c++) tab[k + c] = Math.exp(-(BR[c] * r + BME * mie * m + BO[c] * o));
    }
  }
  _tCache.set(mie, tab);
  return tab;
}
function sampleT(tab, h, mu, out) {
  const fj = Math.sqrt(Math.min(Math.max(h, 0), 100) / 100) * (TH - 1);
  const fi = (Math.min(Math.max(mu, -0.25), 1) + 0.25) / 1.25 * (TM - 1);
  const j0 = Math.min(fj | 0, TH - 2), i0 = Math.min(fi | 0, TM - 2);
  const aj = fj - j0, ai = fi - i0;
  for (let c = 0; c < 3; c++) {
    const a = tab[(j0 * TM + i0) * 3 + c], b = tab[(j0 * TM + i0 + 1) * 3 + c];
    const d = tab[((j0 + 1) * TM + i0) * 3 + c], e = tab[((j0 + 1) * TM + i0 + 1) * 3 + c];
    out[c] = (a * (1 - ai) + b * ai) * (1 - aj) + (d * (1 - ai) + e * ai) * aj;
  }
  return out;
}

/** Fast sun transmittance from the cached table (radians). */
export function sunTransmittanceFast(el, mie, out = [0, 0, 0]) { return sampleT(buildTransmittance(mie), 0.05, Math.sin(el), out); }
/** Sun transmittance to the ground observer for a sun at elevation `el` (radians). */
export function sunTransmittance(el, mie = 1) {
  const tab = buildTransmittance(mie);
  return sampleT(tab, 0.05, Math.sin(el), [0, 0, 0]);
}

/**
 * Sky-view LUT: radiance for unit sun illuminance. u = azimuth from the sun [0, PI], v = elevation (sqrt-mapped).
 * Returns { data: Float32Array RGBA, sunT: [r,g,b] }.
 */
export function computeSkyLUT(sunEl, { mie = 1.6, ms = 1.0, viewH = 0.05, groundAlbedo = 0.15 } = {}) {
  const tab = buildTransmittance(mie);
  const data = new Float32Array(LUT_W * LUT_H * 4);
  const sx = Math.cos(sunEl), sy = Math.sin(sunEl), sz = 0;
  const tv = [0, 0, 0];
  const g = 0.8, g2 = g * g;
  for (let y = 0; y < LUT_H; y++) {
    const v = (y + 0.5) / LUT_H * 2 - 1;
    const el = Math.sign(v) * v * v * Math.PI * 0.5;
    for (let x = 0; x < LUT_W; x++) {
      const az = (x + 0.5) / LUT_W * Math.PI;
      const dx = Math.cos(el) * Math.cos(az), dy = Math.sin(el), dz = Math.cos(el) * Math.sin(az);
      const ox = 0, oy = RG + viewH, oz = 0;
      const tg = raySphereNear(ox, oy, oz, dx, dy, dz, RG);
      const ground = tg > 0;
      const tMax = ground ? tg : raySphereFar(ox, oy, oz, dx, dy, dz, RT);
      const mu = dx * sx + dy * sy + dz * sz;
      const pR = 3 / (16 * Math.PI) * (1 + mu * mu);
      const pM = 3 / (8 * Math.PI) * (1 - g2) * (1 + mu * mu) / ((2 + g2) * Math.pow(Math.max(1 + g2 - 2 * g * mu, 1e-4), 1.5));
      let L0 = 0, L1 = 0, L2 = 0, T0 = 1, T1 = 1, T2 = 1, tPrev = 0;
      const N = 20;
      for (let s = 0; s < N; s++) {
        const f = (s + 1) / N;
        const t = tMax * f * f, dt = t - tPrev, tm = (t + tPrev) * 0.5; tPrev = t;
        const px = ox + dx * tm, py = oy + dy * tm, pz = oz + dz * tm;
        const r = Math.sqrt(px * px + py * py + pz * pz), h = r - RG;
        const dr = Math.exp(-h / HR), dm = Math.exp(-h / HM) * mie, dO = Math.max(0, 1 - Math.abs(h - 25) / 15);
        const muS = (px * sx + py * sy + pz * sz) / r;
        sampleT(tab, h, muS, tv);
        const sM = BMS * dm, eM = BME * dm, msK = ms * (0.25 / Math.PI) * Math.max(0.0, muS + 0.2);
        const sR0 = BR[0] * dr, sR1 = BR[1] * dr, sR2 = BR[2] * dr;
        const e0 = sR0 + eM + BO[0] * dO, e1 = sR1 + eM + BO[1] * dO, e2 = sR2 + eM + BO[2] * dO;
        const S0 = tv[0] * (sR0 * pR + sM * pM) + (sR0 + sM) * msK * (0.15 + 0.85 * tv[0]);
        const S1 = tv[1] * (sR1 * pR + sM * pM) + (sR1 + sM) * msK * (0.15 + 0.85 * tv[1]);
        const S2 = tv[2] * (sR2 * pR + sM * pM) + (sR2 + sM) * msK * (0.15 + 0.85 * tv[2]);
        const Te0 = Math.exp(-e0 * dt), Te1 = Math.exp(-e1 * dt), Te2 = Math.exp(-e2 * dt);
        L0 += T0 * S0 * (1 - Te0) / Math.max(e0, 1e-7); T0 *= Te0;
        L1 += T1 * S1 * (1 - Te1) / Math.max(e1, 1e-7); T1 *= Te1;
        L2 += T2 * S2 * (1 - Te2) / Math.max(e2, 1e-7); T2 *= Te2;
      }
      if (ground) {
        const px = ox + dx * tMax, py = oy + dy * tMax, pz = oz + dz * tMax;
        const r = Math.sqrt(px * px + py * py + pz * pz);
        const muS = (px * sx + py * sy + pz * sz) / r;
        sampleT(tab, 0, muS, tv);
        const k = groundAlbedo / Math.PI;
        L0 += T0 * k * (tv[0] * Math.max(muS, 0) + 0.2);
        L1 += T1 * k * (tv[1] * Math.max(muS, 0) + 0.2);
        L2 += T2 * k * (tv[2] * Math.max(muS, 0) + 0.2);
      }
      const o = (y * LUT_W + x) * 4;
      data[o] = L0; data[o + 1] = L1; data[o + 2] = L2; data[o + 3] = 1;
    }
  }
  return { data, sunT: sampleT(tab, viewH, Math.sin(sunEl), [0, 0, 0]) };
}

/** CPU lookup into LUT data (nearest-ish bilinear), for light colours. dir is world, sunDir world. */
export function sampleLUT(data, dir, sunDir, out) {
  const el = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  const dl = Math.hypot(dir.x, dir.z) || 1, sl = Math.hypot(sunDir.x, sunDir.z) || 1;
  const ca = (dir.x * sunDir.x + dir.z * sunDir.z) / (dl * sl);
  const u = Math.acos(Math.max(-1, Math.min(1, ca))) / Math.PI;
  const v = 0.5 + 0.5 * Math.sign(el) * Math.sqrt(Math.abs(el) / (Math.PI * 0.5));
  const fx = Math.min(Math.max(u * LUT_W - 0.5, 0), LUT_W - 1.001), fy = Math.min(Math.max(v * LUT_H - 0.5, 0), LUT_H - 1.001);
  const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
  for (let c = 0; c < 3; c++) {
    const a = data[(y0 * LUT_W + x0) * 4 + c], b = data[(y0 * LUT_W + x0 + 1) * 4 + c];
    const d = data[((y0 + 1) * LUT_W + x0) * 4 + c], e = data[((y0 + 1) * LUT_W + x0 + 1) * 4 + c];
    out[c] = (a * (1 - ax) + b * ax) * (1 - ay) + (d * (1 - ax) + e * ax) * ay;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared uniforms. three clones built-in material uniforms per material; these objects return themselves from
// clone() so every material keeps a live reference (update once, every material sees it).
function shared(v) { v.clone = function () { return this; }; return v; }
export function makeSharedUniforms(lutTex) {
  shared(lutTex);
  return {
    uAotSkyLUT: { value: lutTex },
    uAotSunDir: { value: shared(new THREE.Vector3(0, 1, 0)) },
    uAotSunCol: { value: shared(new THREE.Vector3(1, 1, 1)) },   // sun illuminance at the ground (rgb)
    uAotSkyK: { value: shared(new THREE.Vector4(8, 1, 0, 0)) },  // x sky scale, y aureole, z smoke pall, w time
    uAotSkyTint: { value: shared(new THREE.Vector3(1, 1, 1)) },   // zenith tint
    uAotSkyTint2: { value: shared(new THREE.Vector3(1, 1, 1)) },  // horizon tint
    uAotGlowCol: { value: shared(new THREE.Vector3(1.0, 0.55, 0.25)) },
    uAotSmokeCol: { value: shared(new THREE.Vector3(0.25, 0.2, 0.17)) },
    uAotSmokeDir: { value: shared(new THREE.Vector3(0, 0, 1)) },
    // inferno: x smoke-choke amount, y fire glow strength, z unused, w lightning sky flash
    uAotInf: { value: shared(new THREE.Vector4(0, 0, 0, 0)) },
    uAotFireCol: { value: shared(new THREE.Vector3(1.0, 0.36, 0.1)) },
    // fog: x haze density (1/m), y haze falloff (1/m), z dust density, w dust falloff
    uAotFogA: { value: shared(new THREE.Vector4(1 / 14000, 1 / 1400, 1 / 2600, 1 / 45)) },
    // x sun in-scatter gain, y mie g, z dust sun gain, w max fog opacity
    uAotFogB: { value: shared(new THREE.Vector4(1.0, 0.72, 1.0, 0.985)) },
    // rgb dust albedo tint, w ground level
    uAotFogC: { value: shared(new THREE.Vector4(0.95, 0.8, 0.62, 0)) },
  };
}

export const GLSL_SKY_PARS = /* glsl */`
uniform sampler2D uAotSkyLUT;
uniform vec3 uAotSunDir, uAotSunCol, uAotSkyTint, uAotSkyTint2, uAotGlowCol, uAotSmokeCol, uAotSmokeDir, uAotFireCol;
uniform vec4 uAotSkyK, uAotFogA, uAotFogB, uAotFogC, uAotInf;
#ifndef AOT_PI
#define AOT_PI 3.14159265359
#endif
float aotHG(float mu, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * AOT_PI * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5)); }
vec3 aotSkyLUT(vec3 dir) {
  float el = asin(clamp(dir.y, -1.0, 1.0));
  vec2 dh = normalize(dir.xz + vec2(1e-6, 0.0)); vec2 sh = normalize(uAotSunDir.xz + vec2(1e-6, 0.0));
  float u = acos(clamp(dot(dh, sh), -1.0, 1.0)) / AOT_PI;
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (AOT_PI * 0.5));
  return texture2D(uAotSkyLUT, vec2(u, v)).rgb;
}
// smoke pall (after the breach): brown-grey darkening low in the sky toward the gate
float aotSmokeMask(vec3 dir) {
  if (uAotSkyK.z <= 0.0) return 0.0;
  vec2 d = normalize(dir.xz + vec2(1e-6, 0.0));
  float az = dot(d, normalize(uAotSmokeDir.xz));
  float m = smoothstep(-0.3, 0.9, az) * exp(-max(dir.y - 0.02, 0.0) * 4.0);
  return clamp(m * uAotSkyK.z, 0.0, 0.92);
}
// lutDir: direction used for the LUT (may be squashed toward the horizon); dir: true view direction (sun lobes)
vec3 aotSkyAt(vec3 lutDir, vec3 dir, float corona) {
  vec3 c = aotSkyLUT(lutDir) * uAotSkyK.x * mix(uAotSkyTint2, uAotSkyTint, smoothstep(0.0, 0.55, max(lutDir.y, 0.0)));
  float mu = dot(dir, uAotSunDir);
  float mp = max(mu, 0.0);
  float hz = exp(-max(lutDir.y, 0.0) * 3.2);
  // golden-hour aureole: warm forward-scattering haze around the low sun, strongest near the horizon
  float lobe = (0.5 * pow(mp, 12.0) + 0.22 * pow(mp, 3.0) * hz + 0.08 * hz + corona * 2.5 * pow(mp, 220.0)) * uAotSkyK.y;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(l), clamp(lobe * 0.3, 0.0, 0.5)) + uAotSunCol * uAotGlowCol * lobe * 0.06;
  float sm = aotSmokeMask(dir);
  c = mix(c, uAotSmokeCol * (0.35 + 0.65 * l / max(dot(uAotSmokeCol, vec3(0.33)), 1e-3)) + uAotSunCol * uAotGlowCol * pow(mp, 6.0) * 0.08, sm);
  // inferno: smoke-choked charcoal-brown sky, fire glow low on the horizon, blood-orange haze around the sun
  if (uAotInf.x > 0.0) {
    float up = max(lutDir.y, 0.0);
    // warm smoke low, cool steel grey-blue high (holes in the smoke banks read cold: warm/cool contrast)
    vec3 steel = vec3(0.085, 0.1, 0.12) * (uAotSkyK.x / 6.0);
    vec3 warmLow = uAotSmokeCol * (0.6 + 0.8 * exp(-up * 2.5));
    vec3 smokeSky = mix(warmLow, steel, smoothstep(0.06, 0.5, up)) + uAotSunCol * uAotGlowCol * (pow(mp, 5.0) * 0.1 + pow(mp, 40.0) * 0.25);
    c = mix(c, smokeSky, uAotInf.x);
    vec2 gd = normalize(dir.xz + vec2(1e-6, 0.0));
    float towardGate = 0.55 + 0.45 * dot(gd, normalize(uAotSmokeDir.xz));
    c += uAotFireCol * uAotInf.y * exp(-up * 5.5) * towardGate;
    // hot zone right behind the breach: the giant silhouettes against it
    float gateK = pow(max(dot(gd, normalize(uAotSmokeDir.xz)), 0.0), 10.0);
    c += uAotFireCol * uAotInf.y * gateK * exp(-up * 2.2) * 0.9;
  }
  c *= 1.0 + uAotInf.w;
  return c;
}
vec3 aotSky(vec3 dir) { return aotSkyAt(dir, dir, 1.0); }
// horizon-level radiance the fog converges to
vec3 aotHorizon(vec3 dir) {
  return aotSkyAt(normalize(vec3(dir.x, max(dir.y, 0.0) * 0.35 + 0.025, dir.z)), dir, 0.0);
}
float aotLayerOD(float dens, float fall, float y0, float dy, float dist) {
  float e0 = exp(-fall * clamp(y0, -200.0, 20000.0));
  float x = fall * dy;
  float f = abs(x) > 1e-4 ? (1.0 - exp(-clamp(x, -30.0, 30.0))) / x : 1.0;
  return dens * e0 * f * dist;
}
// full aerial perspective: returns rgb = in-scatter, a = transmittance
vec4 aotFogTerm(vec3 camPos, vec3 wp) {
  vec3 d = wp - camPos;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-3);
  float y0 = camPos.y - uAotFogC.w;
  float odH = aotLayerOD(uAotFogA.x, uAotFogA.y, y0, d.y, dist);
  float odD = aotLayerOD(uAotFogA.z, uAotFogA.w, y0, d.y, dist);
  float Th = exp(-odH), Td = exp(-odD);
  float mu = dot(dir, uAotSunDir);
  vec3 hz = aotHorizon(dir);
  vec3 sunS = uAotSunCol * (aotHG(mu, uAotFogB.y) * 0.9 + aotHG(mu, 0.2) * 0.25);
  vec3 inH = hz + sunS * uAotFogB.x * 0.08;
  vec3 inD = uAotFogC.rgb * (hz * 0.8 + sunS * uAotFogB.z * 0.12 + uAotSunCol * 0.015);
  float sm = aotSmokeMask(dir);
  inD = mix(inD, uAotSmokeCol * (0.6 + 0.4 * dot(hz, vec3(0.33))), sm * 0.6);
  // dust sits in front of the haze for near geometry: composite dust over haze by optical depth share
  float T = max(Th * Td, 1.0 - uAotFogB.w);
  // the fight has to read: anything within ~300 m keeps >= 65% of its own contrast; haze builds up beyond
  T = max(T, 0.65 * (1.0 - smoothstep(300.0, 1500.0, dist)));
#ifdef AOT_FOG_K
  T = mix(1.0, T, float(AOT_FOG_K)); // per-material fog multiplier (hero subjects): material.defines.AOT_FOG_K = 0.4
#endif
  float wD = odD / max(odD + odH, 1e-5);
  vec3 ins = mix(inH, inD, wD);
  return vec4(ins * (1.0 - T), T);
}
vec3 aotApplyFog(vec3 col, vec3 camPos, vec3 wp) {
  vec4 f = aotFogTerm(camPos, wp);
  return col * f.a + f.rgb;
}
`;

// three.js fog chunk replacements (every built-in material with fog:true gets the aerial perspective)
export const FOG_CHUNKS = {
  fog_pars_vertex: /* glsl */`
#ifdef USE_FOG
  varying vec3 vAotFogWorldPos;
#endif`,
  fog_vertex: /* glsl */`
#ifdef USE_FOG
  vAotFogWorldPos = ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );
#endif`,
  fog_pars_fragment: /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vAotFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${GLSL_SKY_PARS}
#endif`,
  fog_fragment: /* glsl */`
#ifdef USE_FOG
  gl_FragColor.rgb = aotApplyFog( gl_FragColor.rgb, cameraPosition, vAotFogWorldPos );
#endif`,
};
