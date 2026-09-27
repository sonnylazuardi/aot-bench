// RENDER builder — ctx.fx
// GPU-instanced pooled particles (2 draw calls: lit alpha "smoke" pool sorted back-to-front + additive "glow" pool),
// soft depth-faded billboards with a procedurally generated normal-mapped puff atlas lit by the sun (wrap diffuse +
// forward scattering + per-particle self-shadow), aerial-perspective fog. Instanced debris & boulders with gravity,
// spin and ground bounce (main scene: shadows, AO, fog). Lightning ribbons, shockwave rings, emitters (steam, fire,
// smoke) and a flash-light pool. Particles are drawn by post.js after AO via fx.render().
import * as THREE from 'three';
import { GLSL_SKY_PARS, makeSharedUniforms } from './atmos.js';
import { FSPass } from './common.js';

// ------------------------------------------------------------------------------------------------------------
// Atlas (4x4 cells): 0-5 billow puffs, 6-8 wisps, 9-11 flame tongues, 12 glow dot, 13 droplet, 14-15 chunky dust
const CELL = { PUFF: 0, WISP: 6, FLAME: 9, GLOW: 12, DROP: 13, CHUNK: 14 };
const ATLAS_FRAG = /* glsl */`
varying vec2 vUv;
uniform float uTexel;
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += vn(p) * a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
float puff(vec2 p, float seed, float rough) {
  float d = -1.0;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    vec2 c = vec2(h21(vec2(seed * 3.7, fi + 0.3)), h21(vec2(fi * 1.9 + 0.7, seed * 5.3))) * 2.0 - 1.0;
    c *= i == 0 ? 0.0 : 0.34;
    float r = i == 0 ? 0.48 : mix(0.2, 0.36, h21(vec2(seed * 1.7, fi * 2.3)));
    d = max(d, 1.0 - length(p - c) / r);
  }
  float n = fbm(p * 2.4 + seed * 7.0);
  float n2 = fbm(p * 6.5 + seed * 3.0);
  float v = d + (n - 0.5) * 0.75 + (n2 - 0.5) * rough;
  v = smoothstep(0.0, 0.6, v);
  return v * smoothstep(1.0, 0.5, length(p)); // wide falloff: no visible disc outline on big puffs
}
float wisp(vec2 p, float seed) {
  float w = fbm(p * 1.6 + seed * 3.0);
  float n = fbm(vec2(p.x * 1.8, p.y * 1.1) + seed * 5.0 + w * 1.6);
  float fall = smoothstep(1.0, 0.15, length(p * vec2(0.95, 0.8)));
  return smoothstep(0.32, 0.78, n) * fall;
}
float flame(vec2 p, float seed) {
  float y = p.y * 0.5 + 0.5;
  float w = 0.62 * pow(max(1.0 - y, 0.0), 0.75) * (0.75 + 0.5 * fbm(vec2(y * 3.0, seed * 7.0)));
  float x = p.x + (fbm(vec2(y * 2.2 - seed, seed * 3.0)) - 0.5) * 0.9 * y;
  float body = smoothstep(w, w * 0.15, abs(x));
  float n = fbm(vec2(p.x * 3.0, p.y * 2.0 - seed * 3.0));
  return clamp(body * smoothstep(0.0, 0.18, y) * (0.55 + 0.7 * n), 0.0, 1.0) * smoothstep(1.0, 0.75, length(p));
}
float cellDensity(vec2 p, float cell) {
  if (cell < 5.5) return puff(p, cell + 1.0, 0.3);
  if (cell < 8.5) return wisp(p, cell);
  if (cell < 11.5) return flame(p, cell);
  float r = length(p);
  if (cell < 12.5) return exp(-r * r * 5.0) * smoothstep(1.0, 0.7, r);
  if (cell < 13.5) return smoothstep(1.0, 0.25, r);
  return puff(p * 1.05, cell * 3.1, 0.9);
}
void main() {
  vec2 cellId = floor(vUv * 4.0);
  float cell = cellId.x + cellId.y * 4.0;
  vec2 p = fract(vUv * 4.0) * 2.0 - 1.0;
  float e = uTexel * 8.0;
  float d = cellDensity(p, cell);
  float dx = cellDensity(p + vec2(e, 0.0), cell) - cellDensity(p - vec2(e, 0.0), cell);
  float dy = cellDensity(p + vec2(0.0, e), cell) - cellDensity(p - vec2(0.0, e), cell);
  vec3 n = normalize(vec3(-dx, -dy, e * 5.0));
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, 0.0, d);
}`;

// ------------------------------------------------------------------------------------------------------------
const PART_VERT = /* glsl */`
attribute vec4 aPos, aCol, aMisc, aVel;
uniform float uPxScale; // pixels per unit at view distance 1 (drawing buffer height * proj[1][1] / 2)
uniform float uMinPx;
varying vec2 vUv, vRot;
varying vec4 vCol, vMisc;
varying vec3 vWorld, vViewDir;
varying float vViewZ, vSize;
void main() {
  vec3 wp = aPos.xyz; float size = aPos.w;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float vz = -mv.z;
  // minimum on-screen size (sparks / droplets stay visible far away), energy conserved through alpha
  float minS = uMinPx * max(vz, 0.1) / uPxScale;
  float sz = max(size, minS);
  float aK = (size * size) / (sz * sz);
  vec2 corner = position.xy;
  float r = aMisc.x; float c = cos(r), s = sin(r);
  vec2 off = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * sz;
  if (aVel.w > 0.0) {
    vec3 vv = mat3(viewMatrix) * aVel.xyz;
    vec2 vd = vv.xy; float vl = length(vd);
    if (vl > 1e-3) {
      vd /= vl; vec2 pd = vec2(-vd.y, vd.x);
      float st = 1.0 + aVel.w * vl;
      off = (vd * corner.y * st + pd * corner.x) * sz;
    }
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  vViewZ = vz; vSize = sz;
  vWorld = wp;
  vViewDir = normalize(mv.xyz);
  float cell = aMisc.y;
  vec2 cc = vec2(mod(cell, 4.0), floor(cell / 4.0));
  vUv = (cc + corner + 0.5) * 0.25;
  vRot = vec2(c, s);
  // fade when the camera is inside / very close to a big particle
  float nf = smoothstep(sz * 0.12, sz * 0.55 + 0.4, vz);
  vCol = vec4(aCol.rgb, aCol.a * nf * aK);
  vMisc = aMisc;
}`;

const SMOKE_FRAG = /* glsl */`
#include <packing>
uniform sampler2D uAtlas, uDepth;
uniform vec2 uRes; uniform float uNear, uFar, uDepthOn;
uniform vec3 uSunV, uAmbTop, uAmbBot;
varying vec2 vUv, vRot;
varying vec4 vCol, vMisc;
varying vec3 vWorld, vViewDir;
varying float vViewZ, vSize;
${GLSL_SKY_PARS}
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  float a = t.a * vCol.a;
  if (a < 0.002) discard;
  if (uDepthOn > 0.5) {
    float sd = texture2D(uDepth, gl_FragCoord.xy / uRes).r;
    float sz = -perspectiveDepthToViewZ(sd, uNear, uFar);
    a *= clamp((sz - vViewZ) / (vSize * 0.3 + 0.25), 0.0, 1.0);
    if (a < 0.002) discard;
  }
  vec2 nt = t.xy * 2.0 - 1.0;
  vec2 nr = vec2(vRot.x * nt.x - vRot.y * nt.y, vRot.y * nt.x + vRot.x * nt.y);
  vec3 n = normalize(vec3(nr, 0.55));
  float ndl = dot(n, uSunV);
  float wrap = clamp(ndl * 0.55 + 0.45, 0.0, 1.0);
  float shade = vMisc.z;
  float mu = dot(vViewDir, uSunV);
  // forward scattering: thin edges glow when backlit by the low sun
  float thin = 1.0 - t.a * 0.75;
  float fw = aotHG(mu, 0.6) * 4.0 * thin;
  vec3 sunL = uAotSunCol * (wrap * wrap * 0.5 + fw * 0.35) * (0.25 + 0.75 * shade);
  vec3 amb = mix(uAmbBot, uAmbTop, clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * (0.55 + 0.45 * shade);
  vec3 col = vCol.rgb * (sunL + amb) + vCol.rgb * vMisc.w;
  col = aotApplyFog(col, cameraPosition, vWorld);
  gl_FragColor = vec4(col * a, a);
}`;

const GLOW_FRAG = /* glsl */`
#include <packing>
uniform sampler2D uAtlas, uDepth;
uniform vec2 uRes; uniform float uNear, uFar, uDepthOn;
varying vec2 vUv, vRot;
varying vec4 vCol, vMisc;
varying vec3 vWorld, vViewDir;
varying float vViewZ, vSize;
${GLSL_SKY_PARS}
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  float a = t.a * vCol.a;
  if (a < 0.002) discard;
  if (uDepthOn > 0.5) {
    float sd = texture2D(uDepth, gl_FragCoord.xy / uRes).r;
    float sz = -perspectiveDepthToViewZ(sd, uNear, uFar);
    a *= clamp((sz - vViewZ) / (vSize * 0.25 + 0.15), 0.0, 1.0);
  }
  vec4 f = aotFogTerm(cameraPosition, vWorld);
  gl_FragColor = vec4(vCol.rgb * a * f.a, 0.0);
}`;

const BOLT_VERT = /* glsl */`
attribute vec3 aA, aB; attribute vec4 aInfo; // x side(-1/1), y end(0/1), z width, w bolt index
uniform float uTime; uniform vec4 uBolts[16]; // x birth, y life, z intensity, w seed
varying float vSide, vAlpha, vViewZ; varying vec3 vWorld;
void main() {
  vec3 p = mix(aA, aB, aInfo.y);
  vec4 mvA = viewMatrix * vec4(aA, 1.0), mvB = viewMatrix * vec4(aB, 1.0);
  vec2 d = normalize((mvB.xy / max(-mvB.z, 0.1)) - (mvA.xy / max(-mvA.z, 0.1)) + 1e-5);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec2 pd = vec2(-d.y, d.x);
  float w = aInfo.z * (1.0 + 0.0025 * max(-mv.z, 0.0));
  mv.xy += pd * aInfo.x * w;
  gl_Position = projectionMatrix * mv;
  vec4 b = uBolts[int(aInfo.w)];
  float age = uTime - b.x;
  float k = clamp(1.0 - age / b.y, 0.0, 1.0);
  float fl = step(0.35, fract(sin(floor(age * 30.0) * 12.9898 + b.w) * 43758.5453));
  vAlpha = (age < 0.0 ? 0.0 : k * k * mix(0.35, 1.0, fl)) * b.z;
  vSide = aInfo.x; vViewZ = -mv.z; vWorld = p;
}`;
const BOLT_FRAG = /* glsl */`
#include <packing>
uniform sampler2D uDepth; uniform vec2 uRes; uniform float uNear, uFar, uDepthOn;
varying float vSide, vAlpha, vViewZ; varying vec3 vWorld;
${GLSL_SKY_PARS}
void main() {
  if (vAlpha <= 0.001) discard;
  if (uDepthOn > 0.5) {
    float sz = -perspectiveDepthToViewZ(texture2D(uDepth, gl_FragCoord.xy / uRes).r, uNear, uFar);
    if (sz < vViewZ - 2.0) discard;
  }
  float x = abs(vSide);
  float core = exp(-x * x * 40.0), glow = exp(-x * x * 4.0);
  vec3 c = vec3(1.0, 0.96, 0.8) * core * 60.0 + vec3(1.0, 0.8, 0.35) * glow * 5.0;
  vec4 f = aotFogTerm(cameraPosition, vWorld);
  gl_FragColor = vec4(c * vAlpha * f.a, 0.0);
}`;

const RING_FRAG = /* glsl */`
#include <packing>
uniform sampler2D uDepth; uniform vec2 uRes; uniform float uNear, uFar, uDepthOn;
uniform vec4 uRing; // x radius, y width, z alpha, w time
uniform vec3 uRingCol;
varying vec2 vLocal; varying vec3 vWorld; varying float vViewZ;
${GLSL_SKY_PARS}
float rh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  float r = length(vLocal);
  float ang = atan(vLocal.y, vLocal.x);
  float n = rh(vec2(floor(ang * 40.0), 3.0)) * 0.5 + 0.5;
  float d = (r - uRing.x) / uRing.y;
  float band = exp(-d * d * 3.0) * (0.6 + 0.4 * n) + exp(-max(-d, 0.0) * 0.8) * 0.25 * step(d, 0.0) * smoothstep(0.0, 0.2, r / uRing.x);
  float a = band * uRing.z;
  if (uDepthOn > 0.5) {
    float sz = -perspectiveDepthToViewZ(texture2D(uDepth, gl_FragCoord.xy / uRes).r, uNear, uFar);
    a *= clamp((sz - vViewZ) / 6.0 + 0.5, 0.0, 1.0);
  }
  vec3 c = uRingCol;
  vec4 f = aotFogTerm(cameraPosition, vWorld);
  gl_FragColor = vec4((c * f.a) * a, a * 0.8);
}`;
const RING_VERT = /* glsl */`
varying vec2 vLocal; varying vec3 vWorld; varying float vViewZ;
void main() { vLocal = position.xz; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mv = viewMatrix * w; vViewZ = -mv.z; gl_Position = projectionMatrix * mv; }`;

// ------------------------------------------------------------------------------------------------------------
// Particle pool (structure of arrays)
const FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'grow', 'rot', 'rotV', 'drag', 'buoy', 'alpha',
  'fin', 'fout', 'cr', 'cg', 'cb', 'cell', 'shade', 'emis', 'stretch', 'turb', 'wind', 'kind', 'seed', 'gnd', 'gy'];
class Pool {
  constructor(n) {
    this.n = n; this.count = 0;
    for (const f of FIELDS) this[f] = new Float32Array(n);
    this.arrs = FIELDS.map((f) => this[f]);
  }
  alloc() {
    if (this.count < this.n) return this.count++;
    // full: recycle the particle closest to death
    let best = 0, bv = -1;
    for (let k = 0; k < 24; k++) { const i = (Math.random() * this.n) | 0; const v = this.age[i] / this.life[i]; if (v > bv) { bv = v; best = i; } }
    return best;
  }
  kill(i) {
    const j = --this.count;
    if (i !== j) { const a = this.arrs; for (let k = 0; k < a.length; k++) a[k][i] = a[k][j]; }
  }
}

function makeParticleMesh(n, material) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const mk = () => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
  g.setAttribute('aPos', mk()); g.setAttribute('aCol', mk()); g.setAttribute('aMisc', mk()); g.setAttribute('aVel', mk());
  g.instanceCount = 0;
  const m = new THREE.Mesh(g, material);
  m.frustumCulled = false;
  return m;
}

// jittered low-poly rock
function rockGeometry(detail, seed, sx = 1, sy = 0.8, sz = 0.9) {
  const g = new THREE.IcosahedronGeometry(0.5, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const rnd = (i) => { const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453; return x - Math.floor(x); };
  // weld-safe jitter: displacement from a hash of the rounded vertex position
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = Math.round(v.x * 1000) * 7.1 + Math.round(v.y * 1000) * 3.3 + Math.round(v.z * 1000) * 1.7;
    const k = 0.72 + 0.5 * rnd(key);
    v.multiplyScalar(k); v.x *= sx; v.y *= sy; v.z *= sz;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _s = new THREE.Vector3(), _c = new THREE.Color(), _dir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);
// accept 0xrrggbb / '#hex' / THREE.Color / {r,g,b} / [r,g,b] -> {r,g,b} (linear) or null
const _cc = new THREE.Color();
function toRGB(c, out = {}) {
  if (c == null) return null;
  try {
    if (typeof c === 'number' || typeof c === 'string') _cc.set(c);
    else if (Array.isArray(c)) _cc.setRGB(c[0], c[1], c[2]);
    else if (c.isColor) _cc.copy(c);
    else if (Number.isFinite(c.r)) _cc.setRGB(c.r, c.g ?? c.r, c.b ?? c.r);
    else if (Number.isFinite(c.x)) _cc.setRGB(c.x, c.y, c.z);
    else return null;
  } catch { return null; }
  if (!Number.isFinite(_cc.r + _cc.g + _cc.b)) return null;
  out.r = _cc.r; out.g = _cc.g; out.b = _cc.b;
  return out;
}

export async function create(ctx) {
  const { renderer, scene } = ctx;
  const qlevel = ctx.quality?.level || 'high';
  const QK = qlevel === 'high' ? 1 : qlevel === 'medium' ? 0.75 : 0.5;
  const SU = ctx.sky?.uniforms || (() => { // fallback when sky is a stub
    const t = new THREE.DataTexture(new Uint8Array([140, 160, 190, 255]), 1, 1); t.needsUpdate = true;
    const u = makeSharedUniforms(t); u.uAotSkyK.value.set(1, 0, 0, 0); u.uAotSunCol.value.set(3, 2.6, 2); return u;
  })();

  // ---- atlas ------------------------------------------------------------------------------------------------
  const AS = qlevel === 'low' ? 512 : 1024;
  const atlasRT = new THREE.WebGLRenderTarget(AS, AS, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
  });
  atlasRT.texture.colorSpace = THREE.NoColorSpace;
  {
    const ap = new FSPass({ name: 'fxAtlas', fragmentShader: ATLAS_FRAG, uniforms: { uTexel: { value: 2 / (AS / 4) } } });
    const prev = renderer.getRenderTarget();
    ap.render(renderer, atlasRT);
    renderer.setRenderTarget(prev);
    ap.material.dispose();
  }

  // ---- materials -------------------------------------------------------------------------------------------
  const common = {
    uAtlas: { value: atlasRT.texture }, uDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.3 }, uFar: { value: 16000 }, uDepthOn: { value: 0 }, uPxScale: { value: 600 }, uMinPx: { value: 0 },
  };
  const lightU = { uSunV: { value: new THREE.Vector3(0, 1, 0) }, uAmbTop: { value: new THREE.Vector3(0.3, 0.35, 0.45) }, uAmbBot: { value: new THREE.Vector3(0.15, 0.12, 0.1) } };
  const smokeMat = new THREE.ShaderMaterial({
    name: 'fxSmoke', vertexShader: PART_VERT, fragmentShader: SMOKE_FRAG,
    uniforms: { ...SU, ...common, ...lightU },
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const glowMat = new THREE.ShaderMaterial({
    name: 'fxGlow', vertexShader: PART_VERT, fragmentShader: GLOW_FRAG,
    uniforms: { ...SU, ...common, uMinPx: { value: 2.2 } },
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  // glow shares common uniforms but has its own min px
  glowMat.uniforms.uMinPx = { value: 1.3 };

  const NS = Math.round(7000 * QK), NG = Math.round(3000 * QK);
  const smoke = new Pool(NS), glow = new Pool(NG);
  const smokeMesh = makeParticleMesh(NS, smokeMat); smokeMesh.renderOrder = 1;
  const glowMesh = makeParticleMesh(NG, glowMat); glowMesh.renderOrder = 2;
  const fxScene = new THREE.Scene();   // full-res: lightning, shockwave rings
  const pScene = new THREE.Scene();    // half-res off-screen: smoke + glow + embers
  pScene.add(smokeMesh, glowMesh);
  const PRES = qlevel === 'high' ? 0.5 : qlevel === 'medium' ? 0.5 : 0.4;
  const offRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
  offRT.texture.colorSpace = THREE.NoColorSpace;
  const compPass = new FSPass({
    name: 'fxComposite', uniforms: { tFx: { value: offRT.texture }, uTexel: { value: new THREE.Vector2() } },
    fragmentShader: `varying vec2 vUv; uniform sampler2D tFx; uniform vec2 uTexel;
    void main() {
      // light 4-tap tent on top of bilinear: hides half-res stair-steps on dense smoke edges
      vec4 c = texture2D(tFx, vUv) * 0.5;
      c += texture2D(tFx, vUv + vec2(uTexel.x, uTexel.y) * 0.5) * 0.125;
      c += texture2D(tFx, vUv + vec2(-uTexel.x, uTexel.y) * 0.5) * 0.125;
      c += texture2D(tFx, vUv + vec2(uTexel.x, -uTexel.y) * 0.5) * 0.125;
      c += texture2D(tFx, vUv + vec2(-uTexel.x, -uTexel.y) * 0.5) * 0.125;
      gl_FragColor = c;
    }`,
    blending: THREE.CustomBlending, transparent: true,
  });
  compPass.material.blendSrc = THREE.OneFactor; compPass.material.blendDst = THREE.OneMinusSrcAlphaFactor;
  compPass.material.blendSrcAlpha = THREE.ZeroFactor; compPass.material.blendDstAlpha = THREE.OneFactor;
  const _clr = new THREE.Color();
  const _ambWarm = new THREE.Vector3(0.12, 0.085, 0.065);

  // ---- embers: persistent field of glowing sparks / ash drifting around the camera (density from sky mood) ---
  const NE = Math.round(700 * QK);
  const emberMesh = makeParticleMesh(NE, glowMat); emberMesh.renderOrder = 3;
  pScene.add(emberMesh);
  const E = { x: new Float32Array(NE), y: new Float32Array(NE), z: new Float32Array(NE), vx: new Float32Array(NE), vy: new Float32Array(NE),
    vz: new Float32Array(NE), seed: new Float32Array(NE), s: new Float32Array(NE), live: false, density: 0, boost: 0 };
  const ER = 70, EYlo = -25, EYhi = 55;
  function respawnEmber(i, anywhere) {
    const a = Math.random() * 6.283, r = Math.pow(Math.random(), 0.8) * ER;
    E.x[i] = camPos.x + Math.cos(a) * r; E.z[i] = camPos.z + Math.sin(a) * r;
    E.y[i] = camPos.y + (anywhere ? EYlo + Math.random() * (EYhi - EYlo) : EYlo + Math.random() * 10);
    E.vx[i] = rand(-1, 1); E.vy[i] = rand(0.8, 3.2); E.vz[i] = rand(-1, 1);
    E.seed[i] = Math.random() * 100;
    E.s[i] = Math.random() < 0.15 ? rand(0.18, 0.34) : rand(0.07, 0.15);
  }
  function stepEmbers(dt, time) {
    const target = Math.max(ctx.sky?.embers ?? 0, E.boost);
    E.density += (target - E.density) * (1 - Math.exp(-dt * 0.5));
    E.boost = Math.max(0, E.boost - dt * 0.1);
    const n = Math.round(NE * Math.min(E.density, 1));
    if (!n) return;
    if (!E.live) { for (let i = 0; i < NE; i++) respawnEmber(i, true); E.live = true; }
    const wx = wind.x * 0.9, wz = wind.z * 0.9;
    const par = frameNo & 1, dt2 = dt * 2;
    for (let i = 0; i < n; i++) {
      if ((i & 1) === par) { // low-frequency drift: half the embers per frame, double step
        const sd = E.seed[i];
        E.vx[i] += (Math.sin(time * 0.9 + sd) * 1.6 + (wx - E.vx[i]) * 0.3) * dt2;
        E.vz[i] += (Math.cos(time * 0.7 + sd * 1.3) * 1.6 + (wz - E.vz[i]) * 0.3) * dt2;
        E.vy[i] += (Math.sin(time * 1.3 + sd * 2.1) * 1.2 + (1.6 - E.vy[i]) * 0.2) * dt2;
      }
      E.x[i] += E.vx[i] * dt; E.y[i] += E.vy[i] * dt; E.z[i] += E.vz[i] * dt;
      const dx = E.x[i] - camPos.x, dz = E.z[i] - camPos.z, dy = E.y[i] - camPos.y;
      if (dx * dx + dz * dz > ER * ER || dy > EYhi || dy < EYlo - 5) respawnEmber(i, dy > EYhi || dy < EYlo - 5 ? false : true);
    }
  }
  function writeEmbers(camera) {
    const g = emberMesh.geometry;
    const n = Math.round(NE * Math.min(E.density, 1));
    g.instanceCount = n;
    if (!n) return;
    const pa = g.attributes.aPos.array, ca = g.attributes.aCol.array, ma = g.attributes.aMisc.array, va = g.attributes.aVel.array;
    for (let i = 0; i < n; i++) {
      const o = i * 4, fl = 0.55 + 0.45 * Math.sin(now * (5 + (E.seed[i] % 7)) + E.seed[i] * 3.1);
      pa[o] = E.x[i]; pa[o + 1] = E.y[i]; pa[o + 2] = E.z[i]; pa[o + 3] = E.s[i];
      ca[o] = 16 * fl; ca[o + 1] = 4.2 * fl * fl; ca[o + 2] = 0.6 * fl; ca[o + 3] = 1;
      ma[o] = 0; ma[o + 1] = CELL.GLOW; ma[o + 2] = 1; ma[o + 3] = 0;
      va[o] = E.vx[i]; va[o + 1] = E.vy[i]; va[o + 2] = E.vz[i]; va[o + 3] = 0.09;
    }
    for (const k of ['aPos', 'aCol', 'aMisc', 'aVel']) { const at = g.attributes[k]; at.clearUpdateRanges(); at.addUpdateRange(0, n * 4); at.needsUpdate = true; }
  }

  // ---- lightning --------------------------------------------------------------------------------------------
  const MAXSEG = 3000, MAXBOLT = 16;
  const boltGeo = new THREE.BufferGeometry();
  const bA = new Float32Array(MAXSEG * 4 * 3), bB = new Float32Array(MAXSEG * 4 * 3), bI = new Float32Array(MAXSEG * 4 * 4);
  boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXSEG * 4 * 3), 3));
  boltGeo.setAttribute('aA', new THREE.BufferAttribute(bA, 3).setUsage(THREE.DynamicDrawUsage));
  boltGeo.setAttribute('aB', new THREE.BufferAttribute(bB, 3).setUsage(THREE.DynamicDrawUsage));
  boltGeo.setAttribute('aInfo', new THREE.BufferAttribute(bI, 4).setUsage(THREE.DynamicDrawUsage));
  {
    const idx = new Uint32Array(MAXSEG * 6);
    for (let i = 0; i < MAXSEG; i++) { const o = i * 4; idx.set([o, o + 1, o + 2, o, o + 2, o + 3], i * 6); }
    boltGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  boltGeo.setDrawRange(0, 0);
  const boltU = [];
  for (let i = 0; i < MAXBOLT; i++) boltU.push(new THREE.Vector4(-100, 0.3, 0, 0));
  const boltMat = new THREE.ShaderMaterial({
    name: 'fxBolt', vertexShader: BOLT_VERT, fragmentShader: BOLT_FRAG,
    uniforms: { ...SU, ...common, uTime: { value: 0 }, uBolts: { value: boltU } },
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const boltMesh = new THREE.Mesh(boltGeo, boltMat);
  boltMesh.frustumCulled = false; boltMesh.renderOrder = 4;
  fxScene.add(boltMesh);
  const bolts = []; // {slot, birth, life, segs:[[ax,ay,az,bx,by,bz,w]]}
  let boltsDirty = false;

  // ---- shockwave rings ---------------------------------------------------------------------------------------
  const rings = [];
  const ringGeo = new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2);
  function makeRing() {
    const mat = new THREE.ShaderMaterial({
      name: 'fxRing', vertexShader: RING_VERT, fragmentShader: RING_FRAG,
      uniforms: { ...SU, ...common, uRing: { value: new THREE.Vector4() }, uRingCol: { value: new THREE.Vector3(1, 0.8, 0.55) } },
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const m = new THREE.Mesh(ringGeo, mat); m.frustumCulled = false; m.renderOrder = 3; m.visible = false;
    fxScene.add(m);
    return { mesh: m, age: 0, life: 0, speed: 0, maxR: 0, active: false };
  }
  for (let i = 0; i < 4; i++) rings.push(makeRing());

  // ---- lights (created up front: adding lights later would recompile every material) ------------------------
  const flashLight = new THREE.PointLight(0xffe0b0, 0, 900, 2);
  flashLight.name = 'fxFlash';
  const fireLights = [new THREE.PointLight(0xff8a3a, 0, 45, 2), new THREE.PointLight(0xff8a3a, 0, 45, 2)];
  scene.add(flashLight, ...fireLights);
  let flashE = 0, flashDecay = 3;

  // ---- debris (instanced, main scene) -----------------------------------------------------------------------
  const DEB = qlevel === 'low' ? 250 : qlevel === 'medium' ? 450 : 700;
  const debMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, flatShading: true });
  const debTypes = {
    stone: new THREE.InstancedMesh(rockGeometry(0, 1.3), debMat, DEB),
    brick: new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.45, 0.5), debMat, Math.round(DEB * 0.6)),
    wood: new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.22, 1.6), debMat, Math.round(DEB * 0.4)),
  };
  const debris = {};
  for (const [k, m] of Object.entries(debTypes)) {
    m.name = 'fxDebris_' + k;
    m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, _c.set(1, 1, 1));
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
    const n = m.instanceMatrix.count;
    debris[k] = {
      mesh: m, n, count: 0,
      p: new Float32Array(n * 3), v: new Float32Array(n * 3), q: new Float32Array(n * 4), w: new Float32Array(n * 3),
      s: new Float32Array(n), age: new Float32Array(n), life: new Float32Array(n), rest: new Float32Array(n),
      col: new Float32Array(n * 3), trail: new Float32Array(n), gy: new Float32Array(n), colDirty: true,
    };
  }
  // boulders (projectiles)
  const BOUL = 48;
  const boulMat = new THREE.MeshStandardMaterial({ color: 0x9c907c, roughness: 0.95, flatShading: true });
  const boulMesh = new THREE.InstancedMesh(rockGeometry(1, 7.7, 1, 0.85, 0.95), boulMat, BOUL);
  boulMesh.name = 'fxBoulders'; boulMesh.count = 0; boulMesh.frustumCulled = false; boulMesh.castShadow = true; boulMesh.receiveShadow = true;
  boulMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(boulMesh);
  const projectiles = [];

  // ---- emitters / timeline ------------------------------------------------------------------------------------
  const emitters = new Set();
  const timeline = []; // {t, fn}
  let now = 0;
  const later = (dt, fn) => timeline.push({ t: now + dt, fn });

  // ---- helpers ------------------------------------------------------------------------------------------------
  const sunDir = ctx.sky?.sunDir || new THREE.Vector3(...ctx.LAYOUT.sunDir).normalize();
  const wind = ctx.sky?.wind || new THREE.Vector3(3, 0, -1.2);
  const gh = (x, z) => { const h = ctx.world?.groundHeight?.(x, z); return Number.isFinite(h) ? h : 0; };
  const camPos = new THREE.Vector3();

  // spawn one particle into pool P with a spec
  function emit(P, x, y, z, vx, vy, vz, o) {
    if (!Number.isFinite(x + y + z + vx + vy + vz)) return 0;
    const i = P.alloc();
    P.px[i] = x; P.py[i] = y; P.pz[i] = z; P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz;
    P.age[i] = 0; P.life[i] = o.life; P.s0[i] = o.s0; P.s1[i] = o.s1 ?? o.s0; P.grow[i] = o.grow ?? 2;
    P.rot[i] = Math.random() * 6.283; P.rotV[i] = o.rotV ?? rand(-0.4, 0.4);
    P.drag[i] = o.drag ?? 0.5; P.buoy[i] = o.buoy ?? 0; P.alpha[i] = o.alpha ?? 1;
    P.fin[i] = o.fin ?? 0.08; P.fout[i] = o.fout ?? 0.45;
    P.cr[i] = o.r; P.cg[i] = o.g; P.cb[i] = o.b;
    P.cell[i] = o.cell ?? 0; P.shade[i] = o.shade ?? 1; P.emis[i] = o.emis ?? 0; P.stretch[i] = o.stretch ?? 0;
    P.turb[i] = o.turb ?? 0; P.wind[i] = o.wind ?? 0; P.kind[i] = o.kind ?? 0; P.seed[i] = Math.random() * 100; P.gnd[i] = o.gnd ?? 0;
    P.gy[i] = o.gy ?? ((o.gnd || o.kind === 1) ? gh(x, z) : 0);
    return i;
  }
  // self-shadow estimate: particles displaced toward the sun are lit, away are in the plume's own shadow
  const selfShade = (ox, oy, oz, r) => THREE.MathUtils.clamp(0.62 + 0.5 * (ox * sunDir.x + oy * sunDir.y * 0.6 + oz * sunDir.z) / Math.max(r, 1e-3) + 0.12 * oy / Math.max(r, 1e-3), 0.15, 1);
  const puffCell = () => CELL.PUFF + ((Math.random() * 6) | 0);
  const wispCell = () => CELL.WISP + ((Math.random() * 3) | 0);
  const chunkCell = () => CELL.CHUNK + ((Math.random() * 2) | 0);

  function camDist(p) { return camPos.distanceTo(p); }

  // ---- public effects -----------------------------------------------------------------------------------------
  function dust(pos, size = 10, opts = {}) {
    if (!pos || !Number.isFinite(pos.x + pos.y + pos.z)) return;
    const big = size >= 35;
    const n = Math.round(THREE.MathUtils.clamp((big ? 60 : 5) + size * (big ? 2.2 : 1.4), 5, big ? 260 : 90) * QK * (opts.density ?? 1));
    const g0 = opts.ground ?? gh(pos.x, pos.z);
    const baseY = Math.max(pos.y, g0);
    const oc = toRGB(opts.color);
    const cr = oc?.r ?? 0.6, cg = oc?.g ?? 0.53, cb = oc?.b ?? 0.44;
    const dir = opts.dir ? _dir.copy(opts.dir).setY(0).normalize() : null;
    const life = opts.life ?? opts.duration ?? (big ? rand(14, 20) : 4 + Math.pow(size, 0.6) * 1.2);
    const sp = Math.sqrt(size) * (opts.speed ?? 1);
    for (let k = 0; k < n; k++) {
      let ox, oz, vx, vz, vy, oy;
      if (big && dir) {
        // rolling wall of dust along `dir`, wide front, pushed hard then dragged
        const lat = (Math.random() - 0.5) * size * 1.6, fw = Math.random() * size * 0.35;
        ox = dir.x * fw - dir.z * lat; oz = dir.z * fw + dir.x * lat;
        oy = Math.pow(Math.random(), 1.8) * size * 0.7;
        const s = rand(10, 34) * (opts.speed ?? 1);
        vx = dir.x * s + (Math.random() - 0.5) * 6 - dir.z * lat * 0.05; vz = dir.z * s + (Math.random() - 0.5) * 6 + dir.x * lat * 0.05;
        vy = rand(-1, 3) * (1 - oy / (size * 0.7));
      } else {
        const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * size * 0.35;
        ox = Math.cos(a) * r; oz = Math.sin(a) * r; oy = Math.random() * size * 0.2;
        const s = rand(0.6, 1.6) * sp * (big ? 3.2 : 1.1);
        vx = Math.cos(a) * s; vz = Math.sin(a) * s; vy = rand(0.2, 1.4) * sp * 0.35;
        if (dir) { vx += dir.x * sp * 2; vz += dir.z * sp * 2; }
      }
      const s0 = size * rand(0.18, 0.35), s1 = size * rand(0.7, 1.15) * (big ? 0.75 : 1);
      emit(smoke, pos.x + ox, baseY + oy + s0 * 0.25, pos.z + oz, vx, vy, vz, {
        life: life * rand(0.7, 1.15), s0, s1, grow: 2.5, drag: big ? 0.22 : 0.9, buoy: big ? 0.25 : 0.12,
        alpha: rand(0.45, 0.7) * (opts.alpha ?? 1), fin: 0.04, fout: 0.35,
        r: cr * rand(0.85, 1.1), g: cg * rand(0.85, 1.08), b: cb * rand(0.85, 1.05),
        cell: Math.random() < 0.3 ? chunkCell() : puffCell(), shade: selfShade(ox, oy - size * 0.2, oz, size * 0.6),
        turb: 0.6, wind: 0.5, gnd: 1, gy: g0,
      });
    }
    // dense core puffs low on the ground (the base of the cloud reads as solid)
    if (size > 6) {
      const nc = Math.round(Math.min(size * 0.35, 30) * QK);
      for (let k = 0; k < nc; k++) {
        const a = Math.random() * 6.283, r = Math.random() * size * 0.25;
        emit(smoke, pos.x + Math.cos(a) * r, baseY + size * 0.1, pos.z + Math.sin(a) * r, Math.cos(a) * sp * 0.8, rand(0.5, 2) * sp * 0.3, Math.sin(a) * sp * 0.8, {
          life: life * 0.8, s0: size * 0.3, s1: size * 0.8, grow: 3, drag: 0.8, buoy: 0.2, alpha: 0.75, fin: 0.02, fout: 0.4,
          r: cr * 0.9, g: cg * 0.88, b: cb * 0.86, cell: puffCell(), shade: 0.55, turb: 0.4, wind: 0.4, gnd: 1, gy: g0,
        });
      }
    }
  }

  const _scol = {};
  function steamPuffs(x, y, z, size, intensity, o = {}) {
    // puffs build a cloud of roughly `size`; huge sizes get proportionally smaller puffs (billows, not a fog wall)
    const big = size > 20 ? Math.sqrt(20 / size) : 1;
    const s0 = size * rand(0.16, 0.3) * big, s1 = size * rand(0.6, 1.0) * big * (o.grow ?? 1);
    const a = Math.random() * 6.283, r = Math.random() * size * 0.35;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const rise = (o.rise ?? 1) * Math.sqrt(size) * rand(1.2, 2.4);
    const dx = o.dir ? o.dir.x * rise * 1.5 : 0, dy = o.dir ? o.dir.y * rise * 1.5 : 0, dz = o.dir ? o.dir.z * rise * 1.5 : 0;
    const sc = toRGB(o.color, _scol);
    const w = sc?.r ?? 0.93;
    emit(smoke, x + ox, y, z + oz, ox * 0.4 + dx, rise + dy, oz * 0.4 + dz, {
      life: rand(2.2, 3.8) * Math.pow(size / 4, 0.35) * (o.life ?? 1), s0, s1, grow: 2.2, drag: 0.6, buoy: 1.2 * Math.sqrt(size),
      alpha: rand(0.28, 0.46) * intensity * (o.alpha ?? 1), fin: 0.1, fout: 0.3,
      r: w, g: sc?.g ?? 0.94, b: sc?.b ?? 0.96, cell: Math.random() < 0.45 ? wispCell() : puffCell(),
      shade: selfShade(ox, 0, oz, size * 0.5), emis: o.emis ?? 0.14, turb: 1.0, wind: 0.8,
    });
  }

  function steam(pos, size = 4, duration = Infinity, opts = {}) {
    const h = {
      position: (pos?.clone?.() ?? new THREE.Vector3()), size, intensity: opts.intensity ?? 1, alive: true, t: 0, dur: duration, acc: 0, opts,
      stop() { this.alive = false; }, setIntensity(k) { this.intensity = Math.max(0, k); },
      _update(dt) {
        this.t += dt;
        if (this.t > this.dur) this.alive = false;
        if (!this.alive) return false;
        const fade = Number.isFinite(this.dur) ? THREE.MathUtils.clamp((this.dur - this.t) / Math.min(4, this.dur * 0.4), 0, 1) : 1;
        const k = this.intensity * fade;
        if (k <= 0.01) return true;
        this.acc += dt * 20 * Math.pow(this.size, 0.45) * Math.min(k, 1.5) * QK * (this.opts.rate ?? 1);
        const d = camDist(this.position);
        if (d > 1800) this.acc = Math.min(this.acc, 1);
        while (this.acc >= 1) { this.acc -= 1; steamPuffs(this.position.x, this.position.y, this.position.z, this.size, Math.min(1, 0.4 + k * 0.6), this.opts); }
        return true;
      },
    };
    if (opts.burst && pos) { // immediate puff burst (hits, vents opening)
      const nb = Math.round((6 + size * 1.5) * QK);
      for (let k = 0; k < nb; k++) steamPuffs(pos.x, pos.y, pos.z, size, 1, { ...opts, rise: (opts.rise ?? 1) * 1.8 });
    }
    emitters.add(h);
    return h;
  }

  function smokeColumn(pos, size, o) {
    return {
      position: pos.clone(), size, intensity: 1, alive: true, acc: 0, accF: 0, accE: 0, fire: !!o.fire, t: 0, seed: Math.random() * 100,
      light: null,
      stop() { this.alive = false; }, setIntensity(k) { this.intensity = Math.max(0, k); },
      _update(dt) {
        if (!this.alive) return false;
        this.t += dt;
        const k = this.intensity; const S = this.size; const p = this.position;
        const d = camDist(p);
        const lod = d > 900 ? 0.35 : d > 400 ? 0.7 : 1;
        // dark smoke column (tall, leaning with the wind), visible across town
        this.acc += dt * (1.4 + S * 0.15) * k * QK * lod * (o.rate ?? 1);
        while (this.acc >= 1) {
          this.acc -= 1;
          const a = Math.random() * 6.283, r = Math.random() * S * 0.3;
          const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
          const dark = o.fire ? rand(0.06, 0.12) : rand(0.08, 0.16);
          emit(smoke, p.x + ox, p.y + S * 0.4, p.z + oz, ox * 0.2, rand(3, 5.5) * Math.sqrt(S / 4), oz * 0.2, {
            life: rand(16, 24), s0: S * rand(0.45, 0.7), s1: Math.min(S * rand(2.6, 3.8), 34), grow: 1.6, drag: 0.35, buoy: 0.6,
            alpha: rand(0.26, 0.4), fin: 0.05, fout: 0.3,
            r: dark * 1.1, g: dark, b: dark * 0.92, cell: puffCell(), shade: selfShade(ox, 0, oz, S * 0.4), emis: 0, turb: 0.8, wind: 1.6,
          });
        }
        if (this.fire) {
          this.accF += dt * (14 + S * 3) * k * QK * lod;
          while (this.accF >= 1) {
            this.accF -= 1;
            const a = Math.random() * 6.283, r = Math.pow(Math.random(), 0.7) * S * 0.45;
            const fi = emit(glow, p.x + Math.cos(a) * r, p.y + rand(-0.2, 0.3) * S * 0.3, p.z + Math.sin(a) * r, 0, rand(2, 4.5) * Math.sqrt(S / 3), 0, {
              life: rand(0.5, 1.1), s0: S * rand(0.35, 0.6), s1: S * rand(0.6, 1.0), grow: 1.5, drag: 0.8, buoy: 2.5,
              alpha: rand(0.7, 1), fin: 0.1, fout: 0.3, r: 1, g: 1, b: 1, cell: CELL.FLAME + ((Math.random() * 3) | 0),
              rotV: 0, kind: 2, wind: 0.5,
            });
            glow.rot[fi] = rand(-0.25, 0.25);
          }
          this.accE += dt * 4 * k * lod;
          while (this.accE >= 1) {
            this.accE -= 1;
            emit(glow, p.x + rand(-1, 1) * S * 0.3, p.y + S * 0.3, p.z + rand(-1, 1) * S * 0.3, rand(-1, 1), rand(4, 9), rand(-1, 1), {
              life: rand(1.5, 3), s0: 0.12, s1: 0.06, drag: 0.4, buoy: 0.5, alpha: 1, fin: 0.02, fout: 0.6,
              r: 6, g: 2.4, b: 0.6, cell: CELL.GLOW, stretch: 0.04, turb: 2.5, wind: 1,
            });
          }
          // smoke bottoms lit by the flames
        }
        return true;
      },
    };
  }
  function fire(pos, size = 4) { const h = smokeColumn(pos || new THREE.Vector3(), size, { fire: true }); emitters.add(h); fires.add(h); return h; }
  function smokeFn(pos, size = 6) { const h = smokeColumn(pos || new THREE.Vector3(), size, { fire: false }); emitters.add(h); return h; }
  const fires = new Set();

  function debrisFn(pos, count = 12, speed = 10, opts = {}) {
    if (!pos || !Number.isFinite(pos.x + pos.y + pos.z)) return;
    const type = opts.type || 'mixed';
    const n = Math.round(count * (qlevel === 'low' ? 0.5 : 1));
    const baseSize = opts.size ?? 0.6;
    const dc = toRGB(opts.color);
    const debGround = gh(pos.x, pos.z);
    for (let k = 0; k < n; k++) {
      let t = type;
      if (type === 'mixed') t = Math.random() < 0.55 ? 'stone' : Math.random() < 0.6 ? 'brick' : 'wood';
      if (type === 'house') t = Math.random() < 0.55 ? 'brick' : Math.random() < 0.6 ? 'wood' : 'stone';
      if (type === 'wall') t = 'stone';
      const D = debris[t] || debris.stone;
      let i = D.count < D.n ? D.count++ : (Math.random() * D.n) | 0;
      const a = Math.random() * 6.283, el = rand(0.25, 1.2);
      let vx = Math.cos(a) * Math.cos(el), vy = Math.sin(el), vz = Math.sin(a) * Math.cos(el);
      if (opts.dir) { vx = vx * 0.6 + opts.dir.x; vy = vy * 0.6 + opts.dir.y; vz = vz * 0.6 + opts.dir.z; const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l; }
      const s = speed * rand(0.4, 1.15);
      const sz = baseSize * Math.pow(Math.random(), 1.6) * 2.2 + baseSize * 0.25;
      const spread = opts.spread ?? baseSize * 2;
      D.p[i * 3] = pos.x + (Math.random() - 0.5) * spread; D.p[i * 3 + 1] = pos.y + Math.random() * spread * 0.5; D.p[i * 3 + 2] = pos.z + (Math.random() - 0.5) * spread;
      D.v[i * 3] = vx * s; D.v[i * 3 + 1] = vy * s; D.v[i * 3 + 2] = vz * s;
      _q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      D.q[i * 4] = _q.x; D.q[i * 4 + 1] = _q.y; D.q[i * 4 + 2] = _q.z; D.q[i * 4 + 3] = _q.w;
      D.w[i * 3] = rand(-6, 6); D.w[i * 3 + 1] = rand(-6, 6); D.w[i * 3 + 2] = rand(-6, 6);
      D.s[i] = sz; D.age[i] = 0; D.life[i] = rand(6, 11); D.rest[i] = 0; D.trail[i] = 0; D.gy[i] = debGround; D.colDirty = true;
      let cr, cg, cb;
      if (dc) { cr = dc.r; cg = dc.g; cb = dc.b; }
      else if (t === 'stone') { const v = rand(0.5, 0.72); cr = v * 1.02; cg = v * 0.97; cb = v * 0.88; }
      else if (t === 'brick') { if (Math.random() < 0.5) { cr = 0.55; cg = 0.25; cb = 0.16; } else { cr = 0.72; cg = 0.66; cb = 0.56; } }
      else { cr = 0.36; cg = 0.25; cb = 0.15; }
      const vv = rand(0.8, 1.1);
      D.col[i * 3] = cr * vv; D.col[i * 3 + 1] = cg * vv; D.col[i * 3 + 2] = cb * vv;
    }
  }

  function blood(pos, dir) {
    if (!pos || !Number.isFinite(pos.x + pos.y + pos.z)) return;
    const d = _v.copy(dir || _up).normalize();
    const n = Math.round(30 * QK);
    const bg = gh(pos.x, pos.z);
    for (let k = 0; k < n; k++) {
      _v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.9).add(d).normalize();
      const s = rand(5, 16);
      emit(smoke, pos.x, pos.y, pos.z, _v2.x * s, _v2.y * s + 2, _v2.z * s, {
        life: rand(0.4, 0.85), s0: rand(0.1, 0.26), s1: rand(0.06, 0.14), grow: 1, drag: 0.6, buoy: -12, alpha: 1, fin: 0, fout: 0.8,
        r: rand(0.55, 0.8), g: 0.02, b: 0.025, cell: CELL.DROP, stretch: 0.05, emis: 0.9, kind: 1, rotV: 0, gy: bg,
      });
    }
    for (let k = 0; k < 7; k++) {
      _v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.7).add(d).normalize();
      const s = rand(2, 6);
      emit(smoke, pos.x, pos.y, pos.z, _v2.x * s, _v2.y * s, _v2.z * s, {
        life: rand(0.35, 0.7), s0: rand(0.4, 0.8), s1: rand(1.2, 2.2), grow: 2, drag: 3, buoy: -2, alpha: 0.6, fin: 0, fout: 0.3,
        r: 0.7, g: 0.03, b: 0.03, cell: puffCell(), emis: 0.6,
      });
    }
    // immediate steam hiss off the wound
    for (let k = 0; k < 5; k++) steamPuffs(pos.x, pos.y, pos.z, 1.2, 0.8, { life: 0.8 });
  }

  function gasPuff(pos, dir) {
    if (!pos || !Number.isFinite(pos.x + pos.y + pos.z)) return;
    const d = _v.copy(dir || _up).normalize();
    for (let k = 0; k < 3; k++) {
      const s = rand(12, 22);
      _v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.35).add(d).normalize();
      emit(smoke, pos.x + d.x * 0.3, pos.y + d.y * 0.3, pos.z + d.z * 0.3, _v2.x * s, _v2.y * s, _v2.z * s, {
        life: rand(0.6, 1.1), s0: rand(0.25, 0.45), s1: rand(1.6, 2.8), grow: 3, drag: 4.5, buoy: 0.5, alpha: rand(0.28, 0.42),
        fin: 0.02, fout: 0.3, r: 0.93, g: 0.95, b: 0.97, cell: wispCell(), emis: 0.08, turb: 1.5,
      });
    }
  }

  function sparks(pos, dir, opts = {}) {
    if (!pos || !Number.isFinite(pos.x + pos.y + pos.z)) return;
    const d = _v.copy(dir || _up).normalize();
    const n = Math.round((opts.count ?? 18) * QK);
    for (let k = 0; k < n; k++) {
      _v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.3).add(d).normalize();
      const s = rand(7, 22);
      emit(glow, pos.x, pos.y, pos.z, _v2.x * s, _v2.y * s, _v2.z * s, {
        life: rand(0.2, 0.55), s0: rand(0.04, 0.08), s1: 0.02, grow: 1, drag: 1.2, buoy: -9.8, alpha: 1, fin: 0, fout: 0.5,
        r: 9, g: 6, b: 3, cell: CELL.GLOW, stretch: 0.035, rotV: 0,
      });
    }
    emit(glow, pos.x, pos.y, pos.z, 0, 0, 0, { life: 0.08, s0: 0.6, s1: 0.9, alpha: 1, fin: 0, fout: 0.2, r: 6, g: 5, b: 3.5, cell: CELL.GLOW });
  }

  // energy = luminous intensity (cd); illuminance at d metres = energy / d^2 (sun is ~4)
  function flashAt(pos, energy, decay = 3, color, range = 900) {
    if (energy < flashE * 0.6 && flashLight.intensity > 0) return;
    flashLight.position.copy(pos);
    flashLight.color.set(color ?? 0xffe0b0);
    flashLight.distance = range;
    flashE = energy; flashDecay = decay;
  }
  let flashBudget = 1; // repeated flashes (collapsing buildings) cannot stack into a white-out
  function screenFlash(pos, k) {
    // stronger when visible and close
    const d = camDist(pos);
    _v3.copy(pos).project(ctx.camera);
    const on = _v3.z < 1 && Math.abs(_v3.x) < 1.3 && Math.abs(_v3.y) < 1.3 ? 1 : 0.35;
    const f = Math.min(k * on * THREE.MathUtils.clamp(1.4 - d / 2500, 0.25, 1), flashBudget);
    if (f <= 0.01) return;
    flashBudget = Math.max(0, flashBudget - f * 0.8);
    ctx.post?.flash?.(f);
  }

  function lightning(from, to, opts = {}) {
    if (!from || !to || !Number.isFinite(from.x + from.y + from.z + to.x + to.y + to.z)) return;
    // find a free bolt slot
    let slot = -1;
    for (let s = 0; s < MAXBOLT; s++) if (!bolts.some((b) => b.slot === s)) { slot = s; break; }
    if (slot < 0) { const old = bolts.shift(); slot = old.slot; }
    const len = from.distanceTo(to);
    const segs = [];
    const w0 = opts.width ?? THREE.MathUtils.clamp(len * 0.004, 0.25, 1.6);
    const path = (a, b, disp, depth, width, branch) => {
      // midpoint displacement
      let pts = [a.clone(), b.clone()];
      let dd = disp;
      for (let it = 0; it < depth; it++) {
        const np = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          const m = pts[i].clone().lerp(pts[i + 1], 0.5);
          _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(dd * 2);
          m.add(_v);
          np.push(m, pts[i + 1]);
        }
        pts = np; dd *= 0.52;
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const f = 1 - (i / pts.length) * (branch ? 0.8 : 0.3);
        segs.push([pts[i], pts[i + 1], width * f]);
        if (!branch && Math.random() < 0.06 && segs.length < 700) {
          const bl = len * rand(0.08, 0.25);
          _v2.copy(pts[i + 1]).sub(pts[i]).normalize();
          _v3.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(0.9).add(_v2).normalize();
          const e = pts[i].clone().addScaledVector(_v3, bl);
          path(pts[i], e, bl * 0.18, 4, width * 0.45, true);
        }
      }
    };
    path(from, to, len * 0.09, 7, w0, false);
    const b = { slot, birth: now, life: opts.life ?? rand(0.25, 0.45), segs };
    boltU[slot].set(now, b.life, opts.intensity ?? 1, Math.random() * 100);
    bolts.push(b);
    boltsDirty = true;
    _v.copy(from).lerp(to, 0.6);
    flashAt(_v, 3e5 * (opts.intensity ?? 1) * Math.min(1, len / 300), 8, 0xfff0c8, 1500);
    screenFlash(_v, (opts.sky ? 0.1 : 0.22) * (opts.intensity ?? 1));
  }
  function rebuildBolts() {
    let n = 0;
    for (const b of bolts) {
      for (const [a, c, w] of b.segs) {
        if (n >= MAXSEG) break;
        for (let v = 0; v < 4; v++) {
          const o = (n * 4 + v);
          bA.set([a.x, a.y, a.z], o * 3); bB.set([c.x, c.y, c.z], o * 3);
          bI[o * 4] = v === 0 || v === 3 ? -1 : 1; bI[o * 4 + 1] = v < 2 ? 0 : 1; bI[o * 4 + 2] = w; bI[o * 4 + 3] = b.slot;
        }
        n++;
      }
    }
    for (const k of ['aA', 'aB', 'aInfo']) { const at = boltGeo.attributes[k]; at.clearUpdateRanges(); at.addUpdateRange(0, n * 4 * at.itemSize); at.needsUpdate = true; }
    boltGeo.setDrawRange(0, n * 6);
    boltsDirty = false;
  }

  function ring(pos, maxR, speed, color, alpha = 1) {
    const r = rings.find((x) => !x.active) || rings[0];
    r.active = true; r.age = 0; r.maxR = maxR; r.speed = speed; r.alpha = alpha;
    r.mesh.position.set(pos.x, gh(pos.x, pos.z) + 0.6, pos.z);
    r.mesh.visible = true;
    r.mesh.material.uniforms.uRingCol.value.set(color?.[0] ?? 1.2, color?.[1] ?? 0.95, color?.[2] ?? 0.7);
  }

  function explosion(pos, size = 60) {
    if (!pos || !Number.isFinite(pos.x + pos.y + pos.z)) return;
    const S = size;
    const g0 = gh(pos.x, pos.z);
    const big = THREE.MathUtils.clamp(S / 60, 0.05, 1.2);
    screenFlash(pos, 1.3 * Math.pow(big, 1.8));
    flashAt(pos, 40 * S * S * big, 1.6, 0xffd9a0, S * 18);
    ctx.shake?.(1.3 * Math.sqrt(big), { at: pos, radius: 300 + 1700 * big });
    // blinding core + fireball
    emit(glow, pos.x, pos.y + S * 0.3, pos.z, 0, 0, 0, { life: 0.45, s0: S * 0.6, s1: S * 1.3, alpha: 1, fin: 0, fout: 0.1, r: 40, g: 34, b: 24, cell: CELL.GLOW });
    const nf = Math.round(55 * QK);
    for (let k = 0; k < nf; k++) {
      _v.set(Math.random() - 0.5, Math.random() * 0.8 - 0.1, Math.random() - 0.5).normalize();
      const s = rand(8, 26) * S / 60;
      const r0 = Math.random() * S * 0.25;
      emit(glow, pos.x + _v.x * r0, pos.y + S * 0.25 + _v.y * r0, pos.z + _v.z * r0, _v.x * s, _v.y * s + 4, _v.z * s, {
        life: rand(1.2, 2.8), s0: S * rand(0.2, 0.35), s1: S * rand(0.5, 0.8), grow: 2.5, drag: 1.2, buoy: 3, alpha: 1, fin: 0.02, fout: 0.25,
        r: 1, g: 1, b: 1, cell: puffCell(), kind: 3, turb: 1,
      });
    }
    // mushroom: steam/smoke stem + rolling cap
    const ns = Math.round(50 * QK);
    for (let k = 0; k < ns; k++) {
      const h = Math.random();
      const a = Math.random() * 6.283, r = S * (0.15 + h * 0.1) * Math.random();
      const col = Math.random() < 0.7 ? rand(0.8, 0.95) : rand(0.35, 0.5);
      emit(smoke, pos.x + Math.cos(a) * r, g0 + S * 0.1 + h * S * 0.4, pos.z + Math.sin(a) * r, Math.cos(a) * 2, rand(14, 30) * S / 60 * (0.6 + h), Math.sin(a) * 2, {
        life: rand(10, 16), s0: S * rand(0.2, 0.3), s1: S * rand(0.6, 0.9), grow: 2, drag: 0.35, buoy: 0.4, alpha: rand(0.55, 0.8), fin: 0.03, fout: 0.45,
        r: col, g: col * 0.97, b: col * 0.95, cell: puffCell(), shade: selfShade(Math.cos(a) * r, h * S * 0.4 - S * 0.2, Math.sin(a) * r, S * 0.4), emis: 0.25 * (1 - h), turb: 0.8, wind: 0.6,
      });
    }
    const nc = Math.round(40 * QK);
    for (let k = 0; k < nc; k++) {
      const a = Math.random() * 6.283;
      const col = rand(0.78, 0.95);
      later(rand(0.3, 1.2), () => emit(smoke, pos.x + Math.cos(a) * S * 0.3, g0 + S * rand(0.8, 1.1), pos.z + Math.sin(a) * S * 0.3,
        Math.cos(a) * rand(8, 16) * S / 60, rand(4, 10) * S / 60, Math.sin(a) * rand(8, 16) * S / 60, {
          life: rand(10, 16), s0: S * 0.3, s1: S * rand(0.8, 1.2), grow: 2, drag: 0.4, buoy: -0.1, alpha: rand(0.55, 0.75), fin: 0.05, fout: 0.45,
          r: col, g: col * 0.97, b: col * 0.94, cell: puffCell(), shade: selfShade(Math.cos(a), 0.6, Math.sin(a), 1), turb: 0.6, wind: 0.7,
        }));
    }
    // ground shockwave: ring + fast dust skirt
    ring(pos, S * 5, S * 3.2, [1.4, 1.05, 0.7], 1);
    later(0.15, () => ring(pos, S * 7, S * 2.0, [0.7, 0.6, 0.48], 0.6));
    const nd = Math.round(56 * QK);
    for (let k = 0; k < nd; k++) {
      const a = (k / nd) * 6.283 + Math.random() * 0.1;
      const s = rand(40, 70) * S / 60;
      emit(smoke, pos.x + Math.cos(a) * S * 0.3, g0 + rand(1, 6), pos.z + Math.sin(a) * S * 0.3, Math.cos(a) * s, rand(0.5, 3), Math.sin(a) * s, {
        life: rand(6, 10), s0: S * 0.15, s1: S * rand(0.45, 0.7), grow: 2, drag: 0.9, buoy: 0.3, alpha: rand(0.45, 0.65), fin: 0.02, fout: 0.4,
        r: 0.62, g: 0.55, b: 0.46, cell: puffCell(), shade: 0.8, turb: 0.4, wind: 0.4, gnd: 1, gy: g0,
      });
    }
    // lightning cage (only for the transformation-scale blast)
    for (let k = 0; k < (S >= 40 ? 7 : 0); k++) {
      later(k * 0.12 + Math.random() * 0.1, () => {
        _v.set(pos.x + rand(-1, 1) * S * 0.8, pos.y + S * rand(1.2, 2.4), pos.z + rand(-1, 1) * S * 0.8);
        _v2.set(pos.x + rand(-1, 1) * S * 0.2, g0 + rand(0, S * 0.6), pos.z + rand(-1, 1) * S * 0.2);
        lightning(_v.clone(), _v2.clone(), { intensity: 1 });
      });
    }
    debrisFn(_v.set(pos.x, g0 + 2, pos.z), 40, 35, { type: 'stone', size: 1.2, spread: S * 0.3 });
  }

  function projectile(o = {}) {
    if (!o.pos || !o.vel || !Number.isFinite(o.pos.x + o.pos.y + o.pos.z + o.vel.x + o.vel.y + o.vel.z)) return null;
    if (projectiles.length >= BOUL) projectiles.shift();
    const size = o.size ?? 4;
    const p = {
      pos: o.pos.clone(), vel: o.vel.clone(), size, onImpact: o.onImpact, alive: true, age: 0, trail: 0,
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)),
      w: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.8, 2.5)),
    };
    projectiles.push(p);
    return p;
  }
  function impact(p, pt) {
    p.alive = false;
    const point = pt.clone();
    const S = p.size;
    dust(point, S * 4.5, { speed: 1.3 });
    debrisFn(_v.copy(point).setY(point.y + S * 0.3), Math.round(10 + S * 3), 9 + S * 1.5, { type: 'wall', size: S * 0.16, spread: S * 0.8 });
    ctx.shake?.(0.5 + S * 0.08, { at: point, radius: 150 + S * 25 });
    try { p.onImpact?.(point.clone()); } catch (e) { console.error('[fx] onImpact', e); }
  }

  // ---- giant-scale helpers ------------------------------------------------------------------------------------
  /** directional high-pressure steam vent (giant body vents, hurt spray). size in m (20-40 for the giant) */
  function steamJet(pos, dir, size = 20, duration = 2, opts = {}) {
    return steam(pos, size, duration, { rise: 1.2, rate: 1.4, ...opts, dir: (dir || _up).clone().normalize().multiplyScalar(opts.force ?? 2.2) });
  }
  /** enormous steam burst (giant hurt / killed): expanding billows + rising column */
  function eruption(pos, size = 30, opts = {}) {
    if (!pos || !Number.isFinite(pos.x + pos.y + pos.z)) return null;
    const n = Math.round((opts.count ?? 90) * QK);
    for (let k = 0; k < n; k++) {
      _v.set(Math.random() - 0.5, Math.random() * 0.9 - 0.2, Math.random() - 0.5).normalize();
      const s = rand(6, 22) * Math.sqrt(size / 30);
      const w = rand(0.86, 0.97);
      emit(smoke, pos.x + _v.x * size * 0.2, pos.y + _v.y * size * 0.2, pos.z + _v.z * size * 0.2, _v.x * s, _v.y * s + 3, _v.z * s, {
        life: rand(5, 9), s0: size * rand(0.15, 0.25), s1: size * rand(0.55, 0.9), grow: 2.2, drag: 0.7, buoy: 1.8, alpha: rand(0.45, 0.7),
        fin: 0.02, fout: 0.4, r: w, g: w, b: w * 1.02, cell: Math.random() < 0.3 ? wispCell() : puffCell(),
        shade: selfShade(_v.x, _v.y, _v.z, 1), emis: 0.05, turb: 1.2, wind: 0.8,
      });
    }
    const h = steam(pos, size * 0.8, opts.duration ?? 6, { rise: 1.6, rate: 1.2 });
    return h;
  }
  /** roar: screen-space shockwave distortion + ground dust ring + short flash */
  function roar(pos, size = 60, opts = {}) {
    if (!pos || !Number.isFinite(pos.x + pos.y + pos.z)) return;
    const g0 = gh(pos.x, pos.z);
    ctx.post?.shockwave?.(pos, opts.strength ?? 1);
    ctx.shake?.(0.7, { at: pos, radius: 900, duration: 1.2 });
    screenFlash(pos, 0.12);
    ring(_v2.set(pos.x, g0, pos.z), size * 5, size * 3, [0.55, 0.47, 0.38], 0.55);
    const nd = Math.round(46 * QK);
    for (let k = 0; k < nd; k++) {
      const a = (k / nd) * 6.283 + Math.random() * 0.12;
      const s = rand(30, 55) * size / 60, r0 = size * 0.4;
      emit(smoke, pos.x + Math.cos(a) * r0, g0 + rand(0.5, 4), pos.z + Math.sin(a) * r0, Math.cos(a) * s, rand(0.3, 2), Math.sin(a) * s, {
        life: rand(4, 7), s0: size * 0.1, s1: size * rand(0.35, 0.55), grow: 2, drag: 1.1, buoy: 0.3, alpha: rand(0.35, 0.55), fin: 0.02, fout: 0.35,
        r: 0.6, g: 0.53, b: 0.45, cell: puffCell(), shade: 0.8, turb: 0.4, wind: 0.4, gnd: 1, gy: g0,
      });
    }
    // hot breath of steam from the mouth
    if (opts.dir) steamJet(pos, opts.dir, size * 0.25, 1.2, { force: 4, alpha: 0.8 });
    E.boost = Math.max(E.boost, 0.6);
  }
  /** giant footstep / hand slam: huge dust billow + dust ring + rubble */
  function stomp(pos, size = 40, opts = {}) {
    if (!pos || !Number.isFinite(pos.x + pos.y + pos.z)) return;
    const g0 = gh(pos.x, pos.z);
    _v3.set(pos.x, g0, pos.z);
    dust(_v3, size, { speed: 1.4, ...opts });
    ring(_v3, size * 2.2, size * 2.5, [0.5, 0.44, 0.36], 0.45);
    debrisFn(_v2.set(pos.x, g0 + 1, pos.z), Math.round(size * 0.5), 10 + size * 0.25, { type: opts.type || 'mixed', size: 0.4 + size * 0.012, spread: size * 0.4 });
    ctx.shake?.(0.9, { at: pos, radius: size * 12 });
  }

  // ---- update -----------------------------------------------------------------------------------------------
  const windNow = new THREE.Vector3();
  let frameNo = 0;
  function stepPool(P, dt) {
    if (!P.count) return;
    const wx = wind.x, wz = wind.z;
    const px = P.px, py = P.py, pz = P.pz, vxA = P.vx, vyA = P.vy, vzA = P.vz, age = P.age, life = P.life;
    const drag = P.drag, buoy = P.buoy, windA = P.wind, turb = P.turb, seed = P.seed, rot = P.rot, rotV = P.rotV;
    const gnd = P.gnd, gyA = P.gy, kindA = P.kind;
    const f4 = frameNo & 3, f32 = frameNo & 31, dt4 = dt * 4;
    for (let i = 0; i < P.count; i++) {
      const ag = age[i] + dt;
      const kind = kindA[i];
      if (ag >= life[i]) {
        if (kind === 1 && Math.random() < 0.35) { // blood droplet evaporates into a steam wisp
          const x = px[i], y = py[i], z = pz[i];
          P.kill(i); i--;
          steamPuffs(x, y, z, 0.6, 0.55, { life: 0.6 });
          continue;
        }
        P.kill(i); i--; continue;
      }
      age[i] = ag;
      const dr = 1 / (1 + drag[i] * dt);
      let vx = vxA[i] * dr, vy = vyA[i] * dr, vz = vzA[i] * dr;
      vy += buoy[i] * dt;
      const w = windA[i];
      if (w > 0) {
        const y = py[i];
        const hk = (y > 0 ? (y < 166 ? 1 + y * 0.012 : 3) : 1) * w * dt * 0.6;
        vx += (wx - vx * 0.15) * hk; vz += (wz - vz * 0.15) * hk;
      }
      const tb = turb[i];
      if (tb > 0 && ((i + f4) & 3) === 0) { // turbulence is low frequency: staggered, 4x step every 4th frame
        const sd = seed[i], k = tb * dt4;
        vx += Math.sin(ag * 1.3 + sd) * k * 1.5; vz += Math.cos(ag * 1.1 + sd * 1.7) * k * 1.5; vy += Math.sin(ag * 0.9 + sd * 2.3) * k * 0.6;
      }
      vxA[i] = vx; vyA[i] = vy; vzA[i] = vz;
      const x = px[i] + vx * dt, z = pz[i] + vz * dt;
      let y = py[i] + vy * dt;
      px[i] = x; pz[i] = z;
      rot[i] += rotV[i] * dt;
      if (kind === 1) { if (y < gyA[i]) age[i] = life[i]; }
      else if (gnd[i] > 0) {
        if (((i + f32) & 31) === 0 && y < gyA[i] + 30) gyA[i] = gh(x, z); // refresh the cached ground rarely
        const g = gyA[i] + 0.3;
        if (y < g) { y = g; if (vy < 0) vyA[i] = 0; }
      }
      py[i] = y;
    }
  }

  function writePool(P, mesh, sorted) {
    const g = mesh.geometry;
    const aP = g.attributes.aPos, aC = g.attributes.aCol, aM = g.attributes.aMisc, aV = g.attributes.aVel;
    const pa = aP.array, ca = aC.array, ma = aM.array, va = aV.array;
    const n = P.count;
    for (let j = 0; j < n; j++) {
      const i = sorted ? order[j] : j;
      const t = P.age[i] / P.life[i];
      const gk = 1 - Math.pow(1 - t, P.grow[i]);
      const size = P.s0[i] + (P.s1[i] - P.s0[i]) * gk;
      const fin = P.fin[i], fo = P.fout[i];
      let a = P.alpha[i] * (fin > 0 ? Math.min(t / fin, 1) : 1) * (t > fo ? Math.max(0, 1 - (t - fo) / (1 - fo)) : 1);
      let r = P.cr[i], gg = P.cg[i], b = P.cb[i];
      const kind = P.kind[i];
      if (kind === 2) { // flame ramp: white-yellow core -> orange -> deep red
        const k = t;
        r = 9 * (1 - k) + 3 * k; gg = 6.5 * (1 - k) * (1 - k) + 0.5 * k; b = 2.5 * (1 - k) * (1 - k) * (1 - k) + 0.05;
      } else if (kind === 3) { // fireball: blinding yellow -> orange -> dull red, fading
        const k = Math.min(t * 1.4, 1);
        r = 30 * (1 - k) + 2.2 * k; gg = 20 * (1 - k) * (1 - k) + 0.45 * k; b = 8 * Math.pow(1 - k, 3) + 0.08;
        a *= 1 - t * 0.5;
      }
      const o = j * 4;
      pa[o] = P.px[i]; pa[o + 1] = P.py[i]; pa[o + 2] = P.pz[i]; pa[o + 3] = size;
      ca[o] = r; ca[o + 1] = gg; ca[o + 2] = b; ca[o + 3] = a;
      ma[o] = P.rot[i]; ma[o + 1] = P.cell[i]; ma[o + 2] = P.shade[i]; ma[o + 3] = P.emis[i];
      va[o] = P.vx[i]; va[o + 1] = P.vy[i]; va[o + 2] = P.vz[i]; va[o + 3] = P.stretch[i];
    }
    for (const at of [aP, aC, aM, aV]) { at.clearUpdateRanges(); at.addUpdateRange(0, n * 4); at.needsUpdate = true; }
    g.instanceCount = n;
  }

  // back-to-front radix sort (16-bit depth keys, two 8-bit passes)
  let order = new Uint32Array(NS), tmpOrder = new Uint32Array(NS);
  const keys = new Uint16Array(NS), cnt = new Uint32Array(256);
  const fwd = new THREE.Vector3();
  function sortSmoke(camera) {
    const n = smoke.count;
    camera.getWorldDirection(fwd);
    let maxD = 1;
    const cx = camPos.x, cy = camPos.y, cz = camPos.z;
    for (let i = 0; i < n; i++) { const d = (smoke.px[i] - cx) * fwd.x + (smoke.py[i] - cy) * fwd.y + (smoke.pz[i] - cz) * fwd.z; keys[i] = 0; tmpOrder[i] = i; if (d > maxD) maxD = d; }
    const sc = 65535 / maxD;
    for (let i = 0; i < n; i++) {
      const d = (smoke.px[i] - cx) * fwd.x + (smoke.py[i] - cy) * fwd.y + (smoke.pz[i] - cz) * fwd.z;
      keys[i] = 65535 - Math.max(0, Math.min(65535, (d * sc) | 0)); // far first
    }
    // pass 1: low byte
    cnt.fill(0);
    for (let i = 0; i < n; i++) cnt[keys[i] & 255]++;
    for (let i = 1; i < 256; i++) cnt[i] += cnt[i - 1];
    for (let i = n - 1; i >= 0; i--) { const k = keys[i] & 255; order[--cnt[k]] = i; }
    // pass 2: high byte
    cnt.fill(0);
    for (let j = 0; j < n; j++) cnt[keys[order[j]] >> 8]++;
    for (let i = 1; i < 256; i++) cnt[i] += cnt[i - 1];
    for (let j = n - 1; j >= 0; j--) { const i = order[j]; const k = keys[i] >> 8; tmpOrder[--cnt[k]] = i; }
    const t = order; order = tmpOrder; tmpOrder = t;
  }

  function updateDebris(dt) {
    const f8 = frameNo & 7;
    for (const k in debris) {
      const D = debris[k];
      const m = D.mesh;
      if (!D.count && !m.count) continue;
      const P = D.p, V = D.v, Q = D.q, W = D.w, S = D.s, AG = D.age, LF = D.life, R = D.rest, GY = D.gy;
      const M = m.instanceMatrix.array;
      for (let i = 0; i < D.count; i++) {
        AG[i] += dt;
        if (AG[i] > LF[i]) { // swap-remove
          const j = --D.count;
          if (i !== j) {
            P.copyWithin(i * 3, j * 3, j * 3 + 3); V.copyWithin(i * 3, j * 3, j * 3 + 3); Q.copyWithin(i * 4, j * 4, j * 4 + 4);
            W.copyWithin(i * 3, j * 3, j * 3 + 3); D.col.copyWithin(i * 3, j * 3, j * 3 + 3);
            S[i] = S[j]; AG[i] = AG[j]; LF[i] = LF[j]; R[i] = R[j]; D.trail[i] = D.trail[j]; GY[i] = GY[j];
            D.colDirty = true;
          }
          i--; continue;
        }
        const o = i * 3, q = i * 4, s = S[i];
        if (!R[i]) {
          V[o + 1] -= 9.8 * dt;
          P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
          // spin: q = dq * q with dq from the angular velocity (flat math, no temporaries)
          const wx = W[o], wy = W[o + 1], wz = W[o + 2];
          const wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
          if (wl * dt > 1e-5) {
            const ha = wl * dt * 0.5, sn = Math.sin(ha) / wl;
            const ax = wx * sn, ay = wy * sn, az = wz * sn, aw = Math.cos(ha);
            const bx = Q[q], by = Q[q + 1], bz = Q[q + 2], bw = Q[q + 3];
            let nx = aw * bx + ax * bw + ay * bz - az * by, ny = aw * by - ax * bz + ay * bw + az * bx;
            let nz = aw * bz + ax * by - ay * bx + az * bw, nw = aw * bw - ax * bx - ay * by - az * bz;
            const il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
            Q[q] = nx * il; Q[q + 1] = ny * il; Q[q + 2] = nz * il; Q[q + 3] = nw * il;
          }
          // ground: cached height, refreshed rarely or when close to it
          if (((i + f8) & 7) === 0 && P[o + 1] < GY[i] + 12) GY[i] = gh(P[o], P[o + 2]);
          const g = GY[i] + s * 0.3;
          if (P[o + 1] < g) {
            P[o + 1] = g;
            const vy = V[o + 1];
            if (vy < -2.5 && s > 1.2 && Math.random() < 0.5) dust(_v2.set(P[o], g, P[o + 2]), s * 3, { density: 0.35, life: 3, ground: GY[i] });
            V[o + 1] = -vy * 0.28; V[o] *= 0.55; V[o + 2] *= 0.55;
            W[o] *= 0.6; W[o + 1] *= 0.6; W[o + 2] *= 0.6;
            if (Math.abs(V[o + 1]) < 1.2 && V[o] * V[o] + V[o + 2] * V[o + 2] < 1) { R[i] = 1; LF[i] = Math.max(LF[i], AG[i] + rand(3, 6)); }
          }
          // big flying chunks trail dust
          if (s > 1.5) { D.trail[i] += dt; if (D.trail[i] > 0.09) { D.trail[i] = 0; emit(smoke, P[o], P[o + 1], P[o + 2], 0, 0.5, 0, { life: rand(1.2, 2.2), s0: s * 0.6, s1: s * 2.2, drag: 1, alpha: 0.35, fout: 0.3, r: 0.6, g: 0.54, b: 0.46, cell: puffCell(), wind: 0.5, turb: 0.3 }); } }
        }
        // sink into the ground over the last 1.5 s; write the instance matrix directly (rotation * scale, translation)
        const left = LF[i] - AG[i];
        const sink = left < 1.5 ? (1.5 - left) / 1.5 : 0;
        const sc = s * (1 - sink * 0.3);
        const x = Q[q], y = Q[q + 1], z = Q[q + 2], w = Q[q + 3];
        const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx2 = w * x2, wy2 = w * y2, wz2 = w * z2;
        const e = i * 16;
        M[e] = (1 - (yy + zz)) * sc; M[e + 1] = (xy + wz2) * sc; M[e + 2] = (xz - wy2) * sc; M[e + 3] = 0;
        M[e + 4] = (xy - wz2) * sc; M[e + 5] = (1 - (xx + zz)) * sc; M[e + 6] = (yz + wx2) * sc; M[e + 7] = 0;
        M[e + 8] = (xz + wy2) * sc; M[e + 9] = (yz - wx2) * sc; M[e + 10] = (1 - (xx + yy)) * sc; M[e + 11] = 0;
        M[e + 12] = P[o]; M[e + 13] = P[o + 1] - sink * s * 0.8; M[e + 14] = P[o + 2]; M[e + 15] = 1;
      }
      m.count = D.count;
      if (D.count) {
        m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, D.count * 16); m.instanceMatrix.needsUpdate = true;
        if (D.colDirty) {
          m.instanceColor.array.set(D.col.subarray(0, D.count * 3));
          m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, D.count * 3); m.instanceColor.needsUpdate = true;
          D.colDirty = false;
        }
      }
    }
  }
  const _q2 = new THREE.Quaternion();

  const stepDir = new THREE.Vector3();
  function updateProjectiles(dt) {
    let n = 0;
    for (let k = 0; k < projectiles.length; k++) {
      const p = projectiles[k];
      if (!p.alive) { projectiles.splice(k, 1); k--; continue; }
      p.age += dt;
      p.vel.y -= 9.8 * dt;
      stepDir.copy(p.vel).multiplyScalar(dt);
      const stepLen = stepDir.length();
      let hit = null;
      if (stepLen > 1e-4 && ctx.physics?.raycast) {
        stepDir.divideScalar(stepLen);
        hit = ctx.physics.raycast(p.pos, stepDir, stepLen + p.size * 0.4, { exclude: ['colossal', 'titans'] });
      }
      if (hit && hit.point) { impact(p, hit.point); projectiles.splice(k, 1); k--; continue; }
      p.pos.addScaledVector(p.vel, dt);
      const g = gh(p.pos.x, p.pos.z);
      if (p.pos.y - p.size * 0.35 < g || p.age > 20) { impact(p, _v.set(p.pos.x, g, p.pos.z)); projectiles.splice(k, 1); k--; continue; }
      _q.setFromAxisAngle(_v.copy(p.w).normalize(), p.w.length() * dt); p.q.premultiply(_q);
      p.trail += dt;
      while (p.trail > 0.05) {
        p.trail -= 0.05;
        emit(smoke, p.pos.x + rand(-1, 1) * p.size * 0.3, p.pos.y + rand(-1, 1) * p.size * 0.3, p.pos.z + rand(-1, 1) * p.size * 0.3, p.vel.x * 0.1, p.vel.y * 0.1, p.vel.z * 0.1, {
          life: rand(2.5, 4.5), s0: p.size * 0.7, s1: p.size * 2.8, grow: 2, drag: 1.2, alpha: 0.4, fin: 0.02, fout: 0.3, r: 0.64, g: 0.58, b: 0.5, cell: puffCell(), shade: 0.8, wind: 0.6, turb: 0.4,
        });
      }
      _m.compose(p.pos, p.q, _s.setScalar(p.size));
      boulMesh.setMatrixAt(n++, _m);
    }
    boulMesh.count = n;
    if (n) boulMesh.instanceMatrix.needsUpdate = true;
  }

  function updateRings(dt) {
    for (const r of rings) {
      if (!r.active) continue;
      r.age += dt;
      const rad = Math.min(r.maxR, r.speed * r.age * (1 - Math.min(r.age * 0.08, 0.4)));
      const k = 1 - rad / r.maxR;
      if (k <= 0.01) { r.active = false; r.mesh.visible = false; continue; }
      r.mesh.scale.setScalar(rad + r.maxR * 0.02);
      r.mesh.material.uniforms.uRing.value.set(1.0 - 0.02, 0.06 + 0.04 * (1 - k), r.alpha * Math.pow(k, 1.3), now);
    }
  }

  const fireSorted = [];
  function updateFireLights(dt, time) {
    fireSorted.length = 0;
    for (const f of fires) { if (!f.alive) { fires.delete(f); continue; } fireSorted.push(f); }
    fireSorted.sort((a, b) => a.position.distanceToSquared(camPos) - b.position.distanceToSquared(camPos));
    for (let i = 0; i < fireLights.length; i++) {
      const L = fireLights[i], f = fireSorted[i];
      if (!f || f.position.distanceTo(camPos) > 350) { L.intensity = 0; continue; }
      L.position.set(f.position.x, f.position.y + f.size * 0.6, f.position.z);
      const fl = 0.75 + 0.15 * Math.sin(time * 13 + f.seed) + 0.1 * Math.sin(time * 27.3 + f.seed * 2);
      L.intensity = 25 * f.size * f.size * fl * f.intensity;
      L.distance = 12 + f.size * 7;
    }
  }

  const api = {
    CELL, atlas: atlasRT.texture, scene: fxScene, pools: { smoke, glow },
    dust, debris: debrisFn, blood, gasPuff, sparks, explosion, lightning, projectile, steam, fire, smoke: smokeFn,
    steamJet, eruption, roar, stomp,
    /** temporarily raise the ember density (0..1) */
    embers(k = 1) { E.boost = Math.max(E.boost, k); },
    /** remove every live effect (restart) */
    clear() {
      smoke.count = 0; glow.count = 0; emitters.clear(); E.live = false; fires.clear(); projectiles.length = 0; timeline.length = 0;
      for (const D of Object.values(debris)) D.count = 0;
      bolts.length = 0; boltsDirty = true;
      for (const r of rings) { r.active = false; r.mesh.visible = false; }
    },
    get count() { return smoke.count + glow.count; },
    update(dt, time) {
      now += dt; frameNo++;
      ctx.camera.getWorldPosition(camPos);
      // timeline
      for (let i = 0; i < timeline.length; i++) if (timeline[i].t <= now) { const e = timeline[i]; timeline.splice(i, 1); i--; try { e.fn(); } catch (err) { console.error('[fx] timeline', err); } }
      for (const e of emitters) if (!e._update(dt)) emitters.delete(e);
      stepPool(smoke, dt);
      stepPool(glow, dt);
      updateDebris(dt);
      updateProjectiles(dt);
      updateRings(dt);
      updateFireLights(dt, time);
      stepEmbers(dt, now);
      // bolts: expire
      for (let i = 0; i < bolts.length; i++) if (now - bolts[i].birth > bolts[i].life + 0.05) { boltU[bolts[i].slot].z = 0; bolts.splice(i, 1); i--; boltsDirty = true; }
      if (boltsDirty) rebuildBolts();
      boltMat.uniforms.uTime.value = now;
      // flash light decay
      if (flashE > 0) { flashE *= Math.exp(-dt * flashDecay); if (flashE < 5) flashE = 0; }
      flashBudget = Math.min(1, flashBudget + dt * 0.5);
      flashLight.intensity = flashE;
    },
    /** called by post after AO: draw particles into the HDR buffer (soft vs. the stable depth texture) */
    render(r, camera, target, depthTex) {
      camera.getWorldPosition(camPos);
      sortSmoke(camera);
      writePool(smoke, smokeMesh, true);
      writePool(glow, glowMesh, false);
      writeEmbers(camera);
      const W = target?.width ?? r.domElement.width, H = target?.height ?? r.domElement.height;
      const w = Math.max(2, Math.round(W * PRES)), h = Math.max(2, Math.round(H * PRES));
      if (offRT.width !== w || offRT.height !== h) offRT.setSize(w, h);
      common.uNear.value = camera.near; common.uFar.value = camera.far;
      common.uDepth.value = depthTex; common.uDepthOn.value = depthTex ? 1 : 0;
      lightU.uSunV.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
      const z = ctx.sky?.zenithColor, hc = ctx.sky?.horizonColor, sc = ctx.sky?.sunColor;
      if (z && hc) {
        lightU.uAmbTop.value.set(z.r * 0.55 + hc.r * 0.45, z.g * 0.55 + hc.g * 0.45, z.b * 0.55 + hc.b * 0.45).multiplyScalar(1.1);
        if (sc) lightU.uAmbBot.value.set(sc.r * 0.03 + hc.r * 0.3, sc.g * 0.03 + hc.g * 0.3, sc.b * 0.025 + hc.b * 0.3);
        const inf = ctx.sky?.uniforms?.uAotInf?.value;
        if (inf && inf.y > 0) { const fc = ctx.sky.uniforms.uAotFireCol.value; lightU.uAmbBot.value.addScaledVector(fc, inf.y * 0.22); }
        // under the smoke pall the sky fill is warm smoke, not the clear-sky blue the LUT reports
        if (inf && inf.x > 0) lightU.uAmbTop.value.lerp(_ambWarm, Math.min(1, inf.x * 1.8));
      }
      const ac = r.autoClear;
      r.autoClear = false;
      const anyP = smoke.count || glow.count || emberMesh.geometry.instanceCount;
      if (anyP) {
        // half-res off-screen particles, then premultiplied composite
        common.uRes.value.set(w, h);
        common.uPxScale.value = h * camera.projectionMatrix.elements[5] * 0.5;
        r.getClearColor(_clr); const ca = r.getClearAlpha();
        r.setRenderTarget(offRT); r.setClearColor(0x000000, 0); r.clear(true, false, false);
        r.render(pScene, camera);
        r.setClearColor(_clr, ca);
        compPass.uniforms.uTexel.value.set(1 / w, 1 / h);
        compPass.render(r, target ?? null);
      }
      if (bolts.length || rings.some((x) => x.active)) {
        common.uRes.value.set(W, H);
        common.uPxScale.value = H * camera.projectionMatrix.elements[5] * 0.5;
        r.setRenderTarget(target ?? null);
        r.render(fxScene, camera);
      }
      r.autoClear = ac;
    },
  };
  return api;
}
