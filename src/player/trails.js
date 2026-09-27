// Blade trails (Catmull-Rom smoothed ribbons from blade base->tip history, additive, fading with age)
// and the ODM gas jet (soft white exhaust particles from the lower-back nozzle / canisters).
import * as THREE from 'three';

const M = 64;          // trail samples (after sub-sampling)
const LIFE = 0.16;     // seconds a trail sample lives

function softSprite() {
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function makeTrail(scene, color) {
  const pos = new Float32Array(M * 2 * 3), alpha = new Float32Array(M * 2), ed = new Float32Array(M * 2);
  const idx = [];
  for (let i = 0; i < M - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  for (let i = 0; i < M; i++) { ed[i * 2] = 0; ed[i * 2 + 1] = 1; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('edge', new THREE.BufferAttribute(ed, 1));
  geo.setIndex(idx); geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: `attribute float alpha; attribute float edge; varying float vA; varying float vE;
      void main(){ vA = alpha; vE = edge; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; varying float vA; varying float vE;
      void main(){ float e = smoothstep(0.35, 1.0, vE); float a = vA * e * e * 0.55;
        if (a < 0.003) discard; gl_FragColor = vec4(uColor * (0.5 + 0.7 * e), a); }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 6; scene.add(mesh);
  // raw frame samples (ring): base, tip, time
  const R = 8, raw = [...Array(R)].map(() => ({ b: new THREE.Vector3(), t: new THREE.Vector3(), time: -9 }));
  let head = 0, count = 0;
  const S = [...Array(M)].map(() => ({ b: new THREE.Vector3(), t: new THREE.Vector3(), time: -9 })); // smoothed
  let sHead = 0;
  const cr = (p0, p1, p2, p3, t, out) => { // catmull-rom
    const t2 = t * t, t3 = t2 * t;
    out.x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
    out.y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
    out.z = 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
    return out;
  };
  return {
    mesh,
    push(base, tip, time) {
      const r = raw[head]; r.b.copy(base); r.t.copy(tip); r.time = time; head = (head + 1) % R; count = Math.min(R, count + 1);
      if (count < 3) { const s = S[sHead]; s.b.copy(base); s.t.copy(tip); s.time = time; sHead = (sHead + 1) % M; return; }
      // sub-sample the segment between the previous two raw samples (p1 -> p2) with p0/p3 neighbours (p3 = newest)
      const g = (k) => raw[(head - 1 - k + R * 2) % R];
      const p3 = g(0), p2 = g(1), p1 = g(2), p0 = count > 3 ? g(3) : g(2);
      const SUB = 5;
      for (let i = 1; i <= SUB; i++) {
        const u = i / SUB, s = S[sHead];
        cr(p0.b, p1.b, p2.b, p3.b, u, s.b); cr(p0.t, p1.t, p2.t, p3.t, u, s.t); s.time = p1.time + (p2.time - p1.time) * u;
        sHead = (sHead + 1) % M;
      }
    },
    clear() { count = 0; for (const s of S) s.time = -9; },
    update(time, strength) {
      for (let i = 0; i < M; i++) {
        const s = S[(sHead - 1 - i + M * 2) % M];
        const age = time - s.time, a = age < 0 || age > LIFE ? 0 : (1 - age / LIFE) * strength * (i === 0 ? 0 : 1);
        const k = i * 2;
        pos[k * 3] = s.b.x; pos[k * 3 + 1] = s.b.y; pos[k * 3 + 2] = s.b.z;
        pos[(k + 1) * 3] = s.t.x; pos[(k + 1) * 3 + 1] = s.t.y; pos[(k + 1) * 3 + 2] = s.t.z;
        alpha[k] = alpha[k + 1] = a * a;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.alpha.needsUpdate = true;
    },
  };
}

export function createTrails(scene) {
  return { L: makeTrail(scene, 0xcfe6ff), R: makeTrail(scene, 0xcfe6ff) };
}

// ---------------------------------------------------------------------------------------- gas jet
export function createGasJet(scene) {
  const N = 140;
  const pos = new Float32Array(N * 3), size = new Float32Array(N), op = new Float32Array(N);
  const vel = [...Array(N)].map(() => new THREE.Vector3()), life = new Float32Array(N), age = new Float32Array(N).fill(9);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('op', new THREE.BufferAttribute(op, 1).setUsage(THREE.DynamicDrawUsage));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uMap: { value: softSprite() }, uScale: { value: 600 } },
    vertexShader: `attribute float size; attribute float op; varying float vOp; uniform float uScale;
      void main(){ vOp = op; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uMap; varying float vOp;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord); float a = t.a * vOp; if (a < 0.004) discard; gl_FragColor = vec4(vec3(0.93, 0.95, 0.97), a); }`,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 7; scene.add(pts);
  let next = 0, acc = 0;
  return {
    points: pts,
    // emit: rate (particles/s), from: nozzle world pos, dir: exhaust dir (unit), bodyVel
    update(dt, rate, from, dir, bodyVel, camera, viewportH) {
      mat.uniforms.uScale.value = viewportH * 0.5 * camera.projectionMatrix.elements[5];
      acc += rate * dt;
      while (acc >= 1) {
        acc -= 1;
        const i = next; next = (next + 1) % N;
        age[i] = Math.random() * dt; life[i] = 0.35 + Math.random() * 0.35;
        const j = Math.random() * 0.12;
        pos[i * 3] = from.x + (Math.random() - 0.5) * j; pos[i * 3 + 1] = from.y + (Math.random() - 0.5) * j; pos[i * 3 + 2] = from.z + (Math.random() - 0.5) * j;
        vel[i].copy(dir).multiplyScalar(9 + Math.random() * 7).addScaledVector(bodyVel, 0.55);
        vel[i].x += (Math.random() - 0.5) * 2.5; vel[i].y += (Math.random() - 0.5) * 2.5; vel[i].z += (Math.random() - 0.5) * 2.5;
      }
      for (let i = 0; i < N; i++) {
        if (age[i] >= life[i]) { op[i] = 0; size[i] = 0; continue; }
        age[i] += dt; const u = age[i] / life[i];
        vel[i].multiplyScalar(Math.max(0, 1 - 3.2 * dt));
        pos[i * 3] += vel[i].x * dt; pos[i * 3 + 1] += vel[i].y * dt; pos[i * 3 + 2] += vel[i].z * dt;
        size[i] = 0.1 + u * 0.55; op[i] = 0.42 * (1 - u) * Math.min(1, u * 8);
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.size.needsUpdate = true; geo.attributes.op.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------------------- air streaks
// World-fixed "air" motes around the flight path, drawn as streaks along the relative wind (p -> p - v * shutter).
// Respawned ahead of the soldier when they fall behind; opacity ramps in with speed. Sells velocity in stills.
export function createSpeedLines(scene) {
  const N = 90;
  const pos = new Float32Array(N * 2 * 3), al = new Float32Array(N * 2);
  const P = [...Array(N)].map(() => new THREE.Vector3(0, -1e4, 0)), seed = new Float32Array(N).map(() => Math.random());
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('alpha', new THREE.BufferAttribute(al, 1).setUsage(THREE.DynamicDrawUsage));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying float vA; void main(){ if (vA < 0.003) discard; gl_FragColor = vec4(vec3(0.92,0.95,1.0), vA); }`,
  });
  const lines = new THREE.LineSegments(geo, mat); lines.frustumCulled = false; lines.renderOrder = 8; scene.add(lines);
  const _d = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _r = new THREE.Vector3();
  function spawn(i, C, vel, sp, ahead) {
    _d.copy(vel).divideScalar(sp);
    _a.set(0, 1, 0).cross(_d); if (_a.lengthSq() < 1e-4) _a.set(1, 0, 0); _a.normalize(); _b.crossVectors(_d, _a);
    const ang = Math.random() * Math.PI * 2, rad = 2.2 + Math.random() * 9;
    P[i].copy(C).addScaledVector(_d, ahead * (0.4 + Math.random() * 0.8)).addScaledVector(_a, Math.cos(ang) * rad).addScaledVector(_b, Math.sin(ang) * rad);
  }
  return {
    lines,
    update(C, vel, strength) {
      const sp = vel.length();
      const k = strength;
      const shutter = 0.055;
      for (let i = 0; i < N; i++) {
        if (sp < 4 || k <= 0.001) { al[i * 2] = al[i * 2 + 1] = 0; continue; }
        _r.copy(P[i]).sub(C);
        const along = _r.dot(vel) / sp, far = _r.lengthSq();
        if (along < -6 || far > 26 * 26) spawn(i, C, vel, sp, 12 + sp * 0.9);
        const p = P[i];
        pos[i * 6] = p.x; pos[i * 6 + 1] = p.y; pos[i * 6 + 2] = p.z;
        pos[i * 6 + 3] = p.x - vel.x * shutter * (0.6 + seed[i]); pos[i * 6 + 4] = p.y - vel.y * shutter * (0.6 + seed[i]); pos[i * 6 + 5] = p.z - vel.z * shutter * (0.6 + seed[i]);
        const d = Math.sqrt(far), fade = Math.min(1, (26 - d) / 8) * Math.min(1, d / 3);
        al[i * 2] = 0.22 * k * fade * (0.4 + 0.6 * seed[i]); al[i * 2 + 1] = 0;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.alpha.needsUpdate = true;
    },
  };
}
