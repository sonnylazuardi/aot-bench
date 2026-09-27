import * as THREE from 'three';
// Trauma-based camera shake applied on top of whoever owns the camera this frame.
// ctx.shake(amount 0..1+, { at?:Vector3, radius?:number, duration?:number })
// With `at`, strength falls off with distance to the camera (big titan footsteps far away = small).
export function createShake(camera) {
  let trauma = 0, rumble = 0, rumbleT = 0;
  const saved = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  const e = new THREE.Euler();
  let t = 0;
  const n = (x) => Math.sin(x * 1.7) * 0.6 + Math.sin(x * 3.1 + 1.3) * 0.3 + Math.sin(x * 7.3 + 2.1) * 0.1;
  return {
    add(amount, opts = {}) {
      let a = amount;
      if (opts.at) {
        const d = camera.position.distanceTo(opts.at);
        const r = opts.radius ?? 200;
        a *= Math.max(0, 1 - d / r) ** 1.5;
      }
      if (opts.duration) { rumble = Math.max(rumble, a); rumbleT = Math.max(rumbleT, opts.duration); }
      else trauma = Math.min(1.5, trauma + a);
    },
    get trauma() { return Math.max(trauma, rumbleT > 0 ? rumble : 0); },
    apply(dt) {
      t += dt;
      trauma = Math.max(0, trauma - dt * 1.4);
      if (rumbleT > 0) rumbleT -= dt;
      const k = Math.max(trauma, rumbleT > 0 ? rumble : 0);
      saved.p.copy(camera.position); saved.q.copy(camera.quaternion);
      if (k <= 0.001) return;
      const s = k * k;
      const f = 22;
      e.set(n(t * f) * 0.035 * s, n(t * f + 10) * 0.035 * s, n(t * f + 20) * 0.05 * s);
      camera.quaternion.multiply(new THREE.Quaternion().setFromEuler(e));
      camera.position.x += n(t * f + 30) * 0.25 * s;
      camera.position.y += n(t * f + 40) * 0.25 * s;
    },
    restore() { camera.position.copy(saved.p); camera.quaternion.copy(saved.q); },
  };
}
