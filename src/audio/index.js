// AUDIO — 100% procedural WebAudio. ctx.audio (see CONTRACT.md).
//   sounds.js/sfx_*.js : every sound designed as a WebAudio graph, rendered offline at load (background)
//   mixer.js           : master chain, reverbs, wall echo, LFE, HRTF voices, loops, wind engine
//   score.js           : the adaptive film score
//   index.js (here)    : public API, remapping of generic calls to the giant's signature sounds, event-driven
//                        fallbacks (so the soundscape is complete even if a system forgets), boss/ambience director.
import * as THREE from 'three';
import { SOUNDS, renderSound } from './sounds.js';
import { initPools } from './kit.js';
import { Mixer, MIX } from './mixer.js';
import { Score } from './score.js';

// render order: what the first seconds need first; long cinematic beds last
const ORDER = ['ui_tick', 'ui_confirm', 'taiko', 'taiko_hi', 'rim', 'gran', 'odaiko', 'swell', 'impact', 'wind',
  'thunder', 'transform', 'giant_step', 'giant_roar', 'wall_crush', 'wall_break', 'boom', 'bell', 'scream', 'giant_grab', 'steam_blast', 'giant_breath', 'rubble',
  'hook_fire', 'hook_hit_stone', 'hook_hit_wood', 'hook_hit_flesh', 'gas', 'slash', 'reel', 'nape_kill', 'body_hit', 'blade_swap', 'blade_break', 'gas_empty', 'grab', 'heartbeat',
  'giant_groan', 'giant_hurt', 'whoosh', 'steam_jet', 'crunch', 'steam', 'titan_step', 'titan_roar', 'titan_groan', 'cannon', 'giant_fall',
  'town_calm', 'crowd', 'war_bed'];
const LOOPABLE = ['reel', 'steam', 'steam_jet'];
const LAZY = new Set(['fire', 'giant_giggle', 'giant_bite']); // not used by the current scene: synthesised only on first request
const GROUP = { crunch: 'bite', giant_bite: 'bite', grab: 'grab', giant_grab: 'grab', steam: 'steam', steam_jet: 'steam', steam_blast: 'steam',
  hook_hit_stone: 'hook_hit', hook_hit_wood: 'hook_hit', hook_hit_flesh: 'hook_hit', titan_roar: 'roar', giant_roar: 'roar',
  titan_groan: 'groan', giant_groan: 'groan', giant_hurt: 'groan', wall_break: 'wall', wall_crush: 'wall' };
const GIANT_VOICE = new Set(['giant_roar', 'giant_groan', 'giant_hurt']);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export async function create(ctx) {
  const buffers = {}, loopBuffers = {};
  let ac = null, mx = null, score = null, unlocked = false;
  let musicState = 'title', masterVol = 1, simT = 0;
  const stats = { rendered: 0, renderMs: 0, errors: 0, played: 0, deduped: 0, fallbacks: 0 };
  const recent = {};   // group -> {t, pos}
  const fbq = [];      // event-driven fallback plays
  const pendingLoops = new Set();
  const listenerPos = V(), _f = V(), _u = V(), _v = V(), _q = new THREE.Quaternion();

  // ------------------------------------------------ offline rendering: deferred until the game has loaded (or the
  // first unlock), streamed in priority order by 3 parallel workers that yield to the main thread between sounds.
  // All DSP runs natively on OfflineAudioContext render threads; main-thread work per sound is graph building
  // + one normalisation pass (a few ms). play() on a sound that isn't ready yet simply skips; loops start when ready.
  let t0 = 0, startRender = null;
  const renderAll = new Promise((resolve) => {
    startRender = () => {
      if (t0) return; t0 = performance.now();
      const queue = ORDER.concat(Object.keys(SOUNDS).filter((n) => !ORDER.includes(n) && !LAZY.has(n)));
      const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 60 }) : setTimeout(r, 8)));
      const worker = async () => {
        while (queue.length) {
          const name = queue.shift(), def = SOUNDS[name]; if (!def) continue;
          try {
            const list = [];
            for (let v = 0; v < def.variants; v++) { list.push(await renderSound(name, v)); await idle(); }
            buffers[name] = list;
            if (LOOPABLE.includes(name)) loopBuffers[name] = [await renderSound(name, 0, true)];
            stats.rendered++;
          } catch (e) { stats.errors++; console.warn('[audio] render failed', name, e); }
          await idle();
        }
      };
      initPools().then(() => Promise.all([worker(), worker(), worker()])).then(() => { stats.renderMs = Math.round(performance.now() - t0); resolve(); });
    };
  });
  const lazyP = {};
  function ensure(name) { // on-demand render for LAZY sounds (the request itself is skipped; loops start when ready)
    if (!LAZY.has(name) || buffers[name] || lazyP[name]) return;
    const def = SOUNDS[name];
    lazyP[name] = (async () => { const list = []; for (let v = 0; v < def.variants; v++) list.push(await renderSound(name, v)); buffers[name] = list; if (LOOPABLE.includes(name)) loopBuffers[name] = [await renderSound(name, 0, true)]; stats.rendered++; })()
      .catch((e) => { stats.errors++; console.warn('[audio] lazy render failed', name, e); });
  }
  ctx.events.on('loaded', () => setTimeout(() => startRender(), 50));
  setTimeout(() => startRender(), 45000); // safety net if 'loaded' never fires

  // ------------------------------------------------ unlock (call from a click; any first gesture also works)
  let unlockP = null;
  function unlock() {
    if (unlockP) { if (ac && ac.state === 'suspended') ac.resume().catch(() => {}); return unlockP; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return (unlockP = Promise.resolve());
      ac = new AC({ latencyHint: 'interactive' }); // created synchronously inside the gesture
      startRender();
      mx = new Mixer(ac, { buffers, loopBuffers, volume: masterVol, wallRadius: ctx.LAYOUT?.wall?.radius || 380 });
      score = new Score(ac, mx.g.music, buffers);
      unlocked = true;
      score.setState(musicState);
      for (const h of pendingLoops) attachLoop(h); pendingLoops.clear();
      ac.onstatechange = () => { if (ac.state === 'suspended' && document.visibilityState === 'visible' && !document.hidden) ac.resume().catch(() => {}); };
      unlockP = ac.resume().catch(() => {});
    } catch (e) { console.warn('[audio] unlock failed', e); unlockP = Promise.resolve(); }
    return unlockP;
  }
  const gesture = () => { unlock(); removeEventListener('pointerdown', gesture, true); removeEventListener('keydown', gesture, true); };
  addEventListener('pointerdown', gesture, true); addEventListener('keydown', gesture, true);
  document.addEventListener('visibilitychange', () => { if (!ac) return; if (document.hidden) ac.suspend().catch(() => {}); else ac.resume().catch(() => {}); });

  // ------------------------------------------------ remap generic calls from other systems to the giant's signature sounds
  let lastWallBreak = -99, lastSurface = 'stone', lastSurfaceT = -99, lastGiantVoice = -99;
  const C = () => ctx.colossal;
  const headPos = () => C()?.headPosition || (C()?.object ? _v.copy(C().object.position).setY(55) : V(ctx.LAYOUT?.colossal?.x || 0, 55, ctx.LAYOUT?.colossal?.z || 440));
  function remap(name, o) {
    if (name === 'hook_hit') return 'hook_hit_' + (o.surface || (simT - lastSurfaceT < 0.5 ? lastSurface : 'stone'));
    const c = C(), pos = o.position;
    if (!pos?.isVector3) return name;
    if (name === 'wall_break') {
      if ((o.volume ?? 1) < 1.2 && (pos.y > 32 || (c?.active && simT - lastWallBreak < 8))) return 'wall_crush';
      return name;
    }
    if (!c?.active) return name;
    const head = c.headPosition, root = c.object?.position;
    const dHead = head ? pos.distanceTo(head) : 1e9, dRoot = root ? Math.hypot(pos.x - root.x, pos.z - root.z) : 1e9;
    const pp = ctx.player?.position, dPlayer = pp ? pos.distanceTo(pp) : 1e9;
    switch (name) {
      case 'titan_roar': return dHead < 55 ? 'giant_roar' : name;
      case 'titan_groan': return dHead < 55 ? ((o.rate ?? 1) >= 1.1 ? 'giant_hurt' : 'giant_groan') : name;
      case 'titan_step': return dRoot < 70 ? 'giant_step' : name;
      case 'steam': return dRoot < 90 && pos.y > 12 ? 'steam_blast' : name;
      case 'gas': return (o.rate ?? 1) < 0.6 && dPlayer > 15 ? 'whoosh' : name;
      case 'grab': return dRoot < 90 && dPlayer > 6 ? 'giant_grab' : name;
    }
    return name;
  }

  // ------------------------------------------------ play
  function play(name, opts = {}) {
    if (!unlocked || !mx || ac.state === 'closed') return null;
    try {
      const orig = name; name = remap(name, opts);
      if (!SOUNDS[name]) return null;
      ensure(name);
      const grp = GROUP[name] || name, pos = opts.position?.isVector3 ? opts.position : null;
      const r = recent[grp];
      if (r && simT - r.t < 0.06 && (!pos || !r.pos || pos.distanceToSquared(r.pos) < 100)) { stats.deduped++; return null; }
      recent[grp] = { t: simT, pos: pos ? pos.clone() : null };
      if (name === 'wall_break') lastWallBreak = simT;
      let o = opts;
      if (name !== orig && GIANT_VOICE.has(name) || name === 'giant_step') o = { ...opts, rate: 0.92 + 0.08 * THREE.MathUtils.clamp(opts.rate ?? 1, 0, 1.5) };
      if (GIANT_VOICE.has(name)) lastGiantVoice = simT;
      const ts = ctx.clock?.timeScale ?? 1;
      const v = mx.play(name, { ...o, position: pos || undefined, slow: ts < 0.95 && !opts.noSlow ? 0.6 + 0.4 * ts : 1 });
      if (!v) return null;
      stats.played++;
      // shell-shock: standing next to something enormous
      const m = MIX[name];
      if (m?.shock && pos && (opts.volume ?? 1) > 0.5) { const d = pos.distanceTo(listenerPos); if (d < 160) mx.shellshock(m.shock * (1 - d / 160), 2.8); }
      return { stop: (f = 0.1) => mx.kill(v, f), setVolume: (x) => v.r.v.gain.setTargetAtTime(x * (m?.g || 1) * (v.r.bg ?? 1), ac.currentTime, 0.05) };
    } catch (e) { console.warn('[audio] play', name, e); return null; }
  }
  // event-driven: play only if nobody else played this (group) around the same moment
  function fb(name, opts = {}, win = 0.35) { if (unlocked) fbq.push({ name, opts, t: simT, win }); }
  function flushFallbacks() {
    for (let i = fbq.length - 1; i >= 0; i--) {
      const q = fbq[i]; if (simT - q.t < 0.06) continue;
      fbq.splice(i, 1);
      const nm = remap(q.name, q.opts), r = recent[GROUP[nm] || nm];
      if (r && Math.abs(r.t - q.t) < q.win) continue;
      stats.fallbacks++; play(q.name, q.opts);
    }
  }

  // ------------------------------------------------ loops (handles work before unlock)
  const WIND_HANDLE = { stop() {}, setVolume() {}, setRate() {}, setPosition() {}, playing: true }; // wind is engine-driven
  function attachLoop(h) { if (h.stopped || !mx) return; h.inner = mx.loop(h.name, { ...h.opts, volume: h.vol, rate: h.rate, position: h.pos || undefined }); }
  function loop(name, opts = {}) {
    if (name === 'wind') return WIND_HANDLE;
    const h = {
      name, opts: { ...opts }, inner: null, stopped: false, vol: opts.volume ?? 1, rate: opts.rate ?? 1, pos: opts.position?.isVector3 ? opts.position.clone() : null,
      stop(f = 0.6) { this.stopped = true; pendingLoops.delete(this); this.inner?.stop(f); },
      setVolume(v, r) { this.vol = v; this.inner?.setVolume(v, r); },
      setRate(r) { this.rate = r; this.inner?.setRate(r); },
      setPosition(p) { if (!p) return; (this.pos ||= V()).copy(p); this.inner?.setPosition(p); },
      get playing() { return !!this.inner?.playing; },
    };
    if (!SOUNDS[name]) return h;
    ensure(name);
    if (mx) attachLoop(h); else pendingLoops.add(h);
    return h;
  }

  function music(state) { musicState = state; score?.setState(state); }
  function duck(k = 0.5, secs = 1.5) { mx?.duck(k, secs); }
  function stinger(streak = 1) { score?.stinger(streak); }
  function motif() { score?.motif(ac.currentTime + 0.05); }
  function setMasterVolume(v) { masterVol = v; mx?.setVolume(v); }

  // ------------------------------------------------ event wiring
  const E = ctx.events, L = ctx.LAYOUT || {};
  const on = (n, f) => E.on(n, (p) => { try { f(p || {}); } catch (e) { console.warn('[audio] event', n, e); } });
  const surfOf = (hit) => { const k = hit?.kind; return k === 'colossal' || k === 'titan' || k === 'titans' ? 'flesh' : k === 'tree' || k === 'prop' ? 'wood' : 'stone'; };
  on('hook:fire', (p) => fb('hook_fire', { pan: p.side === 'L' ? -0.3 : p.side === 'R' ? 0.3 : 0 }));
  on('hook:attach', (p) => { lastSurface = surfOf(p.hit); lastSurfaceT = simT; fb('hook_hit', { position: p.hit?.point, surface: lastSurface }); });
  on('player:slash', () => fb('slash'));
  on('player:kill', (p) => {
    fb('nape_kill', { position: p.titan?.nape?.position }); duck(0.35, 1.2);
    if (!p.boss) setTimeout(() => score?.stinger(Math.max(1, ctx.director?.streak ?? ctx.hud?.streak ?? 1)), 60);
  });
  on('player:hurt', (p) => { const a = p.amount ?? 0.2; play('body_hit', { volume: 0.6 + Math.min(0.6, a) }); if (a > 0.25) mx?.shellshock(Math.min(1, a), 1.6); });
  on('player:grabbed', () => { fb('grab'); duck(0.4, 2.5); });
  on('player:died', () => { if (C()?.active) setTimeout(() => play('giant_groan', { position: headPos().clone(), volume: 1 }), 1400); });
  on('colossal:appear', () => { const c = L.colossal || { x: 0, z: 440, height: 60 }; fb('transform', { position: V(c.x, (c.height || 60) * 0.8, c.z) }, 1.5); duck(0.7, 6); });
  on('colossal:kick', (p) => fb('boom', { position: p.point || V(0, 25, (L.colossal?.z || 440) - 40), volume: 1.3 }));
  on('colossal:grip', (p) => fb('wall_crush', { position: p.point }, 1));
  on('colossal:attack', (p) => {
    const type = String(p.type || '').toLowerCase(), pt = p.point?.isVector3 ? p.point : headPos().clone();
    if (/roar|shock|howl/.test(type)) fb('giant_roar', { position: headPos().clone() }, 2);
    else if (/steam|vent|burst/.test(type)) fb('steam_blast', { position: pt, volume: 1.2 }, 1);
    else if (/stomp|quake|jump|land/.test(type)) { play('giant_step', { position: pt, volume: 1.3, rate: 0.9 }); fb('boom', { position: pt, volume: 0.7 }); }
    else if (/slam|smash|crush|punch|kick|wall/.test(type)) { fb('whoosh', { position: headPos().clone(), volume: 0.8 }, 1); fb('wall_crush', { position: pt }, 1); }
    else if (/bite|eat/.test(type)) { /* the bite itself arrives with civilian:eaten / crunch */ }
    else fb('whoosh', { position: pt, volume: 1 }, 1); // swat / sweep / grab / lunge
  });
  let cuts = 0;
  on('colossal:hurt', () => { cuts++; fb('giant_hurt', { position: headPos().clone() }, 1); score?.heroic(cuts); duck(0.25, 1); });
  on('colossal:phase', (p) => {
    const ph = p.phase | 0; if (ph < 1) return;
    if (ctx.mode === 'play') music(ph >= 3 ? 'boss3' : ph === 2 ? 'boss2' : 'combat');
    if (ph > 1) { fb('giant_roar', { position: headPos().clone(), volume: 1.2 }, 3); duck(0.5, 3); }
  });
  on('colossal:killed', () => {
    const hp = headPos().clone();
    play('giant_roar', { position: hp, volume: 1.2, rate: 0.72 });
    setTimeout(() => { const g = hp.clone(); g.y = 2; play('giant_fall', { position: g, volume: 1.3 }); }, 2300);
    duck(0.8, 3.5);
  });
  on('wall:breached', (p) => {
    const g = p.position?.isVector3 ? p.position : V(L.outerGate?.x || 0, 20, L.outerGate?.z || 380);
    fb('wall_break', { position: g, volume: 1.3 }, 2); duck(0.6, 5); breachT = simT;
  });
  on('building:collapse', (p) => { const pos = p.position || p.building?.center || p.point; if (pos?.isVector3) fb('rubble', { position: pos }); });
  const civPos = (p) => p.position || p.civ?.position || p.civilian?.position || p.civ?.object?.position || p.point || null;
  on('civilian:grabbed', (p) => fb('scream', { position: civPos(p) || headPos().clone(), volume: 1.1, rate: 1 + Math.random() * 0.2 }));
  on('civilian:eaten', (p) => {
    fb('crunch', { position: civPos(p) || headPos().clone() }, 0.6);
  });
  on('titan:killed', (p) => {
    const t = p.titan, pos = t?.position || t?.object?.position; if (!pos) return;
    const h = t.height || 10;
    fb('titan_groan', { position: pos, rate: THREE.MathUtils.clamp(1.6 - h / 16, 0.6, 1.4) }, 1.5);
    const st = loop('steam', { position: pos.clone().add(V(0, h * 0.4, 0)), volume: 0.7, fadeIn: 1.5 }); setTimeout(() => st.stop(3), 9000);
  });
  on('fight:start', () => { if (!/boss|combat/.test(musicState)) music('combat'); });

  // ------------------------------------------------ the boss + ambience director (per frame)
  let breachT = -99, screamT = 5, heartT = 0, giggleT = 9, cannonT = 14, bellCheckT = 0;
  let breathLoop = null, steamLoop = null, crowdLoop = null, calmLoop = null, warLoop = null, reelLoop = null, wasReeling = false;
  const _cc = V();
  function updateDirector(dt) {
    const c = C(), mode = ctx.mode, breached = !!ctx.world?.breached || breachT > 0;
    // ambience beds
    const wantCalm = !breached, wantWar = breached && mode !== 'title';
    if (wantCalm && !calmLoop) calmLoop = loop('town_calm', { volume: 0.8, fadeIn: 3 });
    if (!wantCalm && calmLoop) { calmLoop.stop(4); calmLoop = null; }
    if (wantWar && !warLoop) warLoop = loop('war_bed', { volume: 0.9, fadeIn: 5 });
    if (!wantWar && warLoop) { warLoop.stop(3); warLoop = null; }
    // crowd panic at the centroid of the fleeing townspeople
    const civ = ctx.titans?.civilians?.list;
    if (breached && Array.isArray(civ)) {
      let n = 0; _cc.set(0, 0, 0);
      for (const x of civ) { const p = x.position || x.object?.position; if (!p || x.alive === false || x.eaten || x.state === 'dead') continue; _cc.add(p); n++; }
      if (n) { _cc.multiplyScalar(1 / n).setY(6); if (!crowdLoop) crowdLoop = loop('crowd', { position: _cc, volume: 1, fadeIn: 3 }); crowdLoop.setPosition(_cc); crowdLoop.setVolume(Math.min(1.3, 0.35 + n / 40), 1); }
      else if (crowdLoop) crowdLoop.setVolume(0.12, 3);
    } else if (breached && !crowdLoop && mode === 'play') crowdLoop = loop('crowd', { position: V(0, 8, 150), volume: 0.9, fadeIn: 4 });
    // the giant: breathing, steam vents, idle giggles
    const alive = c?.active && c.state !== 'dead' && c.state !== 'hidden';
    if (alive && !breathLoop) breathLoop = loop('giant_breath', { position: headPos().clone(), volume: 0.9, fadeIn: 2 });
    if (!alive && breathLoop) { breathLoop.stop(2); breathLoop = null; }
    if (breathLoop) { breathLoop.setPosition(headPos()); breathLoop.setVolume(c.steaming ? 1.2 : 0.85, 0.5); }
    const steaming = alive && !!c.steaming;
    if (steaming && !steamLoop) steamLoop = loop('steam_jet', { position: c.nape?.position || headPos().clone(), volume: 1.1, fadeIn: 0.3 });
    else if (!steaming && steamLoop) { steamLoop.stop(1.2); steamLoop = null; }
    if (steamLoop) steamLoop.setPosition(c.nape?.position || headPos());
    if (alive && (c.fighting || mode === 'play' || mode === 'title')) {
      giggleT -= dt;
      if (giggleT <= 0) {
        giggleT = 8 + Math.random() * 9;
        if (simT - lastGiantVoice > 4 && headPos().distanceTo(listenerPos) < 420) play('giant_groan', { position: headPos().clone(), volume: 0.9 + Math.random() * 0.2 });
      }
    }
    if (mode !== 'play') return;
    const p = ctx.player;
    // heartbeat: low HP or in a fist
    const grabbed = p?.state === 'grabbed';
    if (p && ((p.hp < 0.35 && p.hp > 0) || grabbed)) { heartT -= dt; if (heartT <= 0) { const k = grabbed ? 0.4 : 0.35 - p.hp; play('heartbeat', { volume: 0.6 + k * 1.5 }); heartT = 60 / (80 + k * 170); } }
    // winch
    const reeling = !!p?.reeling;
    if (reeling && !wasReeling) play('reel', { volume: 0.8 });
    if (reeling && !reelLoop) reelLoop = loop('reel', { volume: 0.55, fadeIn: 0.25 });
    if (!reeling && reelLoop) { reelLoop.stop(0.15); reelLoop = null; }
    if (reelLoop) reelLoop.setRate(0.85 + Math.min(0.5, (p.speed ?? p.velocity?.length?.() ?? 0) / 90));
    wasReeling = reeling;
    if (!breached) return;
    // distant screams around town
    screamT -= dt;
    if (screamT <= 0) { screamT = 2.5 + Math.random() * 6; const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 180; play('scream', { position: V(listenerPos.x + Math.cos(a) * r, 4, listenerPos.z + Math.sin(a) * r), volume: 0.6 + Math.random() * 0.5 }); }
    // garrison cannons firing from the wall top
    cannonT -= dt;
    if (cannonT <= 0) { cannonT = 9 + Math.random() * 16; const a = Math.PI / 2 + (Math.random() - 0.5) * 1.6, R = L.wall?.radius || 380; play('cannon', { position: V(Math.cos(a) * R, 52, Math.sin(a) * R), volume: 0.8 + Math.random() * 0.3 }); }
    // alarm bells if nobody rings them
    bellCheckT -= dt;
    if (bellCheckT <= 0) { bellCheckT = 30; if (!recent.bell || simT - recent.bell.t > 45) { const bp = V(L.plaza?.x ?? 0, 34, L.plaza?.z ?? 0); for (let i = 0; i < 6; i++) setTimeout(() => play('bell', { position: bp }), i * 2300); } }
  }

  // ------------------------------------------------ per-frame
  const camPrev = V(); let camVel = 0;
  function update(dt, time, rawDt) {
    const cam = ctx.camera; if (!cam) return;
    const rdt = Math.min(0.1, rawDt || dt || 0.016);
    cam.getWorldPosition(listenerPos);
    camVel = camVel * 0.9 + (camPrev.distanceTo(listenerPos) / Math.max(1e-3, rdt)) * 0.1; camPrev.copy(listenerPos);
    simT += rdt;
    if (!unlocked || !mx) return;
    try {
      const t = ac.currentTime;
      cam.getWorldDirection(_f); _u.set(0, 1, 0).applyQuaternion(cam.getWorldQuaternion(_q));
      mx.playerPos = ctx.player?.position || null;
      mx.setListener(listenerPos, _f, _u, t);
      score?.schedule(t + 0.3);
      // wind from the player's speed (camera speed during cinematics, damped)
      const p = ctx.player, own = ctx.cameraOwner === 'player' && p?.velocity;
      const spd = own ? p.velocity.length() : Math.min(30, camVel * 0.5);
      const vd = own && spd > 1 ? _v.copy(p.velocity).normalize() : null;
      mx.updateWind(spd, listenerPos.y, vd ? vd.dot(mx.right) : 0, ctx.mode === 'paused' || ctx.mode === 'loading');
      mx.update(t);
      flushFallbacks();
      updateDirector(rdt);
      // mode colouring: pause muffled, death dull, slow-mo pulls the music down and the reverb up
      const mode = ctx.mode, slow = (ctx.clock?.timeScale ?? 1) < 0.95 && mode === 'play';
      mx.g.masterLP.frequency.setTargetAtTime(mode === 'paused' ? 900 : mode === 'dead' ? 2500 : 20000, t, 0.12);
      mx.g.musicLP.frequency.setTargetAtTime(slow ? 1400 : 20000, t, slow ? 0.03 : 0.25);
      mx.g.verbOut.gain.setTargetAtTime(slow ? 0.9 : 0.5, t, 0.1);
    } catch (e) { stats.errors++; if (stats.errors < 5) console.warn('[audio] update', e); }
  }

  // ------------------------------------------------ debug / offline verification
  // ITU-R BS.1770 integrated loudness (K-weighting via native biquads, 400 ms blocks, -70/-10 gates) + short-term range
  async function loudness(b) {
    const oc = new OfflineAudioContext(b.numberOfChannels, b.length, b.sampleRate), s = oc.createBufferSource(); s.buffer = b;
    const sh = oc.createBiquadFilter(); sh.type = 'highshelf'; sh.frequency.value = 1681; sh.gain.value = 4; const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
    s.connect(sh); sh.connect(hp); hp.connect(oc.destination); s.start(); const k = await oc.startRendering();
    const sr = k.sampleRate, blk = Math.floor(0.4 * sr), hop = Math.floor(0.1 * sr), ms = [];
    const ch = [...Array(k.numberOfChannels).keys()].map((c) => k.getChannelData(c));
    for (let i = 0; i + blk <= k.length; i += hop) { let z = 0; for (const d of ch) { let a = 0; for (let j = i; j < i + blk; j++) a += d[j] * d[j]; z += a / blk; } ms.push(z); }
    const L = (z) => -0.691 + 10 * Math.log10(z + 1e-12);
    const g1 = ms.filter((z) => L(z) > -70), I1 = L(g1.reduce((a, z) => a + z, 0) / Math.max(1, g1.length));
    const g2 = g1.filter((z) => L(z) > I1 - 10), I = L(g2.reduce((a, z) => a + z, 0) / Math.max(1, g2.length));
    // short-term (3 s) range, 10th..95th percentile above -20 LU gate
    const st = []; const n3 = 30; for (let i = 0; i + n3 <= ms.length; i += 10) { let z = 0; for (let j = i; j < i + n3; j += 4) z += ms[j]; st.push(L(z / Math.ceil(n3 / 4))); }
    const sg = st.filter((x) => x > I - 20).sort((a, b2) => a - b2), q = (p) => sg[Math.min(sg.length - 1, Math.floor(p * (sg.length - 1)))] ?? I;
    return { lufs: +I.toFixed(1), lra: +(q(0.95) - q(0.1)).toFixed(1), stMax: +(sg[sg.length - 1] ?? I).toFixed(1) };
  }
  const lvl = (b) => { const r0 = lvl0(b), gd = 20 * Math.log10(b._gain ?? 1); return { ...r0, peakDb: +(r0.peakDb + gd).toFixed(1), rmsDb: +(r0.rmsDb + gd).toFixed(1) }; };
  const lvl0 = (b) => { let pk = 0, s = 0, nan = 0; for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) { const x = d[i]; if (!Number.isFinite(x)) { nan++; continue; } const a = Math.abs(x); if (a > pk) pk = a; s += x * x; } } return { dur: +b.duration.toFixed(2), peakDb: +(20 * Math.log10(pk + 1e-12)).toFixed(1), rmsDb: +(10 * Math.log10(s / (b.length * b.numberOfChannels) + 1e-12)).toFixed(1), nan }; };
  const debug = {
    stats, buffers, ready: renderAll, get ac() { return ac; }, get mixer() { return mx; }, get score() { return score; },
    level(name, v = 0) { const b = buffers[name]?.[v]; return b ? lvl(b) : null; },
    meter() { return mx?.meter() ?? null; },
    // render a scripted scene through the real mix chain offline: [[time, name, {position, volume}], ...] + optional music state
    async renderScene(script, secs = 10, { state = null, listener = V(-22, 12, 120), loops = [], wind = null, loud = false } = {}) {
      await renderAll;
      const oc = new OfflineAudioContext(2, Math.ceil(secs * 44100), 44100);
      const m = new Mixer(oc, { buffers, loopBuffers, wallRadius: 380 }); m.setListener(listener, V(0, 0, 1), V(0, 1, 0), 0); m.update(0);
      if (state) { const sc = new Score(oc, m.g.music, buffers); sc.setState(state, 0); sc.schedule(secs); }
      for (const [name, o] of loops) m.loop(name, o);
      if (wind) for (const [t, spd] of wind) m.updateWind(spd, listener.y, 0, false, t);
      for (const [t, name, o = {}] of script) m.play(name, { ...o, when: t });
      const b = await oc.startRendering();
      return loud ? { ...lvl0(b), ...(await loudness(b)) } : lvl0(b);
    },
    loudness: (b) => loudness(b),
  };
  return { update, unlock, play, loop, music, duck, stinger, motif, setMasterVolume, debug,
    heroic: (n) => score?.heroic(n), shellshock: (k, s) => mx?.shellshock(k, s),
    get unlocked() { return unlocked; }, get musicState() { return musicState; } };
}
