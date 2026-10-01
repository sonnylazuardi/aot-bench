// PLAYER camera (ctx.cam): third-person spring arm over the right shoulder, looking exactly along the player's aim
// (so the screen-centre crosshair == the hook ray). Critically-damped springs everywhere (spiderbench "SmoothDamp"):
// velocity lag + look-ahead, speed-driven distance and FOV (60 -> ~85), roll into swings, landing dip, fovKick,
// collision pull-in (fast in / eased out), dramatic kill-cam orbit on nape kills, grabbed / death framing.
// Uses REAL time (rawDt) so hit-stop slow motion never makes the camera stutter.
import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const damp = (a, b, r, dt) => a + (b - a) * (1 - Math.exp(-r * dt));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// critically damped spring (Game Programming Gems 4): o[k] value, o[k+'V'] velocity, st smooth time
function sd(o, k, target, st, dt) {
  const w = 2 / Math.max(1e-4, st), x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  if (!Number.isFinite(o[k])) { o[k] = target; o[k + 'V'] = 0; return target; }
  const v = o[k + 'V'] || 0, ch = o[k] - target, tmp = (v + w * ch) * dt;
  o[k + 'V'] = (v - w * tmp) * e; o[k] = target + (ch + tmp) * e; return o[k];
}
const _t = { x: 0, xV: 0 };
function sdV(cur, vel, target, st, dt) {
  for (const a of ['x', 'y', 'z']) { _t.x = cur[a]; _t.xV = vel[a]; sd(_t, 'x', target[a], st, dt); cur[a] = _t.x; vel[a] = _t.xV; }
  return cur;
}

export async function create(ctx) {
  const camera = ctx.camera;
  const UP = new THREE.Vector3(0, 1, 0);
  const c = {
    inited: false, gNear: 0, gNearV: 0, dist: 4.6, distV: 0, heightOff: 0.55, heightOffV: 0, side: 0.5, sideV: 0, fov: 60, fovV: 0, collDist: 4.6, collDistV: 0,
    roll: 0, rollV: 0, kick: 0, kickV: 0, dip: 0, dipV: 0, punch: 0, punchV: 0, slashZ: 0,
    yaw: 0, pitch: 0, overrideK: 0,
    follow: new THREE.Vector3(), followV: new THREE.Vector3(), lag: new THREE.Vector3(), lagV: new THREE.Vector3(),
    lead: new THREE.Vector3(), leadV: new THREE.Vector3(), lastC: new THREE.Vector3(), pivCap: 99,
    kc: null, deadYaw: 0, hidden: false, lift: 0, liftV: 0, push: new THREE.Vector3(),
  };
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3();
  const _pivot = new THREE.Vector3(), _pos = new THREE.Vector3(), _o = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _m = new THREE.Matrix4();
  const EXCL = { exclude: ['titans', 'colossal'] };
  const RING = [[0, 0], [0.42, 0], [-0.42, 0], [0, 0.42], [0, -0.42], [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]];
  const aimDir = (yaw, pitch, out) => out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));

  function snap() { c.inited = false; }

  const cam = {
    get yaw() { return c.yaw; }, get pitch() { return c.pitch; },
    fovKick(amount = 0.5) { c.kickV += 14 * amount; },
    impact(sev = 0.3) { c.dipV -= 4.5 * sev; c.punchV -= 25 * sev; },
    slash() { c.slashZ = 1; c.punchV -= 18; },
    killCam(point, dur = 1.05) { c.kc = { t: 0, dur, point: point.clone(), side: Math.random() < 0.5 ? 1 : -1 }; },
    snap,
    getAimRay(o, d) {
      const p = ctx.player;
      o.copy(camera.position);
      if (p && typeof p.yaw === 'number') aimDir(p.yaw, p.pitch, d); else camera.getWorldDirection(d);
      return d;
    },
    update(dt, time, rawDt) {
      const p = ctx.player;
      if (ctx.cameraOwner !== 'player' || !p || !p.center) { c.inited = false; return; }
      const rdt = Math.min(Math.max(rawDt || dt, 1e-4), 0.1);
      const C = p.center, vel = p.velocity, speed = vel.length();
      const mode = p.mode || p.state;
      const attached = p.hooks && (p.hooks[0]?.attached || p.hooks[1]?.attached);
      if (!c.inited || c.lastC.distanceToSquared(C) > 400) {
        c.follow.copy(C); c.followV.set(0, 0, 0); c.lag.set(0, 0, 0); c.lagV.set(0, 0, 0); c.lead.set(0, 0, 0); c.leadV.set(0, 0, 0);
        c.yaw = p.yaw; c.pitch = p.pitch; c.dist = c.collDist = 4.6; c.lift = 0; c.liftV = 0; c.push.set(0, 0, 0); c.distV = c.collDistV = 0; c.fov = 60; c.kc = null; c.pivCap = 99;
        c.inited = true;
      }
      c.lastC.copy(C);
      // ---- view angles: the player's aim, except grabbed / dead framing
      const grabbed = mode === 'grabbed', dead = mode === 'dead';
      if (dead) { c.deadYaw += rdt * 0.25; }
      const overrideT = grabbed || dead ? 1 : 0;
      c.overrideK = damp(c.overrideK, overrideT, 3, rdt);
      let yaw = p.yaw, pitch = p.pitch;
      if (c.overrideK > 0.001) {
        const oy = dead ? p.yaw + c.deadYaw : p.yaw, op = dead ? -0.55 : -0.15;
        yaw = p.yaw + wrap(oy - p.yaw) * c.overrideK; pitch = p.pitch + (op - p.pitch) * c.overrideK;
      } else c.deadYaw = 0;
      c.yaw = yaw; c.pitch = pitch;
      aimDir(yaw, pitch, _fwd);
      _right.set(-Math.cos(yaw), 0, Math.sin(yaw));
      // ---- follow point with velocity lag (soft-clamped) + look-ahead
      c.follow.copy(C);
      const air = mode === 'air' || mode === 'wall' || attached;
      _v.copy(vel).multiplyScalar(-(air ? 0.026 : 0.014));
      { const L = _v.length(), mx = air ? 1.25 : 0.5; if (L > 1e-4) _v.multiplyScalar(mx * Math.tanh(L / mx) / L); }
      sdV(c.lag, c.lagV, _v, 0.28, rdt);
      _v.copy(vel).addScaledVector(_fwd, -vel.dot(_fwd)); _v.y *= 0.4; _v.multiplyScalar(0.03); // lateral lead: more room ahead
      if (_v.length() > 1.1) _v.setLength(1.1);
      sdV(c.lead, c.leadV, _v, 0.5, rdt);
      // ---- distance / height / side / fov by context
      let wantDist = 4.5, wantH = 0.62, wantSide = 0.52;
      if (mode === 'ground') { wantDist = 4.3 + 0.5 * smooth(7, 11.5, speed); }
      else { wantDist = 3.3 + 0.8 * smooth(10, 45, speed); wantH = 0.42; wantSide = 1.5; } // air: tight + off to the side (3/4, subject on a third)
      if (attached) { wantDist += 0.1; wantH += 0.05; wantSide = 1.65; }
      if (p.lockTarget) { wantDist += 0.8; wantH += 0.2; }
      // selling the scale of the giant: near it the boom pulls back and drops (low angle, body fills the frame)
      const G = ctx.colossal;
      let gNear = 0;
      if (G && G.active && G.object) {
        const gp = G.object.position, dx = gp.x - C.x, dz = gp.z - C.z;
        gNear = 1 - smooth(50, 240, Math.hypot(dx, dz));
      }
      sd(c, 'gNear', gNear, 0.8, rdt);
      wantDist += 1.3 * c.gNear; wantH -= 0.3 * c.gNear;
      if (grabbed) { wantDist = 6.5; wantH = 0.9; wantSide = 0.2; }
      if (dead) { wantDist = 6.5; wantH = 1.2; wantSide = 0; }
      c.slashZ = Math.max(0, c.slashZ - rdt * 2.2);
      wantDist -= 0.7 * Math.sin(Math.min(1, c.slashZ) * Math.PI);
      sd(c, 'dist', wantDist, 0.45, rdt);
      sd(c, 'heightOff', wantH, 0.45, rdt);
      sd(c, 'side', wantSide, 0.6, rdt);
      const wantFov = 60 + 21 * smooth(9, 46, speed) + (p.boosting ? 3 : 0) + (c.gNear || 0) * (4 + 6 * smooth(10, 35, speed));
      sd(c, 'fov', wantFov, 0.45, rdt);
      c.kickV += (-c.kick * 60 - c.kickV * 12) * rdt; c.kick += c.kickV * rdt;
      c.dipV += (-c.dip * 80 - c.dipV * 12) * rdt; c.dip += c.dipV * rdt;
      c.punchV += (-c.punch * 140 - c.punchV * 16) * rdt; c.punch += c.punchV * rdt;
      // ---- roll into swings / turns: lateral acceleration in view space
      const acc = p.S?.accel;
      let wantRoll = 0;
      if (acc && air && !dead) wantRoll = clamp(-acc.dot(_right) * 0.0045, -0.13, 0.13);
      if (attached && p.hooks) { // lean toward the anchor side
        let lat = 0; for (const h of p.hooks) if (h.attached) lat += (h.side === 'L' ? 1 : -1);
        wantRoll += lat * 0.012;
      }
      sd(c, 'roll', wantRoll, 0.35, rdt);
      // ---- compose pivot
      const pivot = _pivot.copy(c.follow).add(c.lag).add(c.lead);
      pivot.y += c.heightOff + c.dip;
      pivot.addScaledVector(_right, c.side);
      // pivot never behind a wall relative to the character
      { _o.copy(C); _o.y += 0.4; _v2.copy(pivot).sub(_o); const L = _v2.length();
        if (L > 1e-3) { _v2.divideScalar(L); const h = ctx.physics.raycast(_o, _v2, L + 0.25, EXCL); const cap = h ? Math.max(0, h.distance - 0.25) : L + 0.25;
          c.pivCap = cap < c.pivCap ? cap : damp(c.pivCap, cap, 4, rdt);
          if (c.pivCap < L) pivot.copy(_o).addScaledVector(_v2, c.pivCap); } }
      // ---- spring-arm collision: sphere-cast (ring of rays, r ~0.45 m) + lift over low obstructions (parapets)
      const back = _v3.copy(_fwd).negate();
      const cast = (lift) => {
        let a = c.dist;
        for (let i = 0; i < RING.length; i++) {
          _o.copy(pivot).addScaledVector(_right, RING[i][0]); _o.y += RING[i][1] + lift;
          const h = ctx.physics.raycast(_o, back, c.dist + 0.6, EXCL);
          if (h) a = Math.min(a, Math.max(0.7, h.distance - 0.5));
        }
        return a;
      };
      let allowed = cast(c.lift);
      // obstructed low (parapet, roof ridge, crate)? see if a higher boom is clear and rise over it
      let wantLift = 0;
      if (allowed < c.dist - 0.4) { const hi = cast(c.lift + 1.1); if (hi > allowed + 0.6) { wantLift = Math.min(1.4, c.lift + 1.1); allowed = Math.max(allowed, hi); } }
      else if (c.lift > 0.05) { const lo = cast(0); if (lo < c.dist - 0.4) wantLift = c.lift; } // stay up while the low arm is still blocked (hysteresis)
      sd(c, 'lift', wantLift, wantLift > c.lift ? 0.18 : 0.6, rdt);
      // distance with hysteresis: fast in, slow out, ignore tiny flickers
      if (allowed < c.collDist - 0.03) { c.collDist = damp(c.collDist, allowed, 22, rdt); c.collDistV = 0; }
      else if (allowed > c.collDist + 0.2) sd(c, 'collDist', allowed, 0.7, rdt);
      const boom = Math.min(c.collDist + 1.6 * Math.max(0, c.kick), Math.max(c.collDist, allowed));
      _pos.copy(pivot); _pos.y += c.lift; _pos.addScaledVector(back, boom);
      // keep the lens >= 0.6 m (2x near plane) from any surface: push out, biased upward
      { const r = ctx.physics.resolveSphere(_pos, 0.6, _v2, EXCL);
        if (r && r.hits && r.hits.length) { _v2.y = Math.max(_v2.y, 0) + Math.abs(_v2.y) * 0.2; c.push.lerp(_v2, 0.35); } else c.push.multiplyScalar(Math.exp(-6 * rdt));
        _pos.add(c.push); }
      const gy = (ctx.world?.groundHeight?.(_pos.x, _pos.z) ?? 0) + 0.5;
      if (_pos.y < gy) _pos.y = gy;
      camera.position.copy(_pos);
      _e.set(pitch, yaw + Math.PI, 0, 'YXZ'); // three camera looks down -Z; yaw 0 = +Z
      camera.quaternion.setFromEuler(_e);
      camera.rotateZ(c.roll);
      // ---- kill cam: orbiting close low-angle shot of the cut, blended in / out
      if (c.kc) {
        const k = c.kc; k.t += rdt;
        const u = k.t / k.dur;
        const w = smooth(0, 0.12, u) * (1 - smooth(0.65, 1, u));
        if (u >= 1) c.kc = null;
        else {
          _v.copy(k.point).sub(C); _v.y = 0; if (_v.lengthSq() < 1e-3) _v.copy(_fwd).setY(0); _v.normalize();
          _v2.crossVectors(UP, _v).normalize().multiplyScalar(k.side);
          const orbit = 0.5 * u * k.side;
          _q2.setFromAxisAngle(UP, orbit);
          _o.copy(_v2).multiplyScalar(3.6).addScaledVector(_v, -2.2).applyQuaternion(_q2).add(C); _o.y += 0.2;
          const look = _v2.copy(C).lerp(k.point, 0.45);
          _m.lookAt(_o, look, UP); _q.setFromRotationMatrix(_m);
          camera.position.lerp(_o, w);
          camera.quaternion.slerp(_q, w);
          c.kcW = w;
        }
      } else c.kcW = 0;
      const f = c.fov + 9 * Math.max(0, c.kick) + c.punch - 10 * (c.kcW || 0);
      if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); }
      camera.updateMatrixWorld();
      // never render the lens inside the soldier
      const near = camera.position.distanceTo(C) < 0.75;
      const body = p.object?.children?.[0];
      if (body && near !== c.hidden) { c.hidden = near; body.visible = !near; }
      // speed feel hooks for the render pipeline (optional API)
      ctx.post?.setSpeed?.(smooth(14, 48, speed));
    },
  };
  return cam;
}
