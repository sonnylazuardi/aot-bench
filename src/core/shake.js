import * as THREE from 'three';
// Trauma-based camera shake applied on top of whoever owns the camera this frame.
// ctx.shake(amount 0..1+, { at?:Vector3, radius?:number, duration?:number, calm?:seconds })
// With `at`, strength falls off steeply with distance to the camera: full inside ~25 m, fading hard past 60 m,
// never more than 0.15 for anything > 120 m away. `calm: s` suppresses all shake for s seconds (e.g. after the intro).
// Rotational-only small-angle shake: no positional jitter (it would push the lens into nearby geometry).
export function createShake(camera) {
  let trauma = 0, rumble = 0, rumbleT = 0, calmT = 0;
  const saved = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  const e = new THREE.Euler(), dq = new THREE.Quaternion();
  let t = 0;
  const n = (x) => Math.sin(x * 1.7) * 0.6 + Math.sin(x * 3.1 + 1.3) * 0.3 + Math.sin(x * 7.3 + 2.1) * 0.1;
  return {
    add(amount, opts = {}) {
      if (opts.calm) calmT = Math.max(calmT, opts.calm);
      let a = amount;
      if (!(a > 0)) return;
      if (opts.at) {
        const d = camera.position.distanceTo(opts.at);
        const r = opts.radius ?? 200;
        a *= Math.max(0, 1 - d / r) ** 1.5;
        if (d > 25) a *= Math.exp(-(d - 25) / 35);       // steep falloff past ~60 m
        if (d > 120) a = Math.min(a, 0.15);
      }
      if (calmT > 0) return;
      if (opts.duration) { rumble = Math.max(rumble, Math.min(a, 0.6)); rumbleT = Math.max(rumbleT, opts.duration); }
      else trauma = Math.min(1.2, trauma + a);
    },
    get trauma() { return Math.max(trauma, rumbleT > 0 ? rumble : 0); },
    apply(dt) {
      t += dt;
      trauma = Math.max(0, trauma - dt * 1.6);
      if (rumbleT > 0) rumbleT -= dt;
      if (calmT > 0) { calmT -= dt; trauma = 0; rumbleT = 0; }
      const k = Math.max(trauma, rumbleT > 0 ? rumble : 0);
      saved.p.copy(camera.position); saved.q.copy(camera.quaternion);
      if (k <= 0.001) return;
      const s = k * k;
      const f = 18;
      e.set(n(t * f) * 0.022 * s, n(t * f + 10) * 0.022 * s, n(t * f + 20) * 0.03 * s);
      camera.quaternion.multiply(dq.setFromEuler(e));
    },
    restore() { camera.position.copy(saved.p); camera.quaternion.copy(saved.q); },
  };
}
