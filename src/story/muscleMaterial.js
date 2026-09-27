// Materials for the giant: soft human skin (peach -> tan, blush, lips, gums, nails, pores, sweat sheen,
// wrap/subsurface light, backlit translucency, cavity occlusion baked from the SDF), strand-textured hair,
// teeth and squinting eyes. All MeshPhysicalMaterial + onBeforeCompile so shadows/fog/tonemapping stay standard.
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
attribute vec3 fibre; attribute vec4 mdata; attribute vec4 mdata2;
varying vec3 vRest; varying vec3 vFibV; varying vec4 vMd; varying vec4 vMd2;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
vRest = position; vMd = mdata; vMd2 = mdata2;`)
    .replace('#include <skinnormal_vertex>', `#include <skinnormal_vertex>
#ifdef USE_SKINNING
vFibV = normalize(normalMatrix * (skinMatrix * vec4(fibre, 0.0)).xyz);
#else
vFibV = normalize(normalMatrix * fibre);
#endif`);
}

export function createSkinMaterial(eyeL = new THREE.Vector3(0, -9, 0), eyeR = new THREE.Vector3(0, -9, 0), eyeR0 = new THREE.Vector3(0.034, 0.02, 0.03)) {
  const uniforms = { ...COMMON_UNIFORMS(), uPore: { value: 1.0 }, uEyeL: { value: eyeL }, uEyeR: { value: eyeR }, uEyeRad: { value: eyeR0 } };
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.42, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.3,
  });
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    injectCommonVertex(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRest; varying vec3 vFibV; varying vec4 vMd; varying vec4 vMd2;
uniform vec3 uSunDirV, uSunCol, uFillDirV, uFillCol; uniform float uTime, uEvap, uHurt, uPore;
uniform vec3 uEyeL, uEyeR, uEyeRad;
${NOISE}
float sH; float sAO; float sEye; float sweat;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float nail = clamp(vMd.x, 0.0, 1.0), gum = clamp(vMd.y, 0.0, 1.0), lip = clamp(vMd2.x, 0.0, 1.0), flush = clamp(vMd2.y, 0.0, 1.0);
  float cav = vMd2.z;
  sAO = vMd.z;
  vec3 p = vRest;
  float big = c_vn(p * 9.0) * 0.6 + c_vn(p * 23.0) * 0.4;
  vec3 pale = vec3(0.58, 0.27, 0.14), tan = vec3(0.44, 0.19, 0.09);
  vec3 col = mix(pale, tan, smoothstep(0.2, 0.85, big) * 0.22 + 0.3);
  // blotchy redness + blush
  col = mix(col, vec3(0.55, 0.17, 0.1), flush * 0.35 + c_vn(p * 40.0) * 0.06);
  col = mix(col, vec3(0.5, 0.15, 0.13), lip * 0.8);
  col = mix(col, vec3(0.62, 0.22, 0.24), gum);
  col = mix(col, vec3(0.86, 0.66, 0.55), nail * 0.8);
  // pores / micro bumps (anti-aliased by footprint)
  vec3 q = p * 1500.0;
  float fw = length(fwidth(q));
  float pw = 1.0 - smoothstep(0.35, 0.9, fw);
  float pore = c_vn(q) * 0.6 + c_vn(q * 2.3 + 7.0) * 0.4;
  float wr = c_vn(p * 380.0);
  float fw2 = length(fwidth(p * 380.0));
  sH = mix(0.5, pore, pw) * 0.5 + mix(0.5, wr, 1.0 - smoothstep(0.3, 0.9, fw2)) * 0.3 + big * 0.2;
  // crease / cavity: deeper, redder, darker (skin folds of the grin)
  float crease = clamp(1.0 - sAO, 0.0, 1.0);
  // occlusion as warm, soft subsurface-red shadow (never grey/black strokes)
  vec3 warm = vec3(0.6, 0.3, 0.2);
  col = mix(col, col * warm, smoothstep(0.08, 0.9, crease) * 0.62 + smoothstep(-0.3, -0.9, cav) * 0.18);
  col *= mix(0.68, 1.0, sAO);
  col *= 1.0 - 0.72 * clamp(vMd2.w, 0.0, 1.0);
  // orbital shading: soft warm shadow pooled around the squinting crescents
  float de = min(length((vRest - uEyeL) / uEyeRad), length((vRest - uEyeR) / uEyeRad));
  sEye = 1.0 - smoothstep(0.45, 1.35, de);
  col = mix(col, col * vec3(0.5, 0.3, 0.25), sEye * 0.6);
  diffuseColor.rgb = col;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
sweat = smoothstep(0.35, 0.75, c_vn(vRest * 26.0) * 0.7 + c_vn(vRest * 70.0) * 0.3);
roughnessFactor = clamp(0.46 - 0.12 * sweat - 0.06 * sH - 0.16 * clamp(vMd2.x, 0.0, 1.0) - 0.2 * clamp(vMd.y, 0.0, 1.0) - 0.1 * sEye + 0.18 * (1.0 - sAO), 0.26, 0.8);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
{
  // specular occlusion: sweat highlights break across the forms instead of glazing the creases
  float so = mix(0.2, 1.0, smoothstep(0.35, 0.95, sAO));
  material.specularColor *= so; material.specularColorBlended *= so; material.specularF90 *= so;
  #ifdef USE_CLEARCOAT
  material.clearcoat *= so * (0.55 + 0.45 * sweat);
  #endif
}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= 0.65;   // lower fill: stronger key-to-fill ratio on the flesh`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 dh = vec2(dFdx(sH), dFdy(sH)) * 0.14 * uPore;
  normal = c_perturb(-vViewPosition, normal, dh, faceDirection);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 V = normalize(vViewPosition);
  float ndv = clamp(dot(normal, V), 0.0, 1.0);
  float ndl = dot(normal, uSunDirV);
  // subsurface: light wrapping past the terminator, reddened
  float wrap = clamp((ndl + 0.3) / 1.3, 0.0, 1.0) - clamp(ndl, 0.0, 1.0);
  totalEmissiveRadiance += diffuseColor.rgb * uSunCol * vec3(1.0, 0.36, 0.14) * wrap * 0.9 * sAO;
  // backlit translucency on silhouettes (ears, fingers, nose)
  float back = pow(clamp(dot(-V, uSunDirV), 0.0, 1.0), 3.0);
  float rim = pow(1.0 - ndv, 2.5);
  totalEmissiveRadiance += uSunCol * vec3(1.0, 0.36, 0.2) * (back * rim * 0.9 + rim * 0.05) * mix(0.3, 1.0, sAO);
  // cinematic character fill so the grin reads while backlit
  float fill = clamp(dot(normal, uFillDirV) * 0.6 + 0.4, 0.0, 1.0);
  totalEmissiveRadiance += diffuseColor.rgb * uFillCol * fill * mix(0.25, 1.0, sAO) * 0.55;
  // hurt/angry: flushed and steaming
  totalEmissiveRadiance += diffuseColor.rgb * vec3(0.9, 0.2, 0.08) * uHurt * (0.35 + 0.65 * (1.0 - sAO));
  if (uEvap > 0.0) {
    float n = c_vn(vRest * 30.0) * 0.6 + c_vn(vRest * 90.0) * 0.4;
    float th = uEvap * 1.15 - 0.08;
    if (n < th) discard;
    float edge = 1.0 - smoothstep(0.0, 0.09, n - th);
    totalEmissiveRadiance += vec3(3.0, 1.1, 0.35) * edge + vec3(0.6, 0.1, 0.03) * uEvap;
  }
}`);
  };
  mat.customProgramCacheKey = () => 'giant-skin-v2';
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
  // strands: noise compressed along the flow direction (fibre attr, rest space via world-ish rest pos)
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
  // tips darker, never lighter (no grey smears at the hem)
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
  // Kajiya-Kay style highlight along the strand tangent
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

// squinting eye: mostly hidden in the slit, a dark wet iris with a hot glint
export function createEyeMaterial() {
  const W = 256, Hh = 128;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, Hh);
  grd.addColorStop(0, '#020101'); grd.addColorStop(0.08, '#0a0604');
  grd.addColorStop(0.12, '#2a1a10'); grd.addColorStop(0.2, '#3b2616'); grd.addColorStop(0.24, '#120a06');
  grd.addColorStop(0.28, '#b9a58e'); grd.addColorStop(0.7, '#cdb9a0'); grd.addColorStop(1, '#8a5a4a');
  g.fillStyle = grd; g.fillRect(0, 0, W, Hh);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04 });
}

export function createTeethMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xf2e8d6, roughness: 0.42, metalness: 0, vertexColors: true, envMapIntensity: 0.25 });
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vec3(0.22, 0.2, 0.18);'); };
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
