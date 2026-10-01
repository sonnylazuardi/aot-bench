// Projected world markers:
//  - boss weak points (ctx.colossal.weakPoints): yellow crosshair ring on the nape (pulses when cuttable), red X-in-circle on
//    limbs with a small vertical green HP bar, greyed when inactive, edge arrows when off-screen
//  - small pure titans: class tag on-screen / edge arrow off-screen, nape lock-on reticle
//  - resupply beacons
// DOM pools; per frame only transform/opacity + text/class when changed.
import * as THREE from 'three';

const POOL = 4, RANGE = 240;
// viewport size cached on resize (reading innerWidth/innerHeight per frame can force a layout)
let VW = innerWidth, VH = innerHeight;
addEventListener('resize', () => { VW = innerWidth; VH = innerHeight; });
export function heightClass(h) { const C = [3, 4, 5, 7, 10, 13, 15, 60]; let b = C[0]; for (const c of C) if (Math.abs(c - h) < Math.abs(b - h)) b = c; return b; }
const WP_NAMES = { hand_L: 'Left hand', hand_R: 'Right hand', ankle_L: 'Left ankle', ankle_R: 'Right ankle', nape: 'Nape' };
const SVG_LIMB = `<svg class="ic" viewBox="-34 -34 68 68" fill="none" stroke="currentColor"><g class="xbig" stroke-width="7" stroke-linecap="round" opacity=".9"><path d="M-27,-27 L-12,-12 M27,-27 L12,-12 M-27,27 L-12,12 M27,27 L12,12"/></g>
  <circle r="13" stroke-width="3" fill="rgba(255,40,55,.16)"/><path d="M-6.5,-6.5 L6.5,6.5 M6.5,-6.5 L-6.5,6.5" stroke-width="3" stroke-linecap="round"/></svg>`;
const SVG_NAPE = `<svg class="ic" viewBox="-34 -34 68 68" fill="none" stroke="currentColor"><g class="xbig" stroke-width="2"><circle r="24" stroke-dasharray="6 5"/></g>
  <circle r="15" stroke-width="3"/><path d="M-12,-12 L-5,-5 M12,-12 L5,-5 M-12,12 L-5,5 M12,12 L5,5" stroke-width="3" stroke-linecap="round"/><circle r="2.2" fill="currentColor" stroke="none"/></svg>`;

export function createMarkers(ctx, parent, reservedEls = () => []) {
  const layer = document.createElement('div'); layer.className = 'layer';
  parent.appendChild(layer);
  const mk = (cls, html) => { const e = document.createElement('div'); e.className = 'mk ' + cls; e.innerHTML = html; e.style.opacity = '0'; layer.appendChild(e); return e; };
  // small titans
  const pool = [];
  for (let i = 0; i < POOL; i++) {
    const e = mk('tmk', `<div class="body"><span class="cls"></span><span class="d"></span><div class="chev"></div></div><div class="arrow"><i></i></div>`);
    pool.push({ e, cls: e.querySelector('.cls'), d: e.querySelector('.d'), arrow: e.querySelector('.arrow'), last: {} });
  }
  const nape = mk('nape', `<div class="inner"><div class="rt"><i></i><i></i><i></i><i></i></div><i class="c"></i><div class="lab">Nape<span></span></div></div>`);
  const napeD = nape.querySelector('.lab span');
  // boss weak points (created lazily per name)
  const wps = new Map();
  function wpEl(name) {
    let w = wps.get(name); if (w) return w;
    const isNape = name === 'nape';
    const e = mk('wpk ' + (isNape ? 'nape' : 'limb'), `<div class="sc">${isNape ? SVG_NAPE : SVG_LIMB}<div class="vb"><u></u></div></div><div class="lab"></div><div class="arrow"><i></i></div>`);
    w = { e, sc: e.querySelector('.sc'), u: e.querySelector('.vb u'), lab: e.querySelector('.lab'), arrow: e.querySelector('.arrow'), last: {} };
    wps.set(name, w); return w;
  }
  // single boss marker used while the giant is far away (weak points collapse into it)
  const bossMk = mk('bmk', `<div class="body">${SVG_LIMB}<span class="d"></span></div><div class="arrow"><i></i></div>`);
  const bossD = bossMk.querySelector('.d'), bossArrow = bossMk.querySelector('.arrow');
  const stB = {};
  // resupply beacons
  const sups = [];
  const supEl = () => { const e = mk('smk', `<div class="body"><div class="dia"></div><span class="lbl">Resupply</span><span class="d"></span></div><div class="arrow"><i></i></div>`); return { e, d: e.querySelector('.d'), lbl: e.querySelector('.lbl'), arrow: e.querySelector('.arrow'), last: {} }; };
  const st = { nape: {} };

  const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();
  const setText = (o, key, node, v) => { if (o[key] !== v) { o[key] = v; node.textContent = v; } };
  const setCls = (o, key, node, c, on) => { if (o[key] !== on) { o[key] = on; node.classList.toggle(c, on); } };
  const setOp = (o, node, v) => { if (o.op !== v) { o.op = v; node.style.opacity = v; } };
  const fmtD = (d) => (d < 50 ? Math.round(d) : Math.round(d / 5) * 5) + ' m';

  // screen position of a world point (edge-clamped on an ellipse when off-screen)
  function screen(pos, margin = 0.9) {
    const W = VW, H = VH, cam = ctx.camera;
    _p.copy(pos).project(cam);
    const on = _p.z < 1 && Math.abs(_p.x) < margin && Math.abs(_p.y) < margin;
    if (on) return { x: (_p.x * 0.5 + 0.5) * W, y: (-_p.y * 0.5 + 0.5) * H, on: true, nx: _p.x, ny: _p.y };
    cam.getWorldPosition(_c); cam.getWorldQuaternion(_q);
    _v.copy(pos).sub(_c).applyQuaternion(_q.invert());
    let dx = _v.x, dy = -_v.y; if (Math.hypot(dx, dy) < 1e-3) { dx = 0; dy = 1; }
    const rx = W * 0.44, ry = H * 0.38, t = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
    return { x: W / 2 + dx * t, y: H / 2 + dy * t, on: false, ang: Math.atan2(dy, dx) };
  }
  const placed = [];
  const place = (e, s) => { placed.push({ e, x: s.x, y: s.y, edge: !s.on }); };
  // reserved HUD rects (layout read only on resize / every 2 s, never per frame)
  let rects = [], rectT = 0;
  addEventListener('resize', () => { rectT = 0; });
  function measure(dt) {
    rectT -= dt; if (rectT > 0) return; rectT = 2;
    rects = reservedEls().map((e) => { const r = e.getBoundingClientRect(); return { l: r.left - 12, t: r.top - 12, r: r.right + 12, b: r.bottom + 12 }; }).filter((r) => r.r - r.l > 30);
  }
  function keepOut(p) {
    for (let pass = 0; pass < 2; pass++) for (const r of rects) {
      if (p.x < r.l || p.x > r.r || p.y < r.t || p.y > r.b) continue;
      const opts = [[0, r.b - p.y], [0, r.t - p.y], [r.l - p.x, 0], [r.r - p.x, 0]]
        .filter(([dx, dy]) => { const x = p.x + dx, y = p.y + dy; return x > 16 && x < VW - 16 && y > 16 && y < VH - 16; });
      if (!opts.length) continue;
      opts.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
      p.x += opts[0][0]; p.y += opts[0][1];
    }
  }
  function flush() {
    for (const p of placed) keepOut(p);
    // edge labels: sort by y, keep ≥ 26 px apart when horizontally close so arrows never cover another label
    const edges = placed.filter((p) => p.edge).sort((a, b) => a.y - b.y);
    for (let i = 1; i < edges.length; i++) for (let j = 0; j < i; j++) {
      const a = edges[j], b = edges[i];
      if (Math.abs(a.x - b.x) < 170 && b.y - a.y < 26) b.y = a.y + 26;
    }
    for (const p of placed) p.e.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
    placed.length = 0;
  }

  function hideAll() {
    for (const m of pool) setOp(m.last, m.e, '0');
    for (const w of wps.values()) setOp(w.last, w.e, '0');
    for (const s of sups) setOp(s.last, s.e, '0');
    setOp(st.nape, nape, '0'); setOp(stB, bossMk, '0');
  }

  // declutter: markers near the reticle or over the hero fade to 25%; central / far ones collapse to icon-only
  const pb = { x0: 0, y0: 0, x1: 0, y1: 0, ok: false }, _f = new THREE.Vector3(), _h = new THREE.Vector3();
  function playerBox(P) {
    pb.ok = false;
    _f.copy(P.position).project(ctx.camera); _h.copy(P.position); _h.y += 1.9; _h.project(ctx.camera);
    if (_f.z > 1 || _h.z > 1) return;
    const fx = (_f.x * 0.5 + 0.5) * VW, fy = (-_f.y * 0.5 + 0.5) * VH, hx = (_h.x * 0.5 + 0.5) * VW, hy = (-_h.y * 0.5 + 0.5) * VH;
    const hpx = Math.abs(fy - hy), w = Math.max(24, hpx * 0.6), pad = 14;
    pb.x0 = Math.min(fx, hx) - w / 2 - pad; pb.x1 = Math.max(fx, hx) + w / 2 + pad; pb.y0 = Math.min(fy, hy) - pad; pb.y1 = Math.max(fy, hy) + pad; pb.ok = true;
  }
  const rDist = (s) => Math.hypot(s.x - VW / 2, s.y - VH / 2);
  const crowded = (s) => s.on && (rDist(s) < 60 || (pb.ok && s.x > pb.x0 && s.x < pb.x1 && s.y > pb.y0 && s.y < pb.y1));
  const central = (s) => s.on && rDist(s) < 120;
  const opStr = (v, s) => String(Math.round(v * (crowded(s) ? 0.25 : 1) * 100) / 100);

  function update(dt = 0.016) {
    const P = ctx.player; if (!P?.position) return hideAll();
    measure(dt);
    try { updateInner(P); } finally { flush(); }
  }
  function updateInner(P) {
    const pp = P.position;
    playerBox(P);
    // ---------------- boss weak points
    const C = ctx.colossal, alive = C && C.active !== false && C.object;
    const lockWp = P.lockTarget && !P.lockTarget.titan && P.lockTarget.position ? P.lockTarget : null;
    const bossDist = alive ? Math.hypot(pp.x - C.object.position.x, pp.z - C.object.position.z) : Infinity;
    const far = bossDist > 150;
    // far away: one boss marker (chest height) instead of five weak points crowding the crosshair
    if (alive && far && !lockWp) {
      _v.copy(C.object.position); _v.y += 38;
      const s = screen(_v, 0.92);
      setOp(stB, bossMk, opStr(1, s)); setCls(stB, 'edge', bossMk, 'edge', !s.on); place(bossMk, s);
      if (!s.on) bossArrow.style.transform = `rotate(${s.ang.toFixed(3)}rad) translateX(${(VH * 0.04).toFixed(0)}px)`;
      setText(stB, 'd', bossD, fmtD(bossDist));
    } else setOp(stB, bossMk, '0');
    const list = alive ? (far ? (lockWp ? [lockWp] : []) : C.weakPoints || []) : [];
    const seen = new Set();
    let tgt = null, tgtScore = 0.28;
    const scr = [];
    for (const w of list) {
      if (!w?.position) continue;
      const cut = (w.hp ?? 1) <= 0 && w.name !== 'nape';
      const s = screen(w.position, 0.95);
      scr.push([w, s, cut]);
      if (s.on && w.active && !cut) { const r = Math.hypot(s.nx, s.ny * VH / VW); if (r < tgtScore) { tgtScore = r; tgt = w; } }
    }
    const lock = P.lockTarget && !P.lockTarget.titan && P.lockTarget.position ? P.lockTarget : null;
    if (lock) tgt = lock;
    for (const [w, s, cut] of scr) {
      const m = wpEl(w.name); seen.add(w.name);
      const d = w.position.distanceTo(pp);
      // far away the four limbs + nape collapse into one cluster: shrink with distance, drop inactive ones
      const show = !cut && ((s.on && (w.active || d < 130)) || (!s.on && w.active));
      setOp(m.last, m.e, show ? opStr(w.active ? 1 : 0.6, s) : '0');
      if (!show) continue;
      setCls(m.last, 'ico', m.e, 'ico', central(s));
      setCls(m.last, 'edge', m.e, 'edge', !s.on);
      setCls(m.last, 'off', m.e, 'off', !w.active);
      setCls(m.last, 'tgt', m.e, 'tgt', w === tgt && (d < 110 || w === lock));
      const k = Math.round(THREE.MathUtils.clamp(1.2 - d / 320, 0.55, 1) * 20) / 20;
      if (m.last.k !== k) { m.last.k = k; m.sc.style.transform = `scale(${k})`; }
      setCls(m.last, 'cut', m.e, 'cut', w.name === 'nape' && !!w.active);
      place(m.e, s);
      if (!s.on) m.arrow.style.transform = `rotate(${s.ang.toFixed(3)}rad) translateX(${(VH * 0.035).toFixed(0)}px)`;
      setText(m.last, 'lab', m.lab, `${WP_NAMES[w.name] || w.name} · ${fmtD(d)}`);
      const hp = Math.round(Math.max(0, Math.min(1, w.hp ?? 1)) * 40);
      if (m.last.hp !== hp) { m.last.hp = hp; m.u.style.transform = `scaleY(${hp / 40})`; }
    }
    for (const [n, m] of wps) if (!seen.has(n)) setOp(m.last, m.e, '0');

    // ---------------- small titans
    const near = [];
    for (const t of ctx.titans?.list || []) {
      if (t.alive === false || !t.position) continue;
      const d = t.position.distanceTo(pp); if (d < RANGE) near.push([d, t]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < POOL; i++) {
      const m = pool[i], it = near[i];
      if (!it) { setOp(m.last, m.e, '0'); continue; }
      const [d, t] = it, h = t.height || 8;
      _v.copy(t.nape?.position || t.position); if (!t.nape?.position) _v.y += h; else _v.y += h * 0.14 + 0.8;
      const s = screen(_v);
      const ab = t.variant === 'abnormal';
      setCls(m.last, 'edge', m.e, 'edge', !s.on); setCls(m.last, 'ab', m.e, 'ab', ab); setCls(m.last, 'near', m.e, 'near', d < 40);
      const label = `${ab ? 'Abnormal · ' : ''}${heightClass(h)} m class`;
      if (m.last.label !== label) { m.last.label = label; m.cls.innerHTML = `<em>▲</em> ${label}`; }
      setText(m.last, 'd', m.d, fmtD(d));
      // off-screen arrows only for the close ones (the boss dominates attention)
      const op = s.on ? (d > 110 ? 0 : d > 80 ? 0.6 : 1) : d < 60 ? 1 : 0;
      setOp(m.last, m.e, opStr(op, s));
      setCls(m.last, 'ico', m.e, 'ico', central(s));
      place(m.e, s);
      if (!s.on) m.arrow.style.transform = `rotate(${s.ang.toFixed(3)}rad) translateX(${(VH * 0.035).toFixed(0)}px)`;
    }
    // nape lock-on for small titans
    let target = P.lockTarget?.titan || null;
    if (target && target.alive === false) target = null;
    if (!target) {
      let best = null, bd = 40;
      for (const [, t] of near) { const np = t.nape?.position; if (!np) continue; const d = np.distanceTo(pp); if (d < bd) { _p.copy(np).project(ctx.camera); if (_p.z < 1 && Math.abs(_p.x) < 0.8 && Math.abs(_p.y) < 0.8) { bd = d; best = t; } } }
      target = best;
    }
    const np = target?.nape?.position;
    if (np) {
      const s = screen(np, 1.2), d = np.distanceTo(pp);
      if (s.on) { setOp(st.nape, nape, '1'); place(nape, s); setText(st.nape, 'd', napeD, d < 8 ? 'Strike!' : fmtD(d)); setCls(st.nape, 'strike', nape, 'strike', d < 8); }
      else setOp(st.nape, nape, '0');
    } else setOp(st.nape, nape, '0');

    // ---------------- resupply beacons
    const R = ctx.director?.resupplies || (ctx.director?.resupply ? [ctx.director.resupply] : []);
    const need = (P.gas ?? 1) < 0.3 || ((P.blades?.count ?? 8) <= 1 && (P.blades?.durability ?? 1) < 0.3);
    let nearest = -1, nd = Infinity;
    R.forEach((r, i) => { const d = r.position.distanceTo(pp); if (d < nd) { nd = d; nearest = i; } });
    R.forEach((r, i) => {
      const m = sups[i] || (sups[i] = supEl());
      _v.copy(r.position); _v.y += 4;
      const s = screen(_v, 0.92), d = r.position.distanceTo(pp);
      // guidance only when it matters: gas / blades low -> nearest crate marked, edge arrow when off-screen
      const guide = need && i === nearest;
      setCls(m.last, 'need', m.e, 'need', guide);
      setCls(m.last, 'edge', m.e, 'edge', guide && !s.on);
      const vis = d < 10 ? 0 : guide ? 1 : s.on && d < 60 ? 0.5 : 0;
      setOp(m.last, m.e, opStr(vis, s));
      if (vis === 0) return;
      place(m.e, s);
      if (!s.on) m.arrow.style.transform = `rotate(${s.ang.toFixed(3)}rad) translateX(${(VH * 0.045).toFixed(0)}px)`;
      setText(m.last, 'd', m.d, fmtD(d));
      setText(m.last, 'l', m.lbl, r.label || 'Resupply');
    });
  }
  return { update, hideAll };
}
