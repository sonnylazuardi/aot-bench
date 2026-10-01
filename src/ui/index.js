// HUD / UI — ctx.hud (see CONTRACT.md). DOM lives in ctx.uiRoot.
// Gameplay HUD writes to the DOM only when a displayed value changes; per-frame motion is transform/opacity only.
import * as THREE from 'three';
import './hud.css';
import { buildTitle, buildPause, buildDeath, buildVictory, buildHelp, controlsHTML } from './screens.js';
import { createRadar } from './radar.js';
import { createMarkers, heightClass } from './markers.js';

function injectFonts() {
  if (document.getElementById('aot-fonts')) return;
  const pc = document.createElement('link'); pc.rel = 'preconnect'; pc.href = 'https://fonts.gstatic.com'; pc.crossOrigin = ''; document.head.appendChild(pc);
  const l = document.createElement('link'); l.id = 'aot-fonts'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:ital,wght@0,400;0,500;0,600;1,400&family=Cinzel:wght@700;900&family=Oswald:wght@500;600;700&display=swap';
  document.head.appendChild(l);
}
export const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clamp = THREE.MathUtils.clamp;

export async function create(ctx) {
  injectFonts();
  const root = ctx.uiRoot || document.getElementById('ui');
  root.innerHTML = '';
  const params = ctx.params || {};
  const shotMode = !!params.shot;

  // ---------------------------------------------------------------- layers
  const hudEl = el('div', 'layer aot-hud off');
  const dmg = el('div', 'dmg');
  const speed = el('canvas', 'speed');
  hudEl.append(dmg, speed);

  const obj = el('div', 'obj hid', `<small>Objective</small><b></b><span class="sub"></span>
    <div class="line"><span class="wps"><i></i><i></i><i></i><i></i></span><span class="wpt">0 / 4 tendons severed</span><i class="dotsep"></i><span class="napev">Nape out of reach</span></div>
    <div class="line civ hide"><span class="k">Civilians lost</span><b class="cl">0</b><span class="clT"></span></div>`);
  const wave = el('div', 'wave hid', `<small>Civilians lost</small><b class="cl">0</b><div class="meter"><u></u></div><div class="t">— fleeing to the inner gate</div>`);
  const boss = el('div', 'boss hid', `<div class="hd"><div class="nm"><small>60 m class</small><b>The Colossal Titan</b></div><div class="ph"><span>Phase</span><i></i><i></i><i></i></div></div>
    <div class="bar"><u class="lag"></u><u class="cur"></u><i class="glint"></i><i class="seg" style="left:33.33%"></i><i class="seg" style="left:66.66%"></i></div>
    <div class="ft"><span class="fl"></span><span class="st"></span></div>`);
  const gear = el('div', 'gear', `<div class="hp"><span class="lbl">Vitals</span><div class="hpbar">${'<i></i>'.repeat(10)}</div></div>
    <div class="row">
      <div class="can L"><div class="valve"></div><div class="shell"><div class="fill"></div></div><i class="tick" style="top:25%"></i><i class="tick" style="top:50%"></i><i class="tick" style="top:75%"></i></div>
      <div class="blades"><div class="set">${'<i></i>'.repeat(8)}</div><div class="dur"><u></u></div></div>
      <div class="can R"><div class="valve"></div><div class="shell"><div class="fill"></div></div><i class="tick" style="top:25%"></i><i class="tick" style="top:50%"></i><i class="tick" style="top:75%"></i></div>
    </div>
    <div class="gasrow"><span>Gas<b class="gp">100%</b></span><span>Blades<b class="bc">8/8</b></span><span>Edge<b class="bd">100%</b></span></div>`);
  const warns = el('div', 'warns');
  const xh = el('div', 'xh', `<i class="dot"></i><i class="tk"></i><i class="tk"></i><i class="tk"></i><i class="tk"></i><i class="ring"></i><i class="hmk"></i><i class="hk L"></i><i class="hk R"></i><span class="dist"></span>`);
  const kill = el('div', 'kill', `<div class="t">Titan Slain</div><div class="s">Nape strike</div><div class="streak"></div>`);
  const qte = el('div', 'qte', `<div class="key"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="5"/><circle class="pr" cx="50" cy="50" r="46" fill="none" stroke="#c4262e" stroke-width="5" stroke-dasharray="289" stroke-dashoffset="289"/></svg><b>F</b></div><div class="t">Mash F</div><div class="s">Cut yourself free</div>`);
  const engage = el('div', 'engage hide', 'Click to engage');
  const toasts = el('div', 'toasts');
  const shock = el('div', 'shock'), steamov = el('div', 'steamov', '<i class="sh"></i>');
  hudEl.append(steamov, obj, boss, gear, warns, xh, kill, qte, engage, shock);

  const radar = createRadar(ctx, hudEl);
  // HUD panels markers must stay out of (boss bar, objective, gear cluster, radar)
  const markers = createMarkers(ctx, hudEl, () => [boss, obj, gear, radar.el].filter((e) => e && !e.classList.contains('hid')));

  const banner = el('div', 'banner', `<div class="cap"></div><div class="big"></div><div class="sub"></div>`);
  const cine = el('div', 'layer'); const lbT = el('div', 'lbx t'), lbB = el('div', 'lbx b'); cine.append(lbT, lbB);
  const subs = el('div', 'subs', '<p></p>');
  const help = buildHelp(ctx); help.classList.add('hide');
  const pause = buildPause(ctx);
  const death = buildDeath(ctx);
  const victory = buildVictory(ctx);
  const title = buildTitle(ctx);
  const flash = el('div', 'flash');
  const fadeEl = el('div', 'fade');
  const skip = el('div', 'skiphint', '<span class="key">Space</span> Hold to skip');
  skip.style.opacity = '0';
  root.append(hudEl, toasts, banner, cine, subs, skip, help, pause.el, death.el, victory.el, title.el, flash, fadeEl);

  // ---------------------------------------------------------------- speed-line texture (drawn once per resize)
  function drawSpeed() {
    const w = Math.round(innerWidth * 0.6), h = Math.round(innerHeight * 0.6); speed.width = w; speed.height = h;
    const g = speed.getContext('2d'); g.clearRect(0, 0, w, h); g.translate(w / 2, h / 2);
    const R = Math.hypot(w, h) / 2;
    for (let i = 0; i < 150; i++) {
      const a = Math.random() * Math.PI * 2, r0 = R * (0.42 + Math.random() * 0.3), r1 = R * (0.8 + Math.random() * 0.35), wd = 0.4 + Math.random() * 1.6;
      const gr = g.createLinearGradient(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1);
      gr.addColorStop(0, 'rgba(255,250,240,0)'); gr.addColorStop(1, `rgba(255,250,240,${0.18 + Math.random() * 0.4})`);
      g.strokeStyle = gr; g.lineWidth = wd; g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke();
    }
  }
  drawSpeed(); addEventListener('resize', drawSpeed);

  // ---------------------------------------------------------------- cached element refs
  const q = (p, s) => p.querySelector(s);
  const R = {
    objT: q(obj, 'b'), objS: q(obj, '.sub'), rows: q(obj, '.rows'), wps: [...obj.querySelectorAll('.wps i')], wpt: q(obj, '.wpt'), napev: q(obj, '.napev'),
    cl: q(obj, '.cl'), clT: q(obj, '.clT'), civLine: q(obj, '.civ'),
    bBar: q(boss, '.bar'), bLag: q(boss, '.lag'), bCur: q(boss, '.cur'), bPh: [...boss.querySelectorAll('.ph i')], bFl: q(boss, '.fl'), bSt: q(boss, '.st'),
    hpI: [...gear.querySelectorAll('.hpbar i')], canL: q(gear, '.can.L .fill'), canR: q(gear, '.can.R .fill'), gp: q(gear, '.gp'),
    bl: [...gear.querySelectorAll('.set i')], bc: q(gear, '.bc'), bd: q(gear, '.bd'), dur: q(gear, '.dur'), durU: q(gear, '.dur u'),
    hkL: q(xh, '.hk.L'), hkR: q(xh, '.hk.R'), xdist: q(xh, '.dist'), killT: q(kill, '.t'), killS: q(kill, '.s'), killK: q(kill, '.streak'),
    qpr: q(qte, '.pr'), qkey: q(qte, '.key'), qT: q(qte, '.t'), bCap: q(banner, '.cap'), bBig: q(banner, '.big'), bSub: q(banner, '.sub'), subP: q(subs, 'p'),
  };
  const last = {};   // last written values
  const set = (key, v, fn) => { if (last[key] !== v) { last[key] = v; fn(v); } };
  const cls = (e, c, on, key) => set(key || (c + (e.className.split(' ')[0])), !!on, () => e.classList.toggle(c, !!on));

  // ---------------------------------------------------------------- state
  let steamCueT = 0, subOpenT = 0, gearActiveT = 3, hmT = 0, visible = true, hurt = 0, streak = 0, streakT = 0, killPopT = 0, qteHits = 0, qteHitT = 0, subT = 0, helpOn = false;
  const warnEls = {};
  function setWarn(id, text, on, blink = true) {
    let w = warnEls[id];
    if (on && !w) { w = warnEls[id] = el('div', 'warn' + (blink ? ' blink' : ''), text); warns.appendChild(w); }
    else if (!on && w) { w.remove(); delete warnEls[id]; }
    else if (on && w && w.textContent !== text) w.textContent = text;
  }

  // ---------------------------------------------------------------- API
  const hud = {
    el: root,
    showTitle() { title.show(); },
    hideTitle() { title.hide(); },
    // progressive disclosure: the body text shows for ~6 s whenever the objective changes, then collapses
    objective(t, sub) { R.objT.textContent = t || ''; R.objS.textContent = sub || ''; obj.classList.toggle('hid', !t); obj.classList.toggle('open', !!sub); subOpenT = sub ? 6.5 : 0; },
    banner(text, sub = '', opts = {}) {
      R.bCap.textContent = opts.cap || 'Shiganshina District'; R.bCap.style.display = opts.cap === '' ? 'none' : '';
      R.bBig.textContent = text || ''; R.bSub.textContent = sub || '';
      // restart the animation without a forced synchronous layout
      banner.classList.remove('go'); requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('go')));
    },
    subtitle(text, secs) {
      if (!text) { subs.classList.remove('on'); subT = 0; return; }
      const m = /^([A-Z][\w .'-]{0,24}):\s*(.*)$/s.exec(text);
      R.subP.innerHTML = m ? `<b>${esc(m[1])}</b>${fmtSub(m[2])}` : fmtSub(text);
      subs.classList.add('on');
      subT = secs ?? clamp(1.4 + text.split(/\s+/).length * 0.32, 2, 8);
    },
    toast(text, kind = '') {
      const t = el('div', 'toast ' + kind, esc(text)); toasts.appendChild(t);
      while (toasts.children.length > 4) toasts.firstChild.remove();
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, 4200);
    },
    showDeath(info) { death.show(info); },
    hideDeath() { death.hide(); },
    showVictory(stats) { victory.show(stats); },
    hideVictory() { victory.hide(); },
    showPause(stats) { pause.show(stats); },
    hidePause() { pause.hide(); },
    letterbox(on) { cine.classList.toggle('lbx-on', !!on); },
    fade(toBlack, secs = 1) {
      fadeEl.style.transitionDuration = secs + 's'; void fadeEl.offsetWidth; fadeEl.style.opacity = toBlack ? '1' : '0';
      return new Promise((r) => setTimeout(r, secs * 1000));
    },
    flash(k = 0.85) { flash.style.setProperty('--fk', k); flash.style.animationName = 'none'; void flash.offsetWidth; flash.style.animationName = ''; flash.classList.add('go'); },
    skipHint(on) { skip.style.opacity = on ? '1' : '0'; },
    setVisible(b) { visible = !!b; },
    toggleHelp(on = !helpOn) { helpOn = on; help.classList.toggle('hide', !on); },
    killPop(titan, n = 1, o = {}) {
      R.killT.textContent = o.title || (n >= 3 ? ['Titan Slain', 'Double Kill', 'Triple Kill', 'Massacre', 'Humanity\'s Strongest'][Math.min(4, n - 1)] : n === 2 ? 'Double Kill' : 'Titan Slain');
      const hc = titan?.height ? `${heightClass(titan.height)} m class` : 'Nape strike';
      R.killS.textContent = o.sub || ((titan?.variant === 'abnormal' ? 'Abnormal · ' : '') + hc);
      R.killK.textContent = !o.title && n > 1 ? `×${n} streak` : '';
      kill.classList.remove('go'); void kill.offsetWidth; kill.classList.add('go'); killPopT = 2.2;
    },
    get streak() { return streak; },
    title, radar, markers,
  };

  // ---------------------------------------------------------------- events
  const E = ctx.events;
  E.on('player:hurt', (p) => { hurt = Math.min(1.2, hurt + 0.55 + (p?.amount || 0) * 1.5); });
  E.on('titan:killed', (p) => {
    if (!p?.byPlayer) return;
    streak = streakT > 0 ? streak + 1 : 1; streakT = 7;
    hud.killPop(p.titan, streak);
  });
  E.on('player:grabbed', () => { qteHits = 0; });
  let civLost = 0;
  E.on('civilian:eaten', () => { civLost++; });
  E.on('colossal:attack', (p) => {
    const ty = String(p?.type || '').toLowerCase();
    const near = p?.point?.isVector3 && ctx.player?.position ? p.point.distanceTo(ctx.player.position) : 999;
    if (/roar|shock|howl|scream/.test(ty) || (/slam|stomp|quake/.test(ty) && near < 110)) {
      shock.classList.remove('go'); void shock.offsetWidth; shock.classList.add('go'); hud.flash(/roar|howl/.test(ty) ? 0.4 : 0.18);
    }
  });
  E.on('colossal:attack', (p) => { if (/steam|vent|blast/.test(String(p?.type || '').toLowerCase())) steamCueT = 3.2; });
  const PART = { hand_L: 'Left hand', hand_R: 'Right hand', ankle_L: 'Left ankle', ankle_R: 'Right ankle', nape: 'Nape' };
  E.on('colossal:hurt', (p) => {
    hmT = 0.22;
    if ((p?.hp ?? 1) <= 0 && p?.part !== 'nape') hud.killPop(null, 1, { title: 'Tendon Severed', sub: PART[p.part] || p.part });
    else if (p?.part === 'nape') hud.killPop(null, 1, { title: 'Nape Wounded', sub: 'Strike again' });
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyH' && (ctx.mode === 'play' || ctx.mode === 'paused') && !e.repeat) hud.toggleHelp();
    if (e.code === 'KeyF' && ctx.player?.state === 'grabbed') { qteHits++; qteHitT = 0.08; }
  });

  // ---------------------------------------------------------------- per-frame
  const _v = new THREE.Vector3();
  function update(dt, time, rawDt) {
    const dtu = rawDt || dt || 0.016;
    const mode = ctx.mode, P = ctx.player, D = ctx.director;
    const playing = (mode === 'play' || mode === 'dead') && visible && ctx.cameraOwner !== 'intro';
    cls(hudEl, 'off', !playing, 'hudoff');
    title.update?.(dtu);
    if (subT > 0) { subT -= dtu; if (subT <= 0) subs.classList.remove('on'); }
    streakT -= dtu; if (streakT <= 0) streak = 0;
    if (killPopT > 0) killPopT -= dtu;
    if (!playing || !P) { markers.hideAll(); return; }

    // vitals / gas / blades
    const hp = clamp(P.hp ?? 1, 0, 1);
    set('hp', Math.ceil(hp * 10 - 0.001), (n) => R.hpI.forEach((e, i) => e.classList.toggle('off', i >= n)));
    cls(gear, 'lowhp', hp < 0.3, 'lowhp');
    const gasL = clamp(P.gasL ?? P.gas ?? 1, 0, 1), gasR = clamp(P.gasR ?? P.gas ?? 1, 0, 1), gas = clamp(P.gas ?? (gasL + gasR) / 2, 0, 1);
    set('gasL', Math.round(gasL * 200), (v) => { R.canL.style.transform = `scaleY(${v / 200})`; });
    set('gasR', Math.round(gasR * 200), (v) => { R.canR.style.transform = `scaleY(${v / 200})`; });
    set('gp', Math.round(gas * 100), (v) => { R.gp.textContent = v + '%'; });
    cls(gear, 'lowgas', gas < 0.2, 'lowgas');
    const bc = clamp(Math.round(P.blades?.count ?? 8), 0, 8), bd = clamp(P.blades?.durability ?? 1, 0, 1);
    set('bc', bc, (n) => { R.bc.textContent = `${n}/8`; R.bl.forEach((e, i) => { e.classList.toggle('used', i >= n); e.classList.toggle('cur', i === n - 1); }); });
    set('bd', Math.round(bd * 100), (v) => { R.durU.style.transform = `scaleX(${v / 100})`; R.bd.textContent = v + '%'; });
    cls(R.dur, 'dull', bd < 0.25, 'dull');

    // gear cluster fades back when everything is fine and unchanged; any change / low value brings it back
    const gsig = `${Math.round(gas * 50)}|${bc}|${Math.round(bd * 50)}|${Math.ceil(hp * 10)}`;
    if (gsig !== last.gsig) { last.gsig = gsig; gearActiveT = 3; }
    gearActiveT -= dtu;
    const fine = gas > 0.95 && hp > 0.9 && bc >= 1 && bd > 0.4;
    cls(gear, 'idle', fine && gearActiveT <= 0, 'gidle');
    if (subOpenT > 0) { subOpenT -= dtu; if (subOpenT <= 0) obj.classList.remove('open'); }

    // warnings
    const swapKey = P.controls?.swapKey || 'R';
    setWarn('gas', gas <= 0.01 ? 'Gas depleted — resupply at the church' : 'Gas low', gas < 0.2 && mode === 'play');
    setWarn('blade', bc <= 0 && bd <= 0.01 ? 'No blades — resupply at the church' : `Blades dull · ${swapKey} to swap`, mode === 'play' && ((bd < 0.18 && bc > 1) || (bc <= 0 && bd <= 0.01) || (bc <= 1 && bd <= 0.01)));

    // crosshair
    const ah = P.aimHit, hitOk = !!ah && (ah.valid ?? true) && (ah.inRange ?? true);
    cls(xh, 'hit', hitOk, 'xhit');
    cls(xh, 'titan', hitOk && (ah.titan || ah.kind === 'titan' || ah.kind === 'colossal'), 'xtitan');
    if (hitOk) set('xd', Math.round(ah.distance ?? 0), (v) => { R.xdist.textContent = v + ' m'; });
    hmT -= dtu; set('hm', hmT > 0, (v) => xh.classList.toggle('hm', v));
    const hooks = P.hooks || [];
    for (const side of ['L', 'R']) {
      const hk = hooks.find((h) => h.side === side); const e = side === 'L' ? R.hkL : R.hkR;
      cls(e, 'on', hk?.attached, 'hk' + side + 'on'); cls(e, 'fly', hk?.active && !hk?.attached, 'hk' + side + 'fly');
    }

    // damage vignette + speed lines
    hurt = Math.max(0, hurt - dtu * 1.6);
    const lowHp = hp < 0.45 ? (0.45 - hp) / 0.45 * (0.55 + 0.12 * Math.sin(time * 6)) : 0;
    set('dmg', Math.round(clamp(Math.max(hurt * 0.85, lowHp, mode === 'dead' ? 0.9 : 0), 0, 1) * 50), (v) => { dmg.style.opacity = v / 50; });
    const spd = P.velocity ? P.velocity.length() : 0;
    const so = clamp((spd - 30) / 25, 0, 0.4);
    if (so > 0.01) { speed.style.opacity = so.toFixed(2); speed.style.transform = `rotate(${(Math.random() * 6).toFixed(1)}deg) scale(${(1 + Math.random() * 0.04).toFixed(3)})`; last.so = 1; }
    else if (last.so) { speed.style.opacity = '0'; last.so = 0; }

    // grab QTE
    const grabbed = P.state === 'grabbed';
    cls(qte, 'on', grabbed, 'qte');
    if (grabbed) {
      const prog = clamp(P.grabProgress ?? P.grabEscape ?? qteHits / 5, 0, 1);
      set('qpr', Math.round(prog * 100), (v) => { R.qpr.setAttribute('stroke-dashoffset', String(289 * (1 - v / 100))); });
      qteHitT -= dtu; cls(R.qkey, 'hit', qteHitT > 0, 'qkeyhit');
    }
    cls(engage, 'hide', !(mode === 'play' && !ctx.input.locked && !shotMode && !grabbed), 'engage');

    // boss bar + objective rows (read straight from the boss)
    const C = ctx.colossal, fighting = !!(C && C.active !== false && (C.state === 'fight' || C.fighting || D?.fight));
    cls(boss, 'hid', !fighting, 'bosshid');
    if (fighting) {
      const bhp = clamp(C.hp ?? 1, 0, 1);
      const prevB = last.bhp;
      set('bhp', Math.round(bhp * 400), (v) => {
        R.bCur.style.transform = `scaleX(${v / 400})`; R.bLag.style.transform = `scaleX(${v / 400})`;
        if (prevB != null && v < prevB - 2) R.bBar.animate?.([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(-2px)' }, { transform: 'none' }], { duration: 250 });
      });
      const ph = clamp(C.phase | 0 || 1, 1, 3);
      set('bph', ph, (v) => R.bPh.forEach((e, i) => { e.classList.toggle('on', i === v - 1); e.classList.toggle('done', i < v - 1); }));
      const wp = C.weakPoints || [];
      const limbs = wp.filter((w) => w.name !== 'nape'), cut = limbs.filter((w) => (w.hp ?? 1) <= 0).length;
      const sig = limbs.map((w) => ((w.hp ?? 1) <= 0 ? 'c' : w.active ? 'a' : '-')).join('');
      set('wps', sig, () => { R.wps.forEach((e, i) => { const w = limbs[i]; e.style.display = w ? '' : 'none'; e.classList.toggle('cut', !!w && (w.hp ?? 1) <= 0); e.classList.toggle('act', !!w && w.active && (w.hp ?? 1) > 0); }); R.wpt.textContent = `${cut} / ${limbs.length || 4} tendons severed`; });
      const nape = wp.find((w) => w.name === 'nape');
      const napeState = !nape ? 'Nape out of reach' : nape.active ? 'Nape exposed — strike!' : C.steaming ? 'Nape shielded by steam' : 'Nape armoured';
      set('napev', napeState, (v) => { R.napev.textContent = v; R.napev.classList.toggle('exp', !!nape?.active); });
      set('bfl', `${cut}/${limbs.length || 4}`, () => { R.bFl.innerHTML = `Tendons severed <b>${cut} / ${limbs.length || 4}</b>`; });
      const st = C.steaming ? 'Steam burst' : C.state === 'stunned' || C.stunned ? 'Staggered' : C.enraged || ph === 3 ? 'Berserk' : '';
      set('bst', st, (v) => { R.bSt.textContent = v; });
      // steam-blast warning: telegraph (C.steamWarn, if the boss exposes one), active venting, or a just-emitted steam attack
      steamCueT -= dtu;
      const warnK = Math.max(clamp(C.steamWarn ?? 0, 0, 1), C.steaming ? 1 : 0, steamCueT > 0 ? 1 : 0);
      setWarn('steam', C.steaming || steamCueT > 0 ? 'Steam blast — get clear!' : 'Steam building — get clear', warnK > 0.05 && mode === 'play');
      let near = 999; if (C.object && P.position) near = Math.hypot(P.position.x - C.object.position.x, P.position.z - C.object.position.z);
      set('steamov', warnK > 0.05 ? Math.round(clamp(1.25 - near / 160, 0.35, 1) * warnK * 20) : 0, (v) => { steamov.style.opacity = v / 20; steamov.classList.toggle('on', v > 0); });
    } else setWarn('steam', '', false);
    // civilians
    const civ = ctx.titans?.civilians;
    let dead = 0, alive = null;
    if (Array.isArray(civ?.list)) { alive = 0; for (const c of civ.list) { if (c.alive === false) dead++; else if (c.state !== 'safe') alive++; } }
    const lost = Math.max(civLost, dead, D?.civiliansLost | 0);
    const showCiv = fighting && (civ || lost > 0);
    cls(R.civLine, 'hide', !showCiv, 'civhid');
    if (showCiv) {
      set('civ', lost, (v) => { R.cl.textContent = v; });
      set('civA', alive, (v) => { R.clT.textContent = v == null ? '' : `· ${v} fleeing`; });
    }

    markers.update(dtu, time);
    radar.update(dtu);
  }
  hud.update = update;

  // defaults so the panels read well before the director sets them
  hud.objective('', '');
  return hud;
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtSub(s) { return esc(s).replace(/\*(.+?)\*/g, '<i>$1</i>'); }
export { controlsHTML };
