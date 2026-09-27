// Story-owned volumetric-looking billboard particles: titan steam, the transformation mushroom cloud,
// dust waves. Depth-sorted, premultiplied alpha, sun-lit with strong forward scattering (backlit steam glows),
// optional per-particle emissive (fire-lit cloud). One draw call. Shared by colossal.js and intro.js.
import * as THREE from 'three';

function puffAtlas() {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S * 2;
  const g = cv.getContext('2d');
  const img = g.createImageData(S * 2, S * 2);
  const hash = (x, y, s) => { const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };
  const vn = (x, y, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let t = 0; t < 4; t++) {
    const ox = (t % 2) * S, oy = Math.floor(t / 2) * S;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S * 2 - 1, v = y / S * 2 - 1;
      let n = 0, a = 0.5, f = 3;
      for (let o = 0; o < 5; o++) { n += a * vn(u * f + 10 * t, v * f - 7 * t, t + o); a *= 0.5; f *= 2.1; }
      const r = Math.hypot(u, v);
      // billowy: radial falloff eroded by noise
      let d = Math.max(0, 1 - r * (1.05 + (0.55 - n) * 0.9));
      d = Math.pow(d, 1.2) * (0.55 + n * 0.9);
      const i = ((oy + y) * S * 2 + ox + x) * 4;
      const val = Math.max(0, Math.min(1, d));
      img.data[i] = val * 255; img.data[i + 1] = n * 255; img.data[i + 2] = 0; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export function getVapor(ctx) {
  if (!ctx._storyVapor) ctx._storyVapor = createVapor(ctx);
  return ctx._storyVapor;
}

function createVapor(ctx, MAX = 1500) {
  const P = {
    x: new Float32Array(MAX), y: new Float32Array(MAX), z: new Float32Array(MAX),
    vx: new Float32Array(MAX), vy: new Float32Array(MAX), vz: new Float32Array(MAX),
    age: new Float32Array(MAX), life: new Float32Array(MAX), s0: new Float32Array(MAX), s1: new Float32Array(MAX),
    rot: new Float32Array(MAX), rv: new Float32Array(MAX), a: new Float32Array(MAX), drag: new Float32Array(MAX), buoy: new Float32Array(MAX),
    r: new Float32Array(MAX), g: new Float32Array(MAX), b: new Float32Array(MAX),
    er: new Float32Array(MAX), eg: new Float32Array(MAX), eb: new Float32Array(MAX), edecay: new Float32Array(MAX),
    fin: new Float32Array(MAX), variant: new Uint8Array(MAX), alive: new Uint8Array(MAX), lit: new Float32Array(MAX),
  };
  let count = 0; // high-water mark
  const free = [];
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index; geo.setAttribute('position', quad.getAttribute('position')); geo.setAttribute('uv', quad.getAttribute('uv'));
  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const aSz = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aGlow = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', aPos); geo.setAttribute('iSize', aSz); geo.setAttribute('iCol', aCol); geo.setAttribute('iGlow', aGlow);
  geo.instanceCount = 0;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    map: { value: puffAtlas() },
    uSunDirV: { value: new THREE.Vector3(0, 0.3, -1) },
    uSunCol: { value: new THREE.Color(1.6, 1.15, 0.75) },
    uAmb: { value: new THREE.Color(0.55, 0.52, 0.55) },
  }]);
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */`
attribute vec3 iPos; attribute vec4 iSize; attribute vec4 iCol; attribute vec3 iGlow;
varying vec2 vUv; varying vec2 vCorner; varying vec4 vCol; varying vec3 vGlow; varying float vA;
varying float vFogD;
void main(){
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float c = cos(iSize.y), s = sin(iSize.y);
  vec2 k = position.xy;
  vec2 rc = vec2(c*k.x - s*k.y, s*k.x + c*k.y);
  mv.xy += rc * iSize.x;
  vCorner = k * 2.0;
  float v = iCol.w;
  vUv = (uv + vec2(mod(v, 2.0), floor(v / 2.0))) * 0.5;
  vCol = iCol; vGlow = iGlow;
  float dist = -mv.z;
  vA = iSize.z * smoothstep(0.5, 0.5 + iSize.x * 0.5, dist);
  gl_Position = projectionMatrix * mv;
  vFogD = -mv.z;
}`,
    fragmentShader: /* glsl */`
uniform sampler2D map; uniform vec3 uSunDirV; uniform vec3 uSunCol; uniform vec3 uAmb;
varying vec2 vUv; varying vec2 vCorner; varying vec4 vCol; varying vec3 vGlow; varying float vA;
varying float vFogD;
#ifdef USE_FOG
uniform vec3 fogColor;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear; uniform float fogFar;
#endif
#endif
void main(){
  vec4 t = texture2D(map, vUv);
  float d = t.r;
  float a = d * vA;
  if (a < 0.004) discard;
  vec2 q = vCorner;
  vec3 n = normalize(vec3(q * 0.9, sqrt(max(0.0, 1.0 - dot(q, q))) + 0.35 + (t.g - 0.5)));
  float lit = clamp(dot(n, uSunDirV) * 0.5 + 0.5, 0.0, 1.0);
  float fwd = pow(clamp(-uSunDirV.z, 0.0, 1.0), 4.0);
  float thin = 1.0 - d;
  vec3 albedo = vCol.rgb;
  vec3 col = albedo * (uAmb * (0.75 + 0.25 * t.g) + uSunCol * lit * 0.75) + uSunCol * albedo * fwd * (0.25 + thin * 1.6);
  col += vGlow * (0.4 + 0.8 * d);
  gl_FragColor = vec4(col * a, a);
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogD * vFogD);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogD);
    #endif
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * a, fogFactor * 0.85);
  #endif
}`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.name = 'storyVapor';
  ctx.scene.add(mesh);

  const tmpV = new THREE.Vector3();
  const order = new Uint16Array(MAX);
  const depth = new Float32Array(MAX);
  let lastFrame = -1;
  const wind = new THREE.Vector3(1.2, 0, -0.6);

  function emit(o) {
    let i;
    if (free.length) i = free.pop();
    else if (count < MAX) i = count++;
    else {
      // recycle the oldest-relative particle
      let best = 0, bv = -1;
      for (let k = 0; k < MAX; k += 7) { const v = P.age[k] / P.life[k]; if (v > bv) { bv = v; best = k; } }
      i = best;
    }
    const p = o.pos;
    P.x[i] = p.x; P.y[i] = p.y; P.z[i] = p.z;
    const v = o.vel;
    P.vx[i] = v ? v.x : 0; P.vy[i] = v ? v.y : 0; P.vz[i] = v ? v.z : 0;
    P.age[i] = 0; P.life[i] = o.life ?? 4;
    P.s0[i] = o.size ?? 4; P.s1[i] = o.size1 ?? (o.size ?? 4) * 2.5;
    P.rot[i] = Math.random() * 6.28; P.rv[i] = (Math.random() - 0.5) * (o.spin ?? 0.3);
    P.a[i] = o.alpha ?? 0.5; P.drag[i] = o.drag ?? 0.6; P.buoy[i] = o.buoy ?? 1.5;
    const c = o.color || [0.95, 0.93, 0.9];
    P.r[i] = c[0]; P.g[i] = c[1]; P.b[i] = c[2];
    const e = o.glow || [0, 0, 0];
    P.er[i] = e[0]; P.eg[i] = e[1]; P.eb[i] = e[2]; P.edecay[i] = o.glowDecay ?? 1.5;
    P.fin[i] = o.fadeIn ?? 0.15; P.variant[i] = (Math.random() * 4) | 0; P.alive[i] = 1;
    return i;
  }

  function update(dt) {
    if (ctx.clock.frame === lastFrame) return;
    lastFrame = ctx.clock.frame;
    // lighting from the sky system (fall back to layout sun)
    const sun = ctx.sky?.sun;
    const cam = ctx.camera;
    if (sun) tmpV.copy(sun.position).sub(sun.target?.position || tmpV.set(0, 0, 0)).normalize();
    else tmpV.set(...ctx.LAYOUT.sunDir).normalize();
    uniforms.uSunDirV.value.copy(tmpV).transformDirection(cam.matrixWorldInverse);
    if (dt > 0) {
      for (let i = 0; i < count; i++) {
        if (!P.alive[i]) continue;
        P.age[i] += dt;
        if (P.age[i] >= P.life[i]) { P.alive[i] = 0; free.push(i); continue; }
        const dr = Math.exp(-P.drag[i] * dt);
        P.vx[i] = P.vx[i] * dr + wind.x * dt * 0.3;
        P.vz[i] = P.vz[i] * dr + wind.z * dt * 0.3;
        P.vy[i] = P.vy[i] * dr + P.buoy[i] * dt;
        P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.z[i] += P.vz[i] * dt;
        P.rot[i] += P.rv[i] * dt;
        const k = Math.exp(-P.edecay[i] * dt);
        P.er[i] *= k; P.eg[i] *= k; P.eb[i] *= k;
      }
    }
    // sort back to front
    const m = cam.matrixWorldInverse.elements;
    let n = 0;
    for (let i = 0; i < count; i++) {
      if (!P.alive[i]) continue;
      depth[i] = m[2] * P.x[i] + m[6] * P.y[i] + m[10] * P.z[i] + m[14];
      order[n++] = i;
    }
    const ord = order.subarray(0, n);
    ord.sort((a, b) => depth[a] - depth[b]);
    const pa = aPos.array, sa = aSz.array, ca = aCol.array, ga = aGlow.array;
    for (let j = 0; j < n; j++) {
      const i = ord[j];
      const t = P.age[i] / P.life[i];
      const fade = Math.min(1, t / P.fin[i]) * (1 - t) * (1 - t) * (1 + t);
      const size = P.s0[i] + (P.s1[i] - P.s0[i]) * (1 - (1 - t) * (1 - t));
      pa[j * 3] = P.x[i]; pa[j * 3 + 1] = P.y[i]; pa[j * 3 + 2] = P.z[i];
      sa[j * 4] = size; sa[j * 4 + 1] = P.rot[i]; sa[j * 4 + 2] = P.a[i] * fade; sa[j * 4 + 3] = 0;
      ca[j * 4] = P.r[i]; ca[j * 4 + 1] = P.g[i]; ca[j * 4 + 2] = P.b[i]; ca[j * 4 + 3] = P.variant[i];
      ga[j * 3] = P.er[i]; ga[j * 3 + 1] = P.eg[i]; ga[j * 3 + 2] = P.eb[i];
    }
    geo.instanceCount = n;
    aPos.needsUpdate = aSz.needsUpdate = aCol.needsUpdate = aGlow.needsUpdate = true;
    aPos.clearUpdateRanges(); aPos.addUpdateRange(0, n * 3);
    aSz.clearUpdateRanges(); aSz.addUpdateRange(0, n * 4);
    aCol.clearUpdateRanges(); aCol.addUpdateRange(0, n * 4);
    aGlow.clearUpdateRanges(); aGlow.addUpdateRange(0, n * 3);
  }

  function clear() { for (let i = 0; i < count; i++) if (P.alive[i]) { P.alive[i] = 0; free.push(i); } }
  return { emit, update, clear, mesh, uniforms, wind, get live() { return geo.instanceCount; } };
}
