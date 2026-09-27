// Procedural titan animation: IK walk with planted feet + heavy footfalls, lumbering upper body,
// head tracking with eerie tilt, reaching/grabbing arms, bite, stagger/kneel, collapse.
// Works in character space (template units) via Rig; the titan root moves in world space.
import * as THREE from 'three';
import { BI } from './body.js';

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

const _q = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _hips = new THREE.Vector3(), _pole = new THREE.Vector3(), _tgt = new THREE.Vector3();
const eul = (x, y, z, order = 'YXZ') => _q.setFromEuler(_e.set(x, y, z, order));

// world <-> character space for a titan
export function toChar(t, p, out) {
  out.copy(p).sub(t.object.position);
  const c = Math.cos(-t.heading), s = Math.sin(-t.heading);
  const x = out.x * c + out.z * s, z = -out.x * s + out.z * c;
  out.x = x; out.z = z;
  return out.divideScalar(t.s);
}
export function toWorld(t, p, out) {
  out.copy(p).multiplyScalar(t.s);
  const c = Math.cos(t.heading), s = Math.sin(t.heading);
  const x = out.x * c + out.z * s, z = -out.x * s + out.z * c;
  out.x = x; out.z = z;
  return out.add(t.object.position);
}

export function initAnim(t) {
  const r = t.rig;
  const s = t.s;
  const legW = r.legLen * s;
  t.gait = {
    phase: Math.random(), legW,
    feet: ['L', 'R'].map((S) => {
      const hip = r.rest[BI['foot' + S]];
      const p = toWorld(t, _v.set(hip.x, r.ankleY, hip.z), new THREE.Vector3());
      return { S, pos: p, from: p.clone(), to: p.clone(), swing: false, u0: 0, land: 0 };
    }),
  };
  t.hipsY = r.hipY;
  t.hipsVel = 0;
  t.look = { yaw: 0, pitch: 0, roll: 0, rollT: 0, tNext: 0 };
  t.blink = { t: 0, next: 2 + Math.random() * 4 };
  t.anim = {
    lean: 0, crouch: 0, jaw: 0.05, jawT: 0.05, curlL: 0.35, curlR: 0.35,
    reach: { L: 0, R: 0 }, reachT: { L: new THREE.Vector3(), R: new THREE.Vector3() },
    kneel: { L: 0, R: 0 }, limp: { L: 0, R: 0 }, lunge: 0, fall: 0, sprint: 0, flail: 0, twist: 0, seed: Math.random() * 100,
    lookAt: null, lookW: 1,
  };
}

// Advance gait; returns footfall events through t.onFootfall(pos, intensity)
export function updateGait(t, dt, ground) {
  const g = t.gait, r = t.rig, s = t.s, A = t.anim;
  const legW = g.legW;
  const speed = t.speed;
  const sprint = A.sprint;
  const swingFrac = lerp(0.42, 0.62, sprint);
  const baseCycle = 1.15 * Math.sqrt(legW / 0.9) * lerp(1, 0.55, sprint);
  const maxStride = legW * lerp(1.45, 3.2, sprint);
  let cycle = baseCycle;
  if (speed * cycle > maxStride) cycle = maxStride / Math.max(speed, 1e-3);
  // are the feet far from where they'd rest?
  const hf = t.heading;
  const fx = Math.sin(hf), fz = Math.cos(hf);
  let err = 0;
  for (const f of g.feet) {
    const hip = r.rest[BI['foot' + f.S]];
    const ix = t.object.position.x + (hip.x * Math.cos(hf) + hip.z * Math.sin(hf)) * s;
    const iz = t.object.position.z + (-hip.x * Math.sin(hf) + hip.z * Math.cos(hf)) * s;
    err = Math.max(err, Math.hypot(f.pos.x - ix, f.pos.z - iz));
  }
  const moving = (speed > legW * 0.04 || err > legW * 0.28 || g.feet[0].swing || g.feet[1].swing) && !t.pinned;
  if (moving) g.phase += dt / cycle;
  for (let i = 0; i < 2; i++) {
    const f = g.feet[i];
    const u = ((g.phase + i * 0.5) % 1 + 1) % 1;
    const inSwing = moving && u < swingFrac;
    if (inSwing && !f.swing) {
      f.swing = true; f.from.copy(f.pos); f.u0 = u;
      // landing target: where the body will be, plus half a stance ahead, at the hip's lateral offset
      const rem = (swingFrac - u) * cycle;
      const ahead = rem * speed + speed * cycle * (1 - swingFrac) * 0.5;
      const hip = r.rest[BI['foot' + f.S]];
      const lx = hip.x * s * (1.05 + 0.25 * sprint), lz = hip.z * s;
      f.to.set(t.object.position.x + fx * ahead + (lx * Math.cos(hf) + lz * Math.sin(hf)) + t.velocity.x * 0,
        0, t.object.position.z + fz * ahead + (-lx * Math.sin(hf) + lz * Math.cos(hf)));
      f.to.y = ground(f.to.x, f.to.z) + r.ankleY * s;
    }
    if (f.swing) {
      const k = clamp((u - f.u0) / Math.max(1e-3, swingFrac - f.u0), 0, 1);
      if (!inSwing || k >= 1) {
        f.swing = false; f.pos.copy(f.to); f.land = 1;
        t.onFootfall?.(f.pos, 1 + sprint * 0.5);
      } else {
        // heavy: slow lift, fast drop
        const kh = smooth(k);
        f.pos.lerpVectors(f.from, f.to, kh);
        const lift = legW * lerp(0.13, 0.3, sprint) * Math.sin(Math.PI * Math.pow(k, 0.8));
        f.pos.y += lift;
      }
    }
    f.land = Math.max(0, f.land - dt * 3);
  }
}

// Build the full pose for this frame
export function poseTitan(t, dt, time) {
  const r = t.rig, A = t.anim, g = t.gait, s = t.s, M = r.meta;
  const H = M.H;
  const sprint = A.sprint;
  const ph = g.phase * Math.PI * 2;
  const speedK = clamp(t.speed / (g.legW * 0.7), 0, 1.5);
  const fall = A.fall;

  // ---- feet in char space ----
  const fL = toChar(t, g.feet[0].pos, _v1), fR = toChar(t, g.feet[1].pos, _v2);
  // kneeling (limb cut / stagger / dying): knee goes to the ground
  // ---- hips ----
  const hipL = r.rest[BI.thighL], hipR = r.rest[BI.thighR];
  const hipOff = r.rest[0].y - hipL.y;
  const Lr = r.legLen * 0.975;
  const reachY = (f, hip) => { const dx = f.x - hip.x, dz = f.z - hip.z; return f.y + Math.sqrt(Math.max(0, Lr * Lr - dx * dx - dz * dz)); };
  let want = r.hipY * (1 - 0.06 - 0.05 * speedK - A.crouch * 0.25 - sprint * 0.08);
  const maxY = Math.min(reachY(fL, hipL), reachY(fR, hipR)) + hipOff;
  want = Math.min(want, maxY);
  // weight: spring the hips toward the target, with extra sag on footfall
  const k = 60, c = 11;
  const acc = k * (want - t.hipsY) - c * t.hipsVel;
  t.hipsVel += acc * dt; t.hipsY += t.hipsVel * dt;
  if (t.hipsY > maxY) { t.hipsY = maxY; t.hipsVel = Math.min(0, t.hipsVel); }
  const swayX = ((fL.x + fR.x) * 0.5) * 0.6 + Math.sin(ph) * H * 0.012 * (1 - sprint) * Math.min(1, speedK + 0.2);
  const hipsZ = ((fL.z + fR.z) * 0.5) * 0.35 + A.lean * H * 0.03 + A.lunge * H * 0.05;
  _hips.set(swayX, t.hipsY, hipsZ);
  // stagger/kneel lowers the body onto one knee
  const kn = Math.max(A.kneel.L, A.kneel.R);
  _hips.y -= kn * r.legLen * 0.42;
  const pelvisYaw = Math.sin(ph) * 0.09 * Math.min(1, speedK) + A.twist * 0.3;
  const pelvisRoll = Math.cos(ph) * 0.05 * Math.min(1, speedK) - (A.kneel.L - A.kneel.R) * 0.12;
  const pelvisPitch = A.lean * 0.18 + sprint * 0.25 + A.lunge * 0.2 + kn * 0.15;
  // collapse: rotate the whole body forward about the knees
  if (fall > 0) {
    const kneelY = r.rest[BI.shinL].y * 0.35;
    const fallA = fall;           // 0..1 kneel, 1..2 forward fall
    const kk = smooth(fallA);
    const fwd = clamp(fallA - 1, 0, 1);
    const ang = Math.pow(fwd, 1.8) * 1.45; // accelerating fall
    const knee = _v3.set(0, kneelY, r.rest[BI.shinL].z + H * 0.05);
    const th = r.rest[0].y - r.rest[BI.shinL].y; // thigh + hip offset
    _hips.set(lerp(_hips.x, 0, kk), lerp(_hips.y, knee.y + th * Math.cos(ang * 0.8), kk), lerp(_hips.z, knee.z + th * Math.sin(ang * 0.8) - H * 0.02, kk));
    r.hips(_hips, eul(lerp(pelvisPitch, 0.15, kk) + ang * 0.95, pelvisYaw * (1 - kk) + A.twist * kk, pelvisRoll * (1 - kk) + Math.sin(A.seed) * 0.15 * fwd));
  } else {
    r.hips(_hips, eul(pelvisPitch, pelvisYaw, pelvisRoll));
  }

  // ---- spine / chest ----
  const breath = Math.sin(time * 1.3 + A.seed) * 0.02;
  const hunch = 0.06 + A.lean * 0.25 + sprint * 0.35 + A.lunge * 0.35;
  r.local(BI.spine, eul(hunch * 0.5 + breath * 0.5, -pelvisYaw * 0.6, -pelvisRoll * 0.5));
  r.local(BI.chest, eul(hunch * 0.5 - breath, -pelvisYaw * 0.7 + A.twist * 0.4, -pelvisRoll * 0.4 + Math.sin(ph * 0.5) * 0.02 * sprint));

  // ---- head: track the target, eerie tilt ----
  const L = t.look;
  let yawT = 0, pitchT = 0.05;
  if (A.lookAt) {
    r.place(BI.neck);
    toChar(t, A.lookAt, _v3);
    _v3.sub(r.cp[BI.chest]);
    _q2.copy(r.cq[BI.chest]).invert();
    _v3.applyQuaternion(_q2);
    yawT = clamp(Math.atan2(_v3.x, _v3.z), -1.2, 1.2) * A.lookW;
    pitchT = clamp(Math.atan2(-_v3.y, Math.hypot(_v3.x, _v3.z)), -0.8, 0.9) * A.lookW + 0.05;
  }
  if (time > L.tNext) { L.rollT = (Math.random() * 2 - 1) * 0.45; L.tNext = time + 2 + Math.random() * 5; }
  L.yaw = damp(L.yaw, yawT, 2.2, dt); L.pitch = damp(L.pitch, pitchT, 2.2, dt); L.roll = damp(L.roll, L.rollT + (sprint * Math.sin(time * 9) * 0.25), 1.2, dt);
  const headBob = Math.sin(ph * 2) * 0.05 * speedK;
  r.local(BI.neck, eul(L.pitch * 0.35 - hunch * 0.35 + headBob, L.yaw * 0.4, L.roll * 0.3));
  r.local(BI.head, eul(L.pitch * 0.65 - hunch * 0.35 + (fall > 1 ? -0.4 : 0), L.yaw * 0.6, L.roll * 0.7 + (fall > 1 ? 0.9 * smooth(fall - 1) : 0)));
  A.jaw = damp(A.jaw, A.jawT, 6, dt);
  r.local(BI.jaw, eul(A.jaw, 0, 0));
  r.local(BI.eyeL, eul(clamp(L.pitch * 0.2, -0.2, 0.2), clamp(L.yaw * 0.25, -0.3, 0.3), 0));
  r.local(BI.eyeR, eul(clamp(L.pitch * 0.2, -0.2, 0.2), clamp(L.yaw * 0.25, -0.3, 0.3), 0));

  // ---- arms ----
  for (const S of ['L', 'R']) {
    const sx = S === 'L' ? 1 : -1;
    const hand = r.limbs['hand' + S];
    const reach = A.reach[S];
    const legPh = S === 'L' ? ph + Math.PI : ph;
    const swing = Math.sin(legPh) * (0.28 * Math.min(1, speedK) * (1 - sprint)) - 0.05;
    const shrug = reach * 0.25;
    r.local(BI['clav' + S], eul(-shrug * 0.3, -sx * shrug * 0.4, sx * shrug * 0.5));
    if (reach > 0.01) {
      // IK toward target; blend from the hanging pose by moving the target
      const T = toChar(t, A.reachT[S], _tgt);
      const sh = r.place(BI['upperArm' + S]);
      // rest hang target
      _v4.set(sh.x + sx * H * 0.03, sh.y - r.limbs['arm' + S].la * 0.95, sh.z + H * 0.05);
      _v4.lerp(T, smooth(reach));
      _pole.set(sx * 0.6, -1, -0.5).normalize();
      r.local(BI['upperArm' + S], _q1.identity());
      r.ik('arm' + S, _v4, _pole);
      // palm faces the target, fingers open
      r.local(BI['hand' + S], eul(0, 0, 0));
    } else if (fall > 0) {
      const fk = smooth(fall - 0.4) ;
      r.local(BI['upperArm' + S], _q1.multiplyQuaternions(eul(-0.3 - fk * 1.9 + Math.sin(A.seed + sx) * 0.3, 0, 0), _q2.setFromAxisAngle(Z, -sx * (0.62 - fk * 0.25))));
      r.local(BI['foreArm' + S], _q.setFromAxisAngle(r.limbs['arm' + S].h0, -0.35 - fk * 0.4));
      r.local(BI['hand' + S], _q.identity());
    } else {
      const limp = A.limp[S];
      const flail = sprint * A.flail;
      const fx = flail * Math.sin(time * 7.3 + sx * 1.7 + A.seed) * 1.1, fz = flail * Math.sin(time * 5.1 + sx) * 0.6;
      r.local(BI['upperArm' + S], _q1.multiplyQuaternions(eul(swing * (1 - limp) - 0.08 - A.lunge * 0.8 + fx - sprint * 0.9, 0, 0), _q2.setFromAxisAngle(Z, -sx * (0.62 - 0.1 * limp - fz * 0.5))));
      r.local(BI['foreArm' + S], _q.setFromAxisAngle(r.limbs['arm' + S].h0, -(0.25 + Math.max(0, -swing) * 0.5 + flail * 0.6 * (1 + Math.sin(time * 6 + sx))) * (1 - limp)));
      r.local(BI['hand' + S], eul(0.1, 0, 0));
    }
    const curl = S === 'L' ? A.curlL : A.curlR;
    r.local(BI['fingers' + S], _q.setFromAxisAngle(hand.curlAxis, curl));
    r.local(BI['fingers2' + S], _q.setFromAxisAngle(hand.curlAxis, curl * 1.3));
    r.local(BI['thumb' + S], _q.setFromAxisAngle(hand.curlAxis, curl * 0.5));
  }

  // ---- legs (IK to planted feet) ----
  for (const S of ['L', 'R']) {
    const f = S === 'L' ? fL : fR;
    const kneelK = fall > 0 ? smooth(fall) : A.kneel[S];
    r.place(BI['thigh' + S]);
    if (kneelK > 0.01) {
      // knee to the ground ahead, shin lying back
      const hj = r.cp[BI['thigh' + S]];
      const kneeY = r.rest[BI.shinL].y * 0.35;
      _v3.set(hj.x, kneeY, Math.max(hj.z + r.legLen * 0.05, f.z + r.legLen * 0.2));
      _v4.set(_v3.x, kneeY * 0.9, _v3.z - r.limbs['leg' + S].lb * 0.96);
      _tgt.copy(f).lerp(_v4, kneelK);
      _pole.set(0, -0.2, 1).normalize();
    } else {
      _tgt.copy(f);
      _pole.set(S === 'L' ? 0.15 : -0.15, 0, 1);
    }
    r.ik('leg' + S, _tgt, _pole);
    const foot = S === 'L' ? g.feet[0] : g.feet[1];
    let pitch = 0;
    if (foot.swing) pitch = -0.35 * Math.sin(Math.PI * clamp((g.phase % 1), 0, 1)) * 0.5;
    // keep the foot level in character space unless kneeling
    r.char(BI['foot' + S], eul(kneelK * 1.3 + pitch, 0, 0));
    r.local(BI['toes' + S], eul(-kneelK * 0.6 + (foot.swing ? 0.3 : 0), 0, 0));
  }
  r.commit();
}
