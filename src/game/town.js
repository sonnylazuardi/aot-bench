// Town ambience during the fight — kept restrained (user direction: not too much fire and burning):
// one or two thin smoke wisps rising near the breach and a brief alarm from the church bell when the fight starts.
import * as THREE from 'three';

export function findChurch(ctx) {
  const L = ctx.LAYOUT, w = ctx.world || {};
  if (w.church) return w.church;
  const B = w.buildings || [];
  let best = null, bh = 0;
  for (const b of B) {
    if (b.kind === 'church') return b;
    const c = b.center || b.box?.getCenter(new THREE.Vector3()); if (!c || !b.box) continue;
    if (Math.hypot(c.x - L.plaza.x, c.z - L.plaza.z) > L.plaza.radius + 55) continue;
    const h = b.height ?? b.box.max.y; if (h > bh) { bh = h; best = b; }
  }
  return best;
}

export function createTown(ctx, d) {
  const L = ctx.LAYOUT;
  const wisps = [];
  let bells = 0, bellT = 0, started = false;
  const church = findChurch(ctx);
  const bellPos = new THREE.Vector3(L.plaza.x, 34, L.plaza.z);
  if (church) {
    const bx = church.box, c = church.center || bx?.getCenter(new THREE.Vector3());
    if (church.tower?.position) bellPos.copy(church.tower.position);
    else if (c && bx) bellPos.set(c.x, bx.max.y * 0.8, c.z);
  }
  // thin smoke wisps from the rubble just inside the breach
  function wisp(x, z, size) {
    const y = ctx.world?.groundHeight?.(x, z) ?? 0;
    try { const h = ctx.fx?.smoke?.(new THREE.Vector3(x, y + 2, z), size); if (h) wisps.push(h); } catch (e) { console.warn(e); }
  }

  return {
    alarm(n = 6) { bells = Math.max(bells, Math.min(n, 6)); bellT = 0; },
    start() {
      if (started) return; started = true;
      this.alarm(6);
      wisp(-26, L.wall.radius - 22, 3.2);
      wisp(19, L.wall.radius - 34, 2.4);
    },
    onCollapse() { /* no extra fires */ },
    update(dt, rdt) {
      if (!started || bells <= 0) return;
      bellT -= rdt;
      if (bellT <= 0) { ctx.audio?.play?.('bell', { position: bellPos, volume: 0.9 }); bells--; bellT = 2.4 + Math.random() * 0.15; }
    },
    get wisps() { return wisps; },
    bellPos,
  };
}
