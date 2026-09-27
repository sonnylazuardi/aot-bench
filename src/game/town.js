// The burning town: fires creeping north from the breach, smoke columns, the church's alarm bell.
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
  const fires = [];
  let fireT = 6, sinceBreach = 0, bells = 0, bellT = 0, bellBurstT = 40, started = false;
  const church = findChurch(ctx);
  const bellPos = new THREE.Vector3(L.plaza.x, 34, L.plaza.z);
  if (church) {
    const bx = church.box, c = church.center || bx?.getCenter(new THREE.Vector3());
    if (church.tower?.position) bellPos.copy(church.tower.position);
    else if (c && bx) bellPos.set(c.x, bx.max.y * 0.8, c.z);
  }

  function ignite(pos, size = 5, life = 80) {
    const fx = ctx.fx || {};
    const f = { pos: pos.clone(), t: 0, life, fire: null, smoke: null, snd: null };
    try { f.fire = fx.fire?.(pos, size); } catch (e) { console.warn(e); }
    try { f.smoke = fx.smoke?.(pos.clone().add(new THREE.Vector3(0, size * 0.8, 0)), size * 1.6); } catch (e) { console.warn(e); }
    f.snd = ctx.audio?.loop?.('fire', { position: pos, volume: Math.min(1.3, 0.5 + size / 10), fadeIn: 2 });
    fires.push(f);
    return f;
  }
  function burnBuilding(filter) {
    const B = (ctx.world?.buildings || []).filter((b) => !b.destroyed && b.box && !b.burning && filter(b));
    if (!B.length) return false;
    const b = B[Math.floor(Math.random() * B.length)]; b.burning = true;
    const c = b.center || b.box.getCenter(new THREE.Vector3());
    const size = THREE.MathUtils.clamp((b.box.max.x - b.box.min.x + b.box.max.z - b.box.min.z) / 5, 3, 9);
    ignite(new THREE.Vector3(c.x, b.box.max.y * 0.82, c.z), size, 70 + Math.random() * 60);
    return true;
  }
  const front = () => L.wall.radius - 30 - sinceBreach * 1.1; // fire front creeps north

  return {
    alarm(n = 12) { bells = Math.max(bells, n); bellT = 0; },
    start(skipped) {
      if (started) return; started = true;
      this.alarm(skipped ? 10 : 18);
      // houses nearest the breach are already alight
      for (let i = 0; i < (skipped ? 4 : 3); i++) burnBuilding((b) => { const c = b.center || b.box.getCenter(new THREE.Vector3()); return c.z > 250 && Math.abs(c.x) < 130; });
    },
    onCollapse(p) {
      const pos = p?.position || p?.center || p?.building?.center || p?.point;
      if (pos?.isVector3 && Math.random() < 0.35 && fires.length < 12) ignite(pos.clone().setY(Math.max(2, pos.y)), 4 + Math.random() * 3, 50);
    },
    update(dt, rdt) {
      if (!started) return;
      sinceBreach += rdt;
      // bell tolling
      if (bells > 0) { bellT -= rdt; if (bellT <= 0) { ctx.audio?.play?.('bell', { position: bellPos, volume: 1 }); bells--; bellT = 2.3 + Math.random() * 0.15; } }
      bellBurstT -= rdt; if (bellBurstT <= 0) { bellBurstT = 50 + Math.random() * 30; this.alarm(6); }
      // spreading fires
      fireT -= rdt;
      if (fireT <= 0) {
        fireT = 9 + Math.random() * 14;
        if (fires.filter((f) => f.t < f.life).length < 9) { const fz = front(); burnBuilding((b) => { const c = b.center || b.box.getCenter(new THREE.Vector3()); return c.z > fz && c.z < fz + 140 && Math.hypot(c.x, c.z) < 350; }); }
      }
      for (let i = fires.length - 1; i >= 0; i--) {
        const f = fires[i]; f.t += rdt;
        if (f.t > f.life && f.fire) { f.fire.stop?.(); f.fire = null; f.snd?.stop?.(4); f.snd = null; }         // burnt out: smoke lingers
        if (f.t > f.life + 60) { f.smoke?.stop?.(); fires.splice(i, 1); }
      }
    },
    get fires() { return fires; },
    bellPos,
  };
}
