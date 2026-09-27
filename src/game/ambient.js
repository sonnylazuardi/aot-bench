// A handful (2–4) of small pure titans roaming the district for scale while the giant fights.
import * as THREE from 'three';

export function createAmbient(ctx, d) {
  const L = ctx.LAYOUT;
  let active = false, respawnT = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const alive = () => (ctx.titans?.list || []).filter((t) => t.alive !== false).length;
  function spawn(inside) {
    const pos = inside
      ? new THREE.Vector3(rnd(-110, 110), 0, rnd(230, 330))
      : new THREE.Vector3(L.titanEntry.x + rnd(-18, 18), 0, L.titanEntry.z + rnd(-10, 10));
    pos.y = ctx.world?.groundHeight?.(pos.x, pos.z) ?? 0;
    try { ctx.titans?.spawn?.({ position: pos, height: +rnd(4, 8).toFixed(1), variant: Math.random() < 0.2 ? 'abnormal' : undefined }); }
    catch (e) { console.warn('[ambient] spawn failed', e); }
  }
  return {
    start() { if (active) return; active = true; for (let i = 0; i < 3; i++) spawn(true); respawnT = 25; },
    update(dt, rdt, ending) {
      if (!active || ending) return;
      respawnT -= rdt;
      if (respawnT <= 0) { respawnT = 25 + Math.random() * 20; if (alive() < 2) spawn(false); }
    },
  };
}
