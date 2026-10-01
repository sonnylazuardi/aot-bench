// TITANS system (ctx.titans) — procedural pure titans. See CONTRACT.md.
//   list, spawn({position, height, variant, target}), trySlash(pos, vel, radius), nearestNape(pos, maxDist), killAll()
// Bodies: SDF-sculpted, surface-nets meshed, GPU-skinned (body.js / sdf.js, built in workers by templates.js).
// Animation: procedural IK gait + upper body (anim.js). Skin: material.js.
import * as THREE from 'three';
import { buildAllTemplates } from './templates.js';
import { createSkinMaterial } from './material.js';
import { Rig } from './rig.js';
import { BI } from './body.js';
import { initAnim, updateGait, poseTitan, toChar, damp } from './anim.js';
import { createCivilians } from './civilians.js';

const CORE = ['average', 'small', 'abnormal', 'gaunt'];
const EXTRA = ['large', 'bighead', 'lanky', 'fat'];
const WALK_K = { average: 1, small: 1.15, large: 0.95, bighead: 0.8, lanky: 1.1, fat: 0.75, gaunt: 1.0, abnormal: 1.1 };
const clamp = THREE.MathUtils.clamp;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// start building/fetching the core templates as soon as the module is imported (main.js calls this before create())
let pre = null;
export function prewarm(ctx) { if (!pre) pre = buildAllTemplates(CORE); return pre; }

export async function create(ctx) {
  // Templates load in the background (IndexedDB cache hit: ~instant; otherwise worker builds) so they never block the
  // game's load. spawn() before they're ready returns a shell titan that materialises as soon as its template exists.
  const templates = {};
  const pending = [];
  const t0 = performance.now();
  const coreP = (pre || buildAllTemplates(CORE)).then((t) => {
    Object.assign(templates, t);
    console.log('[titans] templates', Math.round(performance.now() - t0), 'ms', Object.values(t).map((x) => `${x.name}:${x.tris0}/${x.tris1}`).join(' '));
    flushPending();
    return buildAllTemplates(EXTRA);
  }).then((t) => { Object.assign(templates, t); }).catch((e) => console.warn('[titans] templates failed', e));
  await Promise.race([coreP, new Promise((r) => setTimeout(r, 400))]);
  const L = ctx.LAYOUT;
  const civilians = createCivilians(ctx);
  const all = [];     // every titan in the scene (incl. dying / evaporating)
  const list = [];    // live titans (contract)
  let nextId = 1;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const ground = (x, z) => ctx.world?.groundHeight?.(x, z) ?? 0;
  const noise = { pos: new THREE.Vector3(), t: -1e9 };
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
  const _box = new THREE.Box3();

  function pickVariant(h) {
    const has = (n) => !!templates[n];
    const choose = (arr) => { const a = arr.filter(has); return a.length ? a[(Math.random() * a.length) | 0] : 'average'; };
    if (h < 5.5) return choose(['small', 'small', 'bighead']);
    if (h < 8) return choose(['average', 'bighead', 'fat', 'gaunt', 'small']);
    if (h < 11.5) return choose(['average', 'lanky', 'gaunt', 'fat', 'average']);
    return choose(['large', 'lanky', 'large', 'average']);
  }

  function flushPending() {
    for (const [shell, o] of pending.splice(0)) { if (shell.cancelled) continue; realize(shell, o); }
  }
  function spawn(o = {}) {
    const height = clamp(o.height ?? rnd(5, 12), 2.5, 18);
    const shell = { id: nextId++, pending: true, alive: true, state: 'pending', height, position: (o.position || new THREE.Vector3(L.titanEntry.x, 0, L.titanEntry.z)).clone(), velocity: new THREE.Vector3(), nape: { position: new THREE.Vector3(), radius: Math.max(0.9, height * 0.09) }, object: null };
    if (!templates.average) { pending.push([shell, o]); return shell; }
    return realize(shell, o);
  }
  function realize(shell, o) {
    const height = shell.height;
    let variant = o.variant && templates[o.variant] ? o.variant : pickVariant(height);
    if (o.variant === 'abnormal' && !templates.abnormal) variant = 'average';
    const tpl = templates[variant];
    const mat = createSkinMaterial(tpl.meta);
    // per-instance tint variation: pale peach .. ruddy
    const tint = mat.uniforms.uTint.value;
    const hsl = {}; tint.getHSL(hsl);
    tint.setHSL(hsl.h + rnd(-0.012, 0.012), clamp(hsl.s * rnd(0.8, 1.15), 0, 1), clamp(hsl.l * rnd(0.92, 1.06), 0, 1));
    const rig = new Rig(tpl, mat.material, mat.depth);
    const object = new THREE.Group();
    object.name = 'titan';
    const s = height / tpl.meta.H;
    object.scale.setScalar(s);
    const pos = shell.position.clone();
    pos.y = ground(pos.x, pos.z);
    object.position.copy(pos);
    const heading = o.yaw ?? Math.atan2(L.outerGate.x - pos.x, (pos.z > L.wall.radius ? L.outerGate.z - 40 : 0) - pos.z);
    object.rotation.y = heading;
    object.add(rig.mesh);
    ctx.scene.add(object);
    // hand anchors (palm) for grabbing the player
    const handObj = {};
    for (const S of ['L', 'R']) {
      const h = new THREE.Object3D(); h.name = 'titanHand' + S;
      h.position.set(...tpl.meta.palm[S].offset);
      rig.bones[BI['hand' + S]].add(h);
      handObj[S] = h;
    }
    const t = Object.assign(shell, {
      pending: false, variant, tpl, rig, mat, object, mesh: rig.mesh, s, heading,
      position: object.position, height, alive: true, state: 'walk', velocity: shell.velocity,
      nape: shell.nape,
      head: new THREE.Vector3(), hands: handObj,
      speed: 0, goal: o.target ? o.target.clone() : null, goalT: 0, route: pos.z > L.wall.radius - 5 ? 'enter' : 'roam',
      abnormal: variant === 'abnormal', walkK: (WALK_K[variant] || 1) * rnd(0.9, 1.1),
      atk: null, cd: rnd(1, 3), hold: null, deathT: -1, steam: [], wounds: [], regen: { L: 0, R: 0, aL: 0, aR: 0 },
      groanT: rnd(4, 14), bumpT: rnd(0, 0.3), caps: [], capsFrame: -1, blinkT: rnd(1, 5), blinkK: 0,
    });
    initAnim(t);
    t.onFootfall = (p, k) => footfall(t, p, k);
    all.push(t); list.push(t);
    if (o.bind) { t.state = 'statue'; }
    else { t.anim.lookAt = null; poseTitan(t, 1 / 60, ctx.clock.time); }
    object.updateMatrixWorld(true);
    ctx.events.emit('titan:spawned', t);
    return t;
  }

  function footfall(t, p, k) {
    const h = t.height;
    const amt = clamp(0.05 * Math.pow(h / 8, 1.4) * k, 0.02, 0.5);
    ctx.shake(amt, { at: p, radius: 30 + h * 7 });
    ctx.fx?.dust?.(_v.set(p.x, ground(p.x, p.z) + 0.2, p.z), 0.35 * h * (0.6 + 0.4 * k), { color: 0x9a8b76 });
    ctx.audio?.play?.('titan_step', { position: p, volume: clamp(0.35 + h / 16, 0.3, 1.2), rate: clamp(1.25 - h / 28, 0.6, 1.3) });
    // stomping onto a house crushes it
    if (ctx.world?.buildings?.length) {
      const bs = nearBuildings(p.x, p.z, 1);
      for (const b of bs) {
        if (b.destroyed || !b.box) continue;
        if (p.x > b.box.min.x - 0.5 && p.x < b.box.max.x + 0.5 && p.z > b.box.min.z - 0.5 && p.z < b.box.max.z + 0.5) {
          ctx.world?.damage?.(_v.set(p.x, Math.min(b.box.max.y, p.y + h * 0.1), p.z), h * 0.18, 0.6 * h / 8);
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------------ AI
  function player() { return ctx.player; }
  function playerTargetable() {
    const P = player(); if (!P || !P.position) return false;
    return P.state !== 'dead' && P.state !== 'cinematic' && ctx.mode !== 'intro';
  }

  function think(t, dt) {
    const P = player();
    const pp = P?.position;
    const H = t.height;
    const me = t.object.position;
    const A = t.anim;
    let desired = 0;
    const walk = 1.3 * Math.sqrt(t.rig.legLen * t.s) * t.walkK;
    const distP = pp ? Math.hypot(pp.x - me.x, pp.z - me.z) : 1e9;
    const canSee = playerTargetable() && distP < 150;
    A.lookAt = canSee ? pp : null;
    A.sprint = damp(A.sprint, 0, 3, dt);
    A.lean = damp(A.lean, 0, 3, dt);
    A.crouch = damp(A.crouch, 0, 3, dt);
    A.lunge = damp(A.lunge, 0, 4, dt);
    // route
    if (t.route === 'enter') {
      const breached = ctx.world?.breached !== false || !ctx.world?.breach;
      if (me.z < L.wall.radius - 25) t.route = 'roam';
      else if (breached) t.goal = _v3.set(clamp(me.x, -9, 9), 0, L.wall.radius - 40).clone();
      else t.goal = _v3.set(me.x + rnd(-5, 5), 0, L.wall.radius + 45).clone();
    }
    if (t.route === 'roam' && canSee && !t.hold && !t.atk) t.route = 'chase';
    if (t.route === 'chase' && (!canSee || distP > 170)) { t.route = 'roam'; t.goal = null; }
    if (t.route === 'roam') {
      if (noise.t > ctx.clock.time - 6 && noise.pos.distanceTo(me) < 240) t.goal = noise.pos.clone();
      t.goalT -= dt;
      if (!t.goal || t.goalT < 0 || Math.hypot(t.goal.x - me.x, t.goal.z - me.z) < 12) {
        const a = rnd(0, Math.PI * 2), r = rnd(40, 300);
        t.goal = new THREE.Vector3(Math.sin(a) * r * 0.7, 0, Math.cos(a) * r);
        t.goalT = rnd(20, 45);
      }
    }
    if (t.route === 'chase' && pp) t.goal = _v2.set(pp.x, 0, pp.z).clone();

    // attacks
    t.cd -= dt;
    if (t.atk) { runAttack(t, dt); desired = t.atk ? t.atk.move : desired; }
    else if (t.hold) { runHold(t, dt); }
    else if (canSee && t.cd <= 0) {
      const hp = _v2.copy(pp);
      const shoulderY = me.y + H * 0.8;
      const reach = H * 0.62 + 2;
      const d3 = Math.hypot(hp.x - me.x, (hp.y - shoulderY) * 0.7, hp.z - me.z);
      toChar(t, pp, _v3);
      const inFront = _v3.z > -0.2 * t.tpl.meta.H;
      if (d3 < reach && inFront && P.state !== 'grabbed') {
        const side = _v3.x >= 0 ? 'L' : 'R';
        if (t.anim.limp[side] < 0.5) startAttack(t, side, t.head.distanceTo(pp) < H * 0.28 ? 'bite' : 'grab');
      }
    }
    if (!t.atk && !t.hold && t.goal) {
      const dx = t.goal.x - me.x, dz = t.goal.z - me.z;
      const dist = Math.hypot(dx, dz);
      const stopAt = t.route === 'chase' ? H * 0.4 : 4;
      desired = dist > stopAt ? walk * (t.route === 'chase' ? 1.35 : 1) : 0;
      if (t.abnormal && t.route === 'chase' && dist > H * 1.2) { desired = walk * 3.2; A.sprint = damp(A.sprint, 1, 4, dt); A.flail = 1; }
      // turn toward goal
      const want = Math.atan2(dx, dz);
      let dh = want - t.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const turnRate = (t.abnormal ? 1.6 : 0.9) * clamp(8 / H, 0.5, 1.6);
      t.heading += clamp(dh, -turnRate * dt, turnRate * dt);
      if (Math.abs(dh) > 1.2) desired *= 0.35;
    }
    // stagger / regeneration
    for (const S of ['L', 'R']) {
      if (t.regen[S] > 0) { t.regen[S] -= dt; A.kneel[S] = damp(A.kneel[S], t.regen[S] > 1.2 ? 1 : 0, 3, dt); desired = 0; }
      else A.kneel[S] = damp(A.kneel[S], 0, 2, dt);
      const aK = 'a' + S;
      if (t.regen[aK] > 0) { t.regen[aK] -= dt; A.limp[S] = damp(A.limp[S], 1, 5, dt); }
      else A.limp[S] = damp(A.limp[S], 0, 1.5, dt);
    }
    if (t.pushT > 0) { t.pushT -= dt; desired *= 0.45; }
    t.speed = damp(t.speed, desired, desired > t.speed ? 1.2 : 2.5, dt);
    if (t.abnormal && A.sprint > 0.3) t.speed = damp(t.speed, desired, 3, dt);
  }

  function startAttack(t, side, kind) {
    t.atk = { kind, side, phase: 'windup', t: 0, move: 0, hit: false };
    t.anim.jawT = kind === 'bite' ? 0.5 : 0.25;
    ctx.audio?.play?.('titan_groan', { position: t.head, volume: 0.8, rate: 0.8 + Math.random() * 0.3 });
  }
  function runAttack(t, dt) {
    const a = t.atk, A = t.anim, H = t.height, P = player();
    const pp = P?.position;
    a.t += dt;
    const sk = clamp(Math.sqrt(H / 8), 0.7, 1.5);
    const S = a.side;
    if (a.kind === 'bite') {
      A.lunge = damp(A.lunge, a.phase === 'recover' ? 0 : 1, 6, dt);
      A.lean = damp(A.lean, 0.8, 5, dt);
      if (a.phase === 'windup' && a.t > 0.45 * sk) { a.phase = 'snap'; a.t = 0; A.jawT = 0.65; }
      else if (a.phase === 'snap' && a.t > 0.25) {
        A.jawT = 0.02; a.phase = 'recover'; a.t = 0;
        ctx.audio?.play?.('crunch', { position: t.head, volume: 1 });
        const mouth = mouthWorld(t, _v);
        if (pp && mouth.distanceTo(pp) < H * 0.16 + 1.2 && P.state !== 'dead') {
          P.hurt?.(0.55, _v2.copy(pp).sub(t.head).normalize());
          ctx.shake(0.4, { at: pp, radius: 30 });
        }
      } else if (a.phase === 'recover' && a.t > 0.8) { t.atk = null; t.cd = rnd(1.5, 3); A.jawT = 0.05; }
      return;
    }
    if (pp) {
      A.reachT[S].copy(pp);
      if (a.phase === 'windup') A.reachT[S].y += H * 0.25;
    }
    if (a.phase === 'windup') {
      A.reach[S] = damp(A.reach[S], 0.55, 4, dt);
      A.crouch = damp(A.crouch, 0.5, 4, dt); A.lean = damp(A.lean, 0.4, 3, dt);
      A['curl' + S] = damp(A['curl' + S], -0.15, 6, dt);
      A.twist = damp(A.twist, S === 'L' ? -0.25 : 0.25, 4, dt);
      if (a.t > 0.7 * sk) { a.phase = 'strike'; a.t = 0; }
    } else if (a.phase === 'strike') {
      A.reach[S] = damp(A.reach[S], 1, 12, dt);
      A.lean = damp(A.lean, 0.9, 6, dt);
      A.twist = damp(A.twist, S === 'L' ? 0.2 : -0.2, 8, dt);
      a.move = 1.2;
      const hand = t.hands[S].getWorldPosition(_v);
      if (pp && !a.hit && hand.distanceTo(pp) < H * 0.12 + 1.6 && P.state !== 'grabbed' && P.state !== 'dead' && t.anim.limp[S] < 0.5) {
        a.hit = true;
        if (P.grab) {
          P.grab(t, t.hands[S]);
          t.hold = { side: S, t: 0, from: hand.clone() };
          t.atk = null;
          A['curl' + S] = 1.2;
          ctx.audio?.play?.('grab', { position: hand, volume: 1 });
          ctx.shake(0.25, { at: hand, radius: 40 });
          return;
        }
      }
      if (a.t > 0.4 * sk) { a.phase = 'recover'; a.t = 0; A['curl' + S] = 0.9; }
    } else if (a.phase === 'recover') {
      A.reach[S] = damp(A.reach[S], 0, 3, dt);
      A['curl' + S] = damp(A['curl' + S], 0.35, 3, dt);
      A.twist = damp(A.twist, 0, 3, dt);
      a.move = 0;
      if (a.t > 0.9 * sk) { t.atk = null; t.cd = rnd(1.8, 3.5); A.jawT = 0.05; A.reach[S] = 0; }
    }
  }
  function mouthWorld(t, out) {
    const m = t.tpl.meta.mouth;
    return t.rig.bones[m.bone].localToWorld(out.set(...m.offset));
  }
  function runHold(t, dt) {
    const h = t.hold, A = t.anim, P = player(), S = h.side;
    h.t += dt;
    if (!P || P.state !== 'grabbed' || A.limp[S] > 0.5) { releaseHold(t); return; }
    const mouth = mouthWorld(t, _v);
    // lift from the grab point to just in front of the mouth
    const k = smooth(h.t / 2.6);
    const fwd = _v2.set(Math.sin(t.heading), 0, Math.cos(t.heading)).multiplyScalar(t.height * 0.1);
    A.reachT[S].copy(h.from).lerp(mouth.add(fwd), k);
    A.reach[S] = 1;
    A.crouch = damp(A.crouch, 0.1, 2, dt);
    A.lean = damp(A.lean, 0.2, 2, dt);
    A.lookAt = P.position;
    A.jawT = h.t < 1.6 ? 0.05 + k * 0.3 : 0.7;
    if (h.t > 3.0 && !h.bit) {
      h.bit = true; A.jawT = 0;
      ctx.audio?.play?.('crunch', { position: mouth, volume: 1.2 });
      ctx.fx?.blood?.(P.position.clone(), _v2.set(0, 1, 0));
      if (P.state === 'grabbed') P.kill?.();
    }
    if (h.t > 3.6) releaseHold(t);
  }
  function releaseHold(t) {
    if (!t.hold) return;
    const S = t.hold.side;
    t.hold = null;
    t.anim.reach[S] = 0.6;
    t.atk = { kind: 'grab', side: S, phase: 'recover', t: 0, move: 0, hit: true };
    t.anim.jawT = 0.05;
  }

  // shoulder through houses (grid-indexed building query shared with the civilians)
  const _near = [];
  function nearBuildings(x, z, r) {
    if (civilians.buildingsIn) return civilians.buildingsIn(x, z, r, _near);
    return ctx.world?.buildings || _near;
  }
  function bumpBuildings(t) {
    if (!ctx.world?.buildings?.length || t.speed < 0.3) return;
    const me = t.object.position, H = t.height;
    const fx = Math.sin(t.heading), fz = Math.cos(t.heading);
    const r = H * 0.2;
    const px = me.x + fx * H * 0.12, pz = me.z + fz * H * 0.12;
    const bs = nearBuildings(px, pz, r);
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (b.destroyed || !b.box) continue;
      const bx = clamp(px, b.box.min.x, b.box.max.x), bz = clamp(pz, b.box.min.z, b.box.max.z);
      const d = Math.hypot(px - bx, pz - bz);
      if (d < r) {
        const y = Math.min(b.box.max.y - 0.5, me.y + H * 0.45);
        ctx.world?.damage?.(_v.set(bx, Math.max(me.y + 1, y), bz), H * 0.22, 0.5 + H / 12);
        t.pushT = 0.6;
        if (Math.random() < 0.5) ctx.shake(0.08 * H / 8, { at: _v, radius: 60 });
      }
    }
  }

  function separate(t) {
    for (const o of all) {
      if (o === t || o.deathT >= 0) continue;
      const dx = t.object.position.x - o.object.position.x, dz = t.object.position.z - o.object.position.z;
      const min = (t.height + o.height) * 0.22;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-4) {
        const d = Math.sqrt(d2), push = (min - d) * 0.5;
        t.object.position.x += dx / d * push * 0.1; t.object.position.z += dz / d * push * 0.1;
      }
    }
  }

  // ------------------------------------------------------------------ damage / death
  function kill(t, byPlayer = false, at = null) {
    if (!t.alive) return;
    t.alive = false; t.state = 'dying'; t.deathT = 0;
    t.atk = null;
    if (t.hold) releaseHold(t); t.atk = null;
    const i = list.indexOf(t); if (i >= 0) list.splice(i, 1);
    t.speed = 0; t.pinned = true;
    t.anim.reach.L = t.anim.reach.R = 0;
    t.anim.lookAt = null; t.anim.jawT = 0.45;
    const nape = t.nape.position;
    addWound(t, at || nape, t.tpl.meta.H * 0.05);
    ctx.fx?.blood?.(nape.clone(), _v.set(Math.sin(t.heading), 0.6, Math.cos(t.heading)).negate().normalize());
    const st = ctx.fx?.steam?.(nape.clone(), t.height * 0.35, 4, { intensity: 1.5 });
    if (st) t.steam.push({ h: st, bone: BI.neck, k: 1.5 });
    ctx.audio?.play?.('titan_groan', { position: t.head, volume: 1, rate: 0.55 });
    ctx.events.emit('titan:killed', { titan: t, byPlayer });
  }
  function addWound(t, worldPos, radius) {
    // find nearest bone, convert to bind space (bind rotations are identity)
    let best = 0, bd = 1e9;
    for (let i = 0; i < t.rig.N; i++) {
      t.rig.bones[i].getWorldPosition(_v2);
      const d = _v2.distanceToSquared(worldPos);
      if (d < bd) { bd = d; best = i; }
    }
    const b = t.rig.bones[best];
    b.worldToLocal(_v2.copy(worldPos));
    _v2.add(t.rig.rest[best]);
    const W = t.mat.uniforms.uWound.value;
    const slot = t.wounds.length % 4;
    W[slot].set(_v2.x, _v2.y, _v2.z, radius);
    t.wounds.push(slot);
    return best;
  }
  function limbHit(t, side, kind, point) {
    const H = t.height;
    addWound(t, point, t.tpl.meta.H * 0.035);
    ctx.fx?.blood?.(point.clone(), _v.set(0, 1, 0));
    const st = ctx.fx?.steam?.(point.clone(), H * 0.12, 10, { intensity: 0.8 });
    if (st) t.steam.push({ h: st, pos: point.clone(), k: 0.8, until: ctx.clock.time + 10 });
    if (kind === 'leg') {
      t.regen[side] = 10; t.atk = null;
      ctx.shake(0.15 * H / 8, { at: point, radius: 60 });
      ctx.audio?.play?.('titan_groan', { position: t.head, volume: 0.9, rate: 0.7 });
    } else {
      t.regen['a' + side] = 10;
      if (t.hold && t.hold.side === side) releaseHold(t);
      if (t.atk && t.atk.side === side) t.atk = null;
      t.anim.reach[side] = 0;
    }
  }

  function updateDeath(t, dt) {
    t.deathT += dt;
    const d = t.deathT, A = t.anim, H = t.height, u = t.mat.uniforms;
    // 0..0.9 knees buckle, 0.9 knees hit, 0.9..2.2 fall forward, 2.2 slam
    const prev = A.fall;
    if (d < 0.95) A.fall = smooth(d / 0.95) * 1.0;
    else A.fall = 1 + clamp((d - 0.95) / 1.25, 0, 1);
    if (prev < 1 && A.fall >= 1) {
      for (const f of t.gait.feet) ctx.fx?.dust?.(f.pos.clone(), H * 0.4, {});
      ctx.shake(clamp(0.12 * H / 8, 0.05, 0.4), { at: t.object.position, radius: 60 + H * 6 });
      ctx.audio?.play?.('titan_step', { position: t.object.position, volume: 1, rate: 0.7 });
    }
    if (prev < 2 && A.fall >= 2) {
      // face-down slam
      const fwd = _v.set(Math.sin(t.heading), 0, Math.cos(t.heading));
      for (let i = 0; i < 4; i++) {
        const p = t.object.position.clone().addScaledVector(fwd, H * (0.2 + i * 0.22));
        p.y = ground(p.x, p.z) + 0.3;
        ctx.fx?.dust?.(p, H * 0.7, {});
      }
      const c = t.object.position.clone().addScaledVector(fwd, H * 0.5);
      ctx.shake(clamp(0.25 * H / 8, 0.1, 0.9), { at: c, radius: 80 + H * 8 });
      ctx.audio?.play?.('boom', { position: c, volume: clamp(H / 10, 0.4, 1.3), rate: 0.8 });
      ctx.audio?.play?.('rubble', { position: c, volume: 0.8 });
      ctx.world?.damage?.(c.setY(ground(c.x, c.z) + H * 0.1), H * 0.35, 1 + H / 8);
      // evaporation steam along the corpse
      for (const [bn, k] of [['chest', 1.3], ['hips', 1], ['head', 0.9], ['thighL', 0.7], ['thighR', 0.7], ['upperArmL', 0.6], ['upperArmR', 0.6]]) {
        const bp = t.rig.bones[BI[bn]].getWorldPosition(new THREE.Vector3());
        const st = ctx.fx?.steam?.(bp, H * 0.3 * k, 18, { intensity: k });
        if (st) t.steam.push({ h: st, bone: BI[bn], k });
      }
      ctx.audio?.play?.('steam', { position: c, volume: 0.9 });
    }
    // evaporate: darken, redden, shrink toward the husk
    const e = clamp((d - 2.0) / 16, 0, 1);
    u.uEvap.value = smooth(e * 1.3);
    u.uShrink.value = smooth(clamp((d - 3) / 14, 0, 1)) * 0.92;
    u.uHeat.value = d < 2 ? 0 : 0.35 * (1 - e);
    for (const s of t.steam) s.h.setIntensity?.(s.k * (d < 2.2 ? 1 : 1 - smooth((d - 14) / 5)));
    if (d > 19.5) removeTitan(t);
  }
  function removeTitan(t) {
    for (const s of t.steam) s.h.stop?.();
    t.steam.length = 0;
    ctx.scene.remove(t.object);
    t.mat.material.dispose(); t.mat.depth.dispose();
    t.rig.skeleton.dispose?.();
    const i = all.indexOf(t); if (i >= 0) all.splice(i, 1);
    const j = list.indexOf(t); if (j >= 0) list.splice(j, 1);
    t.state = 'gone';
  }

  // ------------------------------------------------------------------ capsules / queries
  function updateCaps(t) {
    if (t.capsFrame === ctx.clock.frame) return t.caps;
    t.capsFrame = ctx.clock.frame;
    const defs = t.tpl.meta.capsules;
    if (!t.caps.length) for (const c of defs) t.caps.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0, bone: t.rig.bones[c.bone], def: c });
    for (const c of t.caps) {
      c.a.set(...c.def.a).applyMatrix4(c.bone.matrixWorld);
      c.b.set(...c.def.b).applyMatrix4(c.bone.matrixWorld);
      c.r = c.def.r * t.s;
    }
    return t.caps;
  }
  const _ba = new THREE.Vector3(), _oa = new THREE.Vector3();
  function capIntersect(ro, rd, pa, pb, r) {
    _ba.subVectors(pb, pa); _oa.subVectors(ro, pa);
    const baba = _ba.dot(_ba), bard = _ba.dot(rd), baoa = _ba.dot(_oa), rdoa = rd.dot(_oa), oaoa = _oa.dot(_oa);
    const a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - r * r * baba;
    let h = b * b - a * c;
    if (h >= 0 && a > 1e-9) {
      const t = (-b - Math.sqrt(h)) / a;
      const y = baoa + t * bard;
      if (y > 0 && y < baba) return t;
      _oa.subVectors(ro, y <= 0 ? pa : pb);
      const bb = rd.dot(_oa), cc = _oa.dot(_oa) - r * r;
      h = bb * bb - cc;
      if (h > 0) return -bb - Math.sqrt(h);
    }
    return -1;
  }
  const segDist = (p, a, b, out) => {
    _ba.subVectors(b, a);
    const t = clamp(_oa.subVectors(p, a).dot(_ba) / Math.max(1e-9, _ba.lengthSq()), 0, 1);
    out.copy(a).addScaledVector(_ba, t);
    return p.distanceTo(out);
  };

  ctx.physics.addRaycaster('titans', (o, dir, maxDist) => {
    let best = null, bt = maxDist;
    for (const t of all) {
      // bounding sphere
      _v.copy(t.object.position); _v.y += t.height * 0.5;
      const oc = _v2.subVectors(o, _v);
      const bb = oc.dot(dir), cc = oc.lengthSq() - (t.height * 0.9) ** 2;
      if (cc > 0 && bb > 0) continue;
      if (bb * bb - cc < 0) continue;
      for (const c of updateCaps(t)) {
        const d = capIntersect(o, dir, c.a, c.b, c.r);
        if (d > 0 && d < bt) { bt = d; best = { t, c }; }
      }
    }
    if (!best) return null;
    const point = o.clone().addScaledVector(dir, bt);
    const cp = new THREE.Vector3();
    segDist(point, best.c.a, best.c.b, cp);
    const normal = point.clone().sub(cp).normalize();
    return { point, normal, distance: bt, kind: 'titan', ref: best.t, anchor: best.c.bone, local: best.c.bone.worldToLocal(point.clone()) };
  });

  function trySlash(pos, vel, radius = 1) {
    const speed = vel ? vel.length() : 0;
    let res = null;
    for (const t of list) {
      if (!t.alive) continue;
      _v.copy(t.object.position); _v.y += t.height * 0.5;
      if (_v.distanceTo(pos) > t.height + radius + 2) continue;
      if (t.nape.position.distanceTo(pos) < t.nape.radius + radius) {
        if (speed > 12) { kill(t, true, pos); return { titan: t, part: 'nape', killed: true }; }
        res = res || { titan: t, part: 'nape', killed: false };
        continue;
      }
      for (const c of updateCaps(t)) {
        const n = c.bone.name;
        const isLeg = n === 'shinL' || n === 'shinR' || n === 'footL' || n === 'footR';
        const isArm = /^(foreArm|upperArm|hand)[LR]$/.test(n);
        if (!isLeg && !isArm) continue;
        const d = segDist(pos, c.a, c.b, _v3);
        if (d < c.r + radius) {
          const side = n.endsWith('L') ? 'L' : 'R';
          if (speed > 8) limbHit(t, side, isLeg ? 'leg' : 'arm', pos);
          return { titan: t, part: 'limb', killed: false };
        }
      }
    }
    return res;
  }
  function nearestNape(pos, maxDist = Infinity) {
    let best = null, bd = maxDist;
    for (const t of list) {
      if (!t.alive) continue;
      const d = t.nape.position.distanceTo(pos);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  function killAll() { for (const [sh] of pending) { sh.cancelled = true; sh.alive = false; } pending.length = 0; for (const t of list.slice()) kill(t, false); }

  // noise attracts titans
  const hear = () => { if (ctx.player?.position) { noise.pos.copy(ctx.player.position); noise.t = ctx.clock.time; } };
  ctx.events.on('player:slash', hear);
  ctx.events.on('hook:fire', hear);

  // ------------------------------------------------------------------ frame
  const camPos = new THREE.Vector3();
  function update(dt, time) {
    if (dt <= 0) return;
    try { civilians.update(dt, time); } catch (e) { if (!update.cerr) { update.cerr = 1; console.error('[titans] civilians', e); } }
    ctx.camera.getWorldPosition(camPos);
    for (const t of all.slice()) {
      if (t.state === 'statue') continue;
      if (t.alive) {
        think(t, dt);
        // move
        const fx = Math.sin(t.heading), fz = Math.cos(t.heading);
        t.velocity.set(fx * t.speed, 0, fz * t.speed);
        t.object.position.x += t.velocity.x * dt; t.object.position.z += t.velocity.z * dt;
        separate(t);
        t.object.position.y = damp(t.object.position.y, ground(t.object.position.x, t.object.position.z), 8, dt);
        t.object.rotation.y = t.heading;
        t.bumpT -= dt;
        if (t.bumpT <= 0) { t.bumpT = 0.3; bumpBuildings(t); }
        t.state = t.hold ? 'hold' : t.atk ? 'attack' : (t.regen.L > 0 || t.regen.R > 0) ? 'stagger' : t.route;
        t.groanT -= dt;
        if (t.groanT < 0) { t.groanT = rnd(8, 22); ctx.audio?.play?.('titan_groan', { position: t.head, volume: 0.6 + Math.random() * 0.4, rate: clamp(1.3 - t.height / 25, 0.6, 1.4) * (0.85 + Math.random() * 0.3) }); }
      } else if (t.deathT >= 0) {
        t.velocity.set(0, 0, 0);
        updateDeath(t, dt);
        if (t.state === 'gone') continue;
      }
      updateGait(t, dt, ground);
      poseTitan(t, dt, time);
      t.object.updateMatrixWorld(true);
      // derived positions
      const m = t.tpl.meta;
      t.rig.bones[m.nape.bone].localToWorld(t.nape.position.set(...m.nape.offset));
      t.rig.bones[BI.head].getWorldPosition(t.head);
      // blink (slow, eerie)
      t.blinkT -= dt;
      if (t.blinkT < 0) { t.blinkK = 1; t.blinkT = rnd(3, 8); }
      t.blinkK = Math.max(0, t.blinkK - dt * 1.6);
      t.mat.uniforms.uBlink.value = t.alive ? Math.sin(Math.PI * t.blinkK) : 0.85;
      // follow steam to bones
      for (const s of t.steam) if (s.bone != null && s.h.position) t.rig.bones[s.bone].getWorldPosition(s.h.position);
      // LOD
      const dist = camPos.distanceTo(t.object.position);
      t.rig.setGeometry(dist > 38 + t.height * 5 ? t.tpl.geo1 : t.tpl.geo0);
      t.mat.uniforms.uDetail.value = dist < 120 ? 1 : 0;
    }
  }

  return {
    list, all, templates, civilians, get ready() { return !!templates.average; },
    spawn, trySlash, nearestNape, killAll, kill: (t) => kill(t, false),
    update,
    // debug helpers
    _debug: { poseTitan, limbHit, addWound },
  };
}
