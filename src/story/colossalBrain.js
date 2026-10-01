// Boss behaviour for the smiling giant: intro beats (appear / kick), then a three-phase fight.
//  P1 "At the wall": leans over the parapet gripping it; crush / swat / grab+bite / double slam shockwave.
//     Weak points: both wrist tendons. Both cut -> loses grip, staggers, barges through the breach.
//  P2 "In the town": strides up the avenue crushing houses; sweep / grab / eat civilians / ground slam / stomp.
//     Weak points: both Achilles tendons. Both cut -> drops to its knees, nape exposed.
//  P3 "Steam fury": kneeling; cycles scalding steam bursts (steamForceAt pushes, heat hurts, hair whips) with calm
//     windows where the nape is cuttable. Nape kill -> collapses face-first onto the town, steam eruption.
// Everything is posed through rig.pose (group-local model units, facing +Z).
import * as THREE from 'three';
import { ARM, LEG, H } from './colossalBody.js';

const clamp = THREE.MathUtils.clamp;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const s5 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
const nz = (t, s) => Math.sin(t * 0.73 + s) * 0.5 + Math.sin(t * 1.37 + s * 2.1) * 0.3 + Math.sin(t * 2.91 + s * 3.7) * 0.2;
const rnd = (a, b) => a + Math.random() * (b - a);

export function createBrain(ctx, G) {
  const { root, rig, K, sys } = G;
  const pose = rig.pose;
  const W = ctx.LAYOUT.wall;
  const S = {
    mode: 'hidden', t: 0, phase: 0, fighting: false, action: null, cool: 2, lean: 0.52,
    kicked: false, slammed: false, slammedL: false, steaming: false, steamK: 0, burstT: 0, hurt: 0,
    stagger: 0, grabbed: null, lastGaze: new THREE.Vector3(0, 10, 200), tilt: 0, tiltT: 0,
  };
  G.S = S;
  const V = () => new THREE.Vector3();
  const _v = V(), _v2 = V(), _v3 = V(), _v4 = V();
  const toLocal = (w, out = V()) => root.worldToLocal(out.copy(w));
  const toWorld = (l, out = V()) => root.localToWorld(out.copy(l));
  const ground = (x, z) => { try { return ctx.world?.groundHeight?.(x, z) ?? 0; } catch { return 0; } };
  const audio = (n, o) => { try { ctx.audio?.play?.(n, o); } catch {} };
  const fx = (n, ...a) => { try { return ctx.fx?.[n]?.(...a); } catch { return null; } };
  const emit = (n, p) => ctx.events.emit(n, p);
  const player = () => ctx.player;
  const playerOK = () => { const p = ctx.player; return p && p.position && p.state !== 'dead' && ctx.mode !== 'intro' && p.enabled !== false; };

  // ---------------- geometry at the wall ----------------
  const ZW = G.ZF;                                    // feet z at the wall
  const wallL = () => ({ outer: toLocal(_v.set(G.X0, 0, W.radius + W.thickness)).z, inner: toLocal(_v.set(G.X0, 0, W.radius)).z, top: W.height / K });
  const WL = { outer: (ZW - (W.radius + W.thickness)) / K, inner: (ZW - W.radius) / K, top: W.height / K };
  const gripR = new THREE.Vector3(-0.3, WL.top + 0.028, WL.inner - 0.13);
  const gripL = new THREE.Vector3(0.36, WL.top + 0.028, WL.inner - 0.135);
  const GRIP_CURL = [1.1, 0.62, 0.42, 0];
  const OPEN = [0.12, 0.1, 0.08, 0.25];
  const FIST = [1.5, 1.6, 1.1, 0];

  // ---------------- weak points ----------------
  const wp = (name, boneName, off, radius) => ({ name, position: V(), radius, active: false, hp: 1, bone: rig.bone(boneName), off: new THREE.Vector3(...off) });
  const dorsL = new THREE.Vector3(ARM.dorsal[0], ARM.dorsal[1], ARM.dorsal[2]), dorsR = new THREE.Vector3(-ARM.dorsal[0], ARM.dorsal[1], ARM.dorsal[2]);
  const weakPoints = [
    wp('hand_L', 'handL', dorsL.clone().multiplyScalar(0.03).add(new THREE.Vector3(...ARM.dir).multiplyScalar(0.015)).toArray(), 3.2),
    wp('hand_R', 'handR', dorsR.clone().multiplyScalar(0.03).add(new THREE.Vector3(-ARM.dir[0], ARM.dir[1], ARM.dir[2]).multiplyScalar(0.015)).toArray(), 3.2),
    wp('ankle_L', 'footL', [0, 0.03, -0.05], 3.0),
    wp('ankle_R', 'footR', [0, 0.03, -0.05], 3.0),
    wp('nape', 'neck', [0, 0.09, -0.07], 3.6),
  ];
  const WPN = Object.fromEntries(weakPoints.map((w) => [w.name, w]));
  function updateWeakPoints() {
    for (const w of weakPoints) w.bone.localToWorld(w.position.copy(w.off));
    const f = S.fighting && S.mode !== 'dying' && S.mode !== 'dead';
    WPN.hand_L.active = f && S.phase === 1 && WPN.hand_L.hp > 0;
    WPN.hand_R.active = f && S.phase === 1 && WPN.hand_R.hp > 0;
    WPN.ankle_L.active = f && S.phase === 2 && S.mode === 'stride' && WPN.ankle_L.hp > 0;
    WPN.ankle_R.active = f && S.phase === 2 && S.mode === 'stride' && WPN.ankle_R.hp > 0;
    WPN.nape.active = f && S.phase === 3 && S.mode === 'fury' && !S.steaming && WPN.nape.hp > 0;
  }

  // ---------------- palms / mouth ----------------
  const palm = {};
  for (const s of ['L', 'R']) {
    const side = s === 'L' ? 1 : -1;
    const o = new THREE.Object3D(); o.name = 'palm' + s;
    const Fv = new THREE.Vector3(ARM.dir[0] * side, ARM.dir[1], ARM.dir[2]), Dv = new THREE.Vector3(ARM.dorsal[0] * side, ARM.dorsal[1], ARM.dorsal[2]);
    o.position.copy(Fv.multiplyScalar(0.085)).addScaledVector(Dv, -0.03);
    rig.bone('hand' + s).add(o);
    palm[s] = o;
  }
  G.palm = palm;
  const mouthOff = new THREE.Vector3(...H(0, -0.1, 0.13)).sub(rig.bindPos('head'));
  const mouthW = (out) => rig.bone('head').localToWorld(out.copy(mouthOff));
  const mouthLocal = (out) => toLocal(mouthW(out), out);

  // ---------------- gait ----------------
  const gait = {
    feet: { L: { w: V(), from: V(), to: V(), t: 1, planted: true }, R: { w: V(), from: V(), to: V(), t: 1, planted: true } },
    vel: V(), speed: 0, phase: 0, init: false, limp: { L: 0, R: 0 },
  };
  const facing = (out) => out.set(Math.sin(root.rotation.y), 0, Math.cos(root.rotation.y));
  const rightV = (out) => out.set(-Math.cos(root.rotation.y), 0, Math.sin(root.rotation.y)); // giant's right
  function footIdeal(s, out, lead = 0) {
    const side = s === 'L' ? 1 : -1;
    // local +X is the giant's left
    toWorld(_v4.set(LEG.ankle[0] * side * 1.05, 0, 0.02), out);
    out.addScaledVector(gait.vel, lead);
    out.y = ground(out.x, out.z);
    return out;
  }
  function gaitReset() {
    for (const s of ['L', 'R']) { const f = gait.feet[s]; footIdeal(s, f.w); f.from.copy(f.w); f.to.copy(f.w); f.t = 1; f.planted = true; }
    gait.init = true;
  }
  const STEP_DUR = 1.25;
  function gaitUpdate(dt, allowStep = true) {
    if (!gait.init) gaitReset();
    const thr = 0.2 * K;
    for (const s of ['L', 'R']) {
      const f = gait.feet[s], o = gait.feet[s === 'L' ? 'R' : 'L'];
      if (f.lock) continue;
      if (f.planted && !o.lock) {
        const ideal = footIdeal(s, _v, STEP_DUR * 0.5);
        if (allowStep && o.planted && f.w.distanceTo(ideal) > thr * (gait.speed > 0.5 ? 1 : 0.55)) {
          f.from.copy(f.w); f.to.copy(footIdeal(s, _v2, STEP_DUR * 0.9)); f.t = 0; f.planted = false;
        }
      } else {
        const dur = STEP_DUR * (1 + gait.limp[s] * 0.6);
        f.t = Math.min(1, f.t + dt / dur);
        const u = sstep(0, 1, f.t);
        f.w.lerpVectors(f.from, f.to, u);
        f.w.y += Math.sin(Math.PI * f.t) * 0.13 * K * (1 - gait.limp[s] * 0.5);
        if (f.t >= 1) { f.planted = true; f.w.copy(f.to); footfall(f.w, s); }
      }
      // ankle target (local)
      toLocal(f.w, pose.feet[s].target);
      pose.feet[s].target.y += 0.085;
      pose.feet[s].pitch = f.planted ? 0 : Math.sin(Math.PI * f.t) * 0.35;
    }
    // body bob / sway from the stepping feet
    const lSt = !gait.feet.L.planted ? Math.sin(Math.PI * gait.feet.L.t) : 0, rSt = !gait.feet.R.planted ? Math.sin(Math.PI * gait.feet.R.t) : 0;
    pose.rootOff.y += -0.02 - 0.025 * (lSt + rSt);
    pose.side += (rSt - lSt) * 0.05;
    pose.twist += (lSt - rSt) * 0.08;
  }
  function footfall(p, s) {
    const g = _v3.copy(p);
    ctx.shake?.(0.5, { at: g, radius: 260 });
    audio('titan_step', { position: g, volume: 1 });
    fx('dust', g, 9, { color: 0xb8a58a });
    const pl = player();
    if (playerOK() && pl.state === 'ground' && pl.position.distanceTo(g) < 12) { pl.hurt?.(0.5, _v4.copy(pl.position).sub(g).normalize()); }
  }
  // arms swinging while walking (hands w ~0.6)
  function swingArms() {
    const ph = (gait.feet.L.planted ? 0 : Math.sin(Math.PI * gait.feet.L.t)) - (gait.feet.R.planted ? 0 : Math.sin(Math.PI * gait.feet.R.t));
    for (const s of ['L', 'R']) {
      const side = s === 'L' ? 1 : -1, h = pose.hands[s];
      h.w = 0.85;
      h.target.set(ARM.wrist[0] * side * 0.85, ARM.wrist[1] + 0.06, 0.08 + ph * side * -0.12).add(pose.rootOff);
      h.f.set(side * 0.2, -1, 0.15); h.d.set(side, 0, -0.2);
      h.curl = [0.5, 0.6, 0.4, 0]; h.thumb = 0.5;
    }
  }

  // ---------------- helpers ----------------
  function setGripHands(hL = 1, hR = 1) {
    const hs = pose.hands;
    hs.R.target.copy(gripR); hs.R.f.set(0, -0.05, 1); hs.R.d.set(0, 1, -0.05); hs.R.w = hR; hs.R.curl = GRIP_CURL.slice(); hs.R.thumb = 0.6;
    hs.L.target.copy(gripL); hs.L.f.set(0, -0.05, 1); hs.L.d.set(0, 1, -0.05); hs.L.w = hL; hs.L.curl = GRIP_CURL.slice(); hs.L.thumb = 0.6;
  }
  function limpHand(s, k) {
    const side = s === 'L' ? 1 : -1, h = pose.hands[s];
    const hang = _v.set(ARM.wrist[0] * side * 0.9, ARM.wrist[1] + 0.05, 0.25).add(pose.rootOff);
    h.target.lerp(hang, k); h.w = Math.max(h.w, 0.9);
    h.f.set(side * 0.1, -1, 0.3); h.d.set(side, 0, 0);
    h.curl = [0.35, 0.5, 0.35, 0]; h.thumb = 0.3;
  }
  function gazeUpdate(dt, time, target) {
    let tg = target || S.gazeOverride;
    if (!tg) tg = playerOK() ? _v.copy(player().position).add(_v2.set(0, 1, 0)) : ctx.camera.position;
    S.lastGaze.lerp(tg, 1 - Math.exp(-dt * 2.2));
    pose.gaze = S.lastGaze; pose.gazeW = Math.min(1, pose.gazeW + dt * 0.8);
    // uncanny slow head tilts with the occasional twitch
    S.tiltT -= dt;
    if (S.tiltT <= 0) { S.tiltT = rnd(2.5, 6); S.tiltGoal = rnd(-0.38, 0.38); if (Math.random() < 0.3) S.tilt += rnd(-0.15, 0.15); }
    S.tilt += ((S.tiltGoal || 0) - S.tilt) * (1 - Math.exp(-dt * 1.3));
    pose.tilt = S.tilt + nz(time * 0.4, 3) * 0.04;
  }
  // world position of a hand's palm, local target that puts the palm at a world point
  const palmW = (s, out) => palm[s].getWorldPosition(out);
  const wristForPalm = (s, pw, out) => { // approximate: palm is ~0.09 along the fingers from the wrist
    toLocal(pw, out);
    const h = pose.hands[s];
    return out.addScaledVector(_v4.copy(h.f).normalize(), -0.085).addScaledVector(_v3.copy(h.d).normalize(), 0.03);
  };

  // ---------------- actions ----------------
  function startAction(type, o = {}) { S.action = { type, t: 0, ...o }; }
  function endAction(cool = rnd(1.4, 2.8)) { S.action = null; S.cool = cool; gait.feet.L.lock = gait.feet.R.lock = false; }

  function hitPlayer(point, radius, dmg, push, up = 8) {
    if (!playerOK()) return false;
    const pl = player();
    const d = pl.position.distanceTo(point);
    if (d > radius || pl.invuln > 0) return false;
    const dir = _v4.copy(pl.position).sub(point); dir.y = Math.max(0.2, dir.y); dir.normalize();
    pl.hurt?.(dmg, dir.clone());
    pl.knock?.(dir.clone().multiplyScalar(push).add(_v3.set(0, up, 0)));
    ctx.post?.punch?.(0.6);
    ctx.shake?.(0.7);
    return true;
  }
  function shockwave(point, radius, strength, dmg) {
    ctx.shake?.(1.1, { at: point, radius: 400 });
    ctx.post?.punch?.(1); ctx.post?.flash?.(0.15);
    audio('boom', { position: point, volume: 1 });
    fx('dust', point, 30, { color: 0xb0a080 });
    fx('debris', point, 40, 26, {});
    if (!playerOK()) return;
    const pl = player();
    const d = pl.position.distanceTo(point);
    if (d < radius) {
      const k = 1 - d / radius;
      const dir = _v4.copy(pl.position).sub(point); dir.y = Math.abs(dir.y) + 6; dir.normalize();
      pl.knock?.(dir.clone().multiplyScalar(strength * k));
      if (d < radius * 0.5) pl.hurt?.(dmg * k, dir.clone());
    }
  }

  // swat / grab / crush / slam / eat / sweep / stomp -- each writes pose.hands etc. while running
  function runAction(dt, time) {
    const a = S.action; if (!a) return;
    a.t += dt;
    const t = a.t;
    const h = a.hand ? pose.hands[a.hand] : null;
    const side = a.hand === 'L' ? 1 : -1;
    const base = a.hand === 'L' ? gripL : gripR;
    switch (a.type) {
      case 'crush': {
        const k = Math.sin(clamp(t / 1.6, 0, 1) * Math.PI);
        h.target.copy(base).add(_v.set(0, -0.012 * k, 0.01 * k));
        h.curl = [GRIP_CURL[0] + 0.35 * k, GRIP_CURL[1] + 0.4 * k, GRIP_CURL[2] + 0.3 * k, 0];
        if (!a.did && t > 0.55) {
          a.did = true;
          const p = toWorld(_v.set(base.x, WL.top, WL.inner), V());
          try { ctx.world?.damage?.(p, 9, 0.55); } catch {}
          fx('debris', p, 26, 12, {}); fx('dust', p, 12, {});
          audio('wall_break', { position: p, volume: 0.8 });
          ctx.shake?.(0.35, { at: p, radius: 250 });
          emit('colossal:attack', { type: 'crush', point: p });
        }
        if (t > 1.6) endAction();
        break;
      }
      case 'swat': {
        if (!a.aim) a.aim = V();
        if (t < 0.95) {
          // wind-up: hand rears up and back, fingers splayed (telegraph)
          const k = s5(0, 0.95, t);
          h.target.copy(base).lerp(_v.set(base.x * 1.25, base.y + 0.36, base.z - 0.12), k);
          h.f.set(0, 1, 0.3); h.d.set(0, 0.2, -1); h.curl = OPEN; h.thumb = 0.1;
          if (t > 0.8 && playerOK()) a.aim.copy(player().position).addScaledVector(player().velocity || _v.set(0, 0, 0), 0.35);
          if (!a.groan) { a.groan = true; audio('titan_groan', { position: G.headPosition, volume: 0.9, rate: 0.7 }); }
        } else if (t < 1.45) {
          const k = (t - 0.95) / 0.5;
          if (!a.started) { a.started = true; emit('colossal:attack', { type: 'swat', point: a.aim.clone() }); audio('gas', { position: a.aim, volume: 0.9, rate: 0.35 }); }
          const aimL = toLocal(a.aim, _v2);
          const from = _v.set(base.x * 1.25, base.y + 0.36, base.z - 0.12);
          const to = _v3.copy(aimL).add(_v4.set(-side * 0.25, -0.1, 0.05));
          h.target.lerpVectors(from, to, k * k);
          // clamp reach
          h.f.set(-side * 0.6, -0.3, 1); h.d.set(0, 1, 0); h.curl = [0.25, 0.3, 0.2, 0.1];
          if (!a.hit) { palmW(a.hand, _v4); if (hitPlayer(_v4, 12, 0.32, 38, 10)) a.hit = true; }
        } else if (t < 2.5) {
          const k = s5(1.45, 2.5, t);
          h.target.lerp(base, k); h.f.set(0, -0.05, 1); h.d.set(0, 1, -0.05); h.curl = GRIP_CURL;
        } else endAction();
        break;
      }
      case 'grab': return runGrab(dt, time);
      case 'eat': return runEat(dt, time);
      case 'slam': {
        const hs = pose.hands;
        if (t < 1.1) {
          const k = s5(0, 1.1, t);
          for (const s of ['L', 'R']) { const b = s === 'L' ? gripL : gripR; if (WPN['hand_' + s].hp <= 0 && S.phase === 1) continue; hs[s].target.copy(b).lerp(_v.set(b.x * 0.8, b.y + 0.42, b.z - 0.18), k); hs[s].f.set(0, 1, 0.2); hs[s].d.set(0, 0, -1); hs[s].curl = FIST; hs[s].thumb = 0.9; hs[s].w = 1; }
          pose.lean -= 0.18 * k;
          if (!a.groan) { a.groan = true; audio('titan_roar', { position: G.headPosition, volume: 1, rate: 0.8 }); }
        } else if (t < 1.3) {
          const k = (t - 1.1) / 0.2;
          for (const s of ['L', 'R']) { const b = s === 'L' ? gripL : gripR; if (WPN['hand_' + s].hp <= 0 && S.phase === 1) continue; hs[s].target.copy(_v.set(b.x * 0.8, b.y + 0.42, b.z - 0.18)).lerp(_v2.copy(b).add(_v3.set(0, -0.005, 0.02)), k * k); hs[s].curl = FIST; }
          pose.lean -= 0.18 * (1 - k);
        } else {
          if (!a.did) {
            a.did = true;
            const p = toWorld(_v.set((gripL.x + gripR.x) / 2, WL.top, WL.inner), V());
            for (const s of ['L', 'R']) { const b = toWorld(_v2.set(s === 'L' ? gripL.x : gripR.x, WL.top, WL.inner), V()); try { ctx.world?.damage?.(b, 12, 0.9); } catch {} fx('debris', b, 40, 20, {}); }
            audio('wall_break', { position: p, volume: 1 });
            shockwave(p, 110, 55, 0.25);
            emit('colossal:attack', { type: 'slam', point: p });
          }
          const k = s5(1.3, 2.4, t);
          for (const s of ['L', 'R']) { hs[s].curl = GRIP_CURL; }
          if (t > 2.4) endAction(rnd(2, 3.5));
        }
        break;
      }
      case 'blast': { // signature attack: scalding steam blast — telegraphed wind-up, then the body erupts
        const WIND = 1.6, DUR = 2.4;
        if (t < WIND) {
          const k = s5(0, WIND, t);
          S.steamWarn = k * 0.95;
          pose.headPitch -= 0.18 * k; pose.lean -= 0.1 * k; pose.jaw = 0.12 * k;
          S.hurt = Math.max(S.hurt, 0.9 * k);
          pose.side += Math.sin(t * 22) * 0.012 * k;
          if (!a.hiss) { a.hiss = true; audio('steam', { position: G.headPosition, volume: 0.6, rate: 0.6 }); audio('titan_groan', { position: G.headPosition, volume: 0.9, rate: 0.5 }); }
          if (Math.random() < dt * 6 * k) G.woundSteam?.(WPN.nape.position, 0.3);
        } else if (t < WIND + DUR) {
          const u = t - WIND;
          S.steamWarn = 1 - s5(0.2, DUR, u);
          S.blasting = true; S.burstT = u * (3.2 / DUR);
          S.hurt = Math.max(S.hurt, 1);
          pose.headPitch -= 0.18 * (1 - s5(0, DUR, u)); pose.jaw = 0.25;
          if (!a.did) {
            a.did = true;
            const p = WPN.nape.position.clone();
            audio('steam', { position: p, volume: 1 }); audio('titan_roar', { position: G.headPosition, volume: 1, rate: 0.7 });
            ctx.shake?.(0.6, { at: p, radius: 300 }); ctx.post?.punch?.(0.5);
            burst(1.4);
            try { fx('steam', root.position.clone().add(_v.set(0, 40, 0)), 60, 3, { burst: true }); } catch {}
            emit('colossal:attack', { type: 'steam', point: p });
          }
          a.heatT = (a.heatT || 0) - dt;
          if (a.heatT <= 0 && playerOK()) {
            a.heatT = 0.4;
            const pl = player(), d = pl.position.distanceTo(WPN.nape.position);
            const db = pl.position.distanceTo(rig.bone('chest').getWorldPosition(_v2));
            if (Math.min(d, db) < 34) pl.hurt?.(0.1, _v.copy(pl.position).sub(WPN.nape.position).normalize());
          }
        } else { S.blasting = false; S.steamWarn = 0; endAction(rnd(2.5, 4)); }
        break;
      }
      case 'roar': { // head thrown back, the grin splits wide: shockwave knocks the soldier away
        if (t < 1.0) {
          const k = s5(0, 1.0, t);
          pose.headPitch -= 0.45 * k; pose.jaw = 0.25 * k; pose.lean -= 0.12 * k;
          if (!a.groan) { a.groan = true; audio('titan_groan', { position: G.headPosition, volume: 1, rate: 0.5 }); }
        } else if (t < 2.6) {
          const k = 1 - s5(2.0, 2.6, t);
          pose.headPitch -= 0.1 * k; pose.jaw = 0.95 * k; pose.lean -= 0.05 * k;
          pose.tilt += Math.sin(t * 30) * 0.03 * k;
          if (!a.did) {
            a.did = true;
            audio('titan_roar', { position: G.headPosition, volume: 1, rate: 0.75 });
            const p = mouthW(V());
            shockwave(p, 140, 60, 0.18);
            emit('colossal:attack', { type: 'roar', point: p });
            G.woundSteam?.(p, 1.5);
          }
          S.hurt = Math.max(S.hurt, 0.4 * k);
        } else endAction(rnd(2.5, 4));
        break;
      }
      case 'gslam': { // phase 2/3 ground slam with both fists
        const hs = pose.hands;
        const front = _v2.set(0, 0.05, 0.42);
        if (t < 1.2) {
          const k = s5(0, 1.2, t);
          for (const s of ['L', 'R']) { const sd = s === 'L' ? 1 : -1; hs[s].w = 1; hs[s].target.set(0.2 * sd, 1.75, 0.15).add(pose.rootOff); hs[s].f.set(0, 1, 0.3); hs[s].d.set(0, 0, -1); hs[s].curl = FIST; hs[s].thumb = 0.9; }
          pose.lean = S.lean - 0.25 * k;
          if (!a.groan) { a.groan = true; audio('titan_roar', { position: G.headPosition, volume: 1, rate: 0.75 }); }
        } else if (t < 1.45) {
          const k = (t - 1.2) / 0.25;
          for (const s of ['L', 'R']) { const sd = s === 'L' ? 1 : -1; hs[s].target.set(0.2 * sd, 1.75, 0.15).add(pose.rootOff).lerp(_v.copy(front).add(_v3.set(0.12 * sd, 0, 0)), k * k); hs[s].f.set(0, -1, 0.5); hs[s].d.set(0, 0, 1); }
          pose.lean = S.lean + 0.5 * k; pose.rootOff.y -= 0.2 * k;
        } else {
          if (!a.did) { a.did = true; const p = toWorld(front, V()); p.y = ground(p.x, p.z); shockwave(p, 120, 60, 0.3); try { ctx.world?.damage?.(p, 22, 0.25); } catch {} emit('colossal:attack', { type: 'slam', point: p }); }
          const k = 1 - s5(1.45, 2.8, t);
          for (const s of ['L', 'R']) { const sd = s === 'L' ? 1 : -1; hs[s].target.copy(front).add(_v3.set(0.12 * sd, 0, 0)); }
          pose.lean = S.lean + 0.5 * k; pose.rootOff.y -= 0.2 * k;
          if (t > 2.8) endAction(rnd(2.5, 4));
        }
        break;
      }
      case 'sweep': {
        // arm swings flat across the rooftops in front, through the player's height
        const pl = player();
        if (!a.y) a.y = clamp(((pl?.position?.y ?? 15) - ground(root.position.x, root.position.z)) / K, 0.25, 1.3);
        const reach = 0.62;
        const ang = (u) => { const q = side * (1.3 - 2.6 * u); return _v.set(Math.sin(q) * reach + ARM.shoulder[0] * side, a.y, Math.cos(q) * reach * 0.9 + 0.05); };
        h.w = 1;
        if (t < 1.0) {
          const k = s5(0, 1.0, t);
          h.target.lerp(ang(0), k * 0.6 + 0.1); h.f.set(side, 0, 0.3); h.d.set(0, 1, 0); h.curl = OPEN;
          pose.twist += side * 0.35 * k;
          if (!a.groan) { a.groan = true; audio('titan_groan', { position: G.headPosition, volume: 1, rate: 0.6 }); }
        } else if (t < 1.75) {
          const u = s5(1.0, 1.75, t);
          h.target.copy(ang(u)); h.f.set(-side, 0, 0.4); h.d.set(0, 1, 0); h.curl = [0.3, 0.35, 0.25, 0.1];
          pose.twist += side * 0.35 * (1 - 2 * u);
          if (!a.started) { a.started = true; emit('colossal:attack', { type: 'sweep', point: toWorld(ang(0.5), V()) }); audio('gas', { position: G.headPosition, volume: 1, rate: 0.3 }); }
          a.dmgT = (a.dmgT || 0) - dt;
          palmW(a.hand, _v4);
          if (a.dmgT <= 0) { a.dmgT = 0.14; try { ctx.world?.damage?.(_v4.clone(), 9, 0.25); } catch {} }
          if (!a.hit && hitPlayer(_v4, 13, 0.35, 42, 12)) a.hit = true;
        } else if (t < 2.7) {
          pose.twist += side * -0.35 * (1 - s5(1.75, 2.7, t));
        } else endAction(rnd(2, 3.5));
        break;
      }
      case 'stomp': {
        const s = a.foot, f = gait.feet[s];
        if (!a.aim) { a.aim = playerOK() ? player().position.clone() : footIdeal(s, V(), 0); a.aim.x = onPlaza(a.aim.z) ? clamp(a.aim.x, -PLZ.radius * 0.8, PLZ.radius * 0.8) : clamp(a.aim.x, -7, 7); a.aim.y = ground(a.aim.x, a.aim.z); a.from = f.w.clone(); f.planted = false; f.t = 0.5; f.lock = true; }
        if (t < 1.0) {
          const k = s5(0, 1.0, t);
          f.w.lerpVectors(a.from, _v.copy(a.aim).lerp(a.from, 0.3), k); f.w.y = a.from.y + 0.35 * K * k;
          if (!a.groan) { a.groan = true; audio('titan_groan', { position: G.headPosition, volume: 0.8, rate: 0.6 }); }
        } else if (t < 1.25) {
          const k = (t - 1.0) / 0.25;
          f.w.lerpVectors(_v.copy(a.aim).lerp(a.from, 0.3).setY(a.from.y + 0.35 * K), a.aim, k * k);
        } else {
          if (!a.did) { a.did = true; f.w.copy(a.aim); f.planted = true; f.t = 1; f.lock = false; footfall(a.aim, s); shockwave(a.aim, 60, 40, 0.2); hitPlayer(a.aim, 14, 0.6, 30); emit('colossal:attack', { type: 'stomp', point: a.aim.clone() }); }
          if (t > 2.0) endAction();
        }
        toLocal(f.w, pose.feet[s].target); pose.feet[s].target.y += 0.085;
        break;
      }
    }
  }

  // grab the player: reach, snatch, carry to the grin, bite
  function runGrab(dt) {
    const a = S.action, t = a.t, h = pose.hands[a.hand], side = a.hand === 'L' ? 1 : -1;
    const base = S.phase === 1 ? (a.hand === 'L' ? gripL : gripR) : h.target.clone();
    if (!a.from) a.from = h.target.clone();
    if (!a.aim) a.aim = V();
    h.w = 1;
    if (a.stage === undefined) a.stage = 'reach';
    if (a.stage === 'reach') {
      if (t < 0.6) {
        const k = s5(0, 0.6, t);
        h.target.lerpVectors(a.from, _v.copy(a.from).add(_v2.set(0.05 * side, 0.12, -0.08)), k);
        h.curl = OPEN; h.thumb = 0; h.f.set(0, 0.3, 1); h.d.set(0, 1, 0);
        if (playerOK()) a.aim.copy(player().position).addScaledVector(player().velocity || _v.set(0, 0, 0), 0.3);
      } else if (t < 1.0) {
        const k = (t - 0.6) / 0.4;
        if (!a.started) { a.started = true; emit('colossal:attack', { type: 'grab', point: a.aim.clone() }); }
        const al = wristForPalm(a.hand, a.aim, _v2);
        h.target.lerpVectors(_v.copy(a.from).add(_v3.set(0.05 * side, 0.12, -0.08)), al, k * k);
        const dir = _v3.copy(al).sub(rig.groupPos(rig.bone('upperArm' + a.hand), _v4)).normalize();
        h.f.copy(dir); h.d.set(0, 1, 0); h.curl = OPEN;
        palmW(a.hand, _v4);
        if (playerOK() && player().position.distanceTo(_v4) < 10 && player().state !== 'grabbed' && !(player().invuln > 0)) {
          try { player().grab?.(sys, palm[a.hand]); } catch {}
          S.grabbed = { kind: 'player', hand: a.hand };
          a.stage = 'carry'; a.t = 0; a.from = h.target.clone();
          audio('grab', { position: _v4, volume: 1 });
        }
      } else if (t < 2.0) {
        h.target.lerp(base, s5(1.0, 2.0, t)); h.curl = GRIP_CURL; if (S.phase === 1) { h.f.set(0, -0.05, 1); h.d.set(0, 1, -0.05); }
      } else endAction();
      return;
    }
    return carryToMouth(dt, a, h, side, base, () => {
      // bite the soldier (player's own timer resolves death at 2.5 s if not freed)
      audio('crunch', { position: G.headPosition, volume: 1 });
    });
  }
  function carryToMouth(dt, a, h, side, base, onBite) {
    const t = a.t;
    if (a.stage === 'carry') {
      h.curl = FIST; h.thumb = 1;
      const m = mouthLocal(_v);
      const tgt = _v2.copy(m).add(_v3.set(0.06 * side, -0.07, 0.11));
      h.target.lerpVectors(a.from, tgt, s5(0, 1.1, t));
      h.f.set(-side * 0.5, 0.6, -0.6); h.d.set(side * 0.4, 0.2, 0.8);
      pose.gazeW = Math.max(0.3, pose.gazeW - dt);
      pose.headPitch += 0.25 * sstep(0.6, 1.1, t);
      if (t > 1.1) { a.stage = 'bite'; a.t = 0; }
      if (a.aborted) { a.stage = 'return'; a.t = 0; a.from = h.target.clone(); }
    } else if (a.stage === 'bite') {
      h.curl = FIST; h.thumb = 1;
      const m = mouthLocal(_v);
      h.target.copy(m).add(_v3.set(0.03 * side, -0.05 + 0.03 * sstep(0, 0.55, t), 0.08 - 0.05 * sstep(0.3, 0.6, t)));
      pose.jaw = t < 0.55 ? sstep(0, 0.45, t) : 1 - sstep(0.55, 0.68, t);
      pose.headPitch += 0.25 - 0.2 * sstep(0.5, 0.65, t);
      if (!a.bit && t > 0.62) {
        a.bit = true; onBite?.();
        const mp = mouthW(V());
        for (let i = 0; i < 4; i++) fx('blood', mp, _v4.set(rnd(-1, 1), rnd(-0.5, 0.5), rnd(0.2, 1)).normalize());
        ctx.shake?.(0.4, { at: mp, radius: 200 });
        emit('colossal:attack', { type: 'bite', point: mp });
      }
      if (a.aborted && !a.bit) { a.stage = 'return'; a.t = 0; a.from = h.target.clone(); }
      if (t > 0.9) { a.stage = 'chew'; a.t = 0; a.from = h.target.clone(); }
    } else if (a.stage === 'chew') {
      pose.jaw = Math.max(0, Math.sin(t * 7) * 0.18);
      pose.headPitch += 0.08 * Math.sin(t * 3.5);
      h.target.lerpVectors(a.from, base, s5(0.4, 1.8, t));
      h.curl = S.phase === 1 ? GRIP_CURL : [0.6, 0.7, 0.5, 0];
      if (S.phase === 1) { h.f.set(0, -0.05, 1); h.d.set(0, 1, -0.05); }
      if (t > 2.4) { S.grabbed = null; endAction(rnd(2, 3)); }
    } else if (a.stage === 'return') {
      h.target.lerpVectors(a.from, base, s5(0, 1.2, t));
      h.curl = OPEN;
      if (t > 1.2) { S.grabbed = null; endAction(1.5); }
    }
  }
  // eat a fleeing civilian: bend, reach, pick up, lift to the grin, bite, chew
  function runEat(dt) {
    const a = S.action, h = pose.hands[a.hand], side = a.hand === 'L' ? 1 : -1;
    const civ = a.civ;
    const base = h.target.clone();
    if (!a.from) a.from = h.target.clone();
    h.w = 1;
    if (a.stage === undefined) a.stage = 'reach';
    if (a.stage === 'reach') {
      const t = a.t;
      if (!civ || civ.alive === false) { endAction(0.5); return; }
      const k = s5(0, 1.3, t);
      pose.lean = S.lean + 0.55 * k; pose.rootOff.y -= 0.16 * k;
      const al = wristForPalm(a.hand, _v4.copy(civ.position).add(_v.set(0, 1, 0)), _v2);
      h.target.lerpVectors(a.from, al, k);
      h.f.set(0, -1, 0.4); h.d.set(0, 0.3, -1); h.curl = OPEN;
      if (t > 1.3) {
        palmW(a.hand, _v4);
        try { ctx.titans?.civilians?.pickUp?.(civ, palm[a.hand]); } catch {}
        audio('scream', { position: civ.position, volume: 1, rate: rnd(0.9, 1.2) });
        a.stage = 'carry'; a.t = 0; a.from = h.target.clone();
        emit('colossal:attack', { type: 'eat', point: civ.position.clone() });
      }
      return;
    }
    if (a.stage === 'carry') { const k = 1 - s5(0, 1.1, a.t); pose.lean = S.lean + 0.55 * k; pose.rootOff.y -= 0.16 * k; }
    if (!a.home) a.home = (S.mode === 'wall' || S.mode === 'kick') ? (a.hand === 'L' ? gripL : gripR).clone() : new THREE.Vector3(ARM.wrist[0] * side * 0.85, ARM.wrist[1] + 0.06, 0.1);
    carryToMouth(dt, a, h, side, a.home, () => {
      audio('crunch', { position: G.headPosition, volume: 1 });
      try { ctx.titans?.civilians?.eaten?.(civ); } catch {}
    });
  }

  // ---------------- choose actions ----------------
  function pickPhase1() {
    const hands = ['L', 'R'].filter((s) => WPN['hand_' + s].hp > 0);
    if (!hands.length) return;
    const pl = playerOK() ? player() : null;
    if (pl) {
      // nearest usable hand
      let best = null, bd = 1e9;
      for (const s of hands) { const d = palmW(s, _v).distanceTo(pl.position); if (d < bd) { bd = d; best = s; } }
      const shoulderD = rig.bone('upperArm' + best).getWorldPosition(_v).distanceTo(pl.position);
      if (shoulderD < 70 && Math.random() < 0.3) return startAction('blast');
      if (shoulderD < 55) return startAction('swat', { hand: best });
      const hdist = pl.position.distanceTo(G.headPosition);
      if (hdist < 130 && Math.random() < 0.4 && hands.length === 2) return startAction('slam');
      if (hdist < 150 && Math.random() < 0.35) return startAction('roar');
    }
    return startAction('crush', { hand: hands[(Math.random() * hands.length) | 0] });
  }
  function findCiv(reachM) {
    const C = ctx.titans?.civilians;
    if (!C) return null;
    // at the wall: reach over the parapet from the shoulders; in town: bend down anywhere around the feet
    const atWall = S.mode === 'wall';
    const from = atWall ? G.headPosition : root.position;
    let c = null;
    try { c = C.nearest?.(from, reachM + (atWall ? 25 : 0)) || null; } catch { c = null; }
    if (!c || c.alive === false || !c.position) return null;
    if (atWall) {
      const W0 = ctx.LAYOUT.wall;
      const rz = Math.hypot(c.position.x, c.position.z);
      if (c.position.y < W0.height - 12 && rz < W0.radius - 25) return null;   // down in the streets: out of reach from outside
    } else {
      const dx = c.position.x - root.position.x, dz = c.position.z - root.position.z;
      if (Math.hypot(dx, dz) > reachM) return null;
    }
    return c;
  }
  function pickPhase2() {
    const pl = playerOK() ? player() : null;
    const hands = ['L', 'R'];
    if (pl) {
      const d = pl.position.distanceTo(root.position);
      const hd = pl.position.distanceTo(G.headPosition);
      let best = 'L', bd = 1e9;
      for (const s of hands) { const dd = rig.bone('upperArm' + s).getWorldPosition(_v).distanceTo(pl.position); if (dd < bd) { bd = dd; best = s; } }
      if (pl.state === 'ground' && pl.position.y - ground(pl.position.x, pl.position.z) < 4 && d < 35 && Math.abs(pl.position.x - streetX(pl.position.z, pl.position.x)) < 5) {
        const lf = gait.feet.L.w.distanceTo(pl.position) < gait.feet.R.w.distanceTo(pl.position) ? 'L' : 'R';
        return startAction('stomp', { foot: lf });
      }
      if (bd < 70 && Math.random() < 0.35) return startAction('blast');
      if (bd < 60 && pl.position.y < 60) return startAction('sweep', { hand: best });
      if (hd < 120 && Math.random() < 0.3) return startAction('gslam');
      if (hd < 150 && Math.random() < 0.3) return startAction('roar');
    }
  }
  function pickPhase3() {
    const pl = playerOK() ? player() : null;
    if (pl) {
      let best = 'L', bd = 1e9;
      for (const s of ['L', 'R']) { const dd = rig.bone('upperArm' + s).getWorldPosition(_v).distanceTo(pl.position); if (dd < bd) { bd = dd; best = s; } }
      if (bd < 60) return startAction('sweep', { hand: best });
      if (Math.random() < 0.4) return startAction('roar');
    }
  }

  // ---------------- modes ----------------
  function setMode(m) { S.mode = m; S.t = 0; }
  function setPhase(p) {
    if (S.phase === p) return;
    S.phase = p;
    if (p > 1) { burst(0.8); S.hurt = Math.max(S.hurt, 0.6); }
    emit('colossal:phase', { phase: p });
  }
  const standAtWall = () => { root.position.set(G.X0, ground(G.X0, ZW), ZW); root.rotation.y = Math.PI; };

  function modeWall(dt, time) {
    pose.rootOff.set(0, 0, 0); pose.twist = 0; pose.side = 0;
    S.lean += (0.46 - S.lean) * (1 - Math.exp(-dt * 2)); pose.lean = S.lean;
    for (const s of ['L', 'R']) { pose.feet[s].target.set(LEG.ankle[0] * (s === 'L' ? 1 : -1), 0.085, LEG.ankle[2]); pose.feet[s].pitch = 0; }
    setGripHands(1, 1);
    for (const s of ['L', 'R']) if (WPN['hand_' + s].hp <= 0) limpHand(s, 1);
    pose.jaw = 0;
    gazeUpdate(dt, time);
    if (S.fighting && S.phase === 1) {
      S.cool -= dt;
      if (!S.action && S.cool <= 0) pickPhase1();
      runAction(dt, time);
      if (WPN.hand_L.hp <= 0 && WPN.hand_R.hp <= 0 && !S.action) { setMode('stagger'); }
    } else if (S.action) runAction(dt, time);
  }
  function modeAppear(dt, time) {
    const t = S.t;
    const rise = s5(3.0, 10.5, t);
    const leanT = 0.32 + 0.2 * rise;
    S.lean = leanT; pose.lean = leanT;
    pose.rootOff.set(0, -0.42 * (1 - rise), 0.05 * (1 - rise));
    for (const s of ['L', 'R']) { pose.feet[s].target.set(LEG.ankle[0] * (s === 'L' ? 1 : -1), 0.085, LEG.ankle[2]); pose.feet[s].pitch = 0; }
    const hs = pose.hands;
    // right hand: out of the steam, slams onto the parapet at t=1.8, grips
    const up = s5(0.3, 1.45, t), slam = clamp((t - 1.45) / 0.35, 0, 1);
    const hover = _v.set(gripR.x - 0.02, WL.top + 0.2, gripR.z - 0.07), low = _v2.set(gripR.x + 0.05, WL.top - 0.55, gripR.z - 0.18);
    if (t < 1.45) hs.R.target.lerpVectors(low, hover, up); else hs.R.target.lerpVectors(hover, gripR, slam * slam);
    hs.R.w = sstep(0.0, 0.4, t);
    hs.R.f.set(0, 0.35 * (1 - slam) - 0.05, 1); hs.R.d.set(0.1 * (1 - slam), 1, 0.35 * (1 - slam) - 0.05);
    const gr = sstep(1.75, 2.5, t);
    hs.R.curl = [0.15 + gr * 0.95, 0.12 + gr * 0.5, 0.1 + gr * 0.32, 0.25 * (1 - gr)]; hs.R.thumb = 0.2 + gr * 0.4;
    const up2 = s5(5.2, 6.4, t), slam2 = clamp((t - 6.4) / 0.35, 0, 1);
    const hover2 = _v3.set(gripL.x + 0.02, WL.top + 0.16, gripL.z - 0.06), low2 = _v4.set(gripL.x - 0.05, WL.top - 0.6, gripL.z - 0.2);
    if (t < 6.4) hs.L.target.lerpVectors(low2, hover2, up2); else hs.L.target.lerpVectors(hover2, gripL, slam2 * slam2);
    hs.L.w = sstep(5.0, 5.5, t);
    hs.L.f.set(0, 0.3 * (1 - slam2) - 0.05, 1); hs.L.d.set(-0.1 * (1 - slam2), 1, 0.3 * (1 - slam2) - 0.05);
    const gr2 = sstep(6.7, 7.4, t);
    hs.L.curl = [0.15 + gr2 * 0.95, 0.12 + gr2 * 0.5, 0.1 + gr2 * 0.32, 0.25 * (1 - gr2)]; hs.L.thumb = 0.2 + gr2 * 0.4;
    if (!S.slammed && t >= 1.8) { S.slammed = true; gripEvent('R'); }
    if (!S.slammedL && t >= 6.75) { S.slammedL = true; gripEvent('L'); }
    pose.jaw = 0;
    gazeUpdate(dt, time, t < 9 ? _v.set(0, 5, 200) : null);
    pose.gazeW = sstep(4, 8, t);
    if (t > 10.5) setMode('wall');
  }
  function gripEvent(s) {
    const p = toWorld(_v.set(s === 'L' ? gripL.x : gripR.x, WL.top, WL.inner - 0.02), V());
    ctx.events.emit('colossal:grip', { point: p, hand: s });
    ctx.shake?.(0.5, { at: p, radius: 300 });
    fx('debris', p, 30, 14, {}); fx('dust', p, 16, {});
    audio('wall_break', { position: p, volume: 0.9 }); audio('boom', { position: p, volume: 0.6 });
    try { ctx.world?.damage?.(p, 6, 0.3); } catch {}
  }
  function modeKick(dt, time) {
    modeWall(dt, time);
    const k = S.t;
    const restR = _v.set(-LEG.ankle[0], 0.085, LEG.ankle[2]);
    const wind = s5(0.0, 0.85, k) * (1 - s5(0.85, 1.05, k));
    const thrust = clamp((k - 0.85) / 0.35, 0, 1), back = s5(1.9, 3.2, k);
    const windP = _v2.set(-0.1, 0.42, -0.26), hit = _v3.set(-0.03, 0.29, WL.inner - 0.05);
    const fR = pose.feet.R;
    if (k < 0.85) fR.target.lerpVectors(restR, windP, s5(0, 0.85, k));
    else if (k < 1.9) fR.target.lerpVectors(windP, hit, thrust * thrust * thrust);
    else fR.target.lerpVectors(hit, restR, back);
    fR.pitch = k < 0.85 ? s5(0, 0.85, k) * 0.5 : k < 1.9 ? 0.5 + thrust * 0.6 : 1.1 * (1 - back);
    pose.rootOff.set(0, -0.03 * wind - 0.05 * thrust * (1 - back), -0.04 * wind + 0.13 * thrust * (1 - back));
    pose.lean = 0.52 - 0.12 * wind + 0.06 * thrust * (1 - back);
    if (!S.kicked && k >= 1.2) {
      S.kicked = true;
      const p = toWorld(_v4.set(0, 0.28, WL.outer), V());
      emit('colossal:kick', { point: p });
      ctx.shake?.(0.8, { at: p, radius: 900 });
    }
    if (k > 3.4) setMode('wall');
  }
  function modeStagger(dt, time) {
    const t = S.t;
    pose.rootOff.set(0, -0.03 * Math.sin(t * 3), -0.12 * s5(0, 1.2, t));
    S.lean = 0.52 - 0.4 * s5(0, 1.0, t) + 0.25 * s5(1.4, 2.6, t); pose.lean = S.lean;
    pose.side = Math.sin(t * 2.2) * 0.08;
    for (const s of ['L', 'R']) { limpHand(s, 1); pose.feet[s].target.set(LEG.ankle[0] * (s === 'L' ? 1 : -1), 0.085, LEG.ankle[2] - 0.08 * s5(0.3, 1.2, t)); }
    gazeUpdate(dt, time);
    pose.tilt = Math.sin(t * 1.7) * 0.4;
    if (t < 0.1 && !S.stagSnd) { S.stagSnd = true; audio('titan_roar', { position: G.headPosition, volume: 1, rate: 0.9 }); burst(0.6); }
    if (t > 2.8) { S.stagSnd = false; setMode('breach'); gaitReset(); }
  }
  function modeBreach(dt, time) {
    // barge through the gate hole into the town, smashing the wall around it
    const t = S.t;
    const zFrom = ZW, zTo = W.radius - 45;
    const k = s5(0.8, 6.2, t);
    root.position.z = zFrom + (zTo - zFrom) * k;
    root.position.y = ground(root.position.x, root.position.z);
    gait.vel.set(0, 0, (zTo - zFrom) / 5.4 * (t > 0.8 && t < 6.2 ? 1 : 0));
    gait.speed = Math.abs(gait.vel.z);
    const crouch = sstep(0.0, 1.0, t) * (1 - sstep(5.0, 6.8, t));
    pose.rootOff.set(0, -0.3 * crouch, 0.0);
    S.lean = 0.52 + 0.45 * crouch; pose.lean = S.lean; pose.twist = 0; pose.side = 0;
    gaitUpdate(dt, t > 0.6);
    // arms forward, shoving the broken wall aside
    for (const s of ['L', 'R']) {
      const sd = s === 'L' ? 1 : -1, h = pose.hands[s];
      h.w = 1; h.target.set(0.3 * sd, 1.05 + 0.2 * Math.sin(t * 2 + sd), 0.45).add(pose.rootOff);
      h.f.set(0.2 * sd, 0.4, 1); h.d.set(0, 0.3, -1); h.curl = [0.5, 0.7, 0.5, 0]; h.thumb = 0.5;
    }
    gazeUpdate(dt, time);
    S.smashT = (S.smashT || 0) - dt;
    if (S.smashT <= 0 && t > 0.8 && t < 6.2) {
      S.smashT = 0.35;
      for (const s of ['L', 'R']) {
        const p = palmW(s, V());
        const wallZ = W.radius + W.thickness * 0.5;
        if (Math.abs(p.z - wallZ) < 30) {
          const q = new THREE.Vector3(p.x, clamp(p.y, 20, W.height), wallZ);
          try { ctx.world?.damage?.(q, 14, 1); } catch {}
          fx('debris', q, 30, 22, {}); fx('dust', q, 22, {});
          audio('wall_break', { position: q, volume: 1 });
          ctx.shake?.(0.6, { at: q, radius: 300 });
        }
      }
    }
    if (t > 7.0) { setPhase(2); setMode('stride'); S.cool = 1.5; }
  }
  const avenueGoal = V();
  // the giant keeps its feet in the street: main avenue (x~0, 16 m wide) or the central plaza
  const PLZ = ctx.LAYOUT.plaza;
  const onPlaza = (z) => PLZ && Math.abs(z - PLZ.z) < PLZ.radius * 0.7;
  const streetX = (z, x) => onPlaza(z) ? clamp(x, -PLZ.radius * 0.55, PLZ.radius * 0.55) : clamp(x, -3, 3);
  function modeStride(dt, time) {
    pose.rootOff.set(0, 0, 0); pose.twist = 0; pose.side = 0;
    const pl = playerOK() ? player() : null;
    // goal: toward the soldier, but stay on/near the avenue and inside the town
    if (pl) avenueGoal.set(0, 0, clamp(pl.position.z, -220, W.radius - 40));
    else avenueGoal.set(0, 0, 60);
    avenueGoal.x = onPlaza(avenueGoal.z) ? clamp(pl ? pl.position.x : 0, -16, 16) : 0;
    const to = _v.copy(avenueGoal).sub(root.position); to.y = 0;
    const dist = to.length();
    const busy = !!S.action;
    const limp = Math.max(gait.limp.L, gait.limp.R);
    const want = busy || dist < 55 ? 0 : (6.5 - limp * 2.5);
    gait.speed += (want - gait.speed) * (1 - Math.exp(-dt * 1.2));
    if (dist > 1) to.normalize();
    gait.vel.copy(to).multiplyScalar(gait.speed);
    root.position.addScaledVector(gait.vel, dt);
    root.position.x = streetX(root.position.z, root.position.x);
    root.position.y = ground(root.position.x, root.position.z);
    // face travel / the soldier
    let yawGoal = root.rotation.y;
    const lookAt = pl ? _v2.copy(pl.position).sub(root.position) : to;
    if (lookAt.lengthSq() > 1) yawGoal = Math.atan2(lookAt.x, lookAt.z);
    let dy = Math.atan2(Math.sin(yawGoal - root.rotation.y), Math.cos(yawGoal - root.rotation.y));
    root.rotation.y += clamp(dy, -0.35 * dt, 0.35 * dt);
    S.lean += (0.12 + 0.05 * gait.speed / 6 - S.lean) * (1 - Math.exp(-dt * 2)); pose.lean = S.lean;
    gaitUpdate(dt, true);
    // turning in place needs steps too
    if (Math.abs(dy) > 0.3 && gait.speed < 0.5) { for (const s of ['L', 'R']) { const f = gait.feet[s]; if (f.planted && f.w.distanceTo(footIdeal(s, _v3)) > 0.12 * K && gait.feet[s === 'L' ? 'R' : 'L'].planted) { f.from.copy(f.w); f.to.copy(footIdeal(s, _v3)); f.t = 0; f.planted = false; } } }
    if (!S.action) swingArms();
    pose.jaw = 0;
    gazeUpdate(dt, time);
    // shins plough through houses
    S.plowT = (S.plowT || 0) - dt;
    // (buildings stay intact: it walks the avenue, no ploughing)
    if (S.fighting) {
      S.cool -= dt;
      if (!S.action && S.cool <= 0) pickPhase2();
      runAction(dt, time);
      if (WPN.ankle_L.hp <= 0 && WPN.ankle_R.hp <= 0 && !S.action) setMode('kneel');
    }
  }
  function kneelPose(k) {
    // drop onto the knees, hands braced on the ground, head bowed: nape exposed
    pose.rootOff.set(0, -0.47 * k, -0.08 * k);
    S.lean = 0.12 + 0.62 * k; pose.lean = S.lean; pose.twist = 0; pose.side = 0.04 * k;
    for (const s of ['L', 'R']) {
      const sd = s === 'L' ? 1 : -1;
      const stand = _v.set(LEG.ankle[0] * sd, 0.085, LEG.ankle[2]);
      const kneel = _v2.set(LEG.ankle[0] * sd * 1.2, 0.06, -0.36);
      pose.feet[s].target.lerpVectors(stand, kneel, k); pose.feet[s].pitch = -0.9 * k;
      const h = pose.hands[s];
      h.w = 1; h.target.set(0.2 * sd, 0.1, 0.36).lerp(_v3.set(ARM.wrist[0] * sd * 0.9, ARM.wrist[1] - 0.2, 0.1), 1 - k);
      h.f.set(0.1 * sd, -0.2, 1); h.d.set(0, 1, 0); h.curl = [0.3, 0.3, 0.2, 0.15]; h.thumb = 0.3;
    }
  }
  function faceAvenue(dt) {
    const want = (playerOK() && player().position.z > root.position.z) ? 0 : Math.PI;
    const dy = Math.atan2(Math.sin(want - root.rotation.y), Math.cos(want - root.rotation.y));
    root.rotation.y += clamp(dy, -0.8 * dt, 0.8 * dt);
    root.position.x += (streetX(root.position.z, root.position.x) - root.position.x) * (1 - Math.exp(-dt * 2));
  }
  function modeKneel(dt, time) {
    const t = S.t;
    faceAvenue(dt);
    const k = s5(0, 1.6, t);
    kneelPose(k);
    gazeUpdate(dt, time);
    pose.headPitch = 0.35 * k;
    if (!S.kneelHit && t > 1.3) {
      S.kneelHit = true;
      for (const s of ['L', 'R']) { const p = rig.bone('shin' + s).getWorldPosition(V()); p.y = ground(p.x, p.z); ctx.shake?.(1.2, { at: p, radius: 400 }); fx('dust', p, 30, {}); }
      audio('boom', { position: root.position, volume: 1 }); audio('titan_roar', { position: G.headPosition, volume: 1, rate: 0.85 });
    }
    if (t > 2.6) { setPhase(3); setMode('fury'); S.burstT = 0; S.steaming = false; S.cool = 3.5; S.kneelHit = false; }
  }
  function modeFury(dt, time) {
    kneelPose(1);
    gazeUpdate(dt, time);
    pose.headPitch = 0.3;
    // steam cycle: calm 4.5 s (nape open) / burst 3.2 s
    S.burstT += dt;
    S.steamWarn = S.steaming ? 1 - sstep(0.3, 3.2, S.burstT) : sstep(3.0, 4.5, S.burstT);
    if (!S.steaming && S.burstT > 4.5) { S.steaming = true; S.burstT = 0; startBurst(); }
    else if (S.steaming && S.burstT > 3.2) { S.steaming = false; S.burstT = 0; }
    S.hurt += ((S.steaming ? 1 : 0.35) - S.hurt) * (1 - Math.exp(-dt * 3));
    pose.hairWind = S.steaming ? 1.6 : 0.5;
    if (S.steaming) {
      pose.tilt += Math.sin(time * 9) * 0.06; pose.side += Math.sin(time * 7) * 0.02;
      S.heatT = (S.heatT || 0) - dt;
      if (S.heatT <= 0 && playerOK()) { S.heatT = 0.5; const d = player().position.distanceTo(WPN.nape.position); if (d < 26) player().hurt?.(0.06, _v.copy(player().position).sub(WPN.nape.position).normalize()); }
    }
    if (S.fighting && !S.steaming) {
      S.cool -= dt;
      if (!S.action && S.cool <= 0) pickPhase3();
    }
    runAction(dt, time);
  }
  function startBurst() {
    audio('steam', { position: WPN.nape.position, volume: 1 });
    audio('titan_roar', { position: G.headPosition, volume: 0.9, rate: 1.1 });
    ctx.shake?.(0.5, { at: WPN.nape.position, radius: 250 });
    burst(1.2);
    try { fx('steam', WPN.nape.position.clone(), 40, 3.2, { burst: true }); } catch {}
    emit('colossal:attack', { type: 'steam', point: WPN.nape.position.clone() });
  }
  function modeDying(dt, time) {
    const t = S.t;
    if (t < 2.2) faceAvenue(dt);
    const k = s5(0.3, 2.4, t);
    // topple face-first onto the town
    pose.rootOff.set(0, -0.47 - 0.3 * k, -0.08 + 0.25 * k);
    S.lean = 0.74 + 0.85 * k; pose.lean = S.lean; pose.side = 0.1 * k;
    pose.headPitch = 0.3 + 0.3 * k; pose.gazeW = Math.max(0, pose.gazeW - dt);
    pose.tilt = 0.5 * k; pose.jaw = 0.25 * k;
    for (const s of ['L', 'R']) { const h = pose.hands[s], sd = s === 'L' ? 1 : -1; h.w = 1; h.target.set(0.42 * sd, 0.05, 0.55 + 0.3 * k); h.curl = [0.2, 0.2, 0.1, 0.2]; }
    pose.hairWind = 0.3;
    if (!S.fell && t > 2.3) {
      S.fell = true;
      const p = G.headPosition.clone(); p.y = ground(p.x, p.z);
      ctx.shake?.(1.5, { at: p, radius: 600 });
      audio('boom', { position: p, volume: 1 }); audio('rubble', { position: p, volume: 1 });
      for (let i = 0; i < 5; i++) { const q = _v.copy(root.position).lerp(p, i / 4); q.y = ground(q.x, q.z); fx('dust', q.clone(), 40, {}); }
      burst(1.5);
      try { fx('steam', p, 120, 14, { burst: true }); } catch {}
    }
    S.hurt = Math.max(0, S.hurt - dt * 0.2);
    G.evap = s5(4, 13, t);
    if (t > 4 && Math.random() < dt * 5) burst(0.25);
    if (t > 13.5) { setMode('dead'); G.onDead?.(); }
  }
  function burst(k) { G.burst?.(k); }

  // ---------------- public ----------------
  function update(dt, time) {
    S.t += dt;
    // reset additive pose terms
    pose.headPitch = 0; pose.neckFwd = 0; pose.hairWind = 0.25;
    switch (S.mode) {
      case 'appear': modeAppear(dt, time); break;
      case 'wall': modeWall(dt, time); break;
      case 'kick': modeKick(dt, time); break;
      case 'stagger': modeStagger(dt, time); break;
      case 'breach': modeBreach(dt, time); break;
      case 'stride': modeStride(dt, time); break;
      case 'kneel': modeKneel(dt, time); break;
      case 'fury': modeFury(dt, time); break;
      case 'dying': modeDying(dt, time); break;
    }
    if (S.mode !== 'fury') { S.steaming = !!S.blasting; S.hurt = Math.max(0, S.hurt - dt * 0.5); }
    if (!S.action || S.action.type !== 'blast') { S.blasting = false; if (S.mode !== 'fury') S.steamWarn = 0; }
    if (S.chewT > 0) { S.chewT -= dt; if (!S.action) pose.jaw = Math.max(pose.jaw, Math.max(0, Math.sin(time * 7) * 0.2)); }
    S.stagger = Math.max(0, S.stagger - dt);
    if (S.stagger > 0) { pose.side += Math.sin(time * 14) * 0.03 * S.stagger; pose.tilt += Math.sin(time * 11) * 0.1 * S.stagger; }
  }
  function afterPose() { updateWeakPoints(); }

  function trySlash(pos, vel, radius) {
    if (!S.fighting || S.mode === 'dying' || S.mode === 'dead') return null;
    const sp = vel ? vel.length() : 0;
    const dmg = 0.34 + clamp((sp - 10) / 70, 0, 0.3);
    for (const w of weakPoints) {
      if (!w.active) continue;
      if (w.position.distanceTo(pos) > w.radius + radius + 1.2) continue;
      w.hp = Math.max(0, w.hp - (w.name === 'nape' ? dmg * 1.5 : dmg));
      S.stagger = 1; S.hurt = Math.min(1, S.hurt + 0.4);
      G.woundSteam?.(w.position, w.hp <= 0 ? 1 : 0.4);
      emit('colossal:hurt', { part: w.name, hp: w.hp });
      audio('titan_groan', { position: G.headPosition, volume: 1, rate: 1.2 });
      if (w.hp <= 0) {
        w.active = false;
        if (w.name === 'nape') { kill(); return { part: 'nape', killed: true }; }
        if (w.name.startsWith('ankle')) gait.limp[w.name.endsWith('L') ? 'L' : 'R'] = 1;
        if (w.name.startsWith('hand') && S.grabbed?.hand === w.name.slice(-1)) releaseGrab();
        if (S.action && S.action.hand === w.name.slice(-1)) endAction(1.5);
      }
      return { part: w.name, killed: false };
    }
    if (G.bodyHit?.(pos, radius)) return { part: 'body', killed: false };
    return null;
  }
  function kill() {
    S.fighting = false;
    if (S.action) S.action = null;
    setMode('dying');
    S.fell = false;
    audio('nape_kill', { position: WPN.nape.position, volume: 1, rate: 0.7 });
    burst(1.2);
    emit('colossal:killed', { colossal: sys, position: WPN.nape.position.clone() });
  }
  function releaseGrab() {
    const a = S.action;
    if (S.grabbed?.kind === 'player') {
      const s = S.grabbed.hand;
      S.grabbed = null;
      if (a && (a.type === 'grab')) { a.aborted = true; a.stage = 'return'; a.t = 0; a.from = pose.hands[s].target.clone(); }
      const w = WPN['hand_' + s];
      if (S.phase === 1 && w.hp > 0) { w.hp = Math.max(0, w.hp - 0.34); if (w.hp <= 0) w.active = false; }
      S.stagger = 1;
    }
  }
  return {
    S, weakPoints, update, afterPose, trySlash, releaseGrab, gait,
    appear() { standAtWall(); setMode('appear'); S.slammed = S.slammedL = false; pose.gazeW = 0; },
    show() { standAtWall(); setMode('wall'); S.lean = 0.52; pose.gazeW = 1; },
    kick() { if (S.mode !== 'wall' && S.mode !== 'appear') standAtWall(); setMode('kick'); S.kicked = false; },
    startFight() {
      if (S.fighting) return;
      if (S.mode === 'hidden' || S.mode === 'dead') { standAtWall(); setMode('wall'); pose.gazeW = 1; }
      S.fighting = true; S.cool = 2.5;
      for (const w of weakPoints) w.hp = 1;
      gait.limp.L = gait.limp.R = 0;
      if (S.mode === 'appear' || S.mode === 'kick') setMode('wall');
      setPhase(1);
    },
    setPhaseDebug(p) {
      S.fighting = true; S.action = null;
      if (p === 1) { standAtWall(); setMode('wall'); setPhase(1); }
      if (p === 2) { WPN.hand_L.hp = WPN.hand_R.hp = 0; root.position.set(0, 0, W.radius - 60); root.rotation.y = Math.PI; gaitReset(); setPhase(2); setMode('stride'); }
      if (p === 3) { WPN.hand_L.hp = WPN.hand_R.hp = WPN.ankle_L.hp = WPN.ankle_R.hp = 0; if (S.mode === 'wall' || S.mode === 'hidden') { root.position.set(0, 0, 200); root.rotation.y = Math.PI; } setPhase(3); setMode('fury'); S.burstT = 0; }
    },
    get hp() { let s = 0; for (const w of weakPoints) s += w.hp; return s / weakPoints.length; },
    // the Colossal doesn't eat people: eat() (kept for API compatibility) fires its steam blast instead
    eat() { if (S.mode === 'dying' || S.mode === 'dead' || S.mode === 'hidden' || S.action) return false; startAction('blast'); return true; },
    blast() { if (S.mode === 'dying' || S.mode === 'dead' || S.mode === 'hidden') return false; startAction('blast'); return true; },
    chew() {},
    lookAt(t) { S.gazeOverride = t ? (t.isVector3 ? t : null) : null; },
  };
}
