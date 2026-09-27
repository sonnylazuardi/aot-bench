// INTRO + FIGHT CINEMATICS (ctx.intro). Owner: TITANS builder.
//   start(), skip(), playing, playFight(name)  — emits 'intro:done' when the player takes over,
//   'victory:cinematic-done' after the kill cam.
// Beats: calm crane over Shiganshina -> lightning strike behind the wall -> the grinning giant rises and grips the wall
// -> it kicks the gate in (slow-mo, boulders, dust wave) -> it plucks a screaming townsperson and bites -> the town burns,
// camera settles behind the player on a rooftop and eases into gameplay.
import * as THREE from 'three';
import { CineCam, Birds, path, ease, nz, V, clamp, lerp } from './cine.js';

export async function create(ctx) {
  const L = ctx.LAYOUT;
  const W = L.wall;
  const C = new CineCam(ctx);
  const birds = new Birds(ctx, 80);
  const safe = (fn) => { try { return fn(); } catch (e) { console.warn('[intro]', e); return undefined; } };
  const G = () => ctx.colossal;
  const civs = () => ctx.titans?.civilians;
  const ground = (x, z) => ctx.world?.groundHeight?.(x, z) ?? 0;
  const audio = (name, o) => safe(() => ctx.audio?.play?.(name, o));
  const rnd = (a, b) => a + Math.random() * (b - a);

  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const headFallback = V(0, 68, 402);
  function head(out = new THREE.Vector3()) {
    const g = G();
    const h = g?.headPosition;
    if (g?.active && h && h.lengthSq() > 1 && Number.isFinite(h.x + h.y + h.z)) return out.copy(h);
    return out.copy(headFallback);
  }
  // roof spot near (x,z)
  function roofNear(x, z, minH = 7, maxH = 18) {
    const bs = ctx.world?.buildings || [];
    let best = null, bd = 1e9;
    for (const b of bs) {
      if (!b.box || b.destroyed) continue;
      const h = b.box.max.y;
      if (h < minH || h > maxH) continue;
      const cx = (b.box.min.x + b.box.max.x) / 2, cz = (b.box.min.z + b.box.max.z) / 2;
      const d = Math.hypot(cx - x, cz - z);
      if (d < bd) { bd = d; best = V(cx, h, cz); }
    }
    return best || V(x, ground(x, z) + 0.2, z);
  }

  // Hand-off spot: same rule as the director's vantagePoint() — a FLAT standable roof 12–28 m up, 145–235 m from the head,
  // clear sightline; otherwise the flat wall walkway at x=-150 (pitched roofs make the player slide off).
  const DOWN = V(0, -1, 0);
  function vantage() {
    const hd = head(V()), B = ctx.world?.buildings || [], ph = ctx.physics;
    const ex = { exclude: ['titans', 'colossal', 'player'] };
    const wall = () => {
      const r = W.radius + W.thickness / 2, x = -150, z = Math.sqrt(r * r - x * x);
      let y = W.walkwayY ?? W.height;
      const h = safe(() => ph?.raycast?.(V(x, y + 20, z), DOWN, 40, ex));
      if (h && h.point.y > y - 6) y = h.point.y;
      return V(x, y, z);
    };
    if (!ph?.raycast) return wall();
    const cands = [];
    for (const b of B) {
      if (b.destroyed || !b.box) continue;
      const h = b.box.max.y; if (h < 12 || h > 28) continue;
      const c = b.center || b.box.getCenter(new THREE.Vector3());
      const d = Math.hypot(c.x - hd.x, c.z - hd.z);
      if (d < 145 || d > 235 || Math.hypot(c.x, c.z) > 330) continue;
      cands.push([Math.abs(d - 185) * 0.6 + Math.abs(h - 19) * 1.5, b]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    const eye = V(), dir = V(), chest = hd.clone(); chest.y -= 16;
    const clear = (from, target) => { eye.copy(from); eye.y += 1.7; dir.copy(target).sub(eye); const L2 = dir.length(); dir.divideScalar(L2); const h2 = ph.raycast(eye, dir, L2, ex); return !h2 || h2.distance > L2 - 8; };
    const flat = (p) => { for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) { const h = ph.raycast(V(p.x + dx, p.y + 4, p.z + dz), DOWN, 8, ex); if (!h || h.normal.y < 0.8 || Math.abs(h.point.y - p.y) > 0.35) return false; } return true; };
    for (const [, b] of cands.slice(0, 30)) {
      const bx = b.box; let best = null;
      for (const [u, w] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
        const hit = ph.raycast(V(lerp(bx.min.x, bx.max.x, u), bx.max.y + 6, lerp(bx.min.z, bx.max.z, w)), DOWN, 40, ex);
        if (hit && hit.point.y > 8 && (!best || hit.normal.y > best.normal.y)) best = hit;
      }
      if (!best || best.normal.y < 0.8) continue;
      const pos = best.point.clone();
      if (safe(() => flat(pos) && clear(pos, hd) && clear(pos, chest))) return pos;
    }
    return wall();
  }

  // ------------------------------------------------------------------ state
  const S = {
    playing: false, started: false, t: 0, shot: -1, events: [], fired: 0, skipHold: 0, mode: 'intro',
    boulder: null, boulderHit: null, victim: null, victimHand: null, playerSpot: null, slow: 0, fightT: 0, fightShots: null,
  };
  const sys = {
    get playing() { return S.playing; },
    start, skip, playFight, update,
    get time() { return S.t; },
    get _shot() { return S.shot; },
    get handoffSpot() { return S.playerSpot; },
  };

  // full-screen flash overlay that decays by simulation time in update() (post.flash only decays per render call)
  let flashEl = null;
  function domFlash(k, rgb = '255,238,170') {
    if (typeof document === 'undefined') return;
    if (!flashEl) {
      flashEl = document.createElement('div');
      flashEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;opacity:0;mix-blend-mode:screen;';
      (ctx.uiRoot || document.body).appendChild(flashEl);
    }
    flashEl.style.background = `rgb(${rgb})`;
    S.flash = Math.max(S.flash || 0, k);
  }
  function tickFlash(rdt) {
    if (!flashEl) return;
    S.flash = (S.flash || 0) * Math.exp(-rdt * 3.5);
    if (S.flash < 0.004) S.flash = 0;
    flashEl.style.opacity = String(Math.min(1, S.flash));
  }

  // steam rising from BEHIND the giant's shoulders, blowing up and away from the town: frames the face, never covers it
  function shoulderSteam(on) {
    for (const h of S.shoulder || []) safe(() => h.h.stop?.());
    S.shoulder = null;
    if (!on) return;
    const g = G(); const bones = g?.bones;
    S.shoulder = [];
    for (const side of ['L', 'R']) {
      const b = bones?.['upperArm' + side];
      const p = new THREE.Vector3();
      if (b) b.getWorldPosition(p); else p.set(side === 'L' ? -22 : 22, W.height + 4, W.radius + W.thickness + 16);
      const h = safe(() => ctx.fx?.steamJet?.(p.clone(), V(side === 'L' ? -0.35 : 0.35, 1, 0.7), 11, 12, {}));
      if (h) S.shoulder.push({ h, b });
    }
  }
  function followShoulderSteam() {
    if (!S.shoulder) return;
    for (const s2 of S.shoulder) {
      if (!s2.b || !s2.h.position) continue;
      s2.b.getWorldPosition(s2.h.position);
      s2.h.position.y += 4; s2.h.position.z += 7; // behind and above the shoulder, away from the camera
    }
  }

  // grade a shot darker (back-lit silhouette) via the post exposure setting; always restored
  let savedExposure = null;
  function lowKey(on) {
    const st = ctx.post?.settings;
    if (!st || typeof st.exposure !== 'number') return;
    if (on) { if (savedExposure === null) savedExposure = st.exposure; st.exposure = savedExposure * 0.4; }
    else if (savedExposure !== null) { st.exposure = savedExposure; savedExposure = null; }
  }

  // proxy "hand" for the horror beat when the giant has no eat() API
  const hand = new THREE.Object3D(); hand.name = 'introHand';
  ctx.scene.add(hand);

  // ------------------------------------------------------------------ shots
  // each: [duration, enter(), cam(u, t, dt)]
  let SHOTS = [];
  let EVENTS = [];
  function buildTimeline() {
    const gate = V(0, 0, W.radius);
    const wallTop = W.height;
    const pSpot = S.playerSpot;
    const shots = [];
    const at = (t, fn) => EVENTS.push([t, fn]);
    let T = 0;
    const shot = (dur, enter, cam, until = null, maxHold = 0) => { shots.push({ t0: T, t1: T + dur, enter, cam, until, maxHold, held: 0 }); T += dur; return shots[shots.length - 1].t0; };

    // 1 — CALM: slow crane over the rooftops toward the outer wall
    const p1 = path([V(-72, 16, 118), V(-52, 26, 170), V(-26, 36, 222)]);
    const t1 = path([V(-10, 34, 380), V(-4, 40, 380), V(0, 44, 382)]);
    shot(6.2, () => {
      safe(() => ctx.sky?.setMood?.('golden', 0));
      safe(() => ctx.audio?.music?.('calm'));
      birds.start(V(-14, 30, 250));
    }, (u) => { const e = ease.inOut(u); p1(e, C.pos); t1(e, C.target); C.fov = 52; C.hand = 0.15; C.roll = -0.02; });
    at(0.9, () => safe(() => ctx.hud?.subtitle?.('Year 845 — Shiganshina District, the southern edge of Wall Maria', 6)));

    // 2 — street level: townsfolk, birds, the wall looming at the end of the avenue
    shot(4.0, () => { birds.center.set(4, 26, 300); }, (u) => {
      const e = ease.inOut(u);
      C.pos.set(lerp(5, 3.5, e), 1.75, lerp(282, 292, e)); C.target.set(lerp(-2, 0, e), lerp(16, 26, e), 380); C.fov = 58; C.hand = 0.35; C.roll = 0.01;
    });

    // 3 — THE STRIKE: low angle at the wall, blinding bolt just outside
    const strikeAt = shot(3.6, null, (u, t) => {
      C.pos.set(7, 1.6, 318); C.target.set(-2, lerp(40, 52, ease.out(u)), 386); C.fov = 70; C.hand = 0.4; C.roll = 0.03;
    });
    at(strikeAt + 0.55, strike);
    at(strikeAt + 1.0, () => audio('thunder', { volume: 1.3 }));

    // 4 — wide from a rooftop: steam mushroom rising behind the wall, birds scattering
    const wideAt = shot(2.8, null, (u) => {
      C.pos.set(lerp(-46, -40, u), lerp(28, 30, u), lerp(222, 228, u)); C.target.set(0, lerp(70, 95, ease.out(u)), 430); C.fov = 48; C.hand = 0.5; C.roll = -0.015;
    });
    at(wideAt + 0.8, () => safe(() => civs()?.look?.(V(0, 60, 420), 5)));

    // 5 — THE REVEAL: extreme low angle between houses; a hand slams onto the wall top, the grin rises
    const revealAt = shot(4.2, () => {
      safe(() => { const g = G(); g?.hide?.(); g?.appear?.(); });
      safe(() => ctx.audio?.music?.('dread'));
    }, (u) => {
      C.pos.set(-9, 1.3, 334); C.target.set(-3, lerp(48, 60, ease.inOut(u)), 388); C.fov = 76; C.hand = 0.35 + S.gripJolt; C.roll = 0.05;
    });
    // a few short steam plumes BEHIND the wall, blowing up and away from the town; gone before the head rises
    at(revealAt + 0.05, () => {
      S.revealSteam = [];
      for (const x of [-58, -42, 42, 58]) { // flanks only: the head must rise in clear air
        const h = safe(() => ctx.fx?.steamJet?.(V(x, wallTop - 4, W.radius + W.thickness + 10), V(Math.sign(x) * 0.4, 1, 0.45), 14, 1.6, {}));
        if (h) S.revealSteam.push(h);
      }
    });
    at(revealAt + 1.5, () => { for (const h of S.revealSteam || []) safe(() => h.stop?.()); S.revealSteam = null; });

    // 5b — telephoto on the parapet: the second hand slams down (appear t≈6.75) and the crown starts to clear the wall
    // held (up to +4 s) until the giant's real head is clear of the parapet, so shot 6 always shows the face
    shot(3.2, () => shoulderSteam(true), (u) => {
      const hp = head(_v2);
      const e = ease.inOut(u);
      C.pos.set(-34, 26, 292); C.target.set(lerp(-4, hp.x * 0.5, e), lerp(54, (wallTop + hp.y) * 0.5 + 2, e), 392); C.fov = lerp(30, 26, e); C.hand = 0.3 + S.gripJolt; C.roll = -0.02;
    });

    shots[shots.length - 1].until = () => { const g = G(); return !g?.active || head(_v3).y > wallTop + 8; };
    shots[shots.length - 1].maxHold = 4;

    // 6 — over the shoulder of the soldier on a rooftop: the head rises above the wall (camera aims at the live headPosition)
    shot(4.4, () => {
      placePlayer(); lowKey(true);
      // nothing persistent lives in fx yet (town fires start with the fight): wipe the grip dust out of the camera→head cone
      safe(() => ctx.fx?.clear?.());
      shoulderSteam(true);
    }, (u) => {
      const hp = head(_v2);
      const P = pSpot;
      const dir = _v3.copy(hp).sub(P).setY(0); if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); dir.normalize();
      const side = V(dir.z, 0, -dir.x);
      const e = ease.inOut(u);
      // low behind the soldier: the figure is a dark silhouette in the lower third, the head rises in clear sky
      // knee height behind and to the right of the soldier: his back/head/shoulders fill the lower-left third as a dark shape
      C.pos.copy(P).addScaledVector(dir, -lerp(3.6, 3.1, e)).addScaledVector(side, -1.0).add(_v.set(0, 0.5, 0));
      C.target.copy(hp).add(_v.set(0, 2, 0)); C.fov = lerp(40, 34, e); C.hand = 0.3; C.roll = 0.02;
    });

    // 7 — slow push-in on the face: the uncanny grin
    shot(5.0, () => { lowKey(false); safe(() => G()?.lookAt?.(ctx.camera.position)); }, (u) => {
      const hp = head(_v2);
      const e = ease.inOut(u);
      C.pos.set(lerp(-6, -3, e), lerp(44, 49, e), lerp(292, 318, e)); C.target.copy(hp).add(_v.set(0, -2.5, 0)); C.fov = lerp(24, 15, e); C.hand = 0.25; C.roll = 0.01;
    });

    // 8 — THE BREACH: inside the town at the gate; it kicks the gate in (slow-mo on contact)
    const kickAt = shot(4.6, () => { shoulderSteam(false); safe(() => G()?.lookAt?.(null)); }, (u) => {
      const e = ease.out(u);
      C.pos.set(lerp(-20, -24, e), lerp(4.5, 5.5, e), lerp(338, 322, e)); C.target.set(0, 18, 385); C.fov = 62; C.hand = 0.4; C.roll = -0.03;
    });
    at(kickAt + 0.15, () => { S.kicked = false; safe(() => G()?.kick?.()); });
    at(kickAt + 1.9, () => { if (!S.kicked) onKick({ point: V(0, 8, W.radius + 4) }); }); // fallback if no kick event

    // 9 — track one boulder into a house
    const bAt = shot(3.6, () => launchTracked(), (u, t) => {
      const b = S.boulder;
      if (b && b.alive !== false) {
        const bp = b.pos;
        C.pos.set(bp.x - 26, bp.y + 7, bp.z + 16); C.target.copy(bp);
        S.boulderLast = C.pos.clone();
      } else if (S.boulderHit) {
        if (S.boulderLast) C.pos.copy(S.boulderLast); C.target.lerp(S.boulderHit, 0.1);
      }
      C.fov = 55; C.hand = 0.5; C.roll = 0.02;
    });

    // 10 — the dust wave rolls down the avenue at the camera; bells, screams
    const dustAt = shot(3.6, () => { dustWave(); safe(() => civs()?.panic?.()); }, (u) => {
      C.pos.set(1.5, 2.1, 236); C.target.set(0, lerp(14, 8, u), 380); C.fov = 56; C.hand = 0.5 + u * 0.8; C.roll = 0.0;
    });
    at(dustAt + 0.4, () => audio('bell', { position: V(-30, 30, 60), volume: 1 }));
    at(dustAt + 0.9, () => audio('crowd', { volume: 1 }));
    at(dustAt + 1.5, () => audio('scream', { position: V(4, 2, 250), volume: 1 }));

    // 11–14 — HORROR: the giant reaches down, plucks a screaming townsperson from the street and bites.
    // Uses the giant's own eat action when available (reach 1.3 s, carry 1.1 s, bite at ~3.0 s, chew 2.4 s);
    // otherwise stages it with a proxy hand.
    const hAt = shot(1.9, () => setupVictim(), (u) => {
      const v = S.victim?.position || V(-12, 0, 366);
      C.pos.set(v.x + 3.6, v.y + 1.0, v.z - 4.2); C.target.set(v.x, v.y + 1.2 + (S.victimUp ? 3 : 0) + u * 1.5, v.z + 1.5); C.fov = 52; C.hand = 0.35; C.roll = 0.05;
    });
    at(hAt + 0.2, grabVictim);
    shot(1.25, null, (u) => {
      const v = S.victim?.position || hand.position;
      const hp = head(_v2);
      C.pos.set(v.x + 14, Math.max(2, v.y - 12), v.z - 26); C.target.lerpVectors(v, hp, 0.3); C.fov = 40; C.hand = 0.35; C.roll = -0.05;
    });
    shot(0.55, null, (u) => {
      const hp = head(_v2);
      C.pos.set(hp.x + 4, hp.y - 7, hp.z - 44); C.target.copy(hp).add(_v.set(0, -7, 0)); C.fov = 26; C.hand = 0.25; C.roll = 0.02;
    });
    // CUT AWAY at the bite: wide, the blood mist hangs at the mouth
    const biteAt = shot(1.5, bite, (u) => {
      const hp = head(_v2);
      C.pos.set(-44, 30, 298); C.target.copy(hp).add(_v.set(0, -10, 0)); C.fov = 30; C.hand = 0.3 + (1 - u) * 0.4; C.roll = 0;
    });
    // the grin, chewing
    shot(3.0, () => { chew(); }, (u) => {
      const hp = head(_v2);
      const e = ease.inOut(u);
      C.pos.set(lerp(6, 3, e), lerp(hp.y - 16, hp.y - 14, e), lerp(318, 328, e)); C.target.copy(hp).add(_v.set(0, -5, 0)); C.fov = lerp(17, 14, e); C.hand = 0.2; C.roll = -0.01;
    });

    // 15 — the district burns
    shot(3.6, () => {
      safe(() => ctx.sky?.setMood?.('inferno', 4));
      for (const p of [V(-26, 0, 300), V(22, 0, 312), V(-8, 0, 276), V(40, 0, 262), V(-44, 0, 338), V(14, 0, 240)]) {
        const r = roofNear(p.x, p.z, 4, 30); safe(() => ctx.fx?.fire?.(r, rnd(5, 8)));
      }
    }, (u) => {
      const e = ease.inOut(u);
      C.pos.set(lerp(-80, -66, e), lerp(52, 46, e), lerp(214, 230, e)); C.target.copy(head(_v2)).add(_v.set(0, -22, -30)); C.fov = 50; C.hand = 0.3; C.roll = -0.03;
    });

    // 16 — behind the soldier on the rooftop, easing into the gameplay camera
    shot(4.6, () => {
      const v = safe(vantage); if (v) S.playerSpot.copy(v);
      placePlayer(); safe(() => ctx.hud?.subtitle?.('Bring down the Titan.', 3));
    }, (u) => {
      const P = S.playerSpot;
      const hp = head(_v2);
      const dir = _v3.copy(hp).sub(P).setY(0); if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); dir.normalize();
      const e = ease.inOut5(u);
      const back = lerp(22, 6.2, e), up = lerp(12, 2.4, e);
      C.pos.copy(P).addScaledVector(dir, -back).add(_v.set(0, up, 0));
      C.target.copy(P).addScaledVector(dir, 30).add(_v.set(0, lerp(8, 10, e), 0)).lerp(hp, lerp(0.5, 0.15, e));
      C.fov = lerp(48, 62, e); C.hand = lerp(0.35, 0.05, e); C.roll = 0;
    });
    EVENTS.sort((a, b) => a[0] - b[0]);
    S.total = T;
    return shots;
  }

  // ------------------------------------------------------------------ beats
  function strike() {
    const at = V(L.colossal.x, 30, L.colossal.z + 6);
    safe(() => ctx.fx?.lightning?.(V(at.x + 60, 1400, at.z + 260), V(at.x, 10, at.z), { width: 3 }));
    safe(() => ctx.fx?.lightning?.(V(at.x - 40, 1200, at.z + 200), V(at.x + 4, 40, at.z), { width: 1.5 }));
    // keep the air over the gate clear for the head reveal: the blast sits low behind the wall, the steam billows on the flanks
    safe(() => ctx.fx?.explosion?.(V(at.x, 8, at.z + 24), 32));
    for (const sx of [-1, 1]) {
      safe(() => ctx.fx?.eruption?.(V(sx * 58, 55, at.z - 10), 34, { count: 35 }));
      safe(() => ctx.fx?.steam?.(V(sx * 50, 35, at.z - 12), 28, 5, { intensity: 1 }));
    }
    domFlash(0.95, '255,238,160'); safe(() => ctx.post?.flash?.(0.2, { r: 1, g: 0.93, b: 0.55 }));
    safe(() => ctx.post?.shockwave?.(at, 0.8));
    audio('transform', { position: at, volume: 1.4 });
    ctx.shake(1.2, { duration: 1.6 });
    C.jolt(1.2);
    birds.scatter(at);
    safe(() => civs()?.look?.(V(0, 60, 420), 7));
  }
  function onGrip(p) {
    if (!S.playing) return;
    const pt = p?.point || V(0, W.height, W.radius + 4);
    // stone only at the parapet; a small puff well below it on the OUTER face so nothing hangs between the lens and the head
    safe(() => ctx.fx?.debris?.(pt, 30, 16, { type: 'stone', size: 1.3, spread: 6 }));
    safe(() => ctx.fx?.dust?.(V(pt.x, Math.min(38, pt.y - 12), W.radius + W.thickness + 4), 9, {}));
    audio('wall_break', { position: pt, volume: 1.1 });
    ctx.shake(0.8, { at: pt, radius: 700 });
    C.jolt(0.8); S.gripJolt = 0.6;
  }
  function onKick(p) {
    if (!S.playing || S.kicked) return;
    S.kicked = true;
    const pt = p?.point || V(0, 8, W.radius + 4);
    safe(() => { if (!ctx.world?.breached) ctx.world?.breach?.(); });
    S.slow = 3.2; // seconds of slow motion (real time)
    domFlash(0.55, '255,220,170');
    safe(() => ctx.post?.punch?.(1.2));
    audio('wall_break', { position: pt, volume: 1.5 });
    audio('boom', { position: pt, volume: 1.4, rate: 0.7 });
    ctx.shake(1.3, { duration: 2.0 });
    C.jolt(1.3);
    safe(() => ctx.fx?.dust?.(V(0, 12, W.radius - 6), 70, { speed: 1.5 }));
    safe(() => ctx.fx?.debris?.(V(0, 15, W.radius), 80, 40, { type: 'wall', size: 2.2, spread: 18 }));
    // a spray of boulders over the town
    const targets = [];
    const bs = (ctx.world?.buildings || []).filter((b) => b.box && !b.destroyed && b.box.max.z < 360 && b.box.min.z > 200 && Math.abs((b.box.min.x + b.box.max.x) / 2) < 90);
    for (let i = 0; i < 9; i++) {
      const b = bs.length ? bs[(Math.random() * bs.length) | 0] : null;
      targets.push(b ? V((b.box.min.x + b.box.max.x) / 2, b.box.max.y, (b.box.min.z + b.box.max.z) / 2) : V(rnd(-60, 60), 0, rnd(220, 340)));
    }
    for (const tg of targets) throwBoulder(V(rnd(-14, 14), rnd(8, 30), W.radius + rnd(0, 6)), tg, rnd(1.8, 3.2), rnd(2.5, 5));
  }
  function throwBoulder(from, to, T, size) {
    const vel = new THREE.Vector3().subVectors(to, from).divideScalar(T);
    vel.y += 0.5 * 9.8 * T;
    return safe(() => ctx.fx?.projectile?.({ pos: from, vel, size, onImpact: (p) => { safe(() => ctx.world?.damage?.(p, size * 2.2, 3)); audio('rubble', { position: p, volume: 1 }); } }));
  }
  function launchTracked() {
    const tgt = roofNear(-20, 282, 6, 20);
    const from = V(6, 30, W.radius + 2);
    const T = 2.4;
    const vel = new THREE.Vector3().subVectors(tgt, from).divideScalar(T); vel.y += 0.5 * 9.8 * T;
    S.boulderHit = null; S.boulderLast = null;
    S.boulder = safe(() => ctx.fx?.projectile?.({
      pos: from, vel, size: 5.5, onImpact: (p) => {
        S.boulderHit = p.clone();
        safe(() => ctx.world?.damage?.(p, 14, 4));
        audio('boom', { position: p, volume: 1.2 }); audio('rubble', { position: p, volume: 1 });
        C.jolt(0.9);
      },
    }));
    if (!S.boulder) { S.boulder = { pos: from.clone(), alive: true, vel }; S.fakeBoulder = true; } else S.fakeBoulder = false;
  }
  function dustWave() {
    S.wave = { t: 0, z: W.radius - 5 };
  }
  function setupVictim() {
    const C0 = civs();
    const p = V(-13, 0, W.radius - 16); p.y = ground(p.x, p.z);
    let v = null;
    safe(() => { v = C0?.spawn?.(p, { state: 'cower' }); });
    if (v) { v.state = 'cower'; v.cowerK = 1; v.yaw = Math.PI + 0.4; v.female = true; }
    S.victim = v; S.victimUp = false;
    hand.position.copy(p).add(_v.set(0, 1.2, 0));
    audio('scream', { position: p, volume: 1.2, rate: 1.2 });
    // the giant looks down at it
    safe(() => G()?.lookAt?.(p));
  }
  function grabVictim() {
    const v = S.victim;
    const g = G();
    S.victimAPI = false;
    // the giant's public eat(civ, hand) if it exists; otherwise stage it with the proxy hand
    if (v && g?.active) {
      if (typeof g.eat === 'function') { try { S.victimAPI = g.eat(v, 'R') !== false; } catch (e) { console.warn('[intro] eat', e); S.victimAPI = false; } }
    }
    if (S.victimAPI) { S.victimUp = true; return; }
    S.lift = { t: 0, from: hand.position.clone(), delay: 1.3 };
    S.victimUp = true;
  }
  function bite() {
    if (S.victimAPI) return; // the giant bites on its own (blood + crunch)
    const hp = head(_v2);
    const mouth = V(hp.x, hp.y - 6, hp.z - 7);
    if (S.victim) safe(() => civs()?.eaten?.(S.victim));
    S.lift = null;
    for (let i = 0; i < 6; i++) safe(() => ctx.fx?.blood?.(mouth.clone().add(V(rnd(-1.5, 1.5), rnd(-1, 1), rnd(-1.5, 1.5))), V(rnd(-1, 1), rnd(-0.2, 0.8), -1).normalize()));
    audio('crunch', { position: mouth, volume: 1.4 });
  }
  function chew() {
    safe(() => G()?.chew?.());
    safe(() => G()?.lookAt?.(ctx.camera.position));
    S.chewT = 0;
  }
  function placePlayer() {
    const P = S.playerSpot;
    const hp = head(_v2);
    const yaw = Math.atan2(hp.x - P.x, hp.z - P.z);
    safe(() => ctx.player?.teleport?.(P.clone().add(V(0, 0.05, 0)), yaw));
    safe(() => ctx.player?.setEnabled?.(false));
  }

  // ------------------------------------------------------------------ control
  function start() {
    if (S.playing || S.started) return;
    S.started = true; S.playing = true; S.t = 0; S.shot = -1; S.fired = 0; S.slow = 0; S.gripJolt = 0;
    S.playerSpot = safe(vantage) || roofNear(-18, 262, 7, 18);
    EVENTS = [];
    SHOTS = buildTimeline();
    ctx.mode = 'intro'; ctx.cameraOwner = 'intro';
    safe(() => ctx.hud?.letterbox?.(true));
    safe(() => ctx.hud?.toast?.('Hold SPACE to skip'));
    safe(() => ctx.player?.setEnabled?.(false));
    safe(() => { const g = G(); if (g?.active) g.hide?.(); });
    // townsfolk going about their day
    safe(() => {
      const c = civs();
      if (c) {
        c.spawnCrowd(34, { center: V(0, 0, 296), radius: 22 }, { state: 'calm', roofFrac: 0 });
        c.spawnCrowd(26, { center: V(-10, 0, 250), radius: 40 }, { state: 'calm', roofFrac: 0.1 });
      }
    });
    placePlayer();
  }
  function finish(skipped = false) {
    if (!S.playing) return;
    S.playing = false;
    ctx.clock.timeScale = 1;
    safe(() => ctx.post?.setSlowmo?.(0));
    safe(() => ctx.hud?.letterbox?.(false));
    safe(() => ctx.hud?.subtitle?.(''));
    birds.hide();
    S.flash = 0; if (flashEl) flashEl.style.opacity = '0';
    lowKey(false); shoulderSteam(false);
    S.lift = null;
    if (skipped) {
      safe(() => { const g = G(); if (g && !g.active) (g.show || g.appear)?.call(g); });
      safe(() => { if (!ctx.world?.breached) ctx.world?.breach?.(); });
      safe(() => civs()?.panic?.());
      safe(() => ctx.sky?.setMood?.('inferno', 2));
      placePlayer();
    }
    safe(() => G()?.lookAt?.(null));
    ctx.cameraOwner = 'player';
    const hasDirector = !!(ctx.director && ctx.director.startFight);
    safe(() => G()?.startFight?.());
    ctx.events.emit('intro:done', { skipped });
    if (!hasDirector) {
      safe(() => G()?.startFight?.());
      ctx.mode = 'play';
      safe(() => ctx.player?.setEnabled?.(true));
      safe(() => ctx.audio?.music?.('combat'));
    }
  }
  function skip() {
    if (S.fightShots) { endFight(); return; }
    finish(true);
  }

  // ------------------------------------------------------------------ fight cinematics
  function playFight(name) {
    const g = G();
    if (!g?.object) return false;
    if (ctx.mode !== 'play' && name !== 'kill') return false;
    const shots = [];
    const at = [];
    const P = ctx.player?.position?.clone?.() || V(0, 20, 250);
    if (name === 'phase2') {
      // it tears free and smashes through the breach
      shots.push({ dur: 4.2, cam: (u) => {
        const hp = head(_v2); const a = lerp(-0.9, -0.2, ease.inOut(u));
        C.pos.set(hp.x + Math.sin(a) * 150, lerp(30, 45, u), hp.z - Math.cos(a) * 150); C.target.copy(hp).add(_v.set(0, -20, 0)); C.fov = 50; C.hand = 0.6;
      } });
      at.push([0.2, () => { ctx.shake(0.8, { duration: 1.5 }); C.jolt(0.8); }]);
    } else if (name === 'phase3') {
      // steam eruption
      shots.push({ dur: 3.6, cam: (u) => {
        const hp = head(_v2);
        C.pos.set(hp.x - 60 - u * 40, hp.y - 20 + u * 10, hp.z - 90 - u * 50); C.target.copy(hp).add(_v.set(0, -25, 0)); C.fov = lerp(40, 55, u); C.hand = 0.7;
      } });
      at.push([0.3, () => { const hp = head(_v2); safe(() => ctx.fx?.eruption?.(hp.clone().add(V(0, -25, 0)), 60, {})); ctx.shake(0.9, { duration: 1.2 }); C.jolt(1); audio('steam', { position: hp, volume: 1.4 }); }]);
    } else if (name === 'kill') {
      // extreme slow-mo orbit around the soldier at the nape, blood + steam, then the giant falls onto the town
      const nape = (g.nape?.position?.clone?.()) || head(V()).add(V(0, -6, 8));
      shots.push({ dur: 4.2, enter: () => { ctx.clock.timeScale = 0.12; safe(() => ctx.post?.setSlowmo?.(1)); }, cam: (u) => {
        const c = ctx.player?.position || nape;
        const a = lerp(-1.2, 1.4, ease.inOut(u));
        C.pos.set(c.x + Math.sin(a) * 7, c.y + 2 + u * 1.5, c.z + Math.cos(a) * 7); C.target.copy(c); C.fov = lerp(40, 32, u); C.hand = 0.15;
      } });
      shots.push({ dur: 5.5, enter: () => { ctx.clock.timeScale = 1; safe(() => ctx.post?.setSlowmo?.(0)); }, cam: (u) => {
        const hp = head(_v2);
        C.pos.set(-150, 34, 210); C.target.lerpVectors(hp, V(0, 5, 320), ease.inOut(u)); C.fov = 50; C.hand = 0.5;
      } });
      shots.push({ dur: 2.2, cam: () => { C.hand = 0.3; } });
      at.push([0.1, () => {
        for (let i = 0; i < 8; i++) safe(() => ctx.fx?.blood?.(nape.clone().add(V(rnd(-2, 2), rnd(-1, 1), rnd(-2, 2))), V(rnd(-1, 1), rnd(0, 1), rnd(-1, 1)).normalize()));
        safe(() => ctx.fx?.steamJet?.(nape.clone(), V(0, 1, 0.4), 30, 6, {}));
        audio('nape_kill', { position: nape, volume: 1.4 });
      }]);
      at.push([6.5, () => {
        const fall = V(0, 0, W.radius - 45);
        safe(() => ctx.fx?.stomp?.(fall, 120, {}));
        safe(() => ctx.fx?.eruption?.(fall.clone().setY(20), 80, {}));
        safe(() => ctx.world?.damage?.(fall.clone().setY(10), 45, 5));
        safe(() => civs()?.crush?.(fall, 40));
        ctx.shake(1.5, { duration: 2.5 }); C.jolt(1.5);
        audio('boom', { position: fall, volume: 1.5, rate: 0.6 }); audio('rubble', { position: fall, volume: 1.2 });
      }]);
    } else return false;
    // timeline
    let T = 0; for (const s of shots) { s.t0 = T; T += s.dur; s.t1 = T; }
    S.fightShots = { name, shots, at: at.sort((a, b) => a[0] - b[0]), t: 0, fired: 0, cur: -1, total: T, prevOwner: ctx.cameraOwner };
    ctx.cameraOwner = 'intro';
    safe(() => ctx.hud?.letterbox?.(true));
    return true;
  }
  function endFight() {
    const f = S.fightShots; if (!f) return;
    S.fightShots = null;
    ctx.clock.timeScale = 1;
    safe(() => ctx.post?.setSlowmo?.(0));
    safe(() => ctx.hud?.letterbox?.(false));
    if (ctx.cameraOwner === 'intro') ctx.cameraOwner = f.prevOwner === 'intro' ? 'player' : f.prevOwner;
    if (f.name === 'kill') sendVictory();
  }
  ctx.events.on('colossal:phase', (e) => { const ph = e?.phase | 0; if (ph === 2) playFight('phase2'); else if (ph === 3) playFight('phase3'); });
  // kill cam; victory ALWAYS follows (hard fallback timer even if the cinematic can't play or gets stuck)
  let victorySent = false;
  const sendVictory = () => { if (victorySent) return; victorySent = true; ctx.events.emit('victory:cinematic-done', {}); };
  ctx.events.on('victory:cinematic-done', () => { victorySent = true; });
  ctx.events.on('colossal:killed', () => {
    victorySent = false;
    const ok = safe(() => playFight('kill'));
    setTimeout(sendVictory, ok ? 16000 : 2500);
  });
  ctx.events.on('colossal:grip', (e) => onGrip(e));
  ctx.events.on('colossal:kick', (e) => { if (S.playing) onKick(e); });
  ctx.events.on('loaded', () => {
    // intro=1 straight into the cinematic if the director didn't start it
    if (ctx.params.intro === '1' && !ctx.params.cam) setTimeout(() => { if (!S.started && (ctx.mode === 'loading' || ctx.mode === 'title' || ctx.mode === 'intro')) start(); }, 0);
  });

  // ------------------------------------------------------------------ frame
  function update(dt, time, rawDt) {
    const rdt = rawDt ?? dt;
    birds.update(rdt, time);
    tickFlash(rdt);
    if (S.fightShots) { updateFight(rdt); return; }
    if (!S.playing) return;
    // hold SPACE / ESC to skip
    const inp = ctx.input;
    if (inp && (inp.down('Space') || inp.down('Escape'))) { S.skipHold += rdt; if (S.skipHold > 1) { skip(); return; } }
    else S.skipHold = 0;
    // hold a shot at its last frame while its gate (e.g. "the head has cleared the wall") isn't met yet
    const cur = SHOTS.find((sh) => S.t >= sh.t0 && S.t < sh.t1);
    let hold = false;
    if (cur && cur.until && S.t + rdt >= cur.t1 - 1e-3 && cur.held < cur.maxHold) {
      let ok = true; try { ok = !!cur.until(); } catch (e) { ok = true; }
      if (!ok) { hold = true; cur.held += rdt; }
    }
    if (!hold) S.t += rdt;
    // events
    while (S.fired < EVENTS.length && EVENTS[S.fired][0] <= S.t) { const fn = EVENTS[S.fired++][1]; safe(fn); }
    // slow motion after the kick
    if (S.slow > 0) {
      S.slow -= rdt;
      const k = S.slow > 0.9 ? 1 : clamp(S.slow / 0.9, 0, 1);
      ctx.clock.timeScale = lerp(1, 0.22, k);
      safe(() => ctx.post?.setSlowmo?.(k));
      if (S.slow <= 0) { ctx.clock.timeScale = 1; safe(() => ctx.post?.setSlowmo?.(0)); }
    }
    S.gripJolt = Math.max(0, (S.gripJolt || 0) - rdt * 0.8);
    followShoulderSteam();
    // fake boulder (if fx has no projectile)
    if (S.fakeBoulder && S.boulder?.alive) {
      S.boulder.vel.y -= 9.8 * dt; S.boulder.pos.addScaledVector(S.boulder.vel, dt);
      if (S.boulder.pos.y < ground(S.boulder.pos.x, S.boulder.pos.z)) { S.boulder.alive = false; S.boulderHit = S.boulder.pos.clone(); }
    }
    // the dust wave
    if (S.wave) {
      const w = S.wave; w.t += rdt;
      w.acc = (w.acc || 0) + rdt;
      while (w.acc > 0.09) {
        w.acc -= 0.09;
        w.z -= 4.2;
        for (let i = -1; i <= 1; i++) safe(() => ctx.fx?.dust?.(V(i * 9 + rnd(-3, 3), 1.5, w.z), rnd(24, 34), { speed: 1.6 }));
      }
      if (w.z < 240) { S.wave = null; domFlash(0.45, '190,168,132'); }
    }
    // victim lift (fallback staging)
    if (S.lift) {
      S.lift.t += rdt;
      if (S.lift.delay > 0) {
        if (S.lift.t < S.lift.delay) return void runShots(rdt);
        S.lift.delay = 0; S.lift.t = 0;
        if (S.victim) safe(() => civs()?.pickUp?.(S.victim, hand));
        ctx.shake(0.6, { at: hand.position, radius: 200 }); C.jolt(0.7);
        safe(() => ctx.fx?.dust?.(hand.position.clone(), 16, {}));
        audio('grab', { position: hand.position, volume: 1.2 });
      }
      const hp = head(_v2);
      const mouth = _v3.set(hp.x, hp.y - 6, hp.z - 9);
      const k = ease.inOut(S.lift.t / 2.1);
      const kk = ease.out(Math.min(1, S.lift.t / 0.35));
      hand.position.copy(S.lift.from).lerp(mouth, k);
      hand.position.y += kk * 6 * (1 - k);
      hand.updateMatrixWorld();
    }
    runShots(rdt);
  }
  function runShots(rdt) {
    let i = SHOTS.findIndex((s) => S.t >= s.t0 && S.t < s.t1);
    if (i < 0 && S.t >= S.total) { finish(false); return; }
    if (i >= 0) {
      const s = SHOTS[i];
      if (i !== S.shot) { S.shot = i; C.t = Math.random() * 100; if (s.enter) safe(s.enter); }
      safe(() => s.cam((S.t - s.t0) / (s.t1 - s.t0), S.t - s.t0, rdt));
      C.apply(rdt);
    }
  }
  function updateFight(rdt) {
    const f = S.fightShots;
    f.t += rdt;
    // never trap the camera: bail out if someone else took it, the player died, or it overran
    if (ctx.cameraOwner !== 'intro' || (f.name !== 'kill' && ctx.mode !== 'play') || f.t > f.total + 1) { endFight(); return; }
    while (f.fired < f.at.length && f.at[f.fired][0] <= f.t) { const fn = f.at[f.fired++][1]; safe(fn); }
    const i = f.shots.findIndex((s) => f.t >= s.t0 && f.t < s.t1);
    if (i < 0) { endFight(); return; }
    const s = f.shots[i];
    if (i !== f.cur) { f.cur = i; if (s.enter) safe(s.enter); }
    safe(() => s.cam((f.t - s.t0) / s.dur));
    C.apply(rdt);
    const inp = ctx.input;
    if (inp && (inp.down('Space') || inp.down('Escape'))) { S.skipHold += rdt; if (S.skipHold > 0.6) { S.skipHold = 0; endFight(); } } else S.skipHold = 0;
  }

  return sys;
}
