// Cinematic toolkit: camera rig (eased paths, handheld noise, FOV/roll), timeline runner, instanced bird flock.
import * as THREE from 'three';

export const clamp = THREE.MathUtils.clamp;
export const lerp = THREE.MathUtils.lerp;
export const ease = {
  linear: (t) => clamp(t, 0, 1),
  inOut: (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); },
  inOut5: (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); },
  out: (t) => { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); },
  in: (t) => { t = clamp(t, 0, 1); return t * t * t; },
  outQuad: (t) => { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); },
};
// smooth pseudo-noise, roughly -1..1
export const nz = (t, s = 0) => Math.sin(t * 1.13 + s) * 0.5 + Math.sin(t * 2.37 + s * 1.7) * 0.3 + Math.sin(t * 5.71 + s * 2.9) * 0.2;
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Camera rig: shots write pos/target/fov/roll each frame; handheld noise + impulse kicks layered on top.
export class CineCam {
  constructor(ctx) {
    this.ctx = ctx;
    this.pos = new THREE.Vector3(); this.target = new THREE.Vector3(0, 0, 1);
    this.fov = 55; this.roll = 0; this.hand = 0; this.handF = 1; this.t = 0;
    this.kick = 0; this.kickV = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._up = new THREE.Vector3(0, 1, 0);
  }
  // camera jolt (impact): decays quickly
  jolt(k) { this.kick = Math.min(1.5, this.kick + k); }
  apply(dt) {
    const cam = this.ctx.camera;
    this.t += dt;
    // never feed NaN into the camera (black frame); keep the last good pose
    const ok = Number.isFinite(this.pos.x + this.pos.y + this.pos.z + this.target.x + this.target.y + this.target.z + this.fov);
    if (!ok) { if (this.good) { this.pos.copy(this.good.p); this.target.copy(this.good.t); this.fov = this.good.f; } else return; }
    else { if (!this.good) this.good = { p: new THREE.Vector3(), t: new THREE.Vector3(), f: 55 }; this.good.p.copy(this.pos); this.good.t.copy(this.target); this.good.f = this.fov; }
    if (this.pos.distanceToSquared(this.target) < 1e-6) this.target.z += 1;
    this.kick *= Math.exp(-dt * 5);
    const t = this.t * this.handF;
    const h = this.hand + this.kick * 0.6;
    cam.position.copy(this.pos);
    cam.position.x += nz(t * 0.9, 1) * h * 0.25; cam.position.y += nz(t * 0.8, 4) * h * 0.2;
    this._m.lookAt(cam.position, this.target, this._up);
    cam.quaternion.setFromRotationMatrix(this._m);
    const k = this.kick;
    this._e.set(nz(t * 1.1, 7) * h * 0.012 + nz(this.t * 23, 3) * k * 0.02, nz(t, 9) * h * 0.014 + nz(this.t * 19, 5) * k * 0.02, this.roll + nz(t * 0.7, 11) * h * 0.008, 'YXZ');
    cam.quaternion.multiply(this._q.setFromEuler(this._e));
    if (Math.abs(cam.fov - this.fov) > 1e-3) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}

// Catmull-Rom helper: path([p0, p1, ...]) -> (u, out) => out
export function path(points) {
  if (points.length === 2) return (u, out) => out.lerpVectors(points[0], points[1], u);
  const c = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return (u, out) => c.getPoint(clamp(u, 0, 1), out);
}

// Instanced bird flock: circles over the rooftops, scatters from a point.
export class Birds {
  constructor(ctx, n = 70) {
    this.ctx = ctx; this.n = n;
    const body = new THREE.ConeGeometry(0.09, 0.5, 5).rotateX(Math.PI / 2);
    const wing = new THREE.BufferGeometry();
    // a swept wing from the shoulder (origin) out along +X
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, 0.62, 0, -0.1, 0, 0, -0.14, 0.62, 0, -0.1, 0.45, 0, -0.24, 0, 0, -0.14], 3));
    wing.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1c1a1a, roughness: 0.9, side: THREE.DoubleSide });
    this.body = new THREE.InstancedMesh(body, mat, n);
    this.wL = new THREE.InstancedMesh(wing, mat, n);
    this.wR = new THREE.InstancedMesh(wing, mat, n);
    for (const m of [this.body, this.wL, this.wR]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.castShadow = false; }
    this.group = new THREE.Group(); this.group.add(this.body, this.wL, this.wR); this.group.visible = false;
    ctx.scene.add(this.group);
    this.b = [];
    for (let i = 0; i < n; i++) this.b.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: 8 + Math.random() * 30, a: Math.random() * 6.28, w: (0.25 + Math.random() * 0.3) * (Math.random() < 0.5 ? -1 : 1), h: Math.random() * 14, ph: Math.random() * 6.28, fr: 7 + Math.random() * 4, s: 0.8 + Math.random() * 0.5 });
    this.center = new THREE.Vector3(); this.scatterFrom = null; this.scatterT = 0; this.mode = 'circle';
    this._m = new THREE.Matrix4(); this._w = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._q3 = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._e = new THREE.Euler();
  }
  start(center) {
    this.center.copy(center); this.group.visible = true; this.mode = 'circle';
    for (const b of this.b) { b.p.set(center.x + Math.cos(b.a) * b.r, center.y + b.h, center.z + Math.sin(b.a) * b.r); b.v.set(0, 0, 0); }
  }
  scatter(from) {
    this.mode = 'scatter'; this.scatterT = 0;
    for (const b of this.b) {
      const d = b.p.clone().sub(from); d.y = Math.abs(d.y) + 20; d.normalize();
      b.v.copy(d).multiplyScalar(14 + Math.random() * 10);
      b.v.x += (Math.random() - 0.5) * 8; b.v.z += (Math.random() - 0.5) * 8;
      b.fr *= 1.6;
    }
  }
  hide() { this.group.visible = false; this.mode = 'off'; }
  update(dt, time) {
    if (!this.group.visible) return;
    this.scatterT += dt;
    for (let i = 0; i < this.n; i++) {
      const b = this.b[i];
      const prev = this._s.copy(b.p);
      if (this.mode === 'circle') {
        b.a += b.w * dt;
        b.p.set(this.center.x + Math.cos(b.a) * b.r, this.center.y + b.h + Math.sin(time * 0.7 + b.ph) * 2, this.center.z + Math.sin(b.a) * b.r);
        b.v.subVectors(b.p, prev).divideScalar(Math.max(dt, 1e-4));
      } else {
        b.v.y += (Math.random() - 0.4) * dt * 6;
        b.p.addScaledVector(b.v, dt);
      }
      const flap = Math.sin(time * b.fr + b.ph) * (this.mode === 'scatter' ? 1.0 : (Math.sin(time * 0.6 + b.ph) > 0.3 ? 0.7 : 0.1));
      // orientation from velocity
      const yaw = Math.atan2(b.v.x, b.v.z), pitch = -Math.atan2(b.v.y, Math.hypot(b.v.x, b.v.z)) * 0.6;
      this._q.setFromEuler(this._e.set(pitch, yaw, 0, 'YXZ'));
      this._m.compose(b.p, this._q, this._s.set(b.s, b.s, b.s));
      this.body.setMatrixAt(i, this._m);
      this._q2.setFromEuler(this._e.set(0, 0, flap * 0.9));
      this._w.compose(b.p, this._q3.copy(this._q).multiply(this._q2), this._s);
      this.wL.setMatrixAt(i, this._w);
      this._q2.setFromEuler(this._e.set(0, 0, Math.PI - flap * 0.9));
      this._w.compose(b.p, this._q3.copy(this._q).multiply(this._q2), this._s);
      this.wR.setMatrixAt(i, this._w);
    }
    this.body.instanceMatrix.needsUpdate = this.wL.instanceMatrix.needsUpdate = this.wR.instanceMatrix.needsUpdate = true;
    if (this.mode === 'scatter' && this.scatterT > 14) this.hide();
  }
}
