// Resupply point: crates, spare canisters, a signal pennant and a red signal flare with a short rising smoke plume
// visible across the district. Walk into it -> ctx.player.refill().
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { findChurch } from './town.js';

export function churchRoofPoint(ctx) {
  const L = ctx.LAYOUT, w = ctx.world || {};
  if (w.church?.roof?.isVector3) return w.church.roof.clone();
  if (w.resupplyPoint?.isVector3) return w.resupplyPoint.clone();
  const ch = findChurch(ctx);
  if (ch?.box && ctx.physics?.raycast) {
    const b = ch.box, top = b.max.y + 5, down = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3();
    const hits = [];
    for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) {
      o.set(THREE.MathUtils.lerp(b.min.x, b.max.x, i / 6), top, THREE.MathUtils.lerp(b.min.z, b.max.z, j / 6));
      const h = ctx.physics.raycast(o, down, top + 5, { exclude: ['titans', 'colossal'] });
      if (h && h.point.y > 6) hits.push(h);
    }
    // prefer the flattest, then a mid-height roof (not the spire tip)
    hits.sort((a, c) => (c.normal.y - a.normal.y) || (a.point.y - c.point.y));
    const flat = hits.filter((h) => h.normal.y > 0.9);
    const pick = flat.length ? flat.sort((a, c) => a.point.y - c.point.y)[Math.floor(flat.length / 2)] : hits.sort((a, c) => a.point.y - c.point.y)[Math.floor(hits.length * 0.35)];
    if (pick) return pick.point.clone();
  }
  const g = w.groundHeight?.(L.plaza.x + 10, L.plaza.z) ?? 0;
  return new THREE.Vector3(L.plaza.x + 10, g, L.plaza.z);
}

// wall-top walkway just west of the breach (50 m up — a vantage point on the giant's head)
export function wallTopPoint(ctx) {
  const L = ctx.LAYOUT, w = ctx.world || {};
  if (w.wallResupplyPoint?.isVector3) return w.wallResupplyPoint.clone();
  const r = L.wall.radius + L.wall.thickness / 2, x = -62, z = Math.sqrt(r * r - x * x);
  let y = L.wall.walkwayY ?? L.wall.height;
  const h = ctx.physics?.raycast?.(new THREE.Vector3(x, y + 30, z), new THREE.Vector3(0, -1, 0), 60, { exclude: ['titans', 'colossal'] });
  if (h && h.point.y > y - 8) y = h.point.y;
  return new THREE.Vector3(x, y, z);
}

// soft radial sprite textures (flare glow + smoke puff), shared by every beacon
let _tex = null;
function beaconTextures() {
  if (_tex) return _tex;
  const mk = (fn) => { const c = document.createElement('canvas'); c.width = c.height = 64; fn(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const glow = mk((g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,240,210,1)'); r.addColorStop(0.18, 'rgba(255,150,70,.9)'); r.addColorStop(0.5, 'rgba(255,70,20,.25)'); r.addColorStop(1, 'rgba(255,40,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
  const puff = mk((g) => {
    for (let i = 0; i < 7; i++) { const x = 20 + Math.random() * 24, y = 20 + Math.random() * 24, rr = 12 + Math.random() * 10; const r = g.createRadialGradient(x, y, 0, x, y, rr); r.addColorStop(0, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }
  });
  _tex = { glow, puff }; return _tex;
}

export function createResupply(ctx, { position, label = 'Resupply' } = {}) {
  const pos = position || churchRoofPoint(ctx);
  const group = new THREE.Group(); group.name = 'resupply'; group.position.copy(pos);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e4b2c, roughness: 0.92 });
  const wood2 = new THREE.MeshStandardMaterial({ color: 0x4f3520, roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa4a8, metalness: 0.85, roughness: 0.35 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb8923e, metalness: 0.9, roughness: 0.3 });
  const crate = (w, h, dd, x, z, r) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), wood); m.position.set(x, h / 2, z); m.rotation.y = r; m.castShadow = m.receiveShadow = true; group.add(m);
    for (const s of [-1, 1]) { const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.12, dd + 0.04), wood2); band.position.set(x, h / 2 + s * h * 0.32, z); band.rotation.y = r; group.add(band); }
  };
  crate(1.5, 1.0, 1.0, 0, 0, 0.2); crate(1.1, 0.8, 0.9, 0.3, 0.1, -0.1); group.children.at(-3).position.y += 1.0; group.children.at(-2).position.y += 1.0; group.children.at(-1).position.y += 1.0;
  crate(1.2, 0.9, 0.9, -1.7, 0.6, 0.6);
  for (let i = 0; i < 4; i++) { // spare gas canisters in a rack
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.25, 14), steel); cyl.position.set(1.6 + i * 0.44, 0.63, -0.8); cyl.castShadow = true; group.add(cyl);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.16, 10), brass); cap.position.set(1.6 + i * 0.44, 1.33, -0.8); group.add(cap);
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6, 8), wood2); pole.position.set(-0.9, 3, -1.2); pole.castShadow = true; group.add(pole);
  // perf: the 18 static crate/band/canister/cap/pole meshes are merged into one mesh per material (draw calls 18 -> 4)
  {
    const byMat = new Map();
    for (const m of group.children.slice()) {
      if (!m.isMesh) continue;
      m.updateMatrix();
      const g = m.geometry.clone().applyMatrix4(m.matrix);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      const e = byMat.get(m.material) || byMat.set(m.material, { geos: [], shadow: false }).get(m.material);
      e.geos.push(g.index ? g.toNonIndexed() : g); e.shadow ||= m.castShadow;
      group.remove(m); m.geometry.dispose();
    }
    for (const [mat, e] of byMat) {
      const merged = new THREE.Mesh(mergeGeometries(e.geos), mat);
      merged.castShadow = e.shadow; merged.receiveShadow = true;
      group.add(merged);
    }
  }
  const flagGeo = new THREE.PlaneGeometry(1.9, 1.1, 8, 1); flagGeo.translate(0.95, 0, 0);
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0x2f5a3a, roughness: 0.85, side: THREE.DoubleSide }));
  flag.position.set(-0.86, 5.3, -1.2); flag.castShadow = true; group.add(flag);
  const flagBase = flagGeo.attributes.position.array.slice();
  // signal flare: a sputtering red-orange glow at the crates and a short smoke plume (~8 m) that thins with height
  const T = beaconTextures();
  const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: 0xff6a30, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: true }));
  flare.position.set(-0.3, 2.3, 0.4); flare.scale.setScalar(1.8); group.add(flare);
  const PUFFS = 14, puffs = [];
  for (let i = 0; i < PUFFS; i++) {
    const m = new THREE.SpriteMaterial({ map: T.puff, color: i % 3 ? 0xc8583a : 0xe0764a, transparent: true, depthWrite: false, fog: true, opacity: 0 });
    const sp = new THREE.Sprite(m); sp.userData = { age: (i / PUFFS) * 5, life: 5, dx: (Math.random() - 0.5) * 0.6, dz: (Math.random() - 0.5) * 0.6, rot: Math.random() * 6 };
    group.add(sp); puffs.push(sp);
  }
  let beaconOn = false;
  const setBeacon = (on) => { if (on === beaconOn) return; beaconOn = on; flare.visible = on; for (const p of puffs) p.visible = on; };
  setBeacon(false);
  ctx.scene.add(group);

  let cool = 0, t = 0;
  return {
    position: pos, group, label,
    update(dt, rdt) {
      t += rdt; cool -= rdt;
      setBeacon(ctx.mode === 'play' || ctx.mode === 'dead' || ctx.mode === 'paused');
      // flag ripple
      const a = flagGeo.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) { const x = flagBase[i]; a[i + 2] = Math.sin(x * 2.6 - t * 5.2) * 0.14 * x; }
      flagGeo.attributes.position.needsUpdate = true;
      const P = ctx.player; if (!P?.position) return;
      const need = (P.gas ?? 1) < 0.3 || ((P.blades?.count ?? 8) <= 1 && (P.blades?.durability ?? 1) < 0.3);
      if (beaconOn) {
        // flare sputter; plume rises ~1.6 m/s, drifts downwind, grows and fades out by ~8 m
        const k = need ? 1 : 0.7;
        flare.scale.setScalar((1.5 + Math.sin(t * 23) * 0.15 + Math.sin(t * 37) * 0.1) * k);
        flare.material.opacity = (0.75 + 0.25 * Math.sin(t * 17)) * k;
        for (const p of puffs) {
          const u = p.userData; u.age += rdt; if (u.age > u.life) { u.age -= u.life; u.dx = (Math.random() - 0.5) * 0.6; u.dz = (Math.random() - 0.5) * 0.6; }
          const a = u.age / u.life, h = a * 8;
          p.position.set(-0.3 + u.dx + a * 1.6, 2.4 + h, 0.4 + u.dz + a * 0.8);
          p.scale.setScalar(0.9 + a * 3.4);
          p.material.opacity = Math.min(1, a * 6) * (1 - a) * (1 - a) * 0.55 * k;
          p.material.rotation = u.rot + a * 0.8;
        }
      }
      if (ctx.mode !== 'play' || cool > 0) return;
      if (P.position.distanceTo(pos) < 7.5) {
        const full = (P.gas ?? 1) > 0.97 && (P.blades?.count ?? 8) >= 8 && (P.blades?.durability ?? 1) > 0.95 && (P.hp ?? 1) > 0.95;
        if (full) return;
        cool = 6;
        try { P.refill?.(); } catch (e) { console.warn(e); }
        ctx.audio?.play?.('gas', { volume: 1.2 }); ctx.audio?.play?.('blade_swap', { delay: 0.35 });
        ctx.hud?.toast?.('Resupplied — gas canisters and blades replaced', 'gold');
        ctx.events.emit('player:resupply', { label });
      }
    },
  };
}
