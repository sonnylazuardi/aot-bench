// PLAYER — Survey Corps soldier with ODM gear (ctx.player). See CONTRACT.md.
//   position = FEET (world). center = body centre (physics point, ~0.92 m above the feet when upright).
//   Controls: mouse aim (click to lock) · LMB / RMB (or Q / E toggle) = left / right hook, hold to stay attached ·
//   SPACE = gas: reel toward the anchor(s) + boost along aim (jump on the ground) · SHIFT = strong reel / sprint ·
//   WASD = run / air control · F or MMB = spinning slash · R = swap blades · TAB toggle / hold C = soft lock-on.
// Physics: 120 Hz+ substeps (more at speed so the body never moves > 0.3 m per step), rope = inequality constraint
// with auto take-up (distance can shrink, never grow), momentum kept on release.
import * as THREE from 'three';
import { buildCharacter, BI, RIG } from './character.js';
import { makePose, zeroPose, addPose, finishPose, applyPose, POSE } from './pose.js';
import { createCloak } from './cloak.js';
import { createCables } from './cables.js';
import { createTrails, createGasJet, createSpeedLines } from './trails.js';

const H = 0.92;                 // body centre above the feet
const R_BODY = 0.4, R_LOW = 0.36, LOW_OFF = 0.52;
const T = {
  G: 17, maxFall: 62,
  run: 7.2, sprint: 11.5, groundAcc: 55, groundDec: 38, jump: 8.4, coyote: 0.12,
  airAcc: 6.5, swingAcc: 12,
  range: 80, hookSpeed: 220, retract: 120, minLen: 1.6,
  reelAcc: 26, reelWinch: 8, strongAcc: 46, strongWinch: 18, aimBoost: 11,
  boostAcc: 21, boostLift: 6.5,
  drainReel: 0.05, drainStrong: 0.09, drainBoost: 0.065, regen: 0.035,
  vSoft: 43, vMax: 72,
  relBoost: 2.2, relPop: 2.6,
  slashDur: 0.5, slashRadius: 3.0,
};
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const clamp = THREE.MathUtils.clamp;
const damp = (a, b, r, dt) => a + (b - a) * (1 - Math.exp(-r * dt));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const angWrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export async function create(ctx) {
  const { scene, LAYOUT, camera } = ctx;
  const input = ctx.input;

  // ------------------------------------------------------------------ visuals
  const char = buildCharacter();
  scene.add(char.root);
  const bones = char.bones;
  const cloak = createCloak(scene, bones);
  const cables = createCables(scene);
  const trails = createTrails(scene);
  const jet = createGasJet(scene);
  const streaks = createSpeedLines(scene);

  // ------------------------------------------------------------------ state
  const C = new THREE.Vector3(LAYOUT.playerStart.x, H, LAYOUT.playerStart.z); // body centre
  const vel = new THREE.Vector3();
  const position = new THREE.Vector3();
  const S = {
    mode: 'ground', modeT: 0, airT: 0, coyote: 0, facing: LAYOUT.playerStart.yaw || 0,
    groundY: 0, groundKind: 'ground', groundN: new THREE.Vector3(0, 1, 0),
    wallN: new THREE.Vector3(), wallT: 0, wallLost: 0, wallCd: 0,
    land: { t: 9, dur: 0, sev: 0, roll: false },
    slashT: -1, slashHit: false, slashCd: 0, slashAxis: new THREE.Vector3(0, 1, 0),
    boosting: 0, reeling: 0, strong: 0, thrust: 0, gasPuffT: 0, gasSoundT: 0, gasEmptyPlayed: false,
    hurtT: 9, invuln: 0,
    grab: null, deadT: 0, deathCause: '',
    lockOn: false, lockTarget: null,
    hitstop: null,
    lastMouse: 9, aimArm: { L: 0, R: 0 }, aimArmDir: { L: new THREE.Vector3(), R: new THREE.Vector3() },
    speed: 0, prevVel: new THREE.Vector3(), accel: new THREE.Vector3(), bank: 0,
    runPhase: 0, wallPhase: 0,
    kills: 0, time: 0, cling: null, clingCd: 0, tumble: 0, carry: new THREE.Vector3(), wallKind: '', lockHold: null, steam: new THREE.Vector3(),
  };
  const mkHook = (side) => ({ side, active: false, attached: false, point: new THREE.Vector3(), state: 'idle',
    tip: new THREE.Vector3(), target: new THREE.Vector3(), travel: 0, dist: 0, len: 0, miss: false,
    anchor: null, local: new THREE.Vector3(), normal: new THREE.Vector3(), kind: '', ref: null,
    tension: 0, slack: 0, reeling: false, held: false, toggle: false, t: 0,
    vA: new THREE.Vector3(), prevPoint: new THREE.Vector3(), nLocal: new THREE.Vector3(), nWorld: new THREE.Vector3(0, 1, 0), moving: false });
  const hooks = [mkHook('L'), mkHook('R')];
  const blades = { count: 8, durability: 1 };
  const aimHit = { valid: false, point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, kind: '', inRange: false, titan: false };

  // ------------------------------------------------------------------ temps
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
  const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
  const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _aim = new THREE.Vector3();
  const launchers = [new THREE.Vector3(), new THREE.Vector3()];
  const nozzleW = new THREE.Vector3(), exhaust = new THREE.Vector3();
  const bladeB = { L: new THREE.Vector3(), R: new THREE.Vector3() }, bladeT = { L: new THREE.Vector3(), R: new THREE.Vector3() };

  const aimDir = (out) => out.set(Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), Math.cos(player.yaw) * Math.cos(player.pitch));
  const camFlat = () => { _fwd.set(Math.sin(player.yaw), 0, Math.cos(player.yaw)); _right.set(-Math.cos(player.yaw), 0, Math.sin(player.yaw)); };
  const audio = (name, o) => { try { ctx.audio?.play?.(name, o); } catch (e) { /* audio optional */ } };
  const fx = (name, ...a) => { try { return ctx.fx?.[name]?.(...a); } catch (e) { return null; } };
  const emit = (name, p) => ctx.events.emit(name, p);
  const setMode = (m) => { if (S.mode !== m) { S.mode = m; S.modeT = 0; } };

  // ------------------------------------------------------------------ hooks
  const hookPoint = (h, out) => {
    if (h.anchor) { out.copy(h.local); h.anchor.localToWorld(out); return out; }
    return out.copy(h.point);
  };
  const assistDirs = [];
  for (const [a, n] of [[0.04, 6], [0.085, 8]]) for (let i = 0; i < n; i++) assistDirs.push([a * Math.cos((i / n) * Math.PI * 2), a * Math.sin((i / n) * Math.PI * 2)]);
  // raycast along the aim with a small magnetism cone; returns hit or null
  function aimCast(o, d, maxD) {
    let h = ctx.physics.raycast(o, d, maxD);
    if (h && h.kind !== 'ground') return h;
    const base = h;
    // cone: rotate d by small yaw/pitch offsets in the camera basis
    _v4.crossVectors(d, UP); if (_v4.lengthSq() < 1e-6) _v4.set(1, 0, 0); _v4.normalize();
    _v5.crossVectors(_v4, d).normalize();
    for (const [a, b] of assistDirs) {
      _v3.copy(d).addScaledVector(_v4, a).addScaledVector(_v5, b).normalize();
      const hh = ctx.physics.raycast(o, _v3, maxD);
      if (hh && hh.kind !== 'ground') return hh;
    }
    return base;
  }
  function fireHook(h) {
    if (S.mode === 'dead' || S.mode === 'grabbed') return;
    const L = launchers[h.side === 'L' ? 0 : 1];
    getAim(_o, _d);
    // slight left/right divergence so two hooks on one spot land a body-width apart
    _q.setFromAxisAngle(UP, (h.side === 'L' ? 1 : -1) * 0.012); _d.applyQuaternion(_q);
    let hit = null;
    const tgt = S.lockTarget;
    if (tgt && tgt.position) { // lock-on: hooks go for the flesh around the target (shoulders / wrist / ankle)
      _v.copy(tgt.position).sub(C);
      const dd = _v.length(); _v.divideScalar(dd || 1);
      if (_v.dot(_d) > 0.75 && dd < T.range + 8) {
        const sc = Math.max(1.2, (tgt.radius || 1) * 1.4);
        _v2.crossVectors(UP, _v).normalize().multiplyScalar(h.side === 'L' ? sc : -sc);
        _v3.copy(tgt.position).add(_v2).addScaledVector(UP, -sc * 0.35).sub(L); const ld = _v3.length(); _v3.divideScalar(ld);
        hit = ctx.physics.raycast(L, _v3, ld + 6);
        if (!hit) { _v3.copy(tgt.position).sub(L); const l2 = _v3.length(); _v3.divideScalar(l2); hit = ctx.physics.raycast(L, _v3, l2 + 6); }
        if (hit && hit.point.distanceTo(L) > T.range + 8) hit = null;
      }
    }
    if (!hit) {
      const t0 = Math.max(0, _v.copy(C).sub(_o).dot(_d) - 0.5);
      _o.addScaledVector(_d, t0);
      hit = aimCast(_o, _d, T.range + 2);
      if (hit && hit.point.distanceTo(L) > T.range) hit = null;
    }
    h.state = 'fly'; h.active = true; h.attached = false; h.travel = 0; h.t = 0; h.tip.copy(L);
    h.anchor = null; h.ref = null;
    if (hit) {
      h.miss = false; h.target.copy(hit.point); h.point.copy(hit.point); h.normal.copy(hit.normal || UP); h.kind = hit.kind || '';
      h.ref = hit.ref || null;
      if (hit.anchor && hit.local) {
        h.anchor = hit.anchor; h.local.copy(hit.local);
        hit.anchor.updateMatrixWorld?.();
        _m.copy(hit.anchor.matrixWorld).invert(); h.nLocal.copy(h.normal).transformDirection(_m);
      }
      h.moving = !!h.anchor;
      h.hit = hit;
    } else {
      h.miss = true; h.target.copy(L).addScaledVector(_d, T.range); h.point.copy(h.target); h.kind = ''; h.hit = null;
    }
    h.dist = h.target.distanceTo(L);
    S.aimArm[h.side] = 1; S.aimArmDir[h.side].copy(h.target).sub(C).normalize();
    emit('hook:fire', { side: h.side });
    audio('hook_fire', { position: L, volume: 0.9 });
  }
  function releaseHook(h, silent) {
    if (h.state === 'idle') return;
    const wasAttached = h.state === 'attached';
    h.state = 'retract'; h.attached = false; h.reeling = false;
    if (wasAttached && !silent) { // release fling: keep momentum, add a little
      const sp = vel.length();
      if (sp > 8 && !hooks[0].attached && !hooks[1].attached) {
        vel.multiplyScalar((sp + T.relBoost) / sp);
        if (vel.y > -3) vel.y += T.relPop;
        ctx.cam?.fovKick?.(0.25);
      }
    }
  }
  function updateHooks(dt) {
    for (let i = 0; i < 2; i++) {
      const h = hooks[i], L = launchers[i];
      h.t += dt;
      if (h.state === 'fly') {
        if (!h.held) { releaseHook(h, true); continue; }
        if (h.anchor) { hookPoint(h, h.target); h.dist = h.target.distanceTo(L); }
        h.travel += T.hookSpeed * dt;
        const k = Math.min(1, h.travel / Math.max(0.01, h.dist));
        h.tip.copy(L).lerp(h.target, k);
        if (k >= 1) {
          if (h.miss) { releaseHook(h, true); continue; }
          h.state = 'attached'; h.attached = true; h.point.copy(h.target); h.prevPoint.copy(h.target); h.vA.set(0, 0, 0);
          if (!h.moving) h.nWorld.copy(h.normal); else h.nWorld.copy(h.nLocal).transformDirection(h.anchor.matrixWorld);
          h.len = Math.max(T.minLen, C.distanceTo(h.target));
          h.tension = 0; h.slack = 0;
          emit('hook:attach', { side: h.side, hit: h.hit });
          audio('hook_hit', { position: h.target, volume: 0.9 });
          if (h.kind === 'titan' || h.kind === 'colossal') fx('blood', h.target, h.normal);
          else { fx('sparks', h.target, h.normal); fx('dust', h.target, 0.6, { count: 6 }); }
          ctx.cam?.impact?.(0.06);
        }
      } else if (h.state === 'attached') {
        h.prevPoint.copy(h.point);
        hookPoint(h, h.point); h.tip.copy(h.point);
        if (h.moving) {
          if (h.kind === 'colossal' && ctx.colossal?.velocityAt) ctx.colossal.velocityAt(h.point, h.vA);
          else if (dt > 1e-4 && h.t > dt * 1.5) { h.vA.copy(h.point).sub(h.prevPoint).divideScalar(dt); if (h.vA.length() > 40) h.vA.setLength(40); }
          h.nWorld.copy(h.nLocal).transformDirection(h.anchor.matrixWorld);
        } else { h.vA.set(0, 0, 0); h.nWorld.copy(h.normal); }
        const dead = h.ref && (h.ref.alive === false || h.ref.state === 'dead');
        if (!h.held || dead) releaseHook(h, dead);
      } else if (h.state === 'retract') {
        _v.copy(L).sub(h.tip); const d = _v.length();
        const step = T.retract * dt;
        if (d <= step + 0.05) { h.state = 'idle'; h.active = false; h.tip.copy(L); }
        else h.tip.addScaledVector(_v, step / d);
      }
      h.active = h.state === 'fly' || h.state === 'attached';
    }
  }

  // ------------------------------------------------------------------ aim ray (from the camera)
  function getAim(o, d) {
    if (ctx.cam?.getAimRay) ctx.cam.getAimRay(o, d);
    else { o.copy(camera.position); aimDir(d); }
    return d;
  }
  function updateAimHit() {
    getAim(_o, _d);
    const t0 = Math.max(0, _v.copy(C).sub(_o).dot(_d) - 0.5);
    _o.addScaledVector(_d, t0);
    const h = ctx.physics.raycast(_o, _d, T.range + 40);
    aimHit.valid = !!h;
    if (h) {
      aimHit.point.copy(h.point); aimHit.normal.copy(h.normal || UP); aimHit.kind = h.kind || '';
      aimHit.distance = h.point.distanceTo(C); aimHit.inRange = aimHit.distance <= T.range; aimHit.titan = h.kind === 'titan' || h.kind === 'colossal';
    } else { aimHit.inRange = false; aimHit.titan = false; aimHit.distance = 0; aimHit.kind = ''; }
  }

  // ------------------------------------------------------------------ collision
  const col = { hitGround: false, hitWall: false, n: new THREE.Vector3(), wallN: new THREE.Vector3(), groundY: 0, kind: '', into: 0 };
  function resolve(center, r, attached) {
    const hits = ctx.physics.collideSphere(center, r);
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i]; if (!h || !h.normal || !(h.depth > 0)) continue;
      const n = h.normal, dep = Math.min(h.depth, 1.5);
      C.addScaledVector(n, dep); center.addScaledVector(n, dep);
      const vn = vel.dot(n);
      if (n.y > 0.6) { col.hitGround = true; col.groundY = C.y - H; col.kind = h.kind || 'ground'; col.n.copy(n); }
      else if (Math.abs(n.y) < 0.55) { col.hitWall = true; col.wallN.copy(n); col.into = Math.max(col.into, -vn); col.kind = h.kind || col.kind; }
      if (vn < 0) {
        vel.addScaledVector(n, -vn);
        if (Math.abs(n.y) < 0.55) { const f = attached ? 0.5 : 1.5; vel.x *= 1 - Math.min(0.3, f * 0.016); vel.z *= 1 - Math.min(0.3, f * 0.016); }
      }
    }
  }
  const low = new THREE.Vector3(), mid = new THREE.Vector3(), cmid = new THREE.Vector3(), _fxp = new THREE.Vector3();
  function collideBody(attached) {
    col.hitGround = false; col.hitWall = false; col.into = 0;
    cmid.copy(C); resolve(cmid, R_BODY, attached);
    low.copy(C); low.y -= LOW_OFF; resolve(low, R_LOW, attached);
  }
  function probeGround(maxDown) {
    _o.copy(C); _o.y += 0.2;
    const h = ctx.physics.raycast(_o, DOWN, H + 0.2 + maxDown);
    if (h && h.normal.y > 0.55) return h;
    return null;
  }

  // ------------------------------------------------------------------ state changes
  function landOn(y, kind, impact, hs) {
    C.y = y + H; S.groundY = y; S.groundKind = kind || 'ground';
    const sev = clamp((impact - 8) / 22, 0, 1);
    S.land.t = 0; S.land.sev = sev; S.land.roll = false; S.land.dur = 0;
    if (impact > 13 && hs > 7) { S.land.roll = true; S.land.dur = 0.55; vel.multiplyScalar(0.85); }
    else if (impact > 9) { S.land.dur = 0.18 + 0.35 * sev; if (sev > 0.5) { vel.x *= 0.35; vel.z *= 0.35; } }
    else if (impact > 4) S.land.dur = 0.14;
    vel.y = 0;
    if (hs > 1) S.facing = Math.atan2(vel.x, vel.z);
    setMode('ground');
    if (impact > 6) {
      ctx.cam?.impact?.(0.15 + 0.6 * sev);
      if (sev > 0.3) ctx.shake(0.25 * sev, { at: C, radius: 30 });
      fx('dust', _fxp.set(C.x, y, C.z), 0.5 + sev, { count: 8 + (sev * 12) | 0 });
      audio(sev > 0.5 ? 'rubble' : 'hook_hit', { position: C, volume: 0.25 + 0.4 * sev, rate: 0.7 });
    }
  }
  function enterAir() { setMode('air'); S.airT = 0; }
  function enterWall(n, kind) {
    S.wallKind = kind || ''; S.wallN.copy(n); S.wallN.y = 0; S.wallN.normalize(); S.wallT = 0; S.wallLost = 0;
    setMode('wall');
    const into = -vel.dot(S.wallN);
    if (into > 0) vel.addScaledVector(S.wallN, into);
    vel.multiplyScalar(0.7);
    ctx.cam?.impact?.(clamp(into / 30, 0.05, 0.4));
    fx('dust', C, 0.4, { count: 5 });
    audio('hook_hit', { position: C, volume: 0.35, rate: 0.6 });
  }
  // clinging to a moving body (giant limb / back): position glued to the hook point along its surface normal
  function enterCling(hk) {
    S.cling = hk; S.wallN.copy(hk.nWorld); S.wallT = 0; S.wallLost = 0;
    setMode('wall');
    vel.copy(hk.vA);
    ctx.cam?.impact?.(0.25); ctx.shake(0.15);
    fx('blood', hk.point, hk.nWorld);
    audio('hook_hit', { position: hk.point, volume: 0.6, rate: 0.5 });
  }
  function stepCling(h, I) {
    const hk = S.cling;
    S.wallT += h;
    if (!hk.attached) { S.cling = null; enterAir(); vel.addScaledVector(S.wallN, 3); S.clingCd = 0.4; return; }
    S.wallN.copy(hk.nWorld);
    const tgt = _v.copy(hk.point).addScaledVector(hk.nWorld, 0.47);
    C.lerp(tgt, 1 - Math.exp(-30 * h));
    vel.copy(hk.vA);
    if (I.jumpPressed) { // kick off the body
      S.cling = null; releaseHook(hk, true);
      aimDir(_aim); vel.copy(hk.vA).addScaledVector(S.wallN, 10).addScaledVector(UP, 7).addScaledVector(_aim, 8);
      enterAir(); S.clingCd = 0.5; ctx.cam?.fovKick?.(0.4); return;
    }
    const other = hooks[0] === hk ? hooks[1] : hooks[0];
    if (other.attached && (I.gas || I.strong) && C.distanceTo(other.point) > 3) { S.cling = null; enterAir(); S.clingCd = 0.5; return; }
  }
  function wallKick() {
    camFlat(); aimDir(_aim);
    _v.copy(_aim).addScaledVector(S.wallN, -_aim.dot(S.wallN)); // aim along the wall plane
    vel.copy(S.wallN).multiplyScalar(11).addScaledVector(UP, 8.5).addScaledVector(_v, 7);
    enterAir(); S.wallCd = 0.35;
    ctx.cam?.fovKick?.(0.35);
    fx('dust', C, 0.5, { count: 6 });
    audio('hook_fire', { position: C, volume: 0.3, rate: 0.6 });
  }
  // mantle onto a ledge/roof if its top is within reach in front of (or above) the body
  function tryMantle(n) {
    _o.copy(C).addScaledVector(n, -0.55); _o.y += 2.4;
    const h = ctx.physics.raycast(_o, DOWN, 3.2);
    if (!h || h.normal.y < 0.7) return false;
    const rise = h.point.y - (C.y - H);
    if (rise < 0.35 || rise > 2.1) return false;
    vel.y = Math.sqrt(2 * T.G * (rise + 0.45));
    vel.addScaledVector(n, -3.2); // over the lip
    enterAir(); S.wallCd = 0.4;
    return true;
  }

  // ------------------------------------------------------------------ physics steps
  function stepGround(h, I) {
    camFlat();
    _v.set(0, 0, 0).addScaledVector(_fwd, I.my).addScaledVector(_right, I.mx);
    const mag = Math.min(1, _v.length()); if (mag > 1e-3) _v.divideScalar(Math.max(1e-3, _v.length()));
    const landing = S.land.t < S.land.dur;
    const locked = landing && !S.land.roll && S.land.sev > 0.5 && S.land.t < S.land.dur * 0.6;
    const target = locked ? 0 : (I.sprint ? T.sprint : T.run) * mag;
    const hvx = vel.x, hvz = vel.z;
    const wx = _v.x * target, wz = _v.z * target;
    const hsNow = Math.hypot(hvx, hvz);
    const rate = (target > hsNow ? T.groundAcc : hsNow > T.sprint ? 14 : T.groundDec) * h; // fast landings run out
    const dx = wx - hvx, dz = wz - hvz, dl = Math.hypot(dx, dz);
    if (S.land.roll && landing) { /* roll keeps momentum */ }
    else if (dl > rate) { vel.x += dx / dl * rate; vel.z += dz / dl * rate; } else { vel.x = wx; vel.z = wz; }
    if (mag > 0.1 && !locked) S.facing = angWrap(S.facing + clamp(angWrap(Math.atan2(_v.x, _v.z) - S.facing), -14 * h, 14 * h));
    vel.y = 0;
    C.x += vel.x * h; C.z += vel.z * h;
    collideBody(false);
    if (col.hitWall && mag > 0.3 && S.wallCd <= 0 && col.wallN.dot(_v) < -0.5) {
      if (tryMantle(col.wallN)) return;
    }
    const g = probeGround(0.45);
    if (g) {
      const dy = g.point.y - (C.y - H);
      C.y = dy > 0 ? g.point.y + H : damp(C.y, g.point.y + H, 30, h);
      S.groundY = g.point.y; S.groundKind = g.kind || 'ground'; S.coyote = T.coyote;
    } else {
      S.coyote -= h;
      if (S.coyote <= 0) enterAir();
    }
  }

  function stepAir(h, I, attachedN) {
    S.airT += h;
    camFlat(); aimDir(_aim);
    const acc = _v.set(0, -T.G, 0);
    const gasOK = player.gas > 0.001 && I.controllable;
    // anchor centre (midpoint of attached hooks)
    let anchorsN = 0; mid.set(0, 0, 0);
    for (const hk of hooks) if (hk.attached) { mid.add(hk.point); anchorsN++; }
    if (anchorsN) mid.divideScalar(anchorsN);
    S.reeling = 0; S.strong = 0; S.boosting = 0;
    // --- rope thrust (gas) toward the anchors + along the aim
    if (anchorsN && gasOK && (I.gas || I.strong)) {
      _v2.copy(mid).sub(C); const dist = _v2.length(); _v2.divideScalar(Math.max(dist, 1e-3));
      const strong = I.strong;
      const a = strong ? T.strongAcc : T.reelAcc;
      const near = smooth(1.5, 6, dist); // ease off at the anchor (no slamming through)
      acc.addScaledVector(_v2, a * near);
      if (I.gas) acc.addScaledVector(_aim, T.aimBoost);
      acc.y += T.G * (strong ? 0.85 : 0.7) * near; // gas + winch carry most of the weight (flies nearly straight at the anchor)
      S.reeling = 1; S.strong = strong ? 1 : 0;
      for (const hk of hooks) if (hk.attached) { hk.len = Math.max(T.minLen, hk.len - (strong ? T.strongWinch : T.reelWinch) * h * near); hk.reeling = true; }
      player.gas = Math.max(0, player.gas - (strong ? T.drainStrong : T.drainReel) * h);
    } else for (const hk of hooks) hk.reeling = false;
    // --- free gas boost along the aim
    if (!anchorsN && gasOK && I.gas && S.airT > 0.18) {
      acc.addScaledVector(_aim, T.boostAcc); acc.y += T.boostLift;
      S.boosting = 1;
      player.gas = Math.max(0, player.gas - T.drainBoost * h);
    }
    // --- air control (camera relative); attached: tangential only (pumping / steering the arc)
    if (I.controllable && (I.mx || I.my)) {
      _v3.set(0, 0, 0).addScaledVector(_fwd, I.my).addScaledVector(_right, I.mx);
      if (anchorsN) {
        _v2.copy(mid).sub(C).normalize();
        _v3.addScaledVector(_v2, -_v3.dot(_v2));
        acc.addScaledVector(_v3, T.swingAcc);
      } else acc.addScaledVector(_v3, T.airAcc);
    }
    if (!anchorsN && !S.boosting && Math.abs(vel.y) < 3) acc.y += T.G * 0.3; // a little apex hang
    vel.addScaledVector(acc, h);
    // --- drag + soft top speed
    const sp = vel.length();
    let dr = 0.0012 * sp;
    if (sp > T.vSoft) dr += (sp - T.vSoft) * 0.09;
    vel.multiplyScalar(Math.max(0, 1 - dr * h));
    if (vel.y < -T.maxFall) vel.y = -T.maxFall;
    if (sp > T.vMax) vel.multiplyScalar(T.vMax / sp);
    // --- integrate
    C.addScaledVector(vel, h);
    // --- rope constraints (inequality, auto take-up)
    for (let it = 0; it < (anchorsN > 1 ? 2 : 1); it++) {
      for (const hk of hooks) {
        if (!hk.attached) continue;
        _v2.copy(C).sub(hk.point); const L = _v2.length();
        if (L > hk.len) {
          _v2.divideScalar(L);
          C.copy(hk.point).addScaledVector(_v2, hk.len);
          const vr = vel.dot(_v2) - hk.vA.dot(_v2); // relative to the (moving) anchor: a swinging giant drags you along
          if (vr > 0) vel.addScaledVector(_v2, -vr);
          hk.tension = damp(hk.tension, clamp((vel.lengthSq() / Math.max(hk.len, 1) + T.G * Math.max(0, -_v2.y)) / (T.G * 2.2), 0, 1), 12, h);
          hk.slack = damp(hk.slack, 0, 14, h);
        } else {
          hk.len = Math.max(T.minLen, Math.min(hk.len, L)); // winch takes up slack
          hk.tension = damp(hk.tension, 0.1, 8, h);
          hk.slack = damp(hk.slack, 0, 10, h);
        }
      }
    }
    // --- reeled right up to a moving body (the giant has no collider): cling to it
    if (S.reeling && S.clingCd <= 0) for (const hk of hooks) {
      if (hk.attached && hk.moving && C.distanceTo(hk.point) < 2.4) { enterCling(hk); return; }
    }
    // --- collisions
    collideBody(anchorsN > 0);
    if (col.hitGround && vel.y <= 0.5) {
      const impact = Math.max(0, -S.prevVel.y);
      const g = probeGround(0.3);
      const y = g ? g.point.y : col.groundY;
      // attached and reeling: keep flying (skim off roofs instead of sticking)
      if (!(anchorsN && S.reeling)) { landOn(y, g ? g.kind : col.kind, impact, Math.hypot(vel.x, vel.z)); return; }
    }
    if (col.hitWall && S.wallCd <= 0 && S.slashT < 0) {
      // ledge within reach: climb onto the roof
      if (col.into > 1 && tryMantle(col.wallN)) return;
      if (col.kind === 'colossal' || col.kind === 'titan') { // a moving body: cling to it if hooked to it, else bounce off
        for (const hk of hooks) if (hk.attached && hk.moving && C.distanceTo(hk.point) < 9) { enterCling(hk); return; }
      } else if (col.into > 3.5 || (anchorsN && S.reeling && col.into > 1)) { enterWall(col.wallN, col.kind); return; }
    }
  }

  function stepWall(h, I) {
    if (S.cling) { stepCling(h, I); return; }
    S.wallT += h;
    camFlat(); aimDir(_aim);
    const n = S.wallN;
    let anchorsN = 0; mid.set(0, 0, 0);
    for (const hk of hooks) if (hk.attached) { mid.add(hk.point); anchorsN++; }
    if (anchorsN) mid.divideScalar(anchorsN);
    const gasOK = player.gas > 0.001 && I.controllable;
    const acc = _v.set(0, 0, 0);
    S.reeling = 0; S.strong = 0; S.boosting = 0;
    if (anchorsN && gasOK && (I.gas || I.strong)) { // wall-run toward the anchor (feet on the facade)
      _v2.copy(mid).sub(C); const dist = _v2.length(); _v2.divideScalar(Math.max(dist, 1e-3));
      _v2.addScaledVector(n, -_v2.dot(n)); // along the wall
      acc.addScaledVector(_v2, (I.strong ? T.strongAcc : T.reelAcc) * 0.8);
      S.reeling = 1; S.strong = I.strong ? 1 : 0;
      for (const hk of hooks) if (hk.attached) { hk.len = Math.max(T.minLen, Math.min(hk.len, C.distanceTo(hk.point)) - T.reelWinch * h); hk.reeling = true; }
      player.gas = Math.max(0, player.gas - T.drainReel * h);
    } else {
      acc.y -= S.wallT < 0.35 ? 3 : 9; // cling, then slide
    }
    if (I.controllable && (I.mx || I.my)) { // wall run with WASD along the facade
      _v3.set(0, 0, 0).addScaledVector(_fwd, I.my).addScaledVector(_right, I.mx);
      _v3.addScaledVector(n, -_v3.dot(n)); if (I.my > 0) _v3.y += 0.6 * I.my;
      acc.addScaledVector(_v3, 10);
    }
    vel.addScaledVector(acc, h);
    vel.multiplyScalar(1 - 1.6 * h);
    vel.addScaledVector(n, -vel.dot(n) + (-1.5)); // stay pressed to the facade
    C.addScaledVector(vel, h);
    for (const hk of hooks) {
      if (!hk.attached) continue;
      _v2.copy(C).sub(hk.point); const L = _v2.length();
      if (L > hk.len) { _v2.divideScalar(L); C.copy(hk.point).addScaledVector(_v2, hk.len); const vr = vel.dot(_v2); if (vr > 0) vel.addScaledVector(_v2, -vr); }
      else hk.len = Math.max(T.minLen, L);
    }
    collideBody(true);
    if (col.hitGround && vel.y <= 0.2) { landOn(col.groundY, col.kind, 2, 0); return; }
    if (col.hitWall) { S.wallLost = 0; S.wallN.lerp(col.wallN, 0.3).setY(0).normalize(); }
    else { S.wallLost += h; if (S.wallLost > 0.12) { enterAir(); S.wallCd = 0.2; return; } }
    // reached the top of the facade: vault onto the roof
    if (vel.y > 1 && tryMantle(n)) return;
    if (I.jumpPressed && !anchorsN) { wallKick(); return; }
    if (S.wallT > 2.2 && !S.reeling) { enterAir(); S.wallCd = 0.4; vel.addScaledVector(n, 2); }
  }

  // ------------------------------------------------------------------ combat
  function startSlash() {
    if (S.slashT >= 0 || S.slashCd > 0 || S.mode === 'dead' || S.mode === 'grabbed') return;
    S.slashT = 0; S.slashHit = false;
    const sp = vel.length();
    if (S.mode !== 'ground' && sp > 2) S.slashAxis.copy(vel).divideScalar(sp); else S.slashAxis.copy(UP);
    if (S.mode !== 'ground') { // lunge
      aimDir(_aim);
      if (sp > 4) vel.addScaledVector(S.slashAxis, 4); else vel.addScaledVector(_aim, 6);
    }
    trails.L.clear(); trails.R.clear();
    emit('player:slash', { position: C });
    audio('slash', { position: C, volume: 1 });
    ctx.cam?.slash?.();
  }
  function bladesOK() { return blades.count > 0 && blades.durability > 0.001; }
  function updateSlash(dt) {
    if (S.slashCd > 0) S.slashCd -= dt;
    if (S.slashT < 0) return;
    S.slashT += dt;
    const u = S.slashT / T.slashDur;
    if (!S.slashHit && u > 0.14 && u < 0.86 && bladesOK()) {
      _v.copy(C).addScaledVector(vel, 0.04);
      let res = null, boss = false;
      try { res = ctx.colossal?.trySlash?.(_v, vel, T.slashRadius) || null; boss = !!res; } catch (e) { res = null; }
      if (!res) { try { res = ctx.titans?.trySlash?.(_v, vel, T.slashRadius) || null; } catch (e) { res = null; } }
      if (res) onSlashHit(res, boss);
    }
    if (u >= 1) { S.slashT = -1; S.slashCd = 0.12; }
  }
  const WEAK = new Set(['hand_L', 'hand_R', 'ankle_L', 'ankle_R', 'nape']);
  function weakPos(name, out) {
    const wps = ctx.colossal?.weakPoints;
    if (Array.isArray(wps)) for (const w of wps) if (w.name === name && w.position) return out.copy(w.position);
    return out.copy(C);
  }
  function onSlashHit(res, boss) {
    S.slashHit = true;
    const part = res.part || 'limb';
    const weak = boss ? WEAK.has(part) : part === 'nape';
    blades.durability = Math.max(0, blades.durability - (weak ? 0.2 : 0.12) - Math.random() * 0.05);
    const where = boss ? (weak ? weakPos(part, _v4) : _v4.copy(C)) : (res.titan?.nape?.position || C);
    _v.copy(vel); if (_v.lengthSq() < 1e-4) aimDir(_v); _v.normalize();
    fx('blood', where, _v); fx('blood', C, _v2.copy(_v).negate());
    if (res.killed && (boss || part === 'nape')) napeKill(boss ? ctx.colossal : res.titan, where, boss);
    else if (weak) { // weak point cut: the full treatment, short of a kill
      startHitstop(0.07, 0.24, 0.3);
      ctx.post?.punch?.(0.8); ctx.post?.setSlowmo?.(0.8);
      fx('blood', where, UP); fx('steam', where, boss ? 4 : 1.5, 2.5);
      audio('nape_kill', { position: where, volume: 0.85, rate: 1.1 });
      ctx.shake(0.55, { at: C, radius: 60 });
      ctx.cam?.killCam?.(where, 0.75);
    } else {
      startHitstop(0.25, 0.07, 0.12);
      ctx.shake(0.35, { at: C, radius: 40 });
      audio('slash', { position: C, volume: 0.8, rate: 0.8 });
    }
    if (blades.durability <= 0) { audio('blade_break', { position: C }); fx('sparks', C, UP); setBladeVisual(); }
  }
  function napeKill(titan, np, boss) {
    S.kills++;
    startHitstop(0.05, boss ? 0.6 : 0.35, boss ? 0.6 : 0.35);
    ctx.post?.setSlowmo?.(1); ctx.post?.punch?.(1); ctx.post?.flash?.(boss ? 0.3 : 0.12);
    np = np || titan?.nape?.position || C;
    fx('blood', np, _v.copy(vel).normalize()); fx('blood', np, UP);
    fx('steam', np, boss ? 8 : (titan?.height || 10) * 0.25, boss ? 6 : 3.5);
    audio('nape_kill', { position: np, volume: 1 });
    ctx.shake(boss ? 1.0 : 0.7, { at: C, radius: 80 });
    ctx.cam?.killCam?.(np, boss ? 1.6 : 1.05);
    emit('player:kill', { titan, boss: !!boss });
  }
  function startHitstop(scale, hold, ease) {
    S.hitstop = { t: 0, scale, hold, ease };
    ctx.clock.timeScale = scale;
  }
  function updateHitstop(rawDt) {
    const hs = S.hitstop; if (!hs) return;
    hs.t += rawDt;
    if (hs.t < hs.hold) { ctx.clock.timeScale = hs.scale; return; }
    const k = clamp((hs.t - hs.hold) / hs.ease, 0, 1), e = k * k * (3 - 2 * k);
    ctx.clock.timeScale = hs.scale + (1 - hs.scale) * e;
    ctx.post?.setSlowmo?.(1 - e);
    if (k >= 1) { ctx.clock.timeScale = 1; ctx.post?.setSlowmo?.(0); S.hitstop = null; }
  }
  function setBladeVisual() {
    const ok = blades.count > 0, broken = blades.durability <= 0;
    for (const S2 of ['L', 'R']) { const b = char.blades[S2]; b.visible = ok; b.scale.z = broken ? 0.28 : 1; }
  }
  function swapBlades() {
    if (S.mode === 'dead' || S.mode === 'grabbed') return;
    if (blades.count <= 2) { if (blades.durability <= 0) { blades.count = 0; setBladeVisual(); } ctx.hud?.toast?.('Out of blades — resupply'); return; }
    blades.count -= 2; blades.durability = 1; setBladeVisual();
    audio('blade_swap', { position: C });
    S.swapT = 0;
  }

  // ------------------------------------------------------------------ grab / hurt / death
  const grabP = new THREE.Vector3();
  function updateGrabbed(dt, I) {
    const g = S.grab;
    g.t += dt;
    if (g.hand) { g.hand.getWorldPosition(grabP); C.lerp(grabP, 1 - Math.exp(-20 * dt)); }
    vel.set(0, 0, 0);
    if (I.slashPressed && I.controllable) {
      g.progress += 0.2;
      if (blades.count > 0) blades.durability = Math.max(0, blades.durability - 0.06);
      fx('blood', C, UP); audio('slash', { position: C, volume: 0.7, rate: 1.2 }); ctx.shake(0.15);
      g.struggle = 1;
    }
    g.struggle = Math.max(0.3, g.struggle - dt * 2);
    if (g.progress >= 1) { // cut free
      const titan = g.titan;
      S.grab = null;
      _v.copy(C).sub(titan?.position || C).setY(0); if (_v.lengthSq() < 1e-3) _v.set(0, 0, 1); _v.normalize();
      vel.copy(_v).multiplyScalar(9).addScaledVector(UP, 9);
      enterAir(); S.invuln = 1.5;
      fx('blood', C, _v); fx('steam', C, 1.2, 1.5);
      audio('nape_kill', { position: C, volume: 0.6, rate: 1.3 });
      ctx.post?.setDamage?.(0.2);
      try { titan?.releaseGrab?.(); ctx.titans?.releaseGrab?.(titan); } catch (e) { /* titans optional */ }
      ctx.cam?.impact?.(0.4);
      return;
    }
    if (g.t > 2.5) kill('eaten');
  }
  function kill(cause = 'killed') {
    if (S.mode === 'dead') return;
    const wasGrabbed = S.mode === 'grabbed';
    setMode('dead'); S.deadT = 0; S.deathCause = cause; player.hp = 0; S.cling = null;
    for (const hk of hooks) releaseHook(hk, true);
    S.slashT = -1;
    if (wasGrabbed) { audio('crunch', { position: C }); fx('blood', C, UP); }
    else audio('scream', { position: C, volume: 0.6 });
    ctx.post?.setDamage?.(1);
    ctx.shake(0.6);
    emit('player:died', { cause });
  }

  // ------------------------------------------------------------------ input
  const I = { mx: 0, my: 0, gas: false, strong: false, sprint: false, jumpPressed: false, slashPressed: false, controllable: false };
  function readInput() {
    const ok = player.enabled && ctx.mode === 'play' && S.mode !== 'dead';
    I.controllable = ok;
    const m = input.mouse;
    if (!ok) { I.mx = I.my = 0; I.gas = I.strong = I.sprint = I.jumpPressed = I.slashPressed = false; hooks[0].held = hooks[1].held = false; hooks[0].toggle = hooks[1].toggle = false; return; }
    // pointer lock: the click that locks is swallowed
    const locked = input.locked || player.noPointerLock;
    if (!locked && (m.leftPressed || m.rightPressed)) { input.requestLock(); try { ctx.audio?.unlock?.(); } catch (e) { /* */ } }
    I.mx = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    I.my = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    I.gas = input.down('Space'); I.strong = input.down('ShiftLeft') || input.down('ShiftRight'); I.sprint = I.strong;
    I.jumpPressed = input.pressed('Space');
    I.slashPressed = input.pressed('KeyF') || m.middlePressed;
    if (input.pressed('KeyQ')) hooks[0].toggle = !(hooks[0].state === 'fly' || hooks[0].state === 'attached');
    if (input.pressed('KeyE')) hooks[1].toggle = !(hooks[1].state === 'fly' || hooks[1].state === 'attached');
    const heldL = (locked && m.left) || hooks[0].toggle, heldR = (locked && m.right) || hooks[1].toggle;
    const pressL = (locked && m.leftPressed) || (input.pressed('KeyQ') && hooks[0].toggle);
    const pressR = (locked && m.rightPressed) || (input.pressed('KeyE') && hooks[1].toggle);
    hooks[0].held = heldL; hooks[1].held = heldR;
    if (pressL && S.mode !== 'grabbed') fireHook(hooks[0]);
    if (pressR && S.mode !== 'grabbed') fireHook(hooks[1]);
    if (input.pressed('KeyR')) swapBlades();
    if (input.pressed('Tab')) S.tabPressed = true;
    // mouse look
    if (locked && (m.dx || m.dy)) {
      const k = 0.0022 * (input.sensitivity || 1);
      player.yaw = angWrap(player.yaw - m.dx * k);
      player.pitch = clamp(player.pitch - m.dy * k, -1.4, 1.4);
      S.lastMouse = 0;
    }
  }

  const napeTargets = new WeakMap();
  const targets = [];
  function gatherTargets() {
    targets.length = 0;
    const wps = ctx.colossal?.active !== false ? ctx.colossal?.weakPoints : null;
    if (Array.isArray(wps)) for (const w of wps) if (w && w.active !== false && w.position) targets.push(w);
    const list = ctx.titans?.list;
    if (Array.isArray(list)) for (const t of list) {
      if (!t || t.alive === false || !t.nape?.position) continue;
      let w = napeTargets.get(t);
      if (!w) { w = { name: 'nape', titan: t, position: t.nape.position, radius: t.nape.radius || 1, active: true }; napeTargets.set(t, w); }
      w.position = t.nape.position; w.active = t.alive !== false;
      targets.push(w);
    }
    return targets;
  }
  const targetValid = (t) => t && t.position && t.active !== false && !(t.titan && t.titan.alive === false) && t.position.distanceTo(C) < 220;
  function scoreTarget(t) { // lower = better: angle off the aim, then distance
    aimDir(_aim); _v.copy(t.position).sub(camera.position); const d = _v.length(); _v.divideScalar(d || 1);
    return Math.acos(clamp(_v.dot(_aim), -1, 1)) * 2 + d / 150;
  }
  function pickTarget(after) {
    const list = gatherTargets(); if (!list.length) return null;
    list.sort((a, b) => scoreTarget(a) - scoreTarget(b));
    if (!after) return list[0];
    const i = list.indexOf(after);
    return i < 0 ? list[0] : i + 1 < list.length ? list[i + 1] : null;
  }
  function updateLock(dt) {
    if (!I.controllable) { S.lockTarget = null; S.lockOn = false; return; }
    if (S.tabPressed) { S.tabPressed = false; const nt = pickTarget(S.lockOn ? S.lockTarget : null); S.lockOn = !!nt; S.lockTarget = nt; }
    const hold = input.down('KeyC');
    if (hold && !S.lockOn && !targetValid(S.lockTarget)) S.lockTarget = pickTarget(null);
    if (!S.lockOn && !hold) { S.lockTarget = null; return; }
    if (!targetValid(S.lockTarget)) { S.lockTarget = pickTarget(null); if (!S.lockTarget) { S.lockOn = false; return; } }
    // soft lock: steer the aim toward the target (mouse input still wins)
    const tp = S.lockTarget.position;
    _v.copy(tp).sub(camera.position); const d = _v.length(); if (d < 1) return; _v.divideScalar(d);
    const yawT = Math.atan2(_v.x, _v.z), pitchT = Math.asin(clamp(_v.y, -1, 1));
    const r = S.lastMouse < 0.25 ? 1.0 : 4.5;
    player.yaw = angWrap(player.yaw + angWrap(yawT - player.yaw) * (1 - Math.exp(-r * dt)));
    player.pitch = player.pitch + (clamp(pitchT, -1.3, 1.3) - player.pitch) * (1 - Math.exp(-r * dt));
  }

  // ------------------------------------------------------------------ animation
  const CLIPS = ['idle', 'run', 'jump', 'fall', 'fly', 'swing', 'reel', 'boost', 'wall', 'slash', 'land', 'roll', 'grabbed', 'dead', 'hurt'];
  const clipPose = Object.fromEntries(CLIPS.map((k) => [k, makePose()]));
  const wt = Object.fromEntries(CLIPS.map((k) => [k, k === 'idle' ? 1 : 0]));
  const tw = Object.fromEntries(CLIPS.map((k) => [k, 0]));
  const pose = makePose();
  const visQ = new THREE.Quaternion(), wantQ = new THREE.Quaternion(), spinQ = new THREE.Quaternion();
  const legSpring = { x: 0, z: 0, vx: 0, vz: 0 }, look = { yaw: 0, pitch: 0 };
  const basisQ = (fwd, up, out) => {
    _v4.copy(fwd).addScaledVector(up, -fwd.dot(up)); if (_v4.lengthSq() < 1e-6) return false; _v4.normalize();
    _v5.crossVectors(up, _v4).normalize(); _v3.crossVectors(_v4, _v5);
    _m.makeBasis(_v5, _v3, _v4); out.setFromRotationMatrix(_m); return true;
  };
  function swingPhase() {
    let n = 0; mid.set(0, 0, 0);
    for (const hk of hooks) if (hk.attached) { mid.add(hk.point); n++; }
    if (!n) return 0;
    mid.divideScalar(n);
    const hs = Math.hypot(vel.x, vel.z); if (hs < 0.5) return 0;
    const along = ((C.x - mid.x) * vel.x + (C.z - mid.z) * vel.z) / hs;
    return clamp(Math.atan2(along, Math.max(0.01, mid.y - C.y)) / 1.1, -1, 1);
  }
  function animate(dt, time) {
    const sp = vel.length(), hs = Math.hypot(vel.x, vel.z);
    const attached = hooks[0].attached || hooks[1].attached;
    for (const k of CLIPS) tw[k] = 0;
    const m = S.mode;
    const slashing = S.slashT >= 0;
    if (m === 'dead') tw.dead = 1;
    else if (m === 'grabbed') tw.grabbed = 1;
    else if (slashing) tw.slash = 1;
    else if (S.hurtT < 0.35) tw.hurt = 1;
    else if (m === 'ground') {
      if (S.land.t < S.land.dur) { if (S.land.roll) tw.roll = 1; else tw.land = 1 - smooth(0.6, 1, S.land.t / S.land.dur); }
      const rest = 1 - (tw.roll + tw.land);
      const rk = smooth(0.4, 2.6, hs);
      tw.run = rk * rest; tw.idle = (1 - rk) * rest;
    } else if (m === 'wall') tw.wall = 1;
    else if (attached) {
      if (S.reeling) { tw.reel = S.strong ? 1 : 0.65; tw.swing = S.strong ? 0 : 0.35; }
      else tw.swing = 1;
    } else if (S.boosting) tw.boost = 1;
    else if (vel.y > 1.5 && S.airT < 0.7 && hs < 14) tw.jump = 1;
    else if (sp > 12) { tw.fly = smooth(12, 22, sp); tw.fall = 1 - tw.fly; }
    else tw.fall = 1;
    // cross-fade weights (fast for impacts / slash, softer otherwise)
    let wsum = 0;
    for (const k of CLIPS) {
      const rate = (k === 'slash' || k === 'land' || k === 'roll' || k === 'hurt') && tw[k] > wt[k] ? 30 : 11;
      wt[k] = damp(wt[k], tw[k], rate, dt); if (wt[k] < 1e-3 && tw[k] === 0) wt[k] = 0;
      wsum += wt[k];
    }
    zeroPose(pose);
    const t = time;
    if (wt.idle) { POSE.idle(clipPose.idle, t); addPose(pose, clipPose.idle, wt.idle); }
    if (wt.run) {
      S.runPhase = (S.runPhase + dt * (0.9 + hs * 0.11)) % 1;
      POSE.run(clipPose.run, S.runPhase, smooth(6, 11.5, hs)); addPose(pose, clipPose.run, wt.run);
    }
    if (wt.jump) { POSE.jump(clipPose.jump, t); addPose(pose, clipPose.jump, wt.jump); }
    if (wt.fall) { POSE.fall(clipPose.fall, t); addPose(pose, clipPose.fall, wt.fall); }
    if (wt.fly) { POSE.fly(clipPose.fly, t, smooth(12, 40, sp)); addPose(pose, clipPose.fly, wt.fly); }
    if (wt.swing) { POSE.swing(clipPose.swing, t, swingPhase()); addPose(pose, clipPose.swing, wt.swing); }
    if (wt.reel) { POSE.reel(clipPose.reel, t); addPose(pose, clipPose.reel, wt.reel); }
    if (wt.boost) { POSE.boost(clipPose.boost, t); addPose(pose, clipPose.boost, wt.boost); }
    if (wt.wall) {
      const along = vel.length();
      S.wallPhase = (S.wallPhase + dt * (0.4 + along * 0.12)) % 1;
      POSE.wall(clipPose.wall, t, smooth(1, 5, along), S.wallPhase); addPose(pose, clipPose.wall, wt.wall);
    }
    if (wt.slash) { POSE.slash(clipPose.slash, t, Math.max(0, S.slashT) / T.slashDur); addPose(pose, clipPose.slash, wt.slash); }
    if (wt.land) { POSE.land(clipPose.land, S.land.sev); addPose(pose, clipPose.land, wt.land); }
    if (wt.roll) { POSE.roll(clipPose.roll); addPose(pose, clipPose.roll, wt.roll); }
    if (wt.grabbed) { POSE.grabbed(clipPose.grabbed, t, S.grab ? S.grab.struggle : 0.5); addPose(pose, clipPose.grabbed, wt.grabbed); }
    if (wt.dead) { POSE.dead(clipPose.dead, t); addPose(pose, clipPose.dead, wt.dead); }
    if (wt.hurt) { POSE.hurt(clipPose.hurt); addPose(pose, clipPose.hurt, wt.hurt); }
    finishPose(pose, wsum);

    // ---- body frame (world): what the whole skeleton is aligned to
    let rate = 12;
    const fwd = _v.set(Math.sin(S.facing), 0, Math.cos(S.facing)), up = _v2.copy(UP);
    if (m === 'ground') {
      rate = S.land.roll ? 18 : 14;
    } else if (m === 'wall') {
      up.copy(S.wallN);
      fwd.copy(vel).addScaledVector(UP, 1.5); aimDir(_aim); fwd.addScaledVector(_aim, 1.5);
      rate = 12;
    } else if (m === 'grabbed') {
      up.set(0, 1, 0); if (S.grab?.titan?.position) { fwd.copy(S.grab.titan.position).sub(C).setY(0); if (fwd.lengthSq() < 1e-3) fwd.set(0, 0, 1); fwd.normalize(); }
      rate = 8;
    } else if (m === 'dead') {
      const k = smooth(0, 0.8, S.deadT);
      up.set(Math.sin(S.facing), 0, Math.cos(S.facing)).multiplyScalar(k).addScaledVector(UP, 1 - k).normalize();
      fwd.set(0, 1, 0).multiplyScalar(k).addScaledVector(_v3.set(-Math.sin(S.facing), 0, -Math.cos(S.facing)), 1 - k);
      rate = 6;
    } else {
      if (hs > 1.5) S.facing = Math.atan2(vel.x, vel.z);
      fwd.set(Math.sin(S.facing), 0, Math.cos(S.facing));
      if (attached) {
        let n = 0; mid.set(0, 0, 0); for (const hk of hooks) if (hk.attached) { mid.add(hk.point); n++; } mid.divideScalar(n);
        _v3.copy(mid).sub(C); const dist = _v3.length(); _v3.divideScalar(Math.max(dist, 1e-3));
        if (S.reeling && S.strong) up.copy(_v3); // head-first at the anchor
        else up.copy(_v3).multiplyScalar(0.75).addScaledVector(UP, 0.25 + 0.4 * (1 - hooks[0].tension - hooks[1].tension)).normalize();
        // about to hit a facade: swing the feet round to land on it
        const hk = hooks[0].attached ? hooks[0] : hooks[1];
        if (S.reeling && dist < 7 + sp * 0.12 && Math.abs(hk.normal.y) < 0.5) up.copy(hk.normal).setY(0.25).normalize();
        fwd.copy(vel.lengthSq() > 1 ? vel : fwd);
        rate = 10;
      } else {
        const k = S.boosting ? 0.95 : smooth(8, 30, hs) * 0.8;
        _v3.copy(vel); if (_v3.y < -0.6 * hs) _v3.y = -0.6 * hs; if (_v3.lengthSq() > 1e-4) _v3.normalize(); else _v3.copy(UP);
        up.copy(UP).multiplyScalar(1 - k).addScaledVector(_v3, k).normalize();
        fwd.copy(vel).setY(Math.min(vel.y, 0)); if (fwd.lengthSq() < 1e-3) fwd.set(Math.sin(S.facing), 0, Math.cos(S.facing));
        rate = S.boosting ? 9 : 7;
      }
    }
    if (basisQ(fwd, up, wantQ)) { if (visQ.dot(wantQ) < 0) wantQ.set(-wantQ.x, -wantQ.y, -wantQ.z, -wantQ.w); visQ.slerp(wantQ, 1 - Math.exp(-rate * dt)); }
    // bank from yaw rate of travel + lateral acceleration
    _v3.copy(S.accel).applyQuaternion(_q.copy(visQ).invert());
    const air = m !== 'ground' && m !== 'dead' && m !== 'grabbed';
    S.bank = damp(S.bank, air ? clamp(-_v3.x / 30, -0.7, 0.7) : m === 'ground' ? clamp(-_v3.x / 60, -0.25, 0.25) : 0, 5, dt);
    _q2.copy(visQ).multiply(_q.setFromAxisAngle(_v3.set(0, 0, 1), S.bank));
    // root spins: slash (2 turns about the flight / vertical axis), landing roll (1 forward turn)
    let spin = 0, spinAxis = null;
    if (slashing) {
      const u = clamp(S.slashT / T.slashDur, 0, 1), e = u < 0.1 ? 0 : (u - 0.1) / 0.9;
      spin = Math.PI * 4 * (1 - Math.pow(1 - e, 2.2)); spinAxis = _v3.set(0, 1, 0); // about body-up (the frame is head-first along the flight)
    } else if (m === 'ground' && S.land.roll && S.land.t < S.land.dur) {
      const u = S.land.t / S.land.dur; spin = Math.PI * 2 * u * u * (3 - 2 * u); spinAxis = _v3.set(1, 0, 0);
    }
    if (!spinAxis && S.tumble > 0 && S.tumbleT < 0.7 && m !== 'ground') {
      const u = S.tumbleT / 0.7; spin = -Math.PI * 2 * S.tumble * (1 - Math.pow(1 - u, 2)); spinAxis = _v3.set(1, 0, 0);
    }
    if (spinAxis) { spinQ.setFromAxisAngle(spinAxis, spin); _q2.multiply(spinQ); }
    // ---- additive layers
    // legs trail against acceleration in the air (body-space inertia spring)
    _v4.copy(S.accel).applyQuaternion(_q.copy(_q2).invert());
    const tx = air ? clamp(-_v4.x * 0.01, -0.35, 0.35) : 0, tz = air ? clamp(-_v4.z * 0.012, -0.45, 0.45) : 0;
    legSpring.vx += ((tx - legSpring.x) * 90 - legSpring.vx * 12) * dt; legSpring.x += legSpring.vx * dt;
    legSpring.vz += ((tz - legSpring.z) * 90 - legSpring.vz * 12) * dt; legSpring.z += legSpring.vz * dt;
    for (const k of ['ulL', 'ulR', 'llL', 'llR']) { pose[k].x += legSpring.x; pose[k].z += legSpring.z * (k[0] === 'l' ? 1.3 : 1); pose[k].normalize(); }
    // head / chest look toward the aim (not while spinning / dead)
    aimDir(_aim); _v4.copy(_aim).applyQuaternion(_q.copy(_q2).invert());
    const lookW = m === 'dead' || slashing || m === 'grabbed' ? 0 : 1;
    let ly = Math.atan2(_v4.x, _v4.z), lp = -Math.asin(clamp(_v4.y, -1, 1));
    const behind = smooth(1.7, 2.4, Math.abs(ly));
    ly = clamp(ly, -1.1, 1.1) * (1 - behind) * lookW; lp = clamp(lp, -0.7, 0.8) * (1 - behind) * lookW;
    look.yaw = damp(look.yaw, ly, 8, dt); look.pitch = damp(look.pitch, lp, 8, dt);
    pose.chest[1] += look.yaw * 0.25; pose.neck[1] += look.yaw * 0.3; pose.head[1] += look.yaw * 0.4;
    pose.neck[0] += look.pitch * 0.35; pose.head[0] += look.pitch * 0.5; pose.chest[0] += look.pitch * 0.12;
    // grip points at a freshly fired hook
    for (const Sd of ['L', 'R']) {
      S.aimArm[Sd] = Math.max(0, S.aimArm[Sd] - dt * 3);
      const w = S.aimArm[Sd]; if (w <= 0 || slashing || m === 'dead') continue;
      _v4.copy(S.aimArmDir[Sd]).applyQuaternion(_q.copy(_q2).invert());
      const kk = Math.min(1, w * 1.5);
      pose['ua' + Sd].lerp(_v4, kk * 0.8).normalize(); pose['la' + Sd].lerp(_v4, kk).normalize();
    }
    // lean the spine into the bank
    pose.spine[2] += S.bank * 0.25; pose.chest[2] += S.bank * 0.2;
    applyPose(bones, pose);
    // ---- place the root: feet below the body centre along the body's up axis
    const root = char.root;
    root.quaternion.copy(_q2);
    let drop = 0;
    if (m === 'ground' && S.land.roll && S.land.t < S.land.dur) drop = 0.45 * Math.sin(Math.PI * S.land.t / S.land.dur);
    if (m === 'dead') drop = 0.75 * smooth(0, 0.8, S.deadT);
    _v4.set(0, 1, 0).applyQuaternion(_q2);
    S.rootOff = damp(S.rootOff ?? H, m === 'wall' ? 0.45 : H, 12, dt);
    root.position.copy(C).addScaledVector(_v4, -S.rootOff);
    if (drop) root.position.y -= drop;
    root.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------ public API
  const player = {
    get position() { return position; },
    velocity: vel, center: C,
    yaw: LAYOUT.playerStart.yaw || 0, pitch: 0.05,
    object: char.root, cloak: cloak.mesh,
    get state() { return !player.enabled && S.mode !== 'dead' ? 'cinematic' : S.mode === 'wall' ? 'air' : S.mode; },
    get mode() { return S.mode; },
    gas: 1, blades, hp: 1, hooks, enabled: false, aimHit,
    get lockTarget() { return S.lockTarget; },
    get speed() { return S.speed; },
    get boosting() { return S.boosting > 0; },
    get reeling() { return S.reeling > 0; },
    get slashing() { return S.slashT >= 0; },
    get slashT() { return S.slashT; },
    get grabbed() { return S.mode === 'grabbed'; },
    get wallNormal() { return S.mode === 'wall' ? S.wallN : null; },
    get kills() { return S.kills; },
    get landing() { return S.land; },
    get airTime() { return S.airT; },
    get grabProgress() { return S.grab ? S.grab.progress : 0; },
    get invuln() { return S.invuln; },
    tuning: T, noPointerLock: false, S,
    setEnabled(b) { player.enabled = !!b; if (!b) { for (const hk of hooks) { hk.held = false; hk.toggle = false; } } },
    teleport(pos, yaw) {
      C.copy(pos); C.y += H; vel.set(0, 0, 0);
      if (typeof yaw === 'number') { player.yaw = yaw; S.facing = yaw; }
      player.pitch = 0.05;
      for (const hk of hooks) { hk.state = 'idle'; hk.active = hk.attached = false; hk.held = hk.toggle = false; }
      S.slashT = -1; S.land.t = 9; S.grab = null; S.cling = null;
      const g = probeGround(1.5);
      if (g) { C.y = g.point.y + H; setMode('ground'); } else enterAir();
      visQ.setFromAxisAngle(UP, S.facing);
      position.copy(C); position.y -= H;
      animate(0.0001, S.time);
      cloak.reset(char.root);
      ctx.cam?.snap?.();
    },
    hurt(amount = 0.25, fromDir) {
      if (S.mode === 'dead' || S.invuln > 0) return;
      player.hp = Math.max(0, player.hp - amount);
      S.hurtT = 0; S.invuln = 0.35;
      if (fromDir && fromDir.lengthSq && fromDir.lengthSq() > 1e-6) { _v.copy(fromDir).normalize(); vel.addScaledVector(_v, 9).addScaledVector(UP, 4); if (S.mode === 'ground') enterAir(); }
      ctx.post?.setDamage?.(clamp(1 - player.hp, 0.3, 1));
      ctx.shake(0.5 + amount);
      ctx.cam?.impact?.(0.5);
      emit('player:hurt', { amount, hp: player.hp, fromDir });
      if (player.hp <= 0) kill('hurt');
    },
    knock(impulse) {
      if (!impulse || S.mode === 'dead' || S.mode === 'grabbed') return;
      const k = S.invuln > 0 ? 0.4 : 1;
      vel.addScaledVector(impulse, k);
      const mag = impulse.length() * k;
      if (S.mode === 'ground' || S.mode === 'wall') { S.cling = null; enterAir(); S.clingCd = 0.6; S.wallCd = 0.4; }
      if (mag > 28) for (const hk of hooks) releaseHook(hk, true);
      if (mag > 6) { S.tumble = Math.min(1, mag / 30); S.tumbleT = 0; S.hurtT = 0; }
      ctx.cam?.impact?.(clamp(mag / 40, 0.1, 0.8)); ctx.shake(clamp(mag / 40, 0.1, 0.9));
    },
    grab(titan, hand) {
      if (S.mode === 'dead' || S.mode === 'grabbed' || S.invuln > 0) return false;
      for (const hk of hooks) releaseHook(hk, true);
      S.slashT = -1; S.cling = null;
      S.grab = { titan, hand, t: 0, progress: 0, struggle: 1 };
      setMode('grabbed');
      audio('grab', { position: C }); audio('scream', { position: C, volume: 0.5 });
      ctx.post?.setDamage?.(0.45); ctx.shake(0.6);
      ctx.hud?.toast?.('MASH F TO CUT FREE');
      emit('player:grabbed', { titan });
      return true;
    },
    kill,
    respawn() {
      player.hp = 1; player.gas = 1; blades.count = 8; blades.durability = 1; setBladeVisual();
      S.invuln = 2; S.grab = null; S.hurtT = 9; S.deadT = 0; S.lockTarget = null; S.lockOn = false;
      char.root.visible = true; cloak.mesh.visible = true;
      setMode('ground');
      const st = LAYOUT.playerStart;
      const gy = ctx.world?.groundHeight?.(st.x, st.z) ?? 0;
      player.teleport(position.set(st.x, gy, st.z), st.yaw || 0);
      ctx.post?.setDamage?.(0);
    },
    refill() { player.gas = 1; blades.count = 8; blades.durability = 1; setBladeVisual(); S.gasEmptyPlayed = false; },
    fireHook(side) { fireHook(hooks[side === 'R' ? 1 : 0]); },
    // debug / scripted: attach a hook straight to a world point (held until released with debugRelease)
    debugHook(side, point, normal) {
      const h = hooks[side === 'R' ? 1 : 0];
      h.toggle = true; h.held = true; h.state = 'attached'; h.attached = true; h.active = true; h.miss = false;
      h.point.copy(point); h.target.copy(point); h.tip.copy(point); h.prevPoint.copy(point); h.anchor = null; h.moving = false; h.ref = null;
      h.normal.copy(normal || UP); h.nWorld.copy(h.normal); h.kind = 'building'; h.vA.set(0, 0, 0);
      h.len = Math.max(T.minLen, C.distanceTo(point)); h.t = 0; h.travel = h.dist = 1;
      if (S.mode === 'ground') { enterAir(); vel.y = Math.max(vel.y, 2); }
    },
    debugRelease(side) { const h = hooks[side === 'R' ? 1 : 0]; h.toggle = false; h.held = false; },
    slash: startSlash,
    swapBlades,
    update(dt, time, rawDt) {
      updateHitstop(rawDt || dt);
      S.time += dt;
      if (dt <= 0) return;
      dt = Math.min(dt, 1 / 20);
      S.lastMouse += dt; S.hurtT += dt; S.land.t += dt; S.invuln = Math.max(0, S.invuln - dt); S.wallCd -= dt;
      S.modeT += dt; S.clingCd -= dt; if (S.tumbleT !== undefined) S.tumbleT += dt;
      if (S.swapT !== undefined) S.swapT += dt;
      readInput();
      // sockets from the last pose (launchers, nozzle)
      char.sockets.launcherL.getWorldPosition(launchers[0]); char.sockets.launcherR.getWorldPosition(launchers[1]);
      updateHooks(dt);
      if (I.slashPressed && S.mode !== 'grabbed') startSlash();
      updateLock(dt);
      S.prevVel.copy(vel);
      // ---- simulate
      if (S.mode === 'grabbed') updateGrabbed(dt, I);
      else if (S.mode === 'dead') {
        S.deadT += dt;
        if (!S.grab) {
          vel.y -= T.G * dt; vel.x *= 1 - 2 * dt; vel.z *= 1 - 2 * dt;
          C.addScaledVector(vel, dt);
          collideBody(false);
          const g = probeGround(0.2); if (g && C.y - H <= g.point.y + 0.02) { C.y = g.point.y + H; vel.set(0, 0, 0); }
        } else if (S.grab.hand) { S.grab.hand.getWorldPosition(grabP); C.lerp(grabP, 1 - Math.exp(-20 * dt)); }
        if (S.deathCause === 'eaten' && S.deadT > 1.4) { char.root.visible = false; cloak.mesh.visible = false; }
      } else {
        if (S.mode === 'ground' && I.controllable && I.jumpPressed && !(S.land.t < S.land.dur * 0.5 && S.land.sev > 0.5)) {
          vel.y = T.jump; enterAir(); S.airT = 0;
          if (Math.hypot(vel.x, vel.z) > 2) S.facing = Math.atan2(vel.x, vel.z);
        }
        // steam vents on the giant blow the soldier away (acceleration m/s^2)
        let st = null; try { st = ctx.colossal?.steamForceAt?.(C, S.steam) || null; } catch (e) { st = null; }
        if (st && st.lengthSq() > 0.01) {
          vel.addScaledVector(st, dt);
          if ((S.mode === 'ground' || S.mode === 'wall') && st.length() > 10) { S.cling = null; enterAir(); S.clingCd = 0.6; }
        }
        if ((S.mode === 'ground' && S.groundKind === 'colossal') || (S.mode === 'wall' && !S.cling && S.wallKind === 'colossal')) {
          try { const cv = ctx.colossal?.velocityAt?.(C, S.carry); if (cv) C.addScaledVector(cv, dt); } catch (e) { /* optional */ }
        }
        const attached = hooks[0].attached || hooks[1].attached;
        if (S.mode === 'ground' && attached && I.controllable && (I.gas || I.strong) && player.gas > 0) { enterAir(); vel.y = Math.max(vel.y, 3); }
        // wall kick from the air near a facade
        const sp = vel.length();
        const n = Math.max(1, Math.min(12, Math.ceil(sp * dt / 0.3)), Math.ceil(dt / (1 / 120)));
        const h = dt / n;
        for (let i = 0; i < n; i++) {
          if (S.mode === 'ground') stepGround(h, I);
          else if (S.mode === 'air') stepAir(h, I);
          else if (S.mode === 'wall') stepWall(h, I);
          else break;
          if (i === 0) I.jumpPressed = false;
        }
      }
      S.accel.copy(vel).sub(S.prevVel).divideScalar(dt);
      S.speed = vel.length();
      if (S.mode === 'air') S.airT += 0; // (airT advanced in substeps)
      // gas regen on roofs / the wall top
      if (S.mode === 'ground' && (S.groundKind === 'building' || S.groundKind === 'wall' || S.groundY > 4)) player.gas = Math.min(1, player.gas + T.regen * dt);
      if (player.gas <= 0.001 && !S.gasEmptyPlayed && (I.gas || I.strong)) { S.gasEmptyPlayed = true; audio('gas_empty', { position: C }); ctx.hud?.toast?.('Gas empty'); }
      if (player.gas > 0.05) S.gasEmptyPlayed = false;
      updateSlash(dt);
      // ---- visuals
      position.copy(C); position.y -= H;
      animate(dt, S.time);
      const thrust = Math.max(S.boosting, S.reeling);
      S.thrust = damp(S.thrust, thrust, thrust > S.thrust ? 20 : 8, dt);
      cloak.update(dt, vel, char.root, _v.set(Math.sin(S.facing), 0, Math.cos(S.facing)), camera.position);
      char.sockets.launcherL.getWorldPosition(launchers[0]); char.sockets.launcherR.getWorldPosition(launchers[1]);
      for (const hk of hooks) if (hk.state === 'fly') { const k = Math.min(1, hk.travel / Math.max(0.01, hk.dist)); hk.tip.copy(launchers[hk.side === 'L' ? 0 : 1]).lerp(hk.target, k); }
      cables.update(rawDt || dt, S.time, hooks, launchers, ctx.renderer);
      // gas jet from the lower-back nozzle, exhaust opposite the thrust
      char.sockets.nozzle.getWorldPosition(nozzleW);
      exhaust.set(0, -0.5, -1).applyQuaternion(char.root.quaternion).normalize();
      if (thrust > 0) { exhaust.addScaledVector(vel, -0.03).normalize(); }
      jet.update(dt, thrust > 0 ? (S.strong ? 150 : 110) : 0, nozzleW, exhaust, vel, camera, ctx.renderer.domElement.height || 1080);
      if (thrust > 0) {
        S.gasPuffT -= dt;
        if (S.gasPuffT <= 0) { S.gasPuffT = 0.07; fx('gasPuff', nozzleW, exhaust); }
        S.gasSoundT -= dt;
        if (S.gasSoundT <= 0) { S.gasSoundT = 0.32; audio('gas', { position: C, volume: 0.35 + 0.35 * (S.strong ? 1 : 0.5), rate: 0.9 + Math.random() * 0.2 }); }
      } else { S.gasSoundT = 0; }
      // blade trails
      const trailOn = S.slashT >= 0 || (S.speed > 24 && S.mode !== 'ground');
      for (const Sd of ['L', 'R']) {
        char.sockets['bladeBase' + Sd].getWorldPosition(bladeB[Sd]); char.sockets['bladeTip' + Sd].getWorldPosition(bladeT[Sd]);
        if (trailOn && char.blades[Sd].visible) trails[Sd].push(bladeB[Sd], bladeT[Sd], S.time);
        trails[Sd].update(S.time, S.slashT >= 0 ? 1 : 0.25);
      }
      streaks.update(C, vel, S.mode === 'ground' ? 0 : smooth(16, 42, S.speed));
      // wind loop
      if (!player._wind && ctx.mode === 'play') { try { player._wind = ctx.audio?.loop?.('wind', { volume: 0 }) || null; } catch (e) { player._wind = null; } }
      if (player._wind?.setVolume) player._wind.setVolume(smooth(8, 45, S.speed) * 0.8);
      updateAimHit();
      // character light rig: sun direction in view space (sky's sun if present, else the layout's)
      const sun = ctx.sky?.sun;
      if (sun && sun.position) RIG.uSunView.value.copy(sun.position).sub(sun.target?.position || _v.set(0, 0, 0)).normalize();
      else RIG.uSunView.value.set(LAYOUT.sunDir[0], LAYOUT.sunDir[1], LAYOUT.sunDir[2]).normalize();
      RIG.uSunView.value.transformDirection(camera.matrixWorldInverse);
    },
  };

  ctx.renderer.domElement.addEventListener('mousedown', () => {
    if (ctx.mode === 'play' && player.enabled && !input.locked) { input.requestLock(); try { ctx.audio?.unlock?.(); } catch (e) { /* */ } }
  });
  ctx.events.on('intro:done', () => { ctx.shake(0, { calm: 4 }); ctx.cam?.snap?.(); });
  setBladeVisual();
  // initial placement
  {
    const st = LAYOUT.playerStart;
    const gy = ctx.world?.groundHeight?.(st.x, st.z) ?? 0;
    player.teleport(new THREE.Vector3(st.x, gy, st.z), st.yaw || 0);
  }
  if (ctx.params?.ptest) { try { (await import('./testworld.js')).createTestWorld(ctx); } catch (e) { console.warn('[player] testworld', e); } }
  return player;
}
