// Full-screen UI: title, pause, death, victory, controls overlay.
// Buttons emit ctx.events 'ui:*' — the director owns what happens (mode transitions).
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export const DEFAULT_CONTROLS = [
  [['W', 'A', 'S', 'D'], 'Run · steer in the air'],
  [['Mouse'], 'Aim (click to capture the cursor)'],
  [['LMB', 'Q'], '<b>Left anchor</b> — hold to stay hooked'],
  [['RMB', 'E'], '<b>Right anchor</b> — hold to stay hooked'],
  [['Space'], '<b>Gas</b> — reel to the anchors, boost along your aim'],
  [['Shift'], 'Strong reel · sprint'],
  [['F', 'MMB'], '<b>Spinning slash</b> · mash to cut free when grabbed'],
  [['R'], 'Swap blades'],
  [['Tab', 'C'], 'Lock on to a weak point (toggle / hold)'],
  [['H'], 'Show these controls'],
  [['Esc'], 'Pause'],
];
export function controlsHTML(ctx, heading = 'Controls') {
  const list = ctx.player?.controls?.list || DEFAULT_CONTROLS;
  return `<h3>${heading}</h3>` + list.map(([keys, label]) => `<div class="r"><span class="ks">${keys.map((k) => `<span class="key">${k}</span>`).join('')}</span><span>${label}</span></div>`).join('') +
    `<div class="note">Only a deep cut to the nape — one metre long, ten centimetres deep — kills a titan. Anchor, swing past, and strike at speed.</div>`;
}

function grainURL() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const d = g.createImageData(256, 256);
  for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0); return c.toDataURL();
}

const QUALS = ['low', 'medium', 'high'];
function qualityButton(ctx) {
  const b = el('button', 'btn ia', `<span>Quality</span><span class="val"><i class="ql">‹</i><span class="qv"></span><i class="qr">›</i></span>`);
  const cur = ctx.quality?.level || localStorage.getItem('aot.quality') || 'high';
  let sel = cur;
  const paint = () => { b.querySelector('.qv').textContent = sel === cur ? sel.toUpperCase() : `${sel.toUpperCase()} · apply`; };
  paint();
  b.addEventListener('click', (e) => {
    const r = b.getBoundingClientRect(); const x = e.clientX - r.left;
    if (sel !== cur && x > r.width * 0.55 && e.target.closest('.qv')) { try { localStorage.setItem('aot.quality', sel); } catch {} const u = new URL(location.href); u.searchParams.delete('q'); location.href = u.toString(); return; }
    const i = QUALS.indexOf(sel); sel = QUALS[(i + (e.target.classList.contains('ql') ? 2 : 1)) % 3]; paint();
    ctx.audio?.play?.('ui_tick');
  });
  b.cycle = (d) => { const i = QUALS.indexOf(sel); sel = QUALS[(i + d + 3) % 3]; paint(); };
  b.apply = () => { if (sel !== cur) { try { localStorage.setItem('aot.quality', sel); } catch {} const u = new URL(location.href); u.searchParams.delete('q'); location.href = u.toString(); } };
  return b;
}

function menuNav(container, isActive) {
  addEventListener('keydown', (e) => {
    if (!isActive()) return;
    const items = [...container.querySelectorAll('.btn')];
    let i = items.findIndex((b) => b.classList.contains('sel'));
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { i = (i + 1) % items.length; }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { i = (i - 1 + items.length) % items.length; }
    else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && items[i]?.cycle) { items[i].cycle(e.code === 'ArrowLeft' ? -1 : 1); return; }
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') { if (i >= 0) { items[i].apply ? items[i].apply() : items[i].click(); } e.preventDefault(); return; }
    else return;
    items.forEach((b, j) => b.classList.toggle('sel', j === i));
  });
  container.addEventListener('mouseover', (e) => { const b = e.target.closest('.btn'); if (!b || b.classList.contains('sel')) return; container.querySelectorAll('.btn').forEach((x) => x.classList.toggle('sel', x === b)); });
}

// ================================================================ TITLE
export function buildTitle(ctx) {
  const E = ctx.events, shot = !!ctx.params?.shot;
  const root = el('div', 'title out');
  const ash = el('div', 'ash');
  for (let i = 0; i < 34; i++) {
    const s = el('i'); const big = Math.random() < 0.25;
    s.style.cssText = `left:${(Math.random() * 100).toFixed(1)}%;--dx:${(Math.random() * 30 - 8).toFixed(0)}vw;animation-duration:${(9 + Math.random() * 12).toFixed(1)}s;animation-delay:${(-Math.random() * 20).toFixed(1)}s;${big ? 'width:4px;height:4px;' : ''}opacity:0`;
    ash.appendChild(s);
  }
  const grain = el('div', 'grain'); grain.style.backgroundImage = `url(${grainURL()})`;
  root.append(el('div', 'shade'), ash, grain);
  root.appendChild(el('div', 'top', `<span>Year 845 · Wall Maria · Shiganshina District</span><span>Unofficial fan tribute</span>`));
  const block = el('div', 'block', `
    <div class="pre">The day humanity remembered</div>
    <h1><span>Attack</span><span class="on">on</span><span>Titan</span></h1>
    <div class="subt"><i></i>The Fall of Shiganshina</div>`);
  const menu = el('div', 'menu');
  const bBegin = el('button', 'btn primary ia sel', `<span class="n">01</span><span>Begin</span>`);
  const bCtl = el('button', 'btn ia', `<span class="n">02</span><span>Controls</span>`);
  const bQ = qualityButton(ctx); bQ.insertAdjacentHTML('afterbegin', '<span class="n">03</span>');
  const bFs = el('button', 'btn ia', `<span class="n">04</span><span>Fullscreen</span>`);
  menu.append(bBegin, bCtl, bQ, bFs);
  const press = el('div', 'loading', 'Press any key');
  block.append(menu, press);
  root.appendChild(block);
  const panel = el('div', 'panel', `<div class="ctl">${controlsHTML(ctx)}</div>`);
  root.appendChild(panel);
  root.appendChild(el('div', 'hint', `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/></svg>Headphones recommended`));
  root.appendChild(el('div', 'disc', 'An unofficial, non-commercial fan project. <i>Attack on Titan</i> © Hajime Isayama / Kodansha — not affiliated with or endorsed by the rights holders. Every model, texture, sound and note of music here is generated procedurally in your browser.'));

  // "press any key" gate (browsers need a gesture before audio can start); skipped for screenshots
  let gated = !shot, active = false;
  const openGate = () => {
    if (!gated || !active) return; gated = false;
    ctx.audio?.unlock?.(); ctx.audio?.play?.('ui_confirm', { volume: 0.7 });
    press.style.display = 'none'; menu.style.display = '';
  };
  const paintGate = () => { menu.style.display = gated ? 'none' : ''; press.style.display = gated ? '' : 'none'; };
  paintGate();
  addEventListener('keydown', (e) => { if (gated && active) { e.preventDefault(); openGate(); } }, true);
  root.addEventListener('pointerdown', () => { if (gated) openGate(); });

  bBegin.addEventListener('click', () => { if (!active) return; ctx.audio?.unlock?.(); ctx.audio?.play?.('ui_confirm'); ctx.input?.requestLock?.(); E.emit('ui:begin'); });
  bBegin.apply = () => { if (!active) return; ctx.audio?.unlock?.(); ctx.audio?.play?.('ui_confirm'); ctx.input?.requestLock?.(); E.emit('ui:begin'); };
  bCtl.addEventListener('click', () => { panel.classList.toggle('on'); ctx.audio?.play?.('ui_tick'); });
  bFs.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {}); });
  menu.addEventListener('mouseover', (e) => { const b = e.target.closest('.btn'); if (b && b !== menu._last) { menu._last = b; ctx.audio?.play?.('ui_tick'); } });
  menuNav(menu, () => active && !gated);

  return {
    el: root,
    show() { active = true; root.classList.remove('out'); paintGate(); },
    hide() { active = false; root.classList.add('out'); panel.classList.remove('on'); },
    get active() { return active; },
  };
}

// ================================================================ PAUSE
const TIPS = [
  'A titan can only be killed by a deep cut to the nape of the neck — about one metre long and ten centimetres deep.',
  'Speed is damage. Swing past and strike on the way through — a slow cut barely scratches the skin.',
  'Cut the tendons in its hands and ankles. Without them it cannot hold the wall — or stand.',
  'When its skin starts to boil, get clear. The steam will blow you out of the sky.',
  'Gas is life. Crates on the church roof and on the wall walkway refill your canisters and replace every blade.',
  'Anchor to its body and you ride its every move. Its hands are faster than they look.',
  'It is drawn to people. Every townsperson it catches buys you a moment — and costs a life.',
];
export function buildPause(ctx) {
  const E = ctx.events;
  const root = el('div', 'pause hid');
  root.appendChild(el('div', 'veil'));
  const col = el('div', 'col', `<div class="kick">Shiganshina · Year 845</div><h2>Paused</h2>`);
  const menu = el('div', 'menu'); menu.style.cssText = 'display:flex;flex-direction:column;gap:2px;isolation:isolate';
  const bRes = el('button', 'btn ia sel', 'Resume');
  const bCtl = el('button', 'btn ia', 'Controls');
  const bQ = qualityButton(ctx);
  const bRe = el('button', 'btn ia', 'Restart mission');
  const bQuit = el('button', 'btn ia', 'Quit to title');
  menu.append(bRes, bCtl, bQ, bRe, bQuit); col.appendChild(menu); root.appendChild(col);
  const side = el('div', 'side'); const stats = el('div', 'stats'); const ctl = el('div', 'ctl ctlwrap'); ctl.innerHTML = controlsHTML(ctx); ctl.style.display = 'none';
  side.append(stats, ctl); root.appendChild(side);
  const tip = el('div', 'tip'); root.appendChild(tip);
  let open = false;
  bRes.addEventListener('click', () => E.emit('ui:resume'));
  bCtl.addEventListener('click', () => { const on = ctl.style.display === 'none'; ctl.style.display = on ? '' : 'none'; stats.style.display = on ? 'none' : ''; });
  bRe.addEventListener('click', () => E.emit('ui:restart'));
  bQuit.addEventListener('click', () => E.emit('ui:quit'));
  menu.addEventListener('mouseover', (e) => { const b = e.target.closest('.btn'); if (b && b !== menu._last) { menu._last = b; ctx.audio?.play?.('ui_tick'); } });
  menuNav(menu, () => open);
  return {
    el: root,
    show(s = {}) {
      open = true; root.classList.remove('hid'); ctl.style.display = 'none'; stats.style.display = '';
      const items = s.items || [['Titans slain', s.kills ?? 0], ['Deaths', s.deaths ?? 0]];
      stats.innerHTML = `<h3>The fight</h3>` + items.map(([k, v]) => `<div class="r">${k}<b>${v}</b></div>`).join('');
      tip.innerHTML = `<b>Survey note</b><span>${TIPS[Math.floor(Math.random() * TIPS.length)]}</span>`;
    },
    hide() { open = false; root.classList.add('hid'); },
  };
}
export const fmtT = (s) => { s = Math.max(0, Math.round(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

// ================================================================ DEATH
const EPI = [
  'The titan never even looked at you. It simply ate.',
  'Your blades were still in their scabbards.',
  'Somewhere below, the bell kept ringing.',
  'No one saw you fall. The district is too loud with screaming.',
];
export function buildDeath(ctx) {
  const root = el('div', 'death');
  root.appendChild(el('div', 'veil'));
  const c = el('div', 'c', `<div class="k">Soldier lost</div><h2>Devoured</h2><div class="line"></div><p></p><div class="re">Redeploying <u></u></div><div class="st"></div>`);
  root.appendChild(c);
  const p = c.querySelector('p'), st = c.querySelector('.st'), h2 = c.querySelector('h2');
  return {
    el: root,
    show(info = {}) {
      h2.textContent = info.title || 'Devoured';
      p.textContent = info.line || EPI[Math.floor(Math.random() * EPI.length)];
      st.textContent = info.stats || '';
      root.classList.remove('on'); void root.offsetWidth; root.classList.add('on');
    },
    hide() { root.classList.remove('on'); },
  };
}

// ================================================================ VICTORY
export function buildVictory(ctx) {
  const E = ctx.events;
  const root = el('div', 'victory');
  root.appendChild(el('div', 'veil'));
  const c = el('div', 'c', `<div class="k">Humanity's first victory</div><h2>The Titan<br>Falls</h2>
    <p>Shiganshina still burns and the breach still gapes — but the smiling giant is dead, and the people in the boats will remember who held the wall.</p><div class="grid"></div>`);
  const acts = el('div', 'acts');
  const bCont = el('button', 'btn ia sel', 'Play again');
  const bTitle = el('button', 'btn ia', 'Return to title');
  acts.append(bCont, bTitle); c.appendChild(acts); root.appendChild(c);
  bCont.addEventListener('click', () => E.emit('ui:continue'));
  bTitle.addEventListener('click', () => E.emit('ui:quit'));
  let open = false; menuNav(acts, () => open);
  const grid = c.querySelector('.grid');
  return {
    el: root,
    show(s = {}) {
      open = true;
      const rank = s.rank || 'B';
      const items = s.items || [['Time', fmtT(s.time ?? 0)], ['Titans slain', s.kills ?? 0]];
      grid.innerHTML = items.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('') + `<div class="rank"><small>Rank</small><b>${rank}</b></div>`;
      root.classList.remove('on'); void root.offsetWidth; root.classList.add('on');
    },
    hide() { open = false; root.classList.remove('on'); },
  };
}

// ================================================================ HELP OVERLAY (H)
export function buildHelp(ctx) {
  const root = el('div', 'helpov', `<div class="ctl">${controlsHTML(ctx)}</div>`);
  root.refresh = () => { root.innerHTML = `<div class="ctl">${controlsHTML(ctx)}</div>`; };
  return root;
}
