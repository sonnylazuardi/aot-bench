// Titan skin: MeshStandardMaterial patched with wrap/subsurface lighting, backlit rim, triplanar
// procedural skin detail (bump), baked SDF AO, region materials (hair/lips/mouth/teeth/eyes),
// wounds and the evaporation (darken + shrink-to-husk) effect. One material per titan (shared program).
import * as THREE from 'three';

let noiseTex = null;
function makeNoiseTexture() {
  if (noiseTex) return noiseTex;
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  // tileable value noise with several octaves per channel
  const lattice = (period, seed) => {
    const a = new Float32Array(period * period);
    let s = seed;
    for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s / 4294967296; }
    return a;
  };
  const sample = (lat, period, x, y) => {
    const fx = x * period, fy = y * period;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const g = (i, j) => lat[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
    const a = g(ix, iy), b = g(ix + 1, iy), c = g(ix, iy + 1), d = g(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const octs = (seed, p0, n, ridge) => {
    const lats = []; for (let o = 0; o < n; o++) lats.push([lattice(p0 << o, seed + o * 17), p0 << o]);
    return (x, y) => {
      let v = 0, amp = 0.5, tot = 0;
      for (const [lat, p] of lats) {
        let s = sample(lat, p, x, y);
        if (ridge) s = 1 - Math.abs(s * 2 - 1);
        v += s * amp; tot += amp; amp *= 0.5;
      }
      return v / tot;
    };
  };
  const fine = octs(3, 32, 3, false), wrink = octs(9, 8, 4, true), blot = octs(21, 4, 4, false), vein = octs(33, 6, 3, true);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, i = (y * N + x) * 4;
    data[i] = Math.round(fine(u, v) * 255);
    data[i + 1] = Math.round(wrink(u, v) * 255);
    data[i + 2] = Math.round(blot(u, v) * 255);
    data[i + 3] = Math.round(Math.pow(vein(u, v), 6) * 255);
  }
  noiseTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

const VERT_PARS = /* glsl */`
attribute vec4 aMat;
attribute vec4 aInfo;
varying vec4 vMat;
varying vec4 vInfo;
varying vec3 vBindPos;
varying vec3 vBindN;
uniform float uShrink;
uniform float uThScale;
`;
const VERT_BEGIN = /* glsl */`
vec3 transformed = vec3( position );
transformed -= normal * aInfo.y * uThScale * uShrink;
vMat = aMat; vInfo = aInfo; vBindPos = position; vBindN = normal;
`;

const FRAG_PARS = /* glsl */`
varying vec4 vMat;
varying vec4 vInfo;
varying vec3 vBindPos;
varying vec3 vBindN;
uniform sampler2D uNoise;
uniform vec3 uTint;
uniform float uEvap;
uniform float uBlink;
uniform float uLid;
uniform vec3 uEyeL;
uniform vec3 uEyeR;
uniform float uEyeRad;
uniform float uPupil;
uniform float uIris;
uniform vec4 uWound[4];
uniform float uDetail;
uniform float uHeat;
uniform float uSSS;

vec4 triNoise(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture2D(uNoise, p.yz) * w.x + texture2D(uNoise, p.xz) * w.y + texture2D(uNoise, p.xy) * w.z;
}
vec3 titanPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

// albedo / roughness / emissive for every region
const FRAG_ALBEDO = /* glsl */`
float tHair = vMat.x, tLip = vMat.y, tTeeth = vMat.z, tEye = vMat.w;
float tMouth = vInfo.w * (1.0 - tEye);
float ao = vInfo.x;
vec4 nzA = triNoise(vBindPos * 0.9, vBindN);
vec4 nzB = triNoise(vBindPos * 0.23, vBindN);
// skin
vec3 skin = uTint;
float blot = nzB.b;
skin *= mix(0.9, 1.08, blot);
skin = mix(skin, skin * vec3(1.12, 0.78, 0.74), clamp(vInfo.z * 0.9 + (blot - 0.5) * 0.4, 0.0, 1.0)); // flushed knees, knuckles, nose, cheeks
skin = mix(skin, skin * vec3(0.86, 0.8, 0.86), nzA.a * 0.5 * (1.0 - tHair));  // faint veins
skin *= mix(0.72, 1.0, ao);                                                      // cavity tint (skin darkens & reddens in creases)
skin = mix(skin * vec3(0.95, 0.72, 0.66), skin, smoothstep(0.35, 0.85, ao));
vec3 col = skin;
float rough = mix(0.62, 0.48, nzA.r);
// hair: dark, stringy
vec3 hairC = vec3(0.045, 0.032, 0.024) * mix(0.6, 1.4, nzA.g);
col = mix(col, hairC, smoothstep(0.35, 0.65, tHair));
rough = mix(rough, 0.55, tHair);
// lips / gums
vec3 lipC = uTint * vec3(0.78, 0.42, 0.40);
col = mix(col, lipC, smoothstep(0.2, 0.6, tLip));
rough = mix(rough, 0.32, tLip);
// mouth interior
col = mix(col, vec3(0.16, 0.035, 0.03) * (0.4 + 0.6 * ao), smoothstep(0.25, 0.7, tMouth));
rough = mix(rough, 0.25, tMouth);
// teeth
vec3 toothC = mix(vec3(0.86, 0.82, 0.70), vec3(0.72, 0.62, 0.42), vInfo.z) * (0.55 + 0.45 * ao);
col = mix(col, toothC, tTeeth);
rough = mix(rough, 0.28, tTeeth);
// eyes: pale sclera, tiny pupil, lids close from the top (blink)
if (tEye > 0.5) {
  vec3 ec = vBindPos - (vBindPos.x > 0.0 ? uEyeL : uEyeR);
  vec3 en = ec / max(length(ec), 1e-4);
  float fwd = en.z;
  float cp = cos(uPupil);
  vec3 sclera = vec3(0.80, 0.76, 0.70) * mix(1.0, 0.8, smoothstep(0.6, 0.0, fwd));
  sclera = mix(sclera, vec3(0.7, 0.3, 0.28), nzA.a * 0.6 * smoothstep(0.7, 0.2, fwd));
  vec3 e = sclera;
  float irisR = cos(uPupil * 2.3);
  e = mix(e, vec3(0.18, 0.11, 0.06), uIris * smoothstep(irisR - 0.01, irisR + 0.01, fwd));
  e = mix(e, vec3(0.01), smoothstep(cp - 0.008, cp + 0.004, fwd));
  float lidEdge = 1.0 - 2.0 * clamp(max(uBlink, uLid), 0.0, 1.0);
  float lid = smoothstep(lidEdge - 0.04, lidEdge + 0.04, en.y);
  e = mix(e, uTint * 0.85, lid);
  col = e * (0.45 + 0.55 * ao);
  rough = mix(0.06, 0.55, lid);
}
// wounds (raw, steaming flesh)
float wound = 0.0;
for (int i = 0; i < 4; i++) {
  vec4 w = uWound[i];
  if (w.w > 0.0) {
    float d = length(vBindPos - w.xyz) / w.w;
    wound = max(wound, smoothstep(1.0, 0.45, d + (nzA.g - 0.5) * 0.5));
  }
}
col = mix(col, vec3(0.32, 0.03, 0.02) * mix(0.6, 1.2, nzA.g), wound);
rough = mix(rough, 0.3, wound);
// evaporation: flesh darkens, reddens, cracks; crevices glow
float ev = uEvap;
vec3 burnt = mix(vec3(0.26, 0.07, 0.05), vec3(0.08, 0.035, 0.03), smoothstep(0.35, 1.0, ev + (nzB.g - 0.5) * 0.4));
float evMask = smoothstep(0.0, 0.6, ev * 1.6 - nzB.b * 0.6);
col = mix(col, burnt * mix(0.7, 1.2, nzA.g), evMask);
rough = mix(rough, 0.8, evMask);
diffuseColor.rgb = col;
`;

const FRAG_NORMAL = /* glsl */`
{
  // skin micro-detail: pores + creases, faded out at distance to avoid shimmer
  float dist = length(vViewPosition);
  float fade = uDetail * (1.0 - smoothstep(60.0, 180.0, dist));
  if (fade > 0.001) {
    vec4 nA = triNoise(vBindPos * 0.9, vBindN);
    vec4 nC = triNoise(vBindPos * 3.1, vBindN);
    float hgt = (nC.r - 0.5) * 0.6 + (nA.g - 0.5) * 1.1 + nA.a * 0.5;
    hgt *= (1.0 - vMat.z) * (1.0 - vMat.w) * (1.0 + uEvap * 2.0);
    vec2 dH = vec2(dFdx(hgt), dFdy(hgt)) * fade * 0.9;
    normal = titanPerturb(-vViewPosition, normal, dH, faceDirection);
  }
}
`;

const FRAG_LIGHT_END = /* glsl */`
{
  float aoK = vInfo.x;
  reflectedLight.indirectDiffuse *= aoK * aoK;
  reflectedLight.indirectSpecular *= aoK;
  reflectedLight.directDiffuse *= mix(0.55, 1.0, aoK);
  reflectedLight.directSpecular *= aoK;
  #if NUM_DIR_LIGHTS > 0
    // backlit rim: the low sun behind titans outlines their silhouettes
    vec3 Ls = directionalLights[ 0 ].direction;
    float fres = pow(1.0 - saturate(dot(normal, geometryViewDir)), 3.0);
    float back = saturate(dot(Ls, -geometryViewDir) * 0.6 + 0.4);
    reflectedLight.directDiffuse += directionalLights[ 0 ].color * uTint * vec3(1.0, 0.72, 0.6) * fres * back * 0.35 * aoK * (1.0 - uEvap * 0.7);
  #endif
  // evaporating crevices glow faintly
  totalEmissiveRadiance += vec3(1.0, 0.25, 0.08) * uHeat * (1.0 - aoK) * 1.5;
}
`;

export function createSkinMaterial(meta) {
  const tex = makeNoiseTexture();
  const u = {
    uNoise: { value: tex },
    uTint: { value: new THREE.Color().setRGB(meta.tone[0], meta.tone[1], meta.tone[2], THREE.SRGBColorSpace) },
    uEvap: { value: 0 }, uShrink: { value: 0 }, uHeat: { value: 0 },
    uBlink: { value: 0 }, uLid: { value: meta.lid || 0 },
    uEyeL: { value: new THREE.Vector3(...meta.eyeL) }, uEyeR: { value: new THREE.Vector3(...meta.eyeR) },
    uEyeRad: { value: meta.eyeR_ },
    uPupil: { value: meta.pupil }, uIris: { value: meta.iris },
    uWound: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uThScale: { value: meta.thScale },
    uDetail: { value: 1 },
    uSSS: { value: 1 },
  };
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', VERT_BEGIN);
    let lp = THREE.ShaderChunk.lights_physical_pars_fragment;
    // wrap diffuse + red subsurface bleed at the terminator (skin), plain for teeth/eyes
    lp = lp.replace(/reflectedLight\.directDiffuse \+= irradiance \* BRDF_Lambert\( material\.diffuseContribution \) \* \( 1\.0 - F \);/,
      `{ float ndlW = dot( geometryNormal, directLight.direction );
         float wrapD = saturate( ( ndlW + 0.45 ) / 1.45 );
         float sssK = uSSS * ( 1.0 - vMat.z ) * ( 1.0 - vMat.w );
         vec3 bleed = directLight.color * max( wrapD * wrapD - saturate( ndlW ), 0.0 ) * vec3( 0.95, 0.32, 0.2 ) * sssK;
         reflectedLight.directDiffuse += ( irradiance + bleed ) * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F ); }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <lights_physical_pars_fragment>', lp)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_ALBEDO)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + FRAG_LIGHT_END);
  };
  m.customProgramCacheKey = () => 'titanSkin1';

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    sh.uniforms.uShrink = u.uShrink; sh.uniforms.uThScale = u.uThScale;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aInfo;\nuniform float uShrink;\nuniform float uThScale;')
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3( position );\ntransformed -= normal * aInfo.y * uThScale * uShrink;');
  };
  depth.customProgramCacheKey = () => 'titanDepth1';
  return { material: m, depth, uniforms: u };
}
