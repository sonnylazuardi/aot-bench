// RENDER builder — ctx.sky
// Golden-hour physically based sky (CPU-baked atmosphere LUT), raymarched volumetric cumulus + cirrus (half-res,
// temporally accumulated), exponential height fog with sun in-scattering patched into every three material,
// cascaded sun shadows (three r186 SunLight: 2 cascades fitted to the camera frustum), PMREM environment from the sky,
// and moods ('golden' | 'smoke' | 'dusk') that blend over a few seconds.
import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { computeSkyLUT, sampleLUT, sunTransmittanceFast, LUT_W, LUT_H, makeSharedUniforms, GLSL_SKY_PARS, FOG_CHUNKS } from './atmos.js';
import { FSPass, makeRT, GLSL_HASH } from './common.js';

// ------------------------------------------------------------------------------------------------------------
// 3D cloud noise (tileable Perlin-Worley + Worley fbm), generated once on the GPU slice by slice
const NOISE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uZ;
vec3 h33(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float worley(vec3 p, float per) {
  vec3 id = floor(p), f = fract(p); float md = 1.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 h = h33(mod(id + o, per) + 0.5);
    vec3 r = o + h - f; md = min(md, dot(r, r));
  }
  return 1.0 - sqrt(md);
}
float gnoise(vec3 p, float per) {
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(normalize(h33(mod(i, per) + 0.5) * 2.0 - 1.0), f);
  float n100 = dot(normalize(h33(mod(i + vec3(1,0,0), per) + 0.5) * 2.0 - 1.0), f - vec3(1,0,0));
  float n010 = dot(normalize(h33(mod(i + vec3(0,1,0), per) + 0.5) * 2.0 - 1.0), f - vec3(0,1,0));
  float n110 = dot(normalize(h33(mod(i + vec3(1,1,0), per) + 0.5) * 2.0 - 1.0), f - vec3(1,1,0));
  float n001 = dot(normalize(h33(mod(i + vec3(0,0,1), per) + 0.5) * 2.0 - 1.0), f - vec3(0,0,1));
  float n101 = dot(normalize(h33(mod(i + vec3(1,0,1), per) + 0.5) * 2.0 - 1.0), f - vec3(1,0,1));
  float n011 = dot(normalize(h33(mod(i + vec3(0,1,1), per) + 0.5) * 2.0 - 1.0), f - vec3(0,1,1));
  float n111 = dot(normalize(h33(mod(i + vec3(1,1,1), per) + 0.5) * 2.0 - 1.0), f - vec3(1,1,1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float pfbm(vec3 p, float per) {
  float s = 0.0, a = 1.0, w = 0.0;
  for (int i = 0; i < 5; i++) { s += gnoise(p, per) * a; w += a; a *= 0.5; p *= 2.0; per *= 2.0; }
  return clamp(s / w * 0.9 + 0.5, 0.0, 1.0);
}
float wfbm(vec3 p, float per) { return worley(p, per) * 0.625 + worley(p * 2.0, per * 2.0) * 0.25 + worley(p * 4.0, per * 4.0) * 0.125; }
float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
void main() {
  vec3 p = vec3(vUv, uZ);
  float pf = pfbm(p * 4.0, 4.0);
  float wf = wfbm(p * 4.0, 4.0);
  float pw = clamp(remap(pf, wf - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
  gl_FragColor = vec4(pw, wf, wfbm(p * 8.0, 8.0), wfbm(p * 16.0, 16.0));
}`;

// ------------------------------------------------------------------------------------------------------------
// Cloud raymarch (km units, spherical earth). Returns premultiplied radiance + transmittance.
const GLSL_CLOUDS = /* glsl */`
precision highp sampler3D;
uniform sampler3D uNoise;
uniform vec4 uCloudA;   // x bottom km, y top km, z coverage, w density
uniform vec4 uCloudB;   // x base scale 1/km, y detail scale, z erosion, w sun gain
uniform vec4 uCloudC;   // x ambient gain, y fade km, z cirrus, w base darkening
uniform vec3 uCloudOff; // km wind offset
uniform vec4 uCloudD;   // x albedo, y fire belly glow, z lightning flash, w density boost
uniform vec3 uCloudFlashP; // flash position (km, cloud space)
uniform vec4 uCloudE;   // rgb belly tint, w horizon stacking boost
uniform vec4 uCloudF;   // x isotropic multi-scatter (whiteness), yz camera xz (km)
#define C_RG 6360.0
float cRemap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
vec2 cSphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd); float c = dot(ro, ro) - r * r; float d = b * b - c;
  if (d < 0.0) return vec2(-1.0); d = sqrt(d); return vec2(-b - d, -b + d);
}
float cloudCov(vec3 q) {
  vec4 w = texture(uNoise, vec3(q.xz * 0.019, 0.37));
  vec4 w2 = texture(uNoise, vec3(q.xz * 0.057 + 0.5, 0.71));
  float m = w.r * 0.7 + w2.r * 0.45 + w2.g * 0.2 - 0.25;
  return clamp(smoothstep(0.55 - uCloudA.z * 0.6, 1.0 - uCloudA.z * 0.45, m), 0.0, 1.0);
}
float cloudD(vec3 p, float hf, int lod) {
  vec3 q = p + uCloudOff;
  // towering stacks crowd toward the horizon (far from the camera)
  float cov = clamp(cloudCov(q) + uCloudE.w * smoothstep(9.0, 40.0, length(p.xz - uCloudF.yz)), 0.0, 1.0);
  if (cov < 0.02) return 0.0;
  // cumulus profile: flat dark bases, rounded cauliflower tops, taller where coverage is high
  float topF = mix(0.25, 1.0, cov);
  float prof = smoothstep(0.0, 0.06, hf) * (1.0 - smoothstep(topF * 0.3, topF, hf));
  vec4 n = texture(uNoise, q * vec3(uCloudB.x, uCloudB.x * 1.4, uCloudB.x));
  float lf = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float base = cRemap(n.r, -(1.0 - lf) * 0.35, 1.0, 0.0, 1.0);
  float d = cRemap(base * prof, 1.0 - cov * 0.75, 1.0, 0.0, 1.0) * cov;
  if (d <= 0.0) return 0.0;
  if (lod == 0) {
    vec4 dn = texture(uNoise, q * uCloudB.y + vec3(0.0, hf * 0.25, 0.0));
    float df = dn.g * 0.625 + dn.b * 0.25 + dn.a * 0.125;
    df = mix(1.0 - df, df, clamp(hf * 3.0, 0.0, 1.0)); // wispy bottoms, billowy tops
    d = cRemap(d, df * uCloudB.z, 1.0, 0.0, 1.0);
  }
  return clamp(d, 0.0, 1.0) * uCloudA.w * uCloudD.w;
}
float cPhase(float mu, float k) {
  return mix(aotHG(mu, 0.8 * k), aotHG(mu, -0.2 * k), 0.25) + uCloudF.x;
}
vec4 aotCirrus(vec3 ro, vec3 rd) {
  if (uCloudC.z <= 0.0 || rd.y < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float t = cSphere(ro, rd, C_RG + 8.0).y;
  vec3 p = ro + rd * t; vec2 q = p.xz + uCloudOff.xz * 0.5;
  vec2 w = vec2(q.x * 0.8 + q.y * 0.3, q.y * 0.45 - q.x * 0.15); // mild shear only: long streaks read as beams in perspective
  float big = texture(uNoise, vec3(q * 0.007, 0.43)).r;
  float n1 = texture(uNoise, vec3(w * 0.04, 0.17)).g;
  float n2 = texture(uNoise, vec3(w * 0.13 + n1 * 0.25, 0.61)).b;
  float d = smoothstep(0.3, 0.85, big) * smoothstep(0.5, 0.9, n1 * 0.7 + n2 * 0.5) * uCloudC.z;
  d *= smoothstep(0.0, 0.08, rd.y) * exp(-t / 220.0);
  float mu = dot(rd, uAotSunDir);
  vec3 c = uAotSunCol * (0.04 + aotHG(mu, 0.45) * 0.18) + aotSky(vec3(0.0, 1.0, 0.0)) * 1.2;
  float a = clamp(d * 0.6, 0.0, 0.65);
  return vec4(c * a, 1.0 - a);
}
vec4 aotClouds(vec3 camM, vec3 rd, float jit, float nSteps) {
  vec3 ro = vec3(camM.x * 0.001, C_RG + max(camM.y, 1.0) * 0.001, camM.z * 0.001);
  vec4 ci = aotCirrus(ro, rd);
  if (rd.y < -0.02) return vec4(0.0, 0.0, 0.0, 1.0);
  float bot = C_RG + uCloudA.x, top = C_RG + uCloudA.y;
  float t0 = cSphere(ro, rd, bot).y;
  float t1 = cSphere(ro, rd, top).y;
  if (t0 > 110.0) return ci;
  t1 = min(t1, t0 + 20.0);
  float len = t1 - t0;
  float dt = len / nSteps;
  float mu = dot(rd, uAotSunDir);
  vec3 skyUp = aotSky(vec3(0.0, 1.0, 0.0));
  vec3 skyHz = aotSky(normalize(vec3(-uAotSunDir.x, 0.15, -uAotSunDir.z)));
  vec3 ambTop = (skyUp * 1.1 + skyHz * 0.5) * uCloudC.x;
  vec3 ambBot = (skyHz * 0.45 + uAotSunCol * 0.012) * uCloudC.x;
  vec3 L = vec3(0.0); float T = 1.0; float tw = 0.0, ws = 0.0;
  float t = t0 + dt * jit;
  const float SIG = 55.0;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= nSteps) break;
    vec3 p = ro + rd * t;
    float hf = (length(p) - bot) / (top - bot);
    float d = cloudD(p, hf, 0);
    if (d > 0.003) {
      float od = 0.0, lt = 0.0;
      for (int j = 0; j < 5; j++) {
        float sl = 0.05 * pow(2.1, float(j));
        vec3 lp = p + uAotSunDir * (lt + sl * 0.5);
        float lhf = (length(lp) - bot) / (top - bot);
        od += cloudD(lp, lhf, j < 2 ? 0 : 1) * sl; lt += sl;
      }
      float ms = 0.0, a = 1.0, b = 1.0, c = 1.0;
      for (int k = 0; k < 3; k++) { ms += a * cPhase(mu, c) * exp(-SIG * 0.32 * od * b); a *= 0.6; b *= 0.3; c *= 0.5; }
      float powder = 1.0 - 0.45 * exp(-d * SIG * 0.06);
      vec3 sunL = uAotSunCol * ms * powder * uCloudB.w;
      float hk = clamp(hf, 0.0, 1.0);
      vec3 amb = mix(ambBot * uCloudE.rgb, ambTop, hk) * mix(1.0, 0.3 + 0.7 * smoothstep(0.0, 0.5, hk), uCloudC.w);
      float sig = d * SIG;
      float Ts = exp(-sig * dt);
      vec3 S = (sunL + amb) * uCloudD.x;
      // burning town below lights the smoke bellies; lightning glows inside the deck
      float townK = exp(-length(p.xz) * 0.16);
      // thin edges glow with the fire light, dense cores stay charcoal
      S += uAotFireCol * uCloudD.y * pow(1.0 - hk, 3.0) * (0.25 + 0.75 * townK) * (1.0 - smoothstep(0.08, 0.7, d / max(uCloudA.w * uCloudD.w, 1e-3)));
      if (uCloudD.z > 0.0) S += vec3(0.85, 0.85, 1.0) * uCloudD.z * exp(-length(p - uCloudFlashP) * 1.6);
      L += T * S * (1.0 - Ts);
      tw += t * T * (1.0 - Ts); ws += T * (1.0 - Ts);
      T *= Ts;
      if (T < 0.015) break;
    }
    t += dt;
  }
  float tAvg = ws > 0.0 ? tw / ws : t0;
  float fade = exp(-tAvg / uCloudC.y);
  vec3 hz = aotHorizon(rd);
  float aa = 1.0 - T;
  L = L * fade + hz * aa * (1.0 - fade) * 1.05;
  // far clouds dissolve into the horizon haze
  float keep = smoothstep(0.0, 0.04, rd.y + 0.01);
  L *= keep; T = mix(1.0, T, keep);
  return vec4(L + T * ci.rgb, T * ci.a);
}
`;


// Inferno smoke banks: two domain-warped billow layers on sky planes, self-shadowed toward the fire glow
// (Beer-Lambert over 3 samples): charcoal cores, hot orange lit edges/undersides, holes show the cool upper sky.
const GLSL_BANKS = /* glsl */`
float bh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float bvn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(bh(i), bh(i + vec2(1, 0)), u.x), mix(bh(i + vec2(0, 1)), bh(i + vec2(1, 1)), u.x), u.y); }
float bfbm(vec2 p, int oct) { float s = 0.0, a = 0.5, w = 0.0; for (int i = 0; i < 6; i++) { if (i >= oct) break; s += bvn(p) * a; w += a; p = p * 2.07 + vec2(3.1, 7.7); a *= 0.5; } return s / w; }
float billowD(vec2 p, float t, int oct) {
  vec2 w = vec2(bfbm(p + vec2(0.0, t * 0.021), 3), bfbm(p + vec2(5.2, 1.3) - t * 0.017, 3));
  float n = bfbm(p + w * 1.7, oct);
  return n;
}
vec4 bankLayer(vec3 dir, float h, float scale, float cov, float t, vec2 drift, float kLit) {
  float y = max(dir.y, 0.012);
  vec2 p = dir.xz / y * h * scale + drift;
  // fewer octaves + softer threshold toward the horizon (plane mapping compresses detail there -> aliasing)
  int oct = y < 0.08 ? 3 : (y < 0.18 ? 4 : 5);
  float soft = 0.22 + 0.25 * (1.0 - smoothstep(0.02, 0.12, y));
  float d0 = billowD(p, t, oct);
  float dens = smoothstep(cov, cov + soft, d0);
  if (dens <= 0.001) return vec4(0.0, 0.0, 0.0, 1.0);
  // light comes from the burning town: low on the horizon, strongest toward the breach
  vec2 az = normalize(dir.xz + vec2(1e-5, 0.0));
  vec2 L = normalize(az * 0.65 + normalize(uAotSmokeDir.xz) * 0.35) * 0.16;
  float occ = 0.0;
  for (int i = 1; i <= 3; i++) occ += smoothstep(cov, cov + soft, billowD(p + L * float(i), t, 3));
  float lit = exp(-occ * 1.4);                                   // Beer-Lambert toward the fire light
  float towardGate = 0.5 + 0.5 * dot(az, normalize(uAotSmokeDir.xz));
  float fireK = exp(-y * 5.0) * (0.45 + 0.55 * towardGate) * uAotInf.y * kLit; // bellies near the burning horizon glow
  float edge = 1.0 - smoothstep(0.3, 1.0, dens);
  vec3 charcoal = vec3(0.0075, 0.0055, 0.005) * (uAotSkyK.x / 6.0);  // ~#141010 after grading
  vec3 rim = uAotFireCol * vec3(1.35, 0.9, 0.6);
  vec3 col = charcoal + rim * fireK * pow(lit, 1.6) * (0.3 + 0.7 * edge);
  col *= 1.0 + uAotInf.w * 5.0;                                   // lightning inside the deck
  float a = (1.0 - exp(-dens * 4.5)) * smoothstep(0.0, 0.035, dir.y) * min(uAotInf.x / 0.45, 1.0);
  a = clamp(a, 0.0, 0.985);
  return vec4(col * a, 1.0 - a);
}
vec4 aotBanks(vec3 dir) {
  if (uAotInf.x < 0.02 || dir.y < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float t = uAotSkyK.w;
  vec2 drift = uCloudOff.xz * 0.35;
  vec4 A = bankLayer(dir, 0.5, 1.0, 0.33, t, drift, 1.0);                         // low deck just above the wall
  vec4 B = bankLayer(dir, 1.4, 1.5, 0.3, t * 0.7, drift * 0.6 + vec2(11.3, 4.7), 0.5); // higher layer fills the gaps
  return vec4(A.rgb + A.a * B.rgb, A.a * B.a);
}
`;

const CLOUD_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform mat4 uInvProj, uCamWorld, uPrevVP;
uniform vec3 uCamPos;
uniform float uFrame, uBlend, uSteps;
uniform sampler2D uHist;
${GLSL_SKY_PARS}
${GLSL_HASH}
${GLSL_CLOUDS}
${GLSL_BANKS}
void main() {
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, 0.5, 1.0);
  vec3 dir = normalize(mat3(uCamWorld) * normalize(vp.xyz / vp.w));
  vec4 c = vec4(0.0, 0.0, 0.0, 1.0);
  if (dir.y > -0.03) {
    float j = aotIGN(gl_FragCoord.xy + mod(uFrame, 64.0) * 5.588238);
    c = aotClouds(uCamPos, dir, j, uSteps);
    vec4 bk = aotBanks(dir);
    c = vec4(c.rgb + c.a * bk.rgb, c.a * bk.a); // volumetric deck in front of the far smoke banks
    vec4 pc = uPrevVP * vec4(dir, 0.0);
    if (pc.w > 0.0 && uBlend > 0.0) {
      vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
      if (puv.x > 0.001 && puv.y > 0.001 && puv.x < 0.999 && puv.y < 0.999) c = mix(c, texture2D(uHist, puv), uBlend);
    }
  }
  gl_FragColor = c;
}`;

const DOME_VERT = /* glsl */`
varying vec3 vDir; varying vec4 vClip;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  p.z = p.w;
  vClip = p;
  gl_Position = p;
}`;
const DOME_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir; varying vec4 vClip;
uniform sampler2D uCloudTex; uniform float uCloudOn; uniform vec4 uSunDisc;
${GLSL_SKY_PARS}
void main() {
  vec3 dir = normalize(vDir);
  vec3 c = dir.y >= 0.0 ? aotSky(dir) : aotHorizon(dir);
  float mu = dot(dir, uAotSunDir);
  // sun disc with limb darkening + tight bloom halo
  float r = acos(clamp(mu, -1.0, 1.0));
  float disc = 1.0 - smoothstep(uSunDisc.x * 0.85, uSunDisc.x, r);
  float limb = sqrt(max(1.0 - pow(r / uSunDisc.x, 2.0), 0.0));
  float sm = aotSmokeMask(dir);
  vec3 sunC = mix(uAotSunCol, uAotSunCol * vec3(1.0, 0.3, 0.1), clamp(uAotInf.x * 2.0, 0.0, 1.0));
  vec3 sun = sunC * disc * (0.55 + 0.45 * limb) * uSunDisc.y * (1.0 - sm * 0.85) * smoothstep(-0.01, 0.01, dir.y);
  sun += sunC * exp(-r * 90.0) * uSunDisc.z;
  vec4 cl = vec4(0.0, 0.0, 0.0, 1.0);
  if (uCloudOn > 0.5) cl = texture2D(uCloudTex, vClip.xy / vClip.w * 0.5 + 0.5);
  c = (c + sun) * cl.a + cl.rgb;
  gl_FragColor = vec4(c, 1.0);
}`;

const ENV_FRAG = /* glsl */`
precision highp float;
varying vec3 vWDir;
uniform vec3 uGround; uniform float uEnvSat;
${GLSL_SKY_PARS}
${GLSL_HASH}
${GLSL_CLOUDS}
void main() {
  vec3 dir = normalize(vWDir);
  vec3 c;
  if (dir.y >= 0.0) {
    c = aotSky(dir);
    vec4 cl = aotClouds(vec3(0.0, 80.0, 0.0), dir, 0.5, 24.0);
    c = c * cl.a + cl.rgb;
  } else {
    vec3 E = uAotSunCol * max(uAotSunDir.y, 0.0) * 0.7 + aotSky(vec3(0.0, 1.0, 0.0)) * 3.14159 * 0.8;
    vec3 g = uGround * E / 3.14159;
    c = mix(g, aotHorizon(dir), exp(dir.y * 14.0) * 0.8);
  }
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(l), c, uEnvSat), 1.0);
}`;

// ------------------------------------------------------------------------------------------------------------
const BASE = {
  inf: 0, fire: 0, fireCol: [1.0, 0.36, 0.1], cloudBot: 1.35, cloudTop: 3.8, cloudAlb: 1.0, cloudFire: 0, cloudDens: 1.0,
  embers: 0, lightning: 0, sunDisc: 1.0, bloom: 1.0, cloudScale: 0.14, expo: 1.0, contrast: 0, shafts: 1, cirrus: 0.5,
  sunEl: 16.3, sunAz: -21.5, sat: 1.0, skyTint2: [1, 1, 1], cloudBelly: [1, 1, 1], cloudStack: 0.15, cloudIso: 0.025, erode: 0.72,
};
const MOODS = {
  // battle phase 1: vivid saturated blue, crisp sunlit white cumulus, strong clean sun, clear air
  day: {
    ...BASE,
    sunEl: 40, sunAz: 112, sunK: 1.1, sunTint: [0.97, 1.0, 1.08], skyK: 1.0, skyTint: [0.8, 0.96, 1.25], skyTint2: [0.86, 1.04, 1.12], aureole: 0.3, smoke: 0,
    haze: 1 / 26000, hazeFall: 1 / 1600, dust: 1 / 7000, dustFall: 1 / 35, dustTint: [0.82, 0.9, 1.0],
    sunScat: 0.5, dustSun: 0.5, cov: 0.38, cloudSun: 3.4, cloudAmb: 1.15, hemi: 1.0, env: 1.05,
    glow: [1.0, 0.88, 0.7], smokeCol: [0.22, 0.2, 0.2], cloudBelly: [0.78, 0.9, 1.18], cloudStack: 0.34, cloudIso: 0.06, erode: 0.82,
    cloudBot: 1.1, cloudTop: 3.6, cloudDens: 2.4, cloudScale: 0.17, cirrus: 0.25, expo: 1.0, contrast: 0.1, bloom: 0.85, shafts: 0.45, sat: 1.24,
  },
  // calm intro + battle phase 2: warm late sun
  golden: {
    ...BASE,
    sunEl: 22, sunAz: 98, sunK: 1.0, sunTint: [1, 1, 1], skyK: 1.0, skyTint: [1, 1, 1], aureole: 1.0, smoke: 0,
    haze: 1 / 15000, hazeFall: 1 / 1500, dust: 1 / 3200, dustFall: 1 / 45, dustTint: [0.92, 0.8, 0.64],
    sunScat: 1.0, dustSun: 1.0, cov: 0.36, cloudSun: 2.0, cloudAmb: 1.0, hemi: 1.0, env: 1.0,
    glow: [1.0, 0.55, 0.25], smokeCol: [0.22, 0.18, 0.15], cloudDens: 1.3, cloudScale: 0.16, sat: 1.1,
  },
  // battle phase 3: soft pink / peach / lavender sky, luminous layered clouds, pastel aerial perspective
  afternoon: {
    ...BASE,
    sunEl: 13, sunAz: 80, sunK: 0.88, sunTint: [1.0, 0.78, 0.74], skyK: 0.95, skyTint: [1.2, 0.76, 1.08], skyTint2: [1.42, 0.84, 0.86], aureole: 1.7, smoke: 0,
    haze: 1 / 6000, hazeFall: 1 / 1200, dust: 1 / 2600, dustFall: 1 / 70, dustTint: [1.0, 0.8, 0.9],
    sunScat: 1.7, dustSun: 1.3, cov: 0.32, cloudSun: 2.3, cloudAmb: 1.2, hemi: 0.95, env: 1.0,
    glow: [1.0, 0.56, 0.46], smokeCol: [0.22, 0.17, 0.18], cloudBelly: [1.65, 0.7, 0.92], cloudStack: 0.2, cloudIso: 0.05,
    cloudBot: 1.6, cloudTop: 2.7, cloudDens: 1.0, cloudScale: 0.13, cirrus: 0.9, expo: 1.06, contrast: -0.04, bloom: 1.3, shafts: 0.8, sat: 1.15,
  },
  smoke: {
    ...BASE,
    sunK: 0.8, sunTint: [1.0, 0.88, 0.74], skyK: 0.85, skyTint: [1.0, 0.94, 0.86], aureole: 1.3, smoke: 0.5,
    haze: 1 / 9000, hazeFall: 1 / 1100, dust: 1 / 1800, dustFall: 1 / 60, dustTint: [0.86, 0.72, 0.56],
    sunScat: 1.4, dustSun: 1.2, cov: 0.42, cloudSun: 1.7, cloudAmb: 0.9, hemi: 0.9, env: 0.85,
    glow: [1.0, 0.45, 0.16], smokeCol: [0.2, 0.15, 0.12],
  },
  dusk: {
    ...BASE,
    sunEl: 7, sunK: 0.55, sunTint: [1.0, 0.72, 0.5], skyK: 0.6, skyTint: [0.92, 0.82, 0.92], aureole: 1.6, smoke: 0,
    haze: 1 / 9000, hazeFall: 1 / 1300, dust: 1 / 2500, dustFall: 1 / 60, dustTint: [0.8, 0.64, 0.56],
    sunScat: 1.8, dustSun: 1.5, cov: 0.36, cloudSun: 1.5, cloudAmb: 0.75, hemi: 0.75, env: 0.75,
    glow: [1.0, 0.4, 0.18], smokeCol: [0.16, 0.12, 0.11],
  },
};
MOODS.inferno = MOODS.day; // user direction 21:15: no burning sky in battle

export async function create(ctx) {
  const { renderer, scene, LAYOUT } = ctx;
  const qlevel = ctx.quality?.level || 'high';

  // ---- sun + atmosphere LUT -------------------------------------------------------------------------------
  // sun azimuth is fixed (south, behind the outer gate); elevation follows the mood (high clear 'day' sun ->
  // low warm 'golden'/'afternoon' sun). Two sky-view LUTs are baked at load and blended on the CPU when it moves.
  const sunDir = new THREE.Vector3(...LAYOUT.sunDir).normalize();
  const sunAz = new THREE.Vector2(sunDir.x, sunDir.z).normalize();
  const LOW_EL = Math.asin(sunDir.y), HIGH_EL = THREE.MathUtils.degToRad(36);
  const MIE_LOW = 1.8, MIE_HIGH = 0.75;
  const E0 = 6.0; // sun illuminance at the top of the atmosphere (scene units)
  const lutLow = computeSkyLUT(LOW_EL, { mie: MIE_LOW, ms: 1.0, groundAlbedo: 0.18 }).data;
  const lutHigh = computeSkyLUT(HIGH_EL, { mie: MIE_HIGH, ms: 1.0, groundAlbedo: 0.18 }).data;
  const data = new Float32Array(lutLow.length);
  const half = new Uint16Array(data.length);
  const sunT = [1, 1, 1], tA = [0, 0, 0], tB = [0, 0, 0];
  let lutW = -1, sunElNow = LOW_EL, sunAzNow = NaN, lutTex = null;
  function setSunElevation(el, azDeg) {
    sunElNow = el;
    if (azDeg !== undefined) { sunAzNow = azDeg; const a = THREE.MathUtils.degToRad(azDeg); sunAz.set(Math.sin(a), Math.cos(a)); }
    sunDir.set(sunAz.x * Math.cos(el), Math.sin(el), sunAz.y * Math.cos(el));
    const w = THREE.MathUtils.clamp((el - LOW_EL) / (HIGH_EL - LOW_EL), 0, 1);
    sunTransmittanceFast(el, MIE_LOW, tA); sunTransmittanceFast(el, MIE_HIGH, tB);
    for (let c = 0; c < 3; c++) sunT[c] = tA[c] + (tB[c] - tA[c]) * w;
    if (Math.abs(w - lutW) > 0.02 || (w !== lutW && (w === 0 || w === 1))) {
      lutW = w;
      for (let i = 0; i < data.length; i++) { const v = lutLow[i] + (lutHigh[i] - lutLow[i]) * w; data[i] = v; half[i] = THREE.DataUtils.toHalfFloat(v); }
      if (lutTex) lutTex.needsUpdate = true;
    }
  }
  setSunElevation(LOW_EL);
  lutTex = new THREE.DataTexture(half, LUT_W, LUT_H, THREE.RGBAFormat, THREE.HalfFloatType);
  lutTex.minFilter = lutTex.magFilter = THREE.LinearFilter;
  lutTex.wrapS = lutTex.wrapT = THREE.ClampToEdgeWrapping;
  lutTex.colorSpace = THREE.NoColorSpace;
  lutTex.needsUpdate = true;

  const U = makeSharedUniforms(lutTex);
  U.uAotSunDir.value.copy(sunDir);
  U.uAotSmokeDir.value.set(LAYOUT.outerGate.x, 0, LAYOUT.outerGate.z).normalize();

  // ---- patch three's fog chunks + give every built-in material the shared uniforms -------------------------
  Object.assign(THREE.ShaderChunk, FOG_CHUNKS);
  // stable soft shadows: r186 PCF rotates its Vogel disk by per-pixel screen noise (IGN) with no temporal filter, which
  // crawls / sparkles as soon as the camera shakes. Use a fixed rotation (stable) with a few more taps instead.
  {
    let sc = THREE.ShaderChunk.shadowmap_pars_fragment;
    sc = sc.replace(/float phi = interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;/g, 'float phi = 0.7853981;');
    THREE.ShaderChunk.shadowmap_pars_fragment = sc;
  }
  for (const k of Object.keys(THREE.ShaderLib)) {
    const u = THREE.ShaderLib[k].uniforms;
    if (u && 'fogColor' in u) Object.assign(u, U);
  }
  Object.assign(THREE.UniformsLib.fog, U);
  scene.fog = new THREE.FogExp2(0xb0a898, 0.0002); // only enables USE_FOG; the chunk ignores its params
  scene.background = null;

  // ---- lights ---------------------------------------------------------------------------------------------
  const sun = new SunLight(0xffffff, 1);
  sun.name = 'sun';
  sun.position.copy(sunDir);
  sun.castShadow = !!ctx.quality?.shadows;
  const smap = qlevel === 'high' ? 2048 : qlevel === 'medium' ? 1536 : 1024; // per cascade (atlas is 2x1)
  sun.shadow.mapSize.set(smap, smap);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = qlevel === 'high' ? 0.16 : 0.24; // far cascade texels are ~0.3-0.7 m: small biases acne/crawl
  sun.shadow.radius = qlevel === 'low' ? 1.0 : 1.6;
  sun.shadow.camera.near = 1;
  // note: in r186 WebGLShadowMap layer-tests casters against the MAIN view camera, not these cascade cameras, so this
  // is harmless but not relied on; shadow-only proxies should stay on layer 0 with colorWrite/depthWrite false
  sun.shadow.camera.layers.enable(1);
  for (let i = 0; i < 2; i++) sun.shadow.getCamera?.(i)?.layers?.enable(1);
  sun.shadow.camera.far = 420;
  sun.target = new THREE.Object3D(); // compatibility with DirectionalLight-style code (SunLight shines toward the origin)
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x6b5a48, 0.3);
  hemi.name = 'skyHemi';
  scene.add(hemi);

  // ---- clouds: 3D noise -------------------------------------------------------------------------------------
  const NS = 96;
  const noiseRT = new THREE.WebGL3DRenderTarget(NS, NS, NS, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false });
  const nt = noiseRT.texture;
  nt.wrapS = nt.wrapT = nt.wrapR = THREE.RepeatWrapping;
  nt.minFilter = nt.magFilter = THREE.LinearFilter; nt.generateMipmaps = false;
  {
    const np = new FSPass({ name: 'cloudNoise', fragmentShader: NOISE_FRAG, uniforms: { uZ: { value: 0 } } });
    const prev = renderer.getRenderTarget();
    for (let z = 0; z < NS; z++) { np.uniforms.uZ.value = (z + 0.5) / NS; np.render(renderer, noiseRT, z); }
    renderer.setRenderTarget(prev);
    np.material.dispose();
  }
  const cloudU = {
    uNoise: { value: nt },
    uCloudA: { value: new THREE.Vector4(1.35, 3.8, 0.34, 1.0) },
    uCloudB: { value: new THREE.Vector4(0.14, 2.3, 0.72, 2.0) },
    uCloudC: { value: new THREE.Vector4(1.0, 38.0, 0.55, 0.85) },
    uCloudOff: { value: new THREE.Vector3(3.3, 0, 11.7) },
    uCloudD: { value: new THREE.Vector4(1, 0, 0, 1) },
    uCloudFlashP: { value: new THREE.Vector3(0, 6361, 0) },
    uCloudE: { value: new THREE.Vector4(1, 1, 1, 0) },
    uCloudF: { value: new THREE.Vector4(0.02, 0, 0, 0) },
  };

  // half-res cloud pass with temporal accumulation
  const cloudPass = new FSPass({
    name: 'clouds', fragmentShader: CLOUD_FRAG,
    uniforms: {
      ...U, ...cloudU,
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() }, uFrame: { value: 0 }, uBlend: { value: 0 },
      uSteps: { value: qlevel === 'high' ? 32 : qlevel === 'medium' ? 24 : 16 }, uHist: { value: null },
    },
  });
  const cloudScale = qlevel === 'low' ? 0.33 : 0.5;
  let cloudRT = [makeRT(2, 2), makeRT(2, 2)], cloudIdx = 0, cloudFrame = 0, histValid = false;
  const prevVP = new THREE.Matrix4(), curVP = new THREE.Matrix4();
  const lastCamPos = new THREE.Vector3(1e9, 0, 0);
  const dbs = new THREE.Vector2();
  function resize() {
    renderer.getDrawingBufferSize(dbs);
    const w = Math.max(2, Math.round(dbs.x * cloudScale)), h = Math.max(2, Math.round(dbs.y * cloudScale));
    if (cloudRT[0].width !== w || cloudRT[0].height !== h) { cloudRT[0].setSize(w, h); cloudRT[1].setSize(w, h); histValid = false; }
  }
  resize();

  // ---- sky dome -------------------------------------------------------------------------------------------
  const domeMat = new THREE.ShaderMaterial({
    name: 'skyDome', vertexShader: DOME_VERT, fragmentShader: DOME_FRAG,
    uniforms: { ...U, uCloudTex: { value: cloudRT[0].texture }, uCloudOn: { value: 0 }, uSunDisc: { value: new THREE.Vector4(0.0105, 22, 0.3, 0) } },
    depthWrite: false, depthTest: true, side: THREE.BackSide, fog: false, toneMapped: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), domeMat);
  dome.name = 'skyDome';
  dome.frustumCulled = false;
  dome.renderOrder = 1e6; // after every opaque (early-z rejects covered pixels), before transparents
  dome.matrixAutoUpdate = false;
  dome.castShadow = dome.receiveShadow = false;
  scene.add(dome);

  // ---- environment (PMREM) ---------------------------------------------------------------------------------
  const envScene = new THREE.Scene();
  const envMat = new THREE.ShaderMaterial({
    name: 'envSky', side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { ...U, ...cloudU, uGround: { value: new THREE.Vector3(0.2, 0.17, 0.13) }, uEnvSat: { value: 0.8 } },
    vertexShader: 'varying vec3 vWDir; void main(){ vWDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: ENV_FRAG,
  });
  envScene.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), envMat));
  const cubeRT = new THREE.WebGLCubeRenderTarget(qlevel === 'high' ? 96 : 64, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(0.1, 100, cubeRT);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  function bakeEnv() {
    const prev = renderer.getRenderTarget();
    const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
    cubeCam.update(renderer, envScene);
    envRT = pmrem.fromCubemap(cubeRT.texture, envRT ?? undefined);
    renderer.toneMapping = tm;
    renderer.setRenderTarget(prev);
    scene.environment = envRT.texture;
  }

  // ---- mood state -------------------------------------------------------------------------------------------
  let api = null;
  const cur = JSON.parse(JSON.stringify(MOODS.golden));
  let target = MOODS.golden, moodName = 'golden', blendRate = 0.25, envDirty = 0, envTimer = 0, blendT = 1, blendFrom = cur;
  const tmp3 = [0, 0, 0];
  const sunColor = new THREE.Color();
  const horizonColor = new THREE.Color();
  const zenithColor = new THREE.Color();
  const tv = new THREE.Vector3();

  function applyMood() {
    const m = cur;
    const el = THREE.MathUtils.degToRad(m.sunEl);
    if (Math.abs(el - sunElNow) > 1e-4 || Math.abs(m.sunAz - sunAzNow) > 1e-3) {
      setSunElevation(el, m.sunAz);
      U.uAotSunDir.value.copy(sunDir); sun.position.copy(sunDir);
    }
    // sun light: top-of-atmosphere illuminance x transmittance x mood
    const r = E0 * sunT[0] * m.sunK * m.sunTint[0], g = E0 * sunT[1] * m.sunK * m.sunTint[1], b = E0 * sunT[2] * m.sunK * m.sunTint[2];
    U.uAotSunCol.value.set(r, g, b);
    const mx = Math.max(r, g, b);
    sun.color.setRGB(r / mx, g / mx, b / mx);
    sun.intensity = mx;
    sunColor.setRGB(r, g, b);
    U.uAotSkyK.value.set(E0 * m.skyK, m.aureole, m.smoke, 0);
    U.uAotSkyTint.value.fromArray(m.skyTint);
    U.uAotSkyTint2.value.fromArray(m.skyTint2);
    cloudU.uCloudE.value.set(m.cloudBelly[0], m.cloudBelly[1], m.cloudBelly[2], m.cloudStack);
    cloudU.uCloudF.value.x = m.cloudIso;
    cloudU.uCloudB.value.z = m.erode;
    U.uAotGlowCol.value.fromArray(m.glow);
    U.uAotSmokeCol.value.fromArray(m.smokeCol).multiplyScalar(E0 * 0.12 * m.skyK);
    U.uAotFogA.value.set(m.haze, m.hazeFall, m.dust, m.dustFall);
    U.uAotFogB.value.set(m.sunScat, 0.72, m.dustSun, 0.985);
    U.uAotFogC.value.set(m.dustTint[0], m.dustTint[1], m.dustTint[2], ctx.world?.groundLevel ?? 0);
    cloudU.uCloudA.value.z = m.cov;
    cloudU.uCloudA.value.x = m.cloudBot; cloudU.uCloudA.value.y = m.cloudTop; cloudU.uCloudB.value.x = m.cloudScale;
    cloudU.uCloudC.value.z = m.cirrus;
    cloudU.uCloudD.value.x = m.cloudAlb; cloudU.uCloudD.value.y = m.cloudFire; cloudU.uCloudD.value.w = m.cloudDens;
    U.uAotInf.value.x = m.inf; U.uAotInf.value.y = m.fire;
    U.uAotFireCol.value.fromArray(m.fireCol);
    domeMat.uniforms.uSunDisc.value.set(0.0105, 22 * m.sunDisc, 0.3 * m.sunDisc, 0);
    api && (api.embers = m.embers, api.bloomK = m.bloom, api.exposureK = m.expo, api.contrastK = m.contrast, api.shaftsK = m.shafts, api.satK = m.sat);
    cloudU.uCloudB.value.w = m.cloudSun;
    cloudU.uCloudC.value.x = m.cloudAmb;
    // hemisphere fill from the LUT (zenith sky / warm ground bounce)
    sampleLUT(data, tv.set(0, 1, 0), sunDir, tmp3);
    const sk = E0 * m.skyK;
    zenithColor.setRGB(tmp3[0] * sk * m.skyTint[0], tmp3[1] * sk * m.skyTint[1], tmp3[2] * sk * m.skyTint[2]);
    sampleLUT(data, tv.set(-sunDir.x, 0.05, -sunDir.z).normalize(), sunDir, tmp3);
    horizonColor.setRGB(tmp3[0] * sk * m.skyTint2[0], tmp3[1] * sk * m.skyTint2[1], tmp3[2] * sk * m.skyTint2[2]);
    const zl = Math.max(zenithColor.r, zenithColor.g, zenithColor.b) || 1;
    hemi.color.copy(zenithColor).multiplyScalar(1 / zl);
    hemi.groundColor.setRGB(0.55 * sunColor.r / mx, 0.45 * sunColor.g / mx, 0.34 * sunColor.b / mx);
    hemi.intensity = zl * Math.PI * 0.25 * m.hemi;
    scene.environmentIntensity = 0.85 * m.env;
  }
  applyMood();
  bakeEnv();

  const wind = new THREE.Vector3(4.2, 0, 0.8); // crosswind, slightly outward: town smoke leans off the gate->town sightline

  // shadow distance follows camera height (from the rooftops you see the whole town)
  const camPos = new THREE.Vector3();
  function updateShadowRange(camera) {
    camera.getWorldPosition(camPos);
    const h = Math.max(0, camPos.y - (ctx.world?.groundHeight?.(camPos.x, camPos.z) ?? 0));
    const far = THREE.MathUtils.clamp(420 + h * 2.2, 420, 1500);
    sun.shadow.camera.far = far;
  }

  // ---- lightning inside the smoke deck (inferno) ------------------------------------------------------------
  const lt = { timer: 4, pulses: [], flash: 0 };
  const fwd = new THREE.Vector3(), lp = new THREE.Vector3(), lp2 = new THREE.Vector3();
  function strike(camera, opts = {}) {
    camera.getWorldDirection(fwd); fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
    fwd.normalize();
    const az = Math.atan2(fwd.x, fwd.z) + (Math.random() - 0.5) * 2.2;
    const el = THREE.MathUtils.degToRad(8 + Math.random() * 26);
    camera.getWorldPosition(camPos);
    const baseY = cur.cloudBot * 1000 + 150;
    const dist = Math.max(500, (baseY - camPos.y) / Math.tan(el));
    lp.set(camPos.x + Math.sin(az) * dist, baseY, camPos.z + Math.cos(az) * dist);
    cloudU.uCloudFlashP.value.set(lp.x * 0.001, 6360 + lp.y * 0.001, lp.z * 0.001);
    const n = 2 + (Math.random() * 3) | 0;
    let t = 0;
    for (let i = 0; i < n; i++) { lt.pulses.push({ t, k: 0.6 + Math.random() * 0.8 }); t += 0.06 + Math.random() * 0.14; }
    // a visible bolt: mostly cloud-to-cloud, sometimes down into the fields beyond the wall
    if (ctx.fx?.lightning && (opts.bolt ?? Math.random() < 0.7)) {
      const ground = Math.random() < 0.3;
      const a2 = az + (Math.random() - 0.5) * 0.25;
      if (ground) lp2.set(camPos.x + Math.sin(a2) * dist * 1.05, 0, camPos.z + Math.cos(a2) * dist * 1.05);
      else lp2.set(camPos.x + Math.sin(a2) * dist * (0.9 + Math.random() * 0.3), baseY - 80 - Math.random() * 250, camPos.z + Math.cos(a2) * dist * (0.9 + Math.random() * 0.3));
      ctx.fx.lightning(lp.clone(), lp2.clone(), { intensity: 0.8, width: 2.5 + dist * 0.002, sky: true });
    }
    const vol = THREE.MathUtils.clamp(1.4 - dist / 3000, 0.25, 1);
    setTimeout(() => ctx.audio?.play?.('thunder', { volume: vol }), Math.min(4000, dist / 343 * 1000 * 0.5));
    ctx.events?.emit?.('sky:lightning', { position: lp.clone(), distance: dist });
  }
  function updateLightning(dt, camera) {
    if (cur.lightning > 0.3) {
      lt.timer -= dt;
      if (lt.timer <= 0) { strike(camera); lt.timer = (3 + Math.random() * 7) / cur.lightning; }
    }
    let f = 0;
    for (let i = 0; i < lt.pulses.length; i++) {
      const p = lt.pulses[i]; p.t -= dt;
      if (p.t <= 0) { const age = -p.t; if (age > 0.18) { lt.pulses.splice(i, 1); i--; continue; } f = Math.max(f, p.k * Math.exp(-age * 18)); }
    }
    lt.flash = f;
    cloudU.uCloudD.value.z = f * 60;
    U.uAotInf.value.w = f * 0.35;
  }

  api = {
    embers: cur.embers, bloomK: cur.bloom, exposureK: cur.expo, contrastK: cur.contrast, shaftsK: cur.shafts, satK: cur.sat,
    /** trigger an in-cloud lightning strike now (cinematics) */
    strike(opts) { strike(ctx.camera, opts); },
    _debug: { noise: nt, cloudU, get cloudRT() { return cloudRT; }, cloudPass, domeMat, cur, applyMood, bakeEnv },
    sun, hemi, sunDir, sunColor, wind, horizonColor, zenithColor,
    uniforms: U,                 // shared fog/sky uniforms (live objects)
    fogUniforms: U,
    glsl: GLSL_SKY_PARS,         // include in a custom ShaderMaterial, then: col = aotApplyFog(col, cameraPosition, worldPos)
    get mood() { return moodName; },
    get envMap() { return scene.environment; },
    /** uniforms to merge into a custom ShaderMaterial that includes three's <fog_*> chunks */
    getFogUniforms() { return U; },
    /** make a custom ShaderMaterial fog-compatible (merge shared uniforms) */
    patchMaterial(mat) { if (mat?.uniforms) Object.assign(mat.uniforms, THREE.UniformsLib.fog, U); return mat; },
    setMood(name, secs = 6) {
      if (!MOODS[name]) return;
      moodName = name; target = MOODS[name]; blendRate = secs > 0 ? 1 / secs : 1e3;
      blendFrom = JSON.parse(JSON.stringify(cur)); blendT = 0;
    },
    /** called by post before the scene render (exact camera incl. shake) */
    renderClouds(camera) {
      resize();
      camera.updateMatrixWorld();
      camera.getWorldPosition(camPos);
      const u = cloudPass.uniforms;
      u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uCamWorld.value.copy(camera.matrixWorld);
      u.uCamPos.value.copy(camPos);
      cloudU.uCloudF.value.y = camPos.x * 0.001; cloudU.uCloudF.value.z = camPos.z * 0.001;
      curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const jumped = lastCamPos.distanceToSquared(camPos) > 60 * 60;
      lastCamPos.copy(camPos);
      u.uPrevVP.value.copy(prevVP);
      u.uBlend.value = histValid && !jumped ? 0.82 : 0;
      u.uFrame.value = cloudFrame++ % 64;
      u.uHist.value = cloudRT[cloudIdx].texture;
      const dst = cloudRT[1 - cloudIdx];
      const prev = renderer.getRenderTarget();
      cloudPass.render(renderer, dst);
      renderer.setRenderTarget(prev);
      cloudIdx = 1 - cloudIdx;
      prevVP.copy(curVP);
      histValid = true;
      domeMat.uniforms.uCloudTex.value = dst.texture;
      domeMat.uniforms.uCloudOn.value = 1;
      updateShadowRange(camera);
    },
    resize() { resize(); },
    update(dt, time, rawDt) {
      // perf: the blend is a bounded ease (from -> target over ~1/blendRate s) instead of an exponential chase that took
      // ~16 s to fall under its epsilon (applyMood + LUT rebuild every frame and a PMREM re-bake every 2 s meanwhile)
      let changed = false;
      if (blendT < 1) {
        blendT = Math.min(1, blendT + (rawDt ?? dt) * blendRate * 1.1);
        const e = blendT * blendT * (3 - 2 * blendT);
        for (const key in target) {
          const tv2 = target[key], fv = blendFrom[key] ?? tv2;
          if (cur[key] === undefined) cur[key] = Array.isArray(tv2) ? [...tv2] : tv2;
          if (Array.isArray(tv2)) { const cv = cur[key]; for (let i = 0; i < tv2.length; i++) cv[i] = fv[i] + (tv2[i] - fv[i]) * e; }
          else cur[key] = fv + (tv2 - fv) * e;
        }
        changed = true;
        if (blendT >= 1) envTimer = 0;   // final env bake right away
      }
      if (changed) { applyMood(); envDirty = 1; }
      envTimer -= rawDt ?? dt;
      if (envDirty && envTimer <= 0) { bakeEnv(); envDirty = 0; envTimer = 2.0; }
      // cloud drift with the wind (km)
      const o = cloudU.uCloudOff.value;
      o.x -= wind.x * 0.004 * dt; o.z -= wind.z * 0.004 * dt;
      U.uAotSkyK.value.w = time;
      updateLightning(rawDt ?? dt, ctx.camera);
      if (ctx.cameraOwner !== undefined && domeMat.uniforms.uCloudOn.value === 0) updateShadowRange(ctx.camera);
    },
  };

  // mood script (user direction 21:15): calm golden intro -> clear blue 'day' after the breach / at fight start,
  // warming to 'golden' in phase 2 and a pink 'afternoon' in phase 3
  ctx.events?.on?.('wall:breached', () => api.setMood('day', 8));
  ctx.events?.on?.('fight:start', () => { if (moodName !== 'day') api.setMood('day', 2.5); });
  ctx.events?.on?.('colossal:phase', (e) => {
    const ph = e?.phase | 0;
    if (ph === 2) api.setMood('golden', 20);
    else if (ph >= 3) api.setMood('afternoon', 20);
  });
  if (ctx.params?.mood && MOODS[ctx.params.mood]) api.setMood(ctx.params.mood, 0);
  return api;
}
