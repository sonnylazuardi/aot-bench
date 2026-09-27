// District radar (bottom-right): rotating heading-up map of Shiganshina — wall ring, rooftops, breach, titans, resupply.
// Static map is rasterised once (rebuilt when buildings collapse); dynamic layer redrawn at ~15 Hz.
import * as THREE from 'three';

const EXT = 460, PPM = 1.25; // static map covers [-EXT, EXT] metres at PPM px/m

export function createRadar(ctx, parent) {
  const L = ctx.LAYOUT;
  const wrap = document.createElement('div'); wrap.className = 'radar';
  const c = document.createElement('canvas'); wrap.appendChild(c);
  const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.textContent = 'Shiganshina District'; wrap.appendChild(lbl);
  parent.appendChild(wrap);
  const g = c.getContext('2d');
  let W = 0, acc = 1, off = null, builtSig = '', range = 230;
  const _f = new THREE.Vector3();

  // layout is read only after a resize (never per frame)
  let measured = false;
  function size() {
    if (measured && W) return;
    const r = wrap.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1);
    if (r.width < 2) return; // hidden (HUD off) — measure later
    measured = true;
    const w = Math.max(64, Math.round(r.width * dpr)); if (w !== W) { W = w; c.width = c.height = w; }
  }
  addEventListener('resize', () => { measured = false; });

  // static layer: signature checked at most once a second, rebuilt only when buildings collapse / the wall breaches
  let sigT = 0;
  function buildStatic(dt) {
    sigT -= dt;
    if (off && sigT > 0) return;
    sigT = 1;
    const B = ctx.world?.buildings || [];
    let dead = 0; for (let i = 0; i < B.length; i++) if (B[i].destroyed) dead++;
    const sig = B.length + ':' + dead + ':' + !!ctx.world?.breached;
    if (off && sig === builtSig) return;
    builtSig = sig;
    const N = Math.round(EXT * 2 * PPM);
    off = off || document.createElement('canvas'); off.width = off.height = N;
    const o = off.getContext('2d'); o.clearRect(0, 0, N, N);
    o.save(); o.scale(PPM, PPM); o.translate(EXT, EXT);
    // fields outside, town disc inside
    o.fillStyle = 'rgba(70,64,48,.35)'; o.fillRect(-EXT, -EXT, EXT * 2, EXT * 2);
    o.fillStyle = 'rgba(22,19,16,.94)'; o.beginPath(); o.arc(0, 0, L.wall.radius, 0, Math.PI * 2); o.fill();
    // main avenue + plaza
    o.strokeStyle = 'rgba(238,230,211,.12)'; o.lineWidth = L.mainStreet?.width || 16; o.beginPath(); o.moveTo(0, -L.wall.radius); o.lineTo(0, L.wall.radius); o.stroke();
    o.fillStyle = 'rgba(238,230,211,.08)'; o.beginPath(); o.arc(L.plaza.x, L.plaza.z, L.plaza.radius, 0, Math.PI * 2); o.fill();
    // rooftops
    for (const b of B) {
      const bx = b.box; if (!bx) continue;
      const h = b.height ?? (bx.max.y - bx.min.y);
      o.fillStyle = b.destroyed ? 'rgba(150,62,40,.42)' : `rgba(214,200,172,${Math.min(0.34, 0.13 + h / 120).toFixed(2)})`;
      o.fillRect(bx.min.x, bx.min.z, bx.max.x - bx.min.x, bx.max.z - bx.min.z);
    }
    // wall ring
    o.strokeStyle = 'rgba(214,204,182,.75)'; o.lineWidth = L.wall.thickness; o.beginPath(); o.arc(0, 0, L.wall.radius + L.wall.thickness / 2, 0, Math.PI * 2); o.stroke();
    // gates
    const gate = (gx, gz, col, w) => { const a = Math.atan2(gz, gx), da = w / L.wall.radius; o.strokeStyle = col; o.lineWidth = L.wall.thickness + 4; o.beginPath(); o.arc(0, 0, L.wall.radius + L.wall.thickness / 2, a - da, a + da); o.stroke(); };
    gate(L.innerGate.x, L.innerGate.z, 'rgba(20,18,15,1)', 10);
    gate(L.outerGate.x, L.outerGate.z, ctx.world?.breached ? 'rgba(196,38,46,1)' : 'rgba(20,18,15,1)', ctx.world?.breached ? 22 : 10);
    o.restore();
  }

  function draw(dt) {
    size(); if (!W) return; buildStatic(dt);
    const P = ctx.player, cam = ctx.camera; if (!P?.position) return;
    const p = P.position, R = W / 2, s = (R * 0.92) / range;
    cam.getWorldDirection(_f); const theta = -Math.PI / 2 - Math.atan2(_f.z, _f.x);
    g.clearRect(0, 0, W, W);
    g.save(); g.translate(R, R);
    g.beginPath(); g.arc(0, 0, R * 0.96, 0, Math.PI * 2); g.clip();
    g.fillStyle = 'rgba(11,10,9,.72)'; g.fillRect(-R, -R, W, W);
    g.save(); g.rotate(theta); g.scale(s, s); g.translate(-p.x, -p.z);
    if (off) g.drawImage(off, -EXT, -EXT, EXT * 2, EXT * 2);
    // resupply crates
    for (const r of ctx.director?.resupplies || []) {
      const sp = r.position; g.save(); g.translate(sp.x, sp.z); g.rotate(-theta); g.scale(1 / s, 1 / s);
      g.fillStyle = '#d3aa55'; g.strokeStyle = '#0b0a09'; g.lineWidth = 1.5 * (W / 180); const k = 5 * (W / 180);
      g.beginPath(); g.moveTo(0, -k); g.lineTo(k, 0); g.lineTo(0, k); g.lineTo(-k, 0); g.closePath(); g.fill(); g.stroke(); g.restore();
    }
    // civilians (tiny pale dots)
    const civ = ctx.titans?.civilians?.list;
    if (Array.isArray(civ)) { g.fillStyle = 'rgba(238,230,211,.75)'; const k = 1.4 / s * (W / 180); for (const c of civ) { const p2 = c.position || c.object?.position; if (!p2 || c.alive === false || c.eaten) continue; g.fillRect(p2.x - k / 2, p2.z - k / 2, k, k); } }
    g.restore();
    // the giant: big pulsing blot with its reach ring
    const B = ctx.colossal;
    if (B?.object && B.active !== false) {
      const bp = B.object.position, dx = bp.x - p.x, dz = bp.z - p.z, cs = Math.cos(theta), sn = Math.sin(theta);
      let x = (dx * cs - dz * sn) * s, y = (dx * sn + dz * cs) * s; const dd = Math.hypot(x, y), lim = R * 0.84;
      if (dd > lim) { x *= lim / dd; y *= lim / dd; }
      const tt = performance.now() / 1000, rr = Math.max(6 * (W / 180), 14 * s);
      g.fillStyle = `rgba(196,38,46,${(0.18 + 0.1 * Math.sin(tt * 3)).toFixed(2)})`; g.beginPath(); g.arc(x, y, rr * 2.2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e0343c'; g.strokeStyle = '#0b0a09'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#0b0a09'; g.font = `700 ${Math.round(rr * 1.1)}px 'Oswald', sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', x, y + 1);
    }
    // titans (drawn in screen space so edge-clamping is easy)
    const t = performance.now() / 1000;
    for (const ti of ctx.titans?.list || []) {
      if (ti.alive === false || !ti.position) continue;
      const dx = ti.position.x - p.x, dz = ti.position.z - p.z;
      const cs = Math.cos(theta), sn = Math.sin(theta);
      let x = (dx * cs - dz * sn) * s, y = (dx * sn + dz * cs) * s;
      const d = Math.hypot(x, y), lim = R * 0.86, out = d > lim;
      if (out) { x *= lim / d; y *= lim / d; }
      const ab = ti.variant === 'abnormal', h = ti.height || 8;
      const rad = (1.8 + Math.min(1, h / 15) * 2.6) * (W / 180) * (out ? 0.7 : 1);
      const near = Math.hypot(dx, dz) < 60;
      if (near) { g.fillStyle = `rgba(196,38,46,${(0.25 + 0.2 * Math.sin(t * 8)).toFixed(2)})`; g.beginPath(); g.arc(x, y, rad * 2.4, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = ab ? '#f07a2a' : '#d8313a'; g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 1;
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // range rings
    g.strokeStyle = 'rgba(238,230,211,.08)'; g.lineWidth = 1; g.beginPath(); g.arc(0, 0, R * 0.46, 0, Math.PI * 2); g.stroke();
    // view cone
    const cone = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.9); cone.addColorStop(0, 'rgba(238,230,211,.16)'); cone.addColorStop(1, 'rgba(238,230,211,0)');
    g.fillStyle = cone; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R * 0.9, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); g.closePath(); g.fill();
    g.restore();
    // bezel + compass
    g.save(); g.translate(R, R);
    g.strokeStyle = 'rgba(238,230,211,.55)'; g.lineWidth = Math.max(1, W / 160); g.beginPath(); g.arc(0, 0, R * 0.96, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(238,230,211,.25)';
    for (let i = 0; i < 36; i++) { const a = theta + i * Math.PI / 18; const r0 = R * (i % 9 === 0 ? 0.86 : 0.91); g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * R * 0.955, Math.sin(a) * R * 0.955); g.stroke(); }
    g.font = `700 ${Math.round(W / 13)}px 'Barlow Condensed', 'Oswald', sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [lab, wx, wz] of [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]]) {
      const a = Math.atan2(wz, wx) + theta, r = R * 0.78;
      g.fillStyle = lab === 'S' ? '#e0474e' : 'rgba(238,230,211,.8)'; g.fillText(lab, Math.cos(a) * r, Math.sin(a) * r);
    }
    // player arrow
    const k = W / 180;
    g.fillStyle = '#eee6d3'; g.strokeStyle = '#0b0a09'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -8 * k); g.lineTo(5.5 * k, 6 * k); g.lineTo(0, 3 * k); g.lineTo(-5.5 * k, 6 * k); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  return {
    update(dt) { acc += dt; if (acc < 1 / 15) return; const a = acc; acc = 0; draw(a); },
    setRange(r) { range = r; },
  };
}
