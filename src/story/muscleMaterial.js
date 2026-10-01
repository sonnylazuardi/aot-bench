// Materials for the COLOSSAL TITAN: skinless raw muscle (crimson fibre bundles following each muscle's fibre direction,
// dark perimysium grooves, broken wet glints on the crests, reddened wrap/subsurface light), pale bone-ivory fascia / skull
// plates (matte, faint fibrous grain + pink veins, crisp edges), glossy white-pink tendon sheets, gums, teeth, eyes.
// All MeshPhysicalMaterial + onBeforeCompile so shadows / fog (AOT_FOG_K) / tonemapping stay standard.
//
// Fibre detail = one tileable 1024² cross-section texture (colossalTex.js, generated once in a worker, mipmapped,
// anisotropy 8) projected ALONG the per-vertex fibre direction: the cells become long parallel bundles on the surface.
// Every high-frequency term is faded by its screen footprint so nothing shimmers under camera shake.
//
// Geometry attributes (sculpt.js): fibre = rest-space fibre dir; mdata = (plate/tendon mask, gum, AO, belly id);
// mdata2 = (seam between bellies, flush, cavity, shade).
import * as THREE from 'three';

const NOISE = /* glsl */`
float c_h31(vec3 p){ p = fract(p*vec3(0.1031,0.1030,0.0973)); p += dot(p, p.yxz+33.33); return fract((p.x+p.y)*p.z); }
float c_vn(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
  float a=c_h31(i), b=c_h31(i+vec3(1,0,0)), c=c_h31(i+vec3(0,1,0)), d=c_h31(i+vec3(1,1,0));
  float e=c_h31(i+vec3(0,0,1)), g=c_h31(i+vec3(1,0,1)), h=c_h31(i+vec3(0,1,1)), k=c_h31(i+vec3(1,1,1));
  return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y), mix(mix(e,g,f.x),mix(h,k,f.x),f.y), f.z);
}
vec3 c_perturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float fd){
  vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos);
  vec3 r1 = cross(sy, surf_norm), r2 = cross(surf_norm, sx);
  float det = dot(sx, r1) * fd;
  vec3 g = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surf_norm - g);
}
`;
// fibre frame: T1 across the fibre (stable choice per belly), T2 = F x T1
const FRAME = /* glsl */`
vec3 c_t1(vec3 F){ vec3 a = abs(F.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0); return normalize(cross(F, a)); }
`;

const COMMON_UNIFORMS = () => ({
  uSunDirV: { value: new THREE.Vector3(0, 0.3, -1) },
  uSunCol: { value: new THREE.Color(1.0, 0.72, 0.45) },
  uFillDirV: { value: new THREE.Vector3(-0.35, 0.55, 0.75).normalize() },
  uFillCol: { value: new THREE.Color(0.3, 0.24, 0.22) },
  uTime: { value: 0 },
  uEvap: { value: 0 },
  uHurt: { value: 0 },
});

function injectCommonVertex(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
attribute vec3 fibre; attribute vec4 mdata; attribute vec4 mdata2; attribute vec3 manchor;
varying vec3 vRest; varying vec3 vFibV; varying vec3 vFibR; varying vec4 vMd; varying vec4 vMd2; varying vec3 vT1V; varying vec3 vT2V; varying vec3 vNrmR; varying vec3 vAnc;
${FRAME}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
vRest = position; vFibR = fibre; vMd = mdata; vMd2 = mdata2; vNrmR = normal; vAnc = manchor;`)
    .replace('#include <skinnormal_vertex>', `#include <skinnormal_vertex>
{
  vec3 fR = normalize(fibre + 1e-6);
  vec3 t1R = c_t1(fR), t2R = cross(fR, t1R);
#ifdef USE_SKINNING
  vFibV = normalize(normalMatrix * (skinMatrix * vec4(fR, 0.0)).xyz);
  vT1V = normalize(normalMatrix * (skinMatrix * vec4(t1R, 0.0)).xyz);
  vT2V = normalize(normalMatrix * (skinMatrix * vec4(t2R, 0.0)).xyz);
#else
  vFibV = normalize(normalMatrix * fR); vT1V = normalize(normalMatrix * t1R); vT2V = normalize(normalMatrix * t2R);
#endif
}`);
}

// ---------- the fibre texture: worker-generated once, placeholder (neutral) until it lands ----------
const TEX_SIZE = 1024;
let muscleTex = null;
function getMuscleTexture() {
  if (muscleTex) return muscleTex;
  const S = TEX_SIZE;
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 150; data[i + 1] = 180; data[i + 2] = 128; data[i + 3] = 0; }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.userData.ready = false;
  muscleTex = tex;
  const t0 = performance.now();
  const fill = (d) => { tex.image.data.set(d); tex.needsUpdate = true; tex.userData.ready = true; console.log(`[colossal] muscle texture ${S}² ready in ${(performance.now() - t0) | 0} ms`); };
  try {
    const w = new Worker(new URL('./colossalTexWorker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { w.terminate(); fill(e.data.data); };
    w.onerror = () => { w.terminate(); import('./colossalTex.js').then((m) => fill(m.generateMuscleData(S))); };
    w.postMessage({ size: S });
  } catch {
    import('./colossalTex.js').then((m) => fill(m.generateMuscleData(S)));
  }
  return tex;
}
// start generating as soon as this module is imported (in parallel with the geometry workers)
if (typeof window !== 'undefined') getMuscleTexture();

export function createSkinMaterial(eyeL = new THREE.Vector3(0, -9, 0), eyeR = new THREE.Vector3(0, -9, 0), eyeR0 = new THREE.Vector3(0.034, 0.02, 0.03)) {
  const uniforms = {
    ...COMMON_UNIFORMS(),
    uPore: { value: 1.0 },               // bump strength multiplier
    uIdOn: { value: 1.0 },
    uDebug: { value: 0 },                // debug view: 1 seam 2 AO 3 belly id 4 plate 5 cap 6 bundles 7 cavity 8 curvature
    uMusTex: { value: getMuscleTexture() },
    uEyeL: { value: eyeL }, uEyeR: { value: eyeR }, uEyeRad: { value: eyeR0 },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.6, metalness: 0, clearcoat: 1.0, clearcoatRoughness: 0.16, envMapIntensity: 0.22,
  });
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    injectCommonVertex(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRest; varying vec3 vFibV; varying vec3 vFibR; varying vec4 vMd; varying vec4 vMd2; varying vec3 vT1V; varying vec3 vT2V; varying vec3 vNrmR; varying vec3 vAnc;
uniform float uDebug;
uniform vec3 uSunDirV, uSunCol, uFillDirV, uFillCol; uniform float uTime, uEvap, uHurt, uPore, uIdOn;
uniform vec3 uEyeL, uEyeR, uEyeRad;
uniform sampler2D uMusTex;
${NOISE}
${FRAME}
float sAO, sPlate, sTend, sGum, sCrest, sWet, sEye, sCrease, sGlint, sConvex, sHead, sFold;
vec2 sUVA, sUVB; float sS, sWA, sCap, sFpA, sFpB, sWC, sWF, sWF2;
// texture means (R coarse, G fine) -> what a band-limited term fades to
const float RM = 0.74, GM = 0.8;
float c_wc(float fp){ return (1.0 - smoothstep(1.0 / 160.0, 1.0 / 65.0, fp)) * (1.0 - sCap); }
float c_wf(float fp){ return (1.0 - smoothstep(1.0 / 460.0, 1.0 / 180.0, fp)) * (1.0 - 0.8 * sCap); }
// band-limited strand height of one projection (coarse fascicles + fine strands)
float c_bh(vec2 uv, float fp){ vec4 t = texture2D(uMusTex, uv); return mix(RM, t.r, c_wc(fp)) * 0.65 + mix(GM, t.g, c_wf(fp)) * 0.35; }
// d(height)/d(across) of one projection at its footprint (finite difference = band-limited derivative)
float c_dh(vec2 uv, float fp){ float e = max(fp, 1.0 / 1024.0); return (c_bh(uv + vec2(e, 0.0), fp) - c_bh(uv, fp)) / e; }
float c_dg(vec2 uv, float fp){ float e = max(fp, 1.0 / 1024.0); return (texture2D(uMusTex, uv + vec2(e, 0.0)).g - texture2D(uMusTex, uv).g) / e * c_wf(fp); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // ---- masks from the sculpt ----
  sAO = clamp(vMd.z, 0.0, 1.0);
  float seam = clamp(vMd2.x, 0.0, 1.0);
  float bid = mix(0.5, fract(vMd.w), uIdOn);
  float pRaw = vMd.x;
  sGum = clamp(vMd.y, 0.0, 1.0);
  // crisp organic plate edge: jitter the iso-line, anti-alias by its own footprint
  float pe = pRaw + (c_vn(vRest * 160.0) - 0.5) * 0.16 + (c_vn(vRest * 45.0) - 0.5) * 0.12;
  float pw = clamp(fwidth(pe) * 0.75, 0.015, 0.25);
  sPlate = smoothstep(0.52 - pw, 0.52 + pw, pe);
  float head = smoothstep(1.555, 1.585, vRest.y);   // head A is small (chin at ~1.61)
  sHead = head;
  // tendon sheets only on the body (the head only has pure plate / muscle values; mid values there are just edge transitions)
  sTend = smoothstep(0.18, 0.34, pRaw) * (1.0 - smoothstep(0.4, 0.5, pRaw)) * (1.0 - sPlate) * (1.0 - head);

  // ---- strand texture, BIPLANAR in the fibre frame: the across-fibre coordinate is dot(p,T1) or dot(p,T2), whichever
  // the surface actually spans (picked by the rest normal); the along-fibre coordinate is stretched 7x -> long strands ----
  vec3 F = normalize(vFibR + 1e-6);
  vec3 T1 = c_t1(F), T2 = cross(F, T1);
  vec3 Nr = normalize(vNrmR + 1e-6);
  float n1 = dot(Nr, T1), n2 = dot(Nr, T2);
  sWA = smoothstep(0.3, 0.7, n2 * n2 / (n1 * n1 + n2 * n2 + 1e-4) + (c_vn(vRest * 45.0) - 0.5) * 0.3);
  sCap = smoothstep(0.35, 0.72, abs(dot(F, Nr)));     // fibre running into the surface: no strand direction to show
  sS = mix(8.0, 12.0, head);
  // measured from the belly's anchor (manchor): keeps the stripe gradient on T even where the fibre field turns
  vec3 q = vRest - vAnc;
  float along = dot(q, F) * 0.14;
  vec2 bo = vec2(fract(bid * 7.13), fract(bid * 3.71));
  sUVA = vec2(dot(q, T1), along) * sS + bo;
  sUVB = vec2(dot(q, T2), along) * sS + vec2(0.5, 0.37) + bo;
  sFpA = max(fwidth(sUVA.x), 1e-5); sFpB = max(fwidth(sUVB.x), 1e-5);
  vec2 uvA2 = sUVA * 2.7 + vec2(0.31, 0.67), uvB2 = sUVB * 2.7 + vec2(0.71, 0.13);
  vec4 tA = texture2D(uMusTex, sUVA), tB = texture2D(uMusTex, sUVB);
  float gA2 = texture2D(uMusTex, uvA2).g, gB2 = texture2D(uMusTex, uvB2).g;
  float fp = mix(sFpB, sFpA, sWA);
  sWC = c_wc(fp); sWF = c_wf(fp); sWF2 = c_wf(fp * 2.7);
  vec4 tx = mix(tB, tA, sWA);
  float hC = mix(RM, tx.r, sWC), hF = mix(GM, tx.g, sWF), hF2 = mix(GM, mix(gB2, gA2, sWA), sWF2);
  float tint = mix(0.5, tx.b, sWC);

  // ---- muscle ----
  // value structure: grooves (AO / seam / baked curvature) go deep blood-red, bulges go warm orange-red
  float curv = clamp(vMd2.w, -1.0, 1.0);
  sCrease = clamp(max(max(smoothstep(0.97, 0.55, sAO), smoothstep(0.12, 0.6, seam)), smoothstep(-0.04, -0.45, curv)), 0.0, 1.0);
  float convex = smoothstep(0.72, 0.98, sAO) * (1.0 - seam) * smoothstep(-0.2, 0.35, curv);
  sConvex = convex;
  // macro strands (1/3 frequency) that survive to gameplay distance at ~20% contrast
  float mA = texture2D(uMusTex, sUVA * 0.3 + vec2(0.11, 0.0)).r, mB = texture2D(uMusTex, sUVB * 0.3 + vec2(0.53, 0.0)).r;
  float wM = (1.0 - smoothstep(1.0 / 140.0, 1.0 / 50.0, fp * 0.3)) * (1.0 - sCap);
  float hM = mix(RM, mix(mB, mA, sWA), wM);
  float bund = smoothstep(0.25, 0.95, hC);
  vec3 cGroove = vec3(0.068, 0.0037, 0.0024), cGap = vec3(0.15, 0.008, 0.006);
  // each belly its own red: purple-crimson <-> orange-scarlet, +-12% value (separates the muscles at distance)
  vec3 cBase = mix(vec3(0.22, 0.009, 0.017), vec3(0.3, 0.024, 0.014), bid) * (0.88 + 0.24 * fract(bid * 5.31));
  vec3 cTop = vec3(0.62, 0.065, 0.04);
  vec3 col = mix(cGap * (cBase / 0.34), cBase, bund);       // strand gaps: dark crimson, ~35% darker, never black
  col *= mix(1.0, 0.8 + 0.2 * hF, sWF) * mix(1.0, 0.9 + 0.1 * hF2, sWF2);
  col *= 1.0 + (hM - RM) * 0.8;
  col *= 0.84 + 0.32 * tint;
  col.g *= 0.85 + 0.3 * tint;   // strands alternate scarlet / crimson
  // thin pale fascia lines in some of the gaps between bundles (game close-up: white-pink threads on neck/face)
  float gapLine = (1.0 - smoothstep(0.08, 0.38, tx.r)) * smoothstep(0.55, 0.75, tx.b) * sWC * (1.0 - sCap);
  col = mix(col, vec3(0.42, 0.2, 0.17) * mix(0.6, 1.0, sAO), gapLine * 0.65);
  // low-frequency blood / wetness mottling
  float blot = c_vn(vRest * 11.0) * 0.6 + c_vn(vRest * 31.0) * 0.4;
  col *= 0.86 + 0.28 * blot;
  // warm orange-red on the bulges, a little hotter on the strand crests
  sCrest = convex * (0.6 + 0.4 * smoothstep(0.55, 0.95, hC * 0.75 + hF * 0.25));
  col = mix(col, cTop * (0.85 + 0.3 * tint), sCrest * 0.28);
  // deep blood-red between the bellies
  col = mix(col, cGroove, sCrease * 0.9);
  col *= mix(0.25, 1.0, smoothstep(0.35, 0.97, sAO));
  // form shading from the baked curvature: belly tops bright, flats and hollows sink (reads at gameplay distance)
  col *= mix(0.5, 1.12, smoothstep(-0.25, 0.55, curv));

  // ---- tendon sheets: glossy white-pink cords along the fibre ----
  vec3 cTen = mix(vec3(0.62, 0.36, 0.33), vec3(0.8, 0.62, 0.56), hF) * mix(0.75, 1.0, sAO);
  col = mix(col, cTen, sTend * 0.85);

  // ---- gums ----
  col = mix(col, vec3(0.42, 0.06, 0.055) * (0.7 + 0.4 * hF) * mix(0.4, 1.0, sAO), sGum * 0.9);

  // ---- pale plates. HEAD: bone/skin — ivory with pink-grey variation, fine wrinkle folds along fib, soft dark creases.
  //      BODY: tendon straps (Y strap, sternum, intersections) — grey-pink-white glossy cord with strands ----
  float pn = c_vn(vRest * 22.0) * 0.6 + c_vn(vRest * 70.0) * 0.35 + c_vn(vRest * 190.0) * 0.05;
  // wrinkle folds: the strand texture at ~half frequency, projected along the plate's fold direction
  float fA = texture2D(uMusTex, sUVA * 0.55 + vec2(0.2, 0.0)).r, fB = texture2D(uMusTex, sUVB * 0.55 + vec2(0.6, 0.0)).r;
  float wFo = 1.0 - smoothstep(1.0 / 110.0, 1.0 / 40.0, fp * 0.55);
  sFold = mix(RM, mix(fB, fA, sWA), wFo);
  vec3 ivory = vec3(0.5, 0.41, 0.31), greyPink = vec3(0.42, 0.32, 0.27), blush = vec3(0.42, 0.25, 0.2);   // dirty beige skin (game ref)
  vec3 cPl = mix(ivory, greyPink, smoothstep(0.35, 0.75, c_vn(vRest * 13.0) * 0.7 + pn * 0.3));
  cPl = mix(blush, cPl, smoothstep(0.55, 0.97, sAO) * (0.75 + 0.25 * pn));
  cPl = mix(cPl, vec3(0.4, 0.31, 0.27), (1.0 - smoothstep(0.55, 0.95, pRaw)) * 0.55);   // leathery toward the edges
  cPl *= mix(1.0, 0.55 + 0.5 * smoothstep(0.2, 0.95, sFold), wFo);                      // soft dark crease in every fold
  cPl *= mix(1.0, 0.9 + 0.1 * hF, sWF);                                                  // fine grain
  vec2 uvV = (sWA > 0.5 ? vec2(sUVA.x, sUVA.y / 0.14) : vec2(sUVB.x, sUVB.y / 0.14)) * 0.45;
  float vein = texture2D(uMusTex, uvV).a * (1.0 - smoothstep(1.0 / 70.0, 1.0 / 25.0, fp * 0.45));
  cPl *= 0.88 + 0.18 * pn;
  cPl = mix(cPl, vec3(0.5, 0.2, 0.18), vein * 0.3);
  cPl *= mix(0.45, 1.0, smoothstep(0.3, 0.97, sAO));
  vec3 cStrap = mix(vec3(0.42, 0.29, 0.26), vec3(0.6, 0.48, 0.43), hC * 0.6 + hF * 0.4) * mix(0.5, 1.0, sAO);
  cPl = mix(cStrap, cPl, sHead);
  // thin dark rim where the plate tucks into the muscle
  float rim = smoothstep(0.12, 0.42, pRaw) * (1.0 - sPlate);
  col = mix(col, col * 0.55, rim * (1.0 - sTend));
  col = mix(col, cPl, sPlate);

  // ---- sunken eye sockets ----
  float de = min(length((vRest - uEyeL) / uEyeRad), length((vRest - uEyeR) / uEyeRad));
  sEye = max(1.0 - smoothstep(0.5, 1.3, de), clamp(vMd2.y, 0.0, 1.0));
  col = mix(col, col * vec3(0.04, 0.015, 0.015), sEye * 0.97);

  // ---- steam-hurt: darker, cooked meat ----
  col *= 1.0 - 0.35 * uHurt * (1.0 - sPlate * 0.6);

  // wet spots: sparse, on crests only (broken glints, never sheets)
  float wn = c_vn(vRest * 60.0 + 3.1) * 0.55 + c_vn(vRest * 19.0) * 0.45;
  sWet = smoothstep(0.42, 0.66, wn);
  sGlint = sWet * sCrest * (1.0 - sPlate) * (1.0 - sEye);
  diffuseColor.rgb = col;
  if (uDebug > 0.5) {
    float dv = uDebug < 1.5 ? seam : uDebug < 2.5 ? sAO : uDebug < 3.5 ? bid : uDebug < 4.5 ? sPlate : uDebug < 5.5 ? sCap : uDebug < 6.5 ? hC : uDebug < 7.5 ? clamp(vMd2.z * 0.5 + 0.5, 0.0, 1.0) : clamp(vMd2.w * 0.5 + 0.5, 0.0, 1.0);
    diffuseColor.rgb = vec3(dv * dv);
  }
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
{
  float rMus = mix(mix(0.64, 0.5, sConvex), 0.36, sWet * smoothstep(0.3, 0.9, sAO)) + 0.1 * sCrease - 0.1 * uHurt;   // broad soft sheen on bulges
  roughnessFactor = rMus;
  roughnessFactor = mix(roughnessFactor, 0.36, sTend);
  roughnessFactor = mix(roughnessFactor, 0.34, sGum);
  roughnessFactor = mix(roughnessFactor, mix(0.5, 0.78, sHead), sPlate);
  roughnessFactor = clamp(roughnessFactor + 0.25 * sEye, 0.25, 0.9);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // analytic bump from the fibre texture: finite differences at the pixel footprint (band-limited), mapped through
  // the skinned fibre frame (vT1V/vT2V) -> no screen-space derivative blockiness up close
  float dA = c_dh(sUVA, sFpA) * sWA, dB = c_dh(sUVB, sFpB) * (1.0 - sWA);
  float dA2 = c_dg(sUVA * 2.7 + vec2(0.31, 0.67), sFpA * 2.7) * sWA, dB2 = c_dg(sUVB * 2.7 + vec2(0.71, 0.13), sFpB * 2.7) * (1.0 - sWA);
  float amp = 0.0004 * uPore * (1.0 - 0.75 * sPlate) * (1.0 - sGum * 0.5) * mix(0.5, 1.0, sAO);
  float amp2 = 0.00004 * uPore * (1.0 - 0.6 * sPlate);
  vec2 g2 = vec2(dA * amp + dA2 * amp2 * 2.7, dB * amp + dB2 * amp2 * 2.7) * sS;   // slopes along T1 / T2
  {   // wrinkle folds on the head plates (finite differences at the fold footprint; unconditional = valid derivatives)
    float e = max(max(sFpA, sFpB) * 0.55, 1.0 / 1024.0);
    vec2 uA = sUVA * 0.55 + vec2(0.2, 0.0), uB = sUVB * 0.55 + vec2(0.6, 0.0);
    float dfA = (texture2D(uMusTex, uA + vec2(e, 0.0)).r - texture2D(uMusTex, uA).r) / e;
    float dfB = (texture2D(uMusTex, uB + vec2(e, 0.0)).r - texture2D(uMusTex, uB).r) / e;
    float wFo = 1.0 - smoothstep(1.0 / 110.0, 1.0 / 40.0, max(sFpA, sFpB) * 0.55);
    g2 += vec2(dfA * sWA, dfB * (1.0 - sWA)) * 0.00075 * 0.55 * sS * sPlate * sHead * wFo * uPore;
  }
  vec3 gV = g2.x * normalize(vT1V) + g2.y * normalize(vT2V);
  gV -= normal * dot(gV, normal);
  normal = normalize(normal - gV * faceDirection);
}`)
      .replace('#include <clearcoat_normal_fragment_begin>', `#include <clearcoat_normal_fragment_begin>
#ifdef USE_CLEARCOAT
clearcoatNormal = normalize(mix(clearcoatNormal, normal, 0.85));
#endif`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
{
  // specular occlusion: no glaze inside the creases / sockets
  float so = mix(0.15, 1.0, smoothstep(0.35, 0.95, sAO)) * (1.0 - 0.85 * sEye) * (1.0 - 0.5 * sCrease);
  material.specularColor *= so; material.specularColorBlended *= so; material.specularF90 *= so;
  #ifdef USE_CLEARCOAT
  material.clearcoat = 0.7 * sGlint * so + 0.25 * sTend + 0.3 * sGum;
  #endif
}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= 0.7 * mix(0.3, 1.0, sAO * sAO);   // stronger key-to-fill ratio, ambient occluded in the creases
reflectedLight.indirectSpecular *= mix(0.1, 1.0, sAO * sAO);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 V = normalize(vViewPosition);
  float ndv = clamp(dot(normal, V), 0.0, 1.0);
  float ndl = dot(normal, uSunDirV);
  float meat = 1.0 - sPlate;
  // subsurface: light wraps past the terminator, deep red (meat) / warm pink (fascia)
  float wrap = clamp((ndl + 0.4) / 1.4, 0.0, 1.0) - clamp(ndl, 0.0, 1.0);
  totalEmissiveRadiance += diffuseColor.rgb * uSunCol * mix(vec3(0.75, 0.32, 0.28), vec3(1.0, 0.18, 0.12), meat) * wrap * 0.55 * sAO;
  // backlit translucency on thin silhouettes
  float back = pow(clamp(dot(-V, uSunDirV), 0.0, 1.0), 3.0);
  float rim = pow(1.0 - ndv, 3.0);
  totalEmissiveRadiance += uSunCol * vec3(0.55, 0.06, 0.04) * back * rim * 0.6 * mix(0.3, 1.0, sAO);
  // cinematic character fill so the face reads while backlit
  float fill = clamp(dot(normal, uFillDirV) * 0.7 + 0.3, 0.0, 1.0);
  totalEmissiveRadiance += diffuseColor.rgb * uFillCol * fill * fill * mix(0.15, 1.0, sAO) * 0.9;
  // steam-hurt: heat glowing up from the grooves between bundles
  float hot = (0.25 + 0.75 * sCrease) * (1.0 - smoothstep(0.4, 0.8, mix(c_bh(sUVB, sFpB), c_bh(sUVA, sFpA), sWA)) * 0.6);
  totalEmissiveRadiance += vec3(0.5, 0.05, 0.015) * uHurt * hot * meat * (0.75 + 0.25 * sin(uTime * 6.0 + vRest.y * 40.0));
  if (uEvap > 0.0) {
    float n = c_vn(vRest * 30.0) * 0.6 + c_vn(vRest * 90.0) * 0.4;
    float th = uEvap * 1.15 - 0.08;
    if (n < th) discard;
    float edge = 1.0 - smoothstep(0.0, 0.09, n - th);
    totalEmissiveRadiance += vec3(3.0, 1.1, 0.35) * edge + vec3(0.6, 0.1, 0.03) * uEvap;
  }
}`);
  };
  mat.customProgramCacheKey = () => 'colossal-muscle-v4';
  return mat;
}

export function createHairMaterial(tipY = 1.6) {
  const uniforms = { ...COMMON_UNIFORMS(), uTipY: { value: tipY } };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, envMapIntensity: 0.35 });
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    injectCommonVertex(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRest; varying vec3 vFibV; varying vec4 vMd; varying vec4 vMd2;
uniform vec3 uSunDirV, uSunCol, uFillDirV, uFillCol; uniform float uTime, uEvap, uHurt, uTipY;
${NOISE}
float hS; float hAO; float hW;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 F = normalize(vFibV + 1e-5);
  vec3 p = vRest * 75.0;
  vec3 q = vec3(p.x, p.y * 0.07, p.z);
  float fw = length(fwidth(q));
  float w1 = 1.0 - smoothstep(0.18, 0.55, fw);
  float w2 = 1.0 - smoothstep(0.15, 0.45, fw * 2.6);
  hW = w1;
  float s1 = c_vn(q);
  float s2 = c_vn(q * 2.6 + 5.0);
  hS = mix(0.5, s1, w1) * 0.6 + mix(0.5, s2, w2) * 0.4;
  hAO = vMd.z;
  vec3 dark = vec3(0.028, 0.013, 0.006), mid = vec3(0.075, 0.038, 0.017), light = vec3(0.14, 0.075, 0.034);
  vec3 col = mix(dark, mid, smoothstep(0.22, 0.62, hS));
  col = mix(col, light, smoothstep(0.74, 0.92, hS) * 0.55);
  col *= mix(0.25, 1.0, pow(hAO, 1.4));
  col *= mix(0.5, 1.0, smoothstep(uTipY - 0.13, uTipY + 0.05, vRest.y));
  diffuseColor.rgb = col;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 dh = vec2(dFdx(hS), dFdy(hS)) * 0.32 * hW;
  normal = c_perturb(-vViewPosition, normal, dh, faceDirection);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 V = normalize(vViewPosition);
  vec3 T = normalize(vFibV - normal * dot(vFibV, normal) + 1e-5);
  vec3 Hh = normalize(uSunDirV + V);
  float th = dot(T, Hh);
  float spec = pow(sqrt(max(0.0, 1.0 - th * th)), 90.0) * smoothstep(-0.1, 0.3, dot(normal, uSunDirV));
  totalEmissiveRadiance += uSunCol * vec3(0.95, 0.62, 0.36) * spec * 0.16 * (0.4 + hS) * hAO;
  float fill = clamp(dot(normal, uFillDirV) * 0.6 + 0.4, 0.0, 1.0);
  totalEmissiveRadiance += diffuseColor.rgb * uFillCol * fill * 0.6;
  float back = pow(clamp(dot(-V, uSunDirV), 0.0, 1.0), 3.0);
  totalEmissiveRadiance += uSunCol * vec3(0.6, 0.35, 0.2) * back * pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 3.0) * 0.15 * hAO;
  if (uEvap > 0.0) { float n = c_vn(vRest * 30.0); if (n < uEvap * 1.1 - 0.05) discard; }
}`);
  };
  mat.customProgramCacheKey = () => 'giant-hair-v1';
  return mat;
}

// small eyes deep in the sockets: dark wet iris with a hot glint
export function createEyeMaterial() {
  const W = 256, Hh = 128;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, Hh);
  grd.addColorStop(0, '#020101'); grd.addColorStop(0.1, '#070403');
  grd.addColorStop(0.16, '#1c120c'); grd.addColorStop(0.22, '#0c0705');
  grd.addColorStop(0.27, '#5a4a40'); grd.addColorStop(0.6, '#6a5648'); grd.addColorStop(1, '#3a2018');
  g.fillStyle = grd; g.fillRect(0, 0, W, Hh);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshPhysicalMaterial({ map: tex, color: 0x5a4a44, roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.2 });
}

// teeth: off-white enamel (vertex colours carry the root-to-tip shading), slightly wet
export function createTeethMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, vertexColors: true, envMapIntensity: 0.2 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  { float l = dot(diffuseColor.rgb, vec3(0.333)); diffuseColor.rgb = vec3(0.7, 0.6, 0.42) * mix(0.18, 1.0, smoothstep(0.38, 0.88, l)); }   /* yellowed ivory, dark roots/gaps */`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vec3(0.07, 0.06, 0.05);');
  };
  m.customProgramCacheKey = () => 'colossal-teeth-v3';
  return m;
}

export function updateLightingUniforms(u, ctx, fillDir) {
  const sun = ctx.sky?.sun;
  const v = u.uSunDirV.value;
  if (sun) v.copy(sun.position).sub(sun.target?.position || new THREE.Vector3()).normalize(); else v.set(...ctx.LAYOUT.sunDir).normalize();
  v.transformDirection(ctx.camera.matrixWorldInverse);
  if (sun) u.uSunCol.value.copy(sun.color).multiplyScalar(Math.min(3, sun.intensity) * 0.45);
  if (fillDir) u.uFillDirV.value.copy(fillDir);
  u.uTime.value = ctx.clock.time;
}
