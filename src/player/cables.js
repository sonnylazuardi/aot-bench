// ODM wires: screen-space expanded anti-aliased ribbons (min pixel width so a 1 cm steel wire still reads at 80 m),
// sag + travelling whip while flying / slack, dead straight and humming when taut. Plus the barbed hook heads.
import * as THREE from 'three';

const SEG = 40;
const vert = /* glsl */`
  attribute vec3 nextPos; attribute float side; attribute float along;
  uniform vec2 uRes; uniform float uWidth; uniform float uMinPx;
  varying float vSide; varying float vAlpha; varying float vAlong;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec4 c0 = projectionMatrix * mv;
    vec4 c1 = projectionMatrix * modelViewMatrix * vec4(nextPos, 1.0);
    vec2 s0 = c0.xy / c0.w * uRes * 0.5, s1 = c1.xy / c1.w * uRes * 0.5;
    vec2 d = s1 - s0; float L = length(d); d = L > 1e-4 ? d / L : vec2(1.0, 0.0);
    vec2 n = vec2(-d.y, d.x);
    float px = uWidth * projectionMatrix[1][1] * uRes.y * 0.5 / max(0.05, -mv.z);
    float w = max(px, uMinPx);
    vAlpha = clamp(px / uMinPx, 0.45, 1.0);
    c0.xy += n * side * (w * 0.5 + 0.75) / (uRes * 0.5) * c0.w;
    gl_Position = c0; vSide = side * (w * 0.5 + 0.75) / (w * 0.5); vAlong = along;
  }`;
const frag = /* glsl */`
  uniform vec3 uColor; uniform float uOpacity;
  varying float vSide; varying float vAlpha; varying float vAlong;
  void main(){
    float edge = 1.0 - smoothstep(0.6, 1.3, abs(vSide));
    float core = 1.0 - smoothstep(0.0, 0.8, abs(vSide + 0.35));
    vec3 col = uColor * (0.75 + 0.9 * core);                  // tiny specular streak along the wire
    float a = edge * vAlpha * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

function hookHeadGeometry() {
  const parts = [];
  const tip = new THREE.ConeGeometry(0.035, 0.14, 8); tip.rotateX(Math.PI / 2); tip.translate(0, 0, 0.07); parts.push(tip);
  const body = new THREE.CylinderGeometry(0.022, 0.026, 0.12, 8); body.rotateX(Math.PI / 2); body.translate(0, 0, -0.05); parts.push(body);
  for (let k = 0; k < 3; k++) { // barbs
    const b = new THREE.BoxGeometry(0.012, 0.075, 0.018); b.translate(0, 0.045, 0); b.rotateX(-0.6); b.translate(0, 0, 0.015);
    b.rotateZ((k / 3) * Math.PI * 2); parts.push(b);
  }
  const pos = [], nor = [], idx = []; let base = 0;
  for (const g of parts) {
    const gg = g.index ? g.toNonIndexed() : g;
    const p = gg.attributes.position.array, n = gg.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) idx.push(base + i);
    base += p.length / 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export function createCables(scene) {
  const N = 2, pts = N * (SEG + 1) * 2;
  const pos = new Float32Array(pts * 3), nxt = new Float32Array(pts * 3), side = new Float32Array(pts), along = new Float32Array(pts);
  const idx = [];
  for (let c = 0; c < N; c++) {
    const b0 = c * (SEG + 1);
    for (let i = 0; i <= SEG; i++) { const k = (b0 + i) * 2; side[k] = -1; side[k + 1] = 1; along[k] = along[k + 1] = i / SEG; }
    for (let i = 0; i < SEG; i++) { const a = (b0 + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('nextPos', new THREE.BufferAttribute(nxt, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('side', new THREE.BufferAttribute(side, 1));
  geo.setAttribute('along', new THREE.BufferAttribute(along, 1));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: true, side: THREE.DoubleSide,
    uniforms: { uRes: { value: new THREE.Vector2(1920, 1080) }, uWidth: { value: 0.011 }, uMinPx: { value: 1.35 },
      uColor: { value: new THREE.Color(0x3a3f47) }, uOpacity: { value: 0.95 } },
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.name = 'ODMCables';
  scene.add(mesh);

  const headGeo = hookHeadGeometry();
  const headMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, metalness: 0.9, roughness: 0.3 });
  const heads = [0, 1].map(() => { const m = new THREE.Mesh(headGeo, headMat); m.castShadow = true; m.visible = false; scene.add(m); return m; });

  const P = [...Array(SEG + 1)].map(() => new THREE.Vector3());
  const _d = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _sag = new THREE.Vector3(), _a = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  const state = [0, 1].map(() => ({ t: 0, whip: 0, lastState: 'idle', seed: Math.random() * 10 }));

  function writeStrand(c, from, to, sag, wave, hum, time, st) {
    _d.copy(to).sub(from); const L = _d.length();
    if (L < 1e-4) { hide(c); return; }
    _d.divideScalar(L);
    _p1.crossVectors(_up, _d); if (_p1.lengthSq() < 1e-4) _p1.set(1, 0, 0); _p1.normalize();
    _p2.crossVectors(_d, _p1).normalize();
    _sag.set(0, -1, 0).addScaledVector(_d, _d.y); if (_sag.lengthSq() < 0.02) _sag.copy(_p2); _sag.normalize();
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG, env = Math.sin(s * Math.PI);
      const p = P[i].copy(from).addScaledVector(_d, L * s);
      p.addScaledVector(_sag, sag * 4 * s * (1 - s));
      const ph = s * L * 0.7 - time * 26 + st.seed;
      p.addScaledVector(_p1, Math.sin(ph) * wave * env).addScaledVector(_p2, Math.cos(ph * 0.8 + 1.1) * wave * 0.6 * env);
      if (hum > 0) p.addScaledVector(_p1, Math.sin(s * L * 3.1 - time * 90) * hum * env);
    }
    const b0 = c * (SEG + 1);
    for (let i = 0; i <= SEG; i++) {
      const p = P[i], q = P[Math.min(SEG, i + 1)];
      let nx = q.x, ny = q.y, nz = q.z;
      if (i === SEG) { const pp = P[SEG - 1]; nx = 2 * p.x - pp.x; ny = 2 * p.y - pp.y; nz = 2 * p.z - pp.z; }
      for (let s = 0; s < 2; s++) { const k = ((b0 + i) * 2 + s) * 3; pos[k] = p.x; pos[k + 1] = p.y; pos[k + 2] = p.z; nxt[k] = nx; nxt[k + 1] = ny; nxt[k + 2] = nz; }
    }
  }
  function hide(c) {
    const b0 = c * (SEG + 1);
    for (let i = 0; i <= SEG; i++) for (let s = 0; s < 2; s++) { const k = ((b0 + i) * 2 + s) * 3; pos[k] = pos[k + 2] = nxt[k] = nxt[k + 2] = 0; pos[k + 1] = nxt[k + 1] = -1e4; }
  }

  return {
    mesh,
    // hooks: player hook objects; launchers: [Vector3 L, Vector3 R]
    update(dt, time, hooks, launchers, renderer) {
      renderer.getDrawingBufferSize(_a); mat.uniforms.uRes.value.set(_a.x, _a.y);
      for (let c = 0; c < 2; c++) {
        const h = hooks[c], st = state[c], head = heads[c];
        if (h.state !== st.lastState) { st.t = 0; if (h.state === 'attached') st.whip = 1; st.lastState = h.state; } else st.t += dt;
        st.whip = Math.max(0, st.whip - dt * 3);
        if (h.state === 'idle') { hide(c); head.visible = false; continue; }
        const from = launchers[c], to = h.tip;
        const L = from.distanceTo(to);
        let sag = 0, wave = 0, hum = 0;
        if (h.state === 'fly') { const k = Math.min(1, st.t * 6); sag = Math.min(L * 0.05, 1.2) * k; wave = 0.12 * Math.exp(-st.t * 4) + 0.03; }
        else if (h.state === 'attached') {
          const slack = h.slack || 0;
          sag = slack * Math.min(L * 0.12, 3.5) + 0.002 * L * (1 - Math.min(1, h.tension * 3));
          wave = st.whip * 0.35 * Math.exp(-st.t * 6) + slack * 0.12;
          hum = h.reeling ? 0.012 : 0;
        } else if (h.state === 'retract') { sag = Math.min(L * 0.18, 2.5); wave = 0.25; }
        writeStrand(c, from, to, sag, wave, hum, time, st);
        head.visible = true; head.position.copy(to);
        _d.copy(to).sub(P[SEG - 2]); if (_d.lengthSq() > 1e-6) { head.lookAt(_d.add(to)); }
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.nextPos.needsUpdate = true;
    },
  };
}
