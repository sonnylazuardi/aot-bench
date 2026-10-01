// DIRECTOR — owns ctx.mode and the game flow:
//   title (cinematic drift camera) -> intro (ctx.intro) -> BOSS FIGHT "Bring down the Titan" (ctx.colossal, phases,
//   fleeing civilians, a few small ambient titans, burning town, resupply on the church roof + wall walkway)
//   -> death / rooftop respawn (fight continues) -> nape kill -> victory cinematic -> victory screen.
import * as THREE from 'three';
import { createTown } from './town.js';
import { createResupply, churchRoofPoint, wallTopPoint } from './resupply.js';
import { createAmbient } from './ambient.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// title camera: slow drift over the western rooftops toward the backlit outer gate
const TITLE_PATH = {
  pos: [V(-170, 30, -60), V(-128, 34, 60), V(-82, 40, 170), V(-40, 47, 262), V(-14, 52, 318)],
  look: [V(-30, 30, 380), V(-8, 36, 380), V(0, 40, 390), V(8, 42, 400), V(10, 40, 430)],
  secs: 85,
};
// victory: slow crane up over the district, looking back at the breach where the giant fell
const VICTORY_PATH = {
  pos: [V(-60, 24, 170), V(-70, 60, 110), V(-80, 110, 40)],
  look: [V(0, 25, 360), V(0, 20, 370), V(0, 10, 380)],
  secs: 45,
};
const PHASE_BANNERS = {
  1: ['Phase I', 'Bring Down the Titan', 'Sever the tendons in its hands and ankles to bring it to its knees — then cut the nape.'],
  2: ['Phase II', "It's Inside the Walls", 'It has broken into the district. Keep it away from the fleeing townspeople.'],
  3: ['Phase III', 'Boiling Point', 'It vents scalding steam. Strike the nape between blasts.'],
};

export async function create(ctx) {
  const P = ctx.params || {}, L = ctx.LAYOUT, E = ctx.events;
  const shot = !!P.shot;
  const d = {
    streak: 0, bestStreak: 0, kills: 0, deaths: 0, civiliansLost: 0, fight: false, fightTime: 0, playTime: 0,
    silentBreach: false, resupply: null, resupplies: [], wave: 0,
  };
  let streakT = 0, deadT = 0, pausedScale = 1, pauseGuard = 0, victoryShown = false, playStarted = false;
  let ending = false, endT = 0, introT = 0, lastPhase = 0;
  let camPath = null, camT = 0, titleGiant = false;
  const curves = (p) => ({ pos: new THREE.CatmullRomCurve3(p.pos, false, 'centripetal'), look: new THREE.CatmullRomCurve3(p.look, false, 'centripetal'), secs: p.secs });
  const titleCurve = curves(TITLE_PATH), victoryCurve = curves(VICTORY_PATH);

  const town = createTown(ctx, d);
  const ambient = createAmbient(ctx, d);
  const church = createResupply(ctx, { position: churchRoofPoint(ctx), label: 'Resupply · Church' });
  const wall = createResupply(ctx, { position: wallTopPoint(ctx), label: 'Resupply · Wall' });
  d.resupplies = [church, wall]; d.resupply = church;

  const C = () => ctx.colossal;
  const music = (s) => ctx.audio?.music?.(s);
  const phaseMusic = () => { const ph = C()?.phase | 0; return ph >= 3 ? 'boss3' : ph === 2 ? 'boss2' : 'combat'; };

  // ------------------------------------------------------------------ flow
  function toTitle() {
    ctx.mode = 'title'; ctx.cameraOwner = 'title';
    camPath = titleCurve; camT = shot ? 0.35 * titleCurve.secs : 0;
    ctx.player?.setEnabled?.(false);
    ctx.sky?.setMood?.('golden');
    try {
      C()?.titlePose?.(); titleGiant = !!C()?.titlePose && C()?.active !== false;
      // title only: slide the giant along the ring, away from the gatehouse, so its hands grip the long plain wall top
      // (the intro's appear() / startFight() call standAtWall() and put it back at the gate)
      const o = C()?.object;
      if (titleGiant && o) {
        const r = Math.hypot(o.position.x, o.position.z) || L.colossal.z, th = Math.asin(THREE.MathUtils.clamp(-95 / r, -1, 1));
        o.position.set(r * Math.sin(th), ctx.world?.groundHeight?.(r * Math.sin(th), r * Math.cos(th)) ?? o.position.y, r * Math.cos(th));
        o.rotation.y = Math.PI + th;
      }
    } catch (e) { console.warn(e); titleGiant = false; }
    headAnchor.set(0, 0, 0);
    ctx.hud?.showTitle?.(); ctx.hud?.letterbox?.(false);
    music('title');
  }
  function startIntro() {
    ctx.hud?.hideTitle?.();
    restoreFov();
    if (titleGiant) { titleGiant = false; try { C()?.lookAt?.(null); C()?.hide?.(); } catch (e) { console.warn(e); } }
    ctx.mode = 'intro'; ctx.cameraOwner = 'intro'; introT = 0;
    ctx.player?.setEnabled?.(false);
    music('calm');
    ctx.hud?.skipHint?.(true);
    let ok = false;
    try { if (ctx.intro?.start) { ctx.intro.start(); ok = true; } } catch (e) { console.warn('[director] intro failed, going straight to the fight', e); }
    if (!ok && ctx.mode === 'intro') introFallback();
  }
  function introFallback() {
    ctx.hud?.fade?.(true, 0.5).then(() => { startFight({ skipped: true }); ctx.hud?.fade?.(false, 1); });
  }
  function startFight({ skipped = false } = {}) {
    if (playStarted) return; playStarted = true;
    restoreFov(); titleGiant = false;
    ctx.hud?.skipHint?.(false); ctx.hud?.hideTitle?.();
    d.silentBreach = true;
    try {
      if (!ctx.world?.breached) ctx.world?.breach?.();
      const c = C();
      if (c && skipped && !c.active) c.appear?.();
      if (c && c.state !== 'fight' && !c.fighting) c.startFight?.();
    } catch (e) { console.warn('[director] start fight', e); }
    d.silentBreach = false;
    d.fight = true; d.fightTime = 0;
    ctx.mode = 'play'; ctx.cameraOwner = 'player';
    if (skipped) placeAtVantage(V(-18, 0, 262));
    E.emit('fight:start', { skipped });
    try { const ph0 = C()?.phase | 0; ctx.sky?.setMood?.(ph0 >= 3 ? 'afternoon' : ph0 === 2 ? 'golden' : 'day'); } catch (e) { console.warn(e); }
    ctx.player?.setEnabled?.(true);
    ctx.hud?.letterbox?.(false); ctx.hud?.setVisible?.(true); ctx.hud?.subtitle?.('');
    ctx.hud?.objective?.('Bring down the Titan', 'Sever the tendons in its hands and ankles, then cut the nape. Stay clear when it vents steam.');
    lastPhase = Math.max(1, C()?.phase | 0);
    const b = PHASE_BANNERS[lastPhase]; ctx.hud?.banner?.(b[1], b[2], { cap: b[0] });
    try { ctx.titans?.civilians?.spawnCrowd?.(60, { center: V(0, 0, 210), x: 0, z: 210, radius: 150 }); } catch (e) { console.warn('[director] civilians', e); }
    ambient.start(skipped);
    town.start(skipped);
    music(phaseMusic());
    if (!shot) setTimeout(() => ctx.hud?.toast?.('Resupply crates: church roof & wall walkway', 'gold'), skipped ? 3500 : 7000);
  }
  function die() {
    if (ctx.mode !== 'play') return;
    ctx.mode = 'dead'; d.deaths++; deadT = 3.4; d.streak = 0;
    music('death');
    ctx.hud?.showDeath?.({ stats: `Titan ${Math.round((C()?.hp ?? 1) * 100)}%  ·  Tendons severed ${cutCount()} / 4  ·  Civilians lost ${civLost()}` });
  }
  function respawn() {
    ctx.hud?.fade?.(true, 0.35);
    setTimeout(() => {
      try { ctx.player?.respawn?.(); } catch (e) { console.warn(e); }
      placeAtVantage(null);
      ctx.hud?.hideDeath?.();
      ctx.mode = 'play'; ctx.cameraOwner = 'player'; ctx.player?.setEnabled?.(true);
      music(phaseMusic());
      ctx.hud?.fade?.(false, 0.8);
      ctx.hud?.toast?.('Redeployed to a rooftop — the Titan is still standing', 'steel');
    }, 380);
  }
  function victory() {
    if (victoryShown) return; victoryShown = true;
    ctx.mode = 'victory'; ctx.player?.setEnabled?.(false);
    if (ctx.cameraOwner === 'player' || ctx.cameraOwner === 'intro') { ctx.cameraOwner = 'title'; camPath = victoryCurve; camT = 0; }
    music('victory');
    const lost = civLost();
    const rank = d.deaths === 0 && lost <= 5 ? 'S' : d.deaths <= 1 && lost <= 15 ? 'A' : d.deaths <= 3 ? 'B' : 'C';
    ctx.hud?.showVictory?.({ rank, items: [['Time', fmt(d.fightTime)], ['Deaths', d.deaths], ['Civilians lost', lost]] });
    ctx.input?.exitLock?.();
  }
  function pause() {
    if (ctx.mode !== 'play') return;
    ctx.mode = 'paused'; pausedScale = ctx.clock.timeScale || 1; ctx.clock.timeScale = 0; pauseGuard = 0.35;
    ctx.hud?.showPause?.({ items: [['Titan', `${Math.round((C()?.hp ?? 1) * 100)}%`], ['Phase', ['I', 'II', 'III'][Math.max(0, (C()?.phase | 0 || 1) - 1)]], ['Tendons severed', `${cutCount()} / 4`], ['Civilians lost', civLost()], ['Deaths', d.deaths]] });
    ctx.input?.exitLock?.();
  }
  function resume() {
    if (ctx.mode !== 'paused') return;
    ctx.hud?.hidePause?.(); ctx.hud?.toggleHelp?.(false);
    ctx.mode = 'play'; ctx.clock.timeScale = 1;
    ctx.input?.requestLock?.();
  }
  const reload = (q) => { const u = new URL(location.href); u.search = q; location.href = u.toString(); };
  const cutCount = () => (C()?.weakPoints || []).filter((w) => w.name !== 'nape' && (w.hp ?? 1) <= 0).length;
  const civLost = () => { const c = ctx.titans?.civilians; return Math.max(d.civiliansLost, typeof c?.eaten === 'number' ? c.eaten : typeof c?.lost === 'number' ? c.lost : 0); };

  // ------------------------------------------------------------------ events
  E.on('loaded', () => {
    if (P.cam) return; // debug camera
    if (P.skip) startFight({ skipped: true });
    else if (P.intro) { ctx.hud?.hideTitle?.(); ctx.audio?.unlock?.(); startIntro(); }
    else toTitle();
  });
  E.on('ui:begin', () => {
    if (ctx.mode !== 'title') return;
    ctx.audio?.unlock?.();
    ctx.hud?.flash?.(0.6);
    ctx.hud?.hideTitle?.();
    ctx.hud?.fade?.(true, 0.9).then(() => { startIntro(); ctx.hud?.fade?.(false, 1.2); });
  });
  E.on('intro:done', () => {
    if (ctx.mode !== 'intro' && ctx.mode !== 'title') return;
    startFight({ skipped: false });
    // match the intro's last shot exactly (no pop): use its hand-off spot/yaw if it publishes one
    const hs = ctx.intro?.handoffSpot;
    const pos = hs?.isVector3 ? hs : hs?.position || hs?.pos;
    if (pos?.isVector3 && ctx.player) {
      const yaw = typeof hs.yaw === 'number' ? hs.yaw : Math.atan2(giantHead().x - pos.x, giantHead().z - pos.z);
      try { ctx.player.teleport?.(pos.clone(), yaw); if (typeof hs.pitch === 'number') ctx.player.pitch = hs.pitch; } catch (e) { console.warn('[director] handoff', e); }
    }
  });
  E.on('colossal:appear', () => { if (ctx.mode === 'intro') music('dread'); });
  E.on('wall:breached', () => { if (ctx.mode === 'intro') music('breach'); });
  E.on('colossal:phase', (p) => {
    const ph = p?.phase | 0; if (!ph || ph === lastPhase || ctx.mode === 'intro') return; lastPhase = ph;
    const b = PHASE_BANNERS[ph]; if (b && d.fight) ctx.hud?.banner?.(b[1], b[2], { cap: b[0] });
    if (ctx.mode === 'play') music(phaseMusic());
    // sky follows the fight (RENDER moods): phase II golden, phase III afternoon
    if (ph === 2) ctx.sky?.setMood?.('golden'); else if (ph >= 3) ctx.sky?.setMood?.('afternoon');
  });
  E.on('colossal:killed', () => {
    if (ending) return; ending = true; endT = 0; d.fight = false;
    ctx.hud?.toast?.('The Titan is down', 'gold');
    music('victory');
  });
  E.on('victory:cinematic-done', () => victory());
  E.on('player:died', die);
  E.on('civilian:eaten', () => { d.civiliansLost++; });
  E.on('titan:killed', (p) => {
    if (!p?.byPlayer) return;
    d.kills++; d.streak = streakT > 0 ? d.streak + 1 : 1; streakT = 7; d.bestStreak = Math.max(d.bestStreak, d.streak);
  });
  E.on('ui:resume', resume);
  E.on('ui:restart', () => reload('?skip=1'));
  E.on('ui:quit', () => reload(''));
  E.on('ui:continue', () => reload('?skip=1'));
  E.on('building:collapse', (p) => town.onCollapse(p));

  let lockWas = false;
  document.addEventListener('pointerlockchange', () => {
    const locked = !!document.pointerLockElement;
    if (!locked && lockWas && ctx.mode === 'play') pause();
    lockWas = locked;
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (ctx.mode === 'play' && !document.pointerLockElement) pause();
      else if (ctx.mode === 'paused' && pauseGuard <= 0) resume();
      else if (ctx.mode === 'intro') ctx.intro?.skip?.();
    }
    if (e.code === 'Enter' && ctx.mode === 'intro' && !e.repeat) ctx.intro?.skip?.();
  });
  addEventListener('blur', () => { if (ctx.mode === 'play' && !shot) pause(); });
  ctx.renderer.domElement.addEventListener('mousedown', () => { if (ctx.mode === 'play' && !document.pointerLockElement) ctx.input?.requestLock?.(); });

  // ------------------------------------------------------------------ helpers
  // where the giant's head is (headPosition can be stale right after appear()/startFight() teleports the root)
  function giantHead() {
    const c = C(); if (!c?.object) return V(L.colossal.x, 58, L.colossal.z);
    const hp = c.headPosition, o = c.object.position;
    if (hp && hp.lengthSq() > 1 && Math.hypot(hp.x - o.x, hp.z - o.z) < 45) return hp.clone();
    return V(o.x, o.y + 56, o.z - 10);
  }
  // a rooftop 12–28 m up, ~150–230 m from the giant, with a clear sightline to its head (the first thing you see)
  const DOWN = new THREE.Vector3(0, -1, 0);
  function vantagePoint(prefer = null) {
    const head = giantHead(), B = ctx.world?.buildings || [], ph = ctx.physics;
    const cands = [];
    for (const b of B) {
      if (b.destroyed || !b.box) continue;
      const h = b.box.max.y; if (h < 12 || h > 28) continue;
      const c = b.center || b.box.getCenter(new THREE.Vector3());
      const d = Math.hypot(c.x - head.x, c.z - head.z);
      if (d < 145 || d > 235 || Math.hypot(c.x, c.z) > 330) continue;
      const sc = Math.abs(d - 185) * 0.6 + Math.abs(h - 19) * 1.5 + (prefer ? Math.hypot(c.x - prefer.x, c.z - prefer.z) * 0.3 : Math.random() * 25);
      cands.push([sc, b, c]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    const eye = new THREE.Vector3(), dir = new THREE.Vector3(), chest = head.clone(); chest.y -= 16;
    const clear = (from, target) => { if (!ph?.raycast) return true; eye.copy(from); eye.y += 1.7; dir.copy(target).sub(eye); const L2 = dir.length(); dir.divideScalar(L2); const h2 = ph.raycast(eye, dir, L2, { exclude: ['titans', 'colossal', 'player'] }); return !h2 || h2.distance > L2 - 8; };
    // WORLD-provided flat rooftop platforms win; house-roof terraces before watchtowers / belfries
    const kindCost = (k) => (/watch|belfry|tower|spire/.test(k || '') ? 60 : 0);
    const vps = (ctx.world?.vantagePoints || []).map((v) => ({ p: v?.isVector3 ? v : v?.position || v?.pos, kind: v?.kind || '' })).filter((v) => v.p?.isVector3);
    const ranked = vps.map((v) => [kindCost(v.kind) + Math.abs(Math.hypot(v.p.x - head.x, v.p.z - head.z) - 185) * 0.5 + (prefer ? Math.hypot(v.p.x - prefer.x, v.p.z - prefer.z) * 0.3 : Math.random() * 20), v.p])
      .sort((a, b) => a[0] - b[0]);
    for (const [, p] of ranked) if (clear(p, head)) return spotFacing(p.clone(), head);
    if (ranked.length) return spotFacing(ranked[0][1].clone(), head); // a world platform even without a perfect sightline beats the wall
    // flattest standable roof point on the footprint (steep roofs make the player slide off)
    const roofSpot = (b) => {
      const bx = b.box; let best = null;
      for (const [u, w] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
        const x = THREE.MathUtils.lerp(bx.min.x, bx.max.x, u), z = THREE.MathUtils.lerp(bx.min.z, bx.max.z, w);
        const hit = ph.raycast(V(x, bx.max.y + 6, z), DOWN, 40, { exclude: ['titans', 'colossal', 'player'] });
        if (hit && hit.point.y > 8 && (!best || hit.normal.y > best.normal.y)) best = hit;
      }
      return best;
    };
    if (!ph?.raycast) return cands.length ? spotFacing(V(cands[0][2].x, cands[0][1].box.max.y, cands[0][2].z), head) : null;
    // a flat patch ≥ ~2.4 m across (a ridge cap reads flat at one point but the body slides off it)
    const flatPatch = (p) => {
      for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
        const h = ph.raycast(V(p.x + dx, p.y + 4, p.z + dz), DOWN, 8, { exclude: ['titans', 'colossal', 'player'] });
        if (!h || h.normal.y < 0.8 || Math.abs(h.point.y - p.y) > 0.35) return false;
      }
      return true;
    };
    for (const [, b] of cands.slice(0, 30)) {
      const hit = roofSpot(b); if (!hit || hit.normal.y < 0.8) continue;
      const pos = hit.point.clone();
      if (flatPatch(pos) && clear(pos, head) && clear(pos, chest)) return spotFacing(pos, head);
    }
    // pitched roofs everywhere: the flat wall walkway well west of the gate (≈160 m from the giant, head in full view)
    return wallVantage(head);
  }
  function wallVantage(head) {
    const r = L.wall.radius + L.wall.thickness / 2, x = -150, z = Math.sqrt(r * r - x * x);
    let y = L.wall.walkwayY ?? L.wall.height;
    const h = ctx.physics?.raycast?.(V(x, y + 20, z), DOWN, 40, { exclude: ['titans', 'colossal', 'player'] });
    if (h && h.point.y > y - 6) y = h.point.y;
    return spotFacing(V(x, y, z), head);
  }
  const spotFacing = (pos, head) => ({ pos, yaw: Math.atan2(head.x - pos.x, head.z - pos.z), pitch: THREE.MathUtils.clamp(Math.atan2(head.y - pos.y - 1.7, Math.hypot(head.x - pos.x, head.z - pos.z)) * 0.8, -0.1, 0.35) });
  function placeAtVantage(prefer) {
    const v = vantagePoint(prefer) || safeRooftop();
    try {
      ctx.player?.teleport?.(v.pos, v.yaw);
      if (ctx.player && typeof v.pitch === 'number') ctx.player.pitch = v.pitch;
      if (ctx.player && ctx.player.state === 'air') console.warn('[director] vantage roof not standable', v.pos.toArray());
    } catch (e) { console.warn('[director] vantage', e); }
    return v;
  }
  function safeRooftop() {
    const B = ctx.world?.buildings || [], c = C();
    const threats = (ctx.titans?.list || []).filter((t) => t.alive !== false && t.position).map((t) => t.position);
    if (c?.object) threats.push(c.object.position);
    let best = null, bs = -Infinity;
    for (const b of B) {
      if (b.destroyed || !b.box) continue;
      const h = b.height ?? b.box.max.y; if (h < 8 || h > 30) continue;
      const bc = b.center || b.box.getCenter(new THREE.Vector3());
      if (Math.hypot(bc.x, bc.z) > 330) continue;
      let nt = 400; for (const t of threats) nt = Math.min(nt, Math.hypot(t.x - bc.x, t.z - bc.z));
      // far enough from the giant to recover, close enough to get straight back into the fight
      const s = -Math.abs(Math.min(nt, 260) - 130) + Math.random() * 12;
      if (s > bs) { bs = s; best = { pos: V(bc.x, b.box.max.y + 1.5, bc.z) }; }
    }
    if (!best) { const g = ctx.world?.groundHeight?.(L.playerStart.x, L.playerStart.z) ?? 0; best = { pos: V(L.playerStart.x, g + 1.5, L.playerStart.z) }; }
    const aim = c?.object?.position || V(L.outerGate.x, 0, L.outerGate.z);
    best.yaw = Math.atan2(aim.x - best.pos.x, aim.z - best.pos.z);
    return best;
  }
  const _p = new THREE.Vector3(), _l = new THREE.Vector3(), _v = new THREE.Vector3();
  // title with the giant: slow drift over the rooftops, the grinning head + hands on the wall in the right third,
  // leaving the left of the frame dark for the menu (hfov ~94°: right-third centre ≈ 19.5° off-axis)
  const headAnchor = new THREE.Vector3(), _hp = new THREE.Vector3();
  // telephoto (fov 28) compresses the giant against the wall so it looms; camera just above the wall-top height so the
  // hands gripping the parapet read. hfov ≈ 48° -> right-third centre ≈ 8.3° off-axis.
  const TITLE_FOV = 28; let savedFov = 0;
  function titleGiantCamera(dt) {
    const c = C(); const hp = c?.headPosition;
    if (!hp || hp.lengthSq() < 1) return false;
    if (headAnchor.lengthSq() < 1) headAnchor.copy(hp); else headAnchor.lerp(hp, 1 - Math.exp(-dt / 3));
    if (!savedFov) { savedFov = ctx.camera.fov; ctx.camera.fov = TITLE_FOV; ctx.camera.updateProjectionMatrix(); }
    camT += dt;
    const t = camT, H = headAnchor;
    const D = 150 + Math.sin(t * 0.04) * 12;                          // slow push-in / pull-out
    _p.set(H.x + 18 + Math.sin(t * 0.027) * 14, 47.5 + Math.sin(t * 0.05 + 1) * 1.5, H.z - D);   // a little off-axis: the wall runs across the frame
    const off = (H.z - _p.z) * Math.tan(THREE.MathUtils.degToRad(8.3));
    _l.set(H.x + off, H.y - 8 + Math.sin(t * 0.07) * 0.6, H.z);        // head + hands land in the right third
    ctx.camera.position.copy(_p); ctx.camera.lookAt(_l);
    return true;
  }
  function restoreFov() { if (savedFov) { ctx.camera.fov = savedFov; ctx.camera.updateProjectionMatrix(); savedFov = 0; } }
  function driveCamera(dt) {
    if (camPath === titleCurve && titleGiant && ctx.mode === 'title' && titleGiantCamera(dt)) return;
    if (!camPath) return;
    camT += dt;
    let u = camT / camPath.secs;
    if (camPath === titleCurve && u >= 1) { camT = 0; u = 0; ctx.hud?.fade?.(true, 0.01); ctx.hud?.fade?.(false, 1.6); }
    u = Math.min(1, u);
    const e = camPath === victoryCurve ? 1 - Math.pow(1 - u, 2) : u;
    camPath.pos.getPoint(e, _p); camPath.look.getPoint(e, _l);
    if (camPath === victoryCurve && C()?.object) _l.lerp(_v.copy(C().object.position).setY(15), 0.5);
    const t = ctx.clock.time;
    _p.x += Math.sin(t * 0.21) * 1.2; _p.y += Math.sin(t * 0.33 + 1) * 0.6;
    _l.x += Math.sin(t * 0.17 + 2) * 2.5; _l.y += Math.sin(t * 0.13) * 1.5;
    ctx.camera.position.copy(_p); ctx.camera.lookAt(_l);
  }

  // ------------------------------------------------------------------ per-frame
  function update(dt, time, rawDt) {
    const rdt = rawDt || dt;
    if (pauseGuard > 0) pauseGuard -= rdt;
    if (ctx.mode === 'paused') { ctx.clock.timeScale = 0; return; }
    if (ctx.cameraOwner === 'title') driveCamera(rdt);
    if (ctx.mode === 'intro') {
      introT += rdt;
      // intro stalled (never emitted intro:done) -> fall through to the fight
      if (introT > 150 || (introT > 3 && ctx.cameraOwner !== 'intro' && !ctx.intro?.playing)) { introT = -1e9; introFallback(); }
      return;
    }
    if (ctx.mode === 'title' || ctx.mode === 'loading') return;
    streakT -= dt; if (streakT <= 0) d.streak = 0;
    if (ctx.mode === 'play' || ctx.mode === 'dead') {
      d.playTime += rdt; if (d.fight) d.fightTime += rdt;
      if (ctx.mode === 'play' && ctx.player && (ctx.player.state === 'dead' || (ctx.player.hp ?? 1) <= 0)) die();
      if (ctx.mode === 'dead') { deadT -= rdt; if (deadT <= 0) { deadT = 1e9; respawn(); } }
      if (ending && !victoryShown) {
        endT += rdt;
        // the kill cinematic (if any) takes the camera and emits 'victory:cinematic-done'; otherwise fall back
        if ((ctx.cameraOwner === 'player' && endT > 8) || endT > 45) victory();
      }
      ambient.update(dt, rdt, ending);
      town.update(dt, rdt);
      for (const r of d.resupplies) r.update(dt, rdt);
    } else if (ctx.mode === 'victory') town.update(dt, rdt);
  }

  Object.assign(d, { update, start: startFight, startFight, startIntro, toTitle, pause, resume, victory, die, respawn, safeRooftop });
  return d;
}
const fmt = (s) => { if (typeof s !== 'number') return '--:--'; s = Math.max(0, Math.round(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
