// Procedural rig for the giant: a `pose` description (filled by the brain each frame, group-local model units,
// facing +Z) -> bone rotations. Two-bone IK for arms and legs, hand orientation frames, finger curls, torso lean/
// twist, neck+head gaze with an uncanny tilt, jaw, and spring-driven hair bones.
import * as THREE from 'three';
import { ARM, LEG, FINGERS } from './colossalBody.js';

const clamp = THREE.MathUtils.clamp;
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

export function createRig(root, bones, bdefs, bi) {
  const bone = (n) => bones[bi[n]];
  const bindPos = (n) => new THREE.Vector3(...bdefs[bi[n]].pos);
  const restDirs = new Map();
  const restDir = (a, b) => { const k = a + '>' + b; let v = restDirs.get(k); if (!v) { v = bindPos(b).sub(bindPos(a)).normalize(); restDirs.set(k, v); } return v; };
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qa = new THREE.Quaternion();
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
  const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
  const _e = new THREE.Euler();

  function groupQuat(b, out) {
    out.identity();
    const chain = [];
    for (let c = b; c && c.isBone; c = c.parent) chain.push(c);
    for (let i = chain.length - 1; i >= 0; i--) out.multiply(chain[i].quaternion);
    return out;
  }
  function groupPos(b, out) { b.updateWorldMatrix(true, false); out.setFromMatrixPosition(b.matrixWorld); return root.worldToLocal(out); }
  function aim(b, rd, dirG) {
    groupQuat(b.parent, _q);
    _v4.copy(rd).applyQuaternion(_q).normalize();
    _q2.setFromUnitVectors(_v4, _v3.copy(dirG).normalize());
    b.quaternion.copy(_q).invert().multiply(_q2).multiply(_q);
  }
  function setGroupQuat(b, qG) { groupQuat(b.parent, _qa); b.quaternion.copy(_qa).invert().multiply(qG); }
  const ik = { S: new THREE.Vector3(), E: new THREE.Vector3(), u: new THREE.Vector3(), v: new THREE.Vector3(), T: new THREE.Vector3() };
  function ik2(b1, b2, b3name, target, pole, l1, l2) {
    const { S, E, u, v, T } = ik;
    groupPos(b1, S);
    u.copy(target).sub(S);
    const d = clamp(u.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
    u.normalize();
    const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    v.copy(pole).sub(S); v.addScaledVector(u, -v.dot(u));
    if (v.lengthSq() < 1e-8) v.set(0, 0, 1); v.normalize();
    E.copy(S).addScaledVector(u, l1 * cosA).addScaledVector(v, l1 * sinA);
    aim(b1, restDir(b1.name, b2.name), _v.copy(E).sub(S));
    b1.updateMatrixWorld(true);
    T.copy(S).addScaledVector(u, d);
    aim(b2, restDir(b2.name, b3name), _v2.copy(T).sub(E));
    b2.updateMatrixWorld(true);
  }
  const legL1 = new THREE.Vector3(...LEG.knee).distanceTo(new THREE.Vector3(...LEG.hip));
  const legL2 = new THREE.Vector3(...LEG.ankle).distanceTo(new THREE.Vector3(...LEG.knee));
  const handBind = {};
  for (const side of [1, -1]) {
    const s = side > 0 ? 'L' : 'R';
    const F = new THREE.Vector3(ARM.dir[0] * side, ARM.dir[1], ARM.dir[2]);
    const D = new THREE.Vector3(ARM.dorsal[0] * side, ARM.dorsal[1], ARM.dorsal[2]);
    const Tn = side > 0 ? new THREE.Vector3().crossVectors(F, D) : new THREE.Vector3().crossVectors(D, F);
    handBind[s] = new THREE.Matrix4().makeBasis(F, D, Tn);
  }
  function handQuat(s, f, d, out) {
    const F = _v.copy(f).normalize();
    const D = _v2.copy(d).addScaledVector(F, -d.dot(F)).normalize();
    const Tn = s === 'L' ? _v3.crossVectors(F, D) : _v3.crossVectors(D, F);
    _m.makeBasis(F, D, Tn);
    _m2.copy(handBind[s]).transpose();
    return out.setFromRotationMatrix(_m.multiply(_m2));
  }
  function curlFingers(s, c, thumb) {
    const sign = s === 'L' ? -1 : 1;
    for (const fg of FINGERS) {
      if (fg.name === 'thumb') { for (let i = 0; i < 3; i++) bone('thumb' + i + s).quaternion.setFromAxisAngle(Z, sign * thumb * [0.25, 0.5, 0.4][i]); continue; }
      const spreadK = fg.name === 'index' ? 1 : fg.name === 'pinky' ? -1.2 : fg.name === 'ring' ? -0.5 : 0;
      for (let i = 0; i < 3; i++) {
        bone(fg.name + i + s).quaternion.setFromAxisAngle(Z, sign * c[i]);
        if (i === 0 && c[3]) bone(fg.name + i + s).quaternion.multiply(_q.setFromAxisAngle(X, spreadK * c[3] * sign * -1));
      }
    }
  }

  // ---------- pose ----------
  const mkHand = () => ({ target: new THREE.Vector3(), f: new THREE.Vector3(0, 0, 1), d: new THREE.Vector3(0, 1, 0), w: 0, curl: [0.2, 0.3, 0.2, 0], thumb: 0.3 });
  const pose = {
    rootOff: new THREE.Vector3(), lean: 0, twist: 0, side: 0,
    hands: { L: mkHand(), R: mkHand() },
    feet: { L: { target: new THREE.Vector3(...LEG.ankle), pitch: 0 }, R: { target: new THREE.Vector3(-LEG.ankle[0], LEG.ankle[1], LEG.ankle[2]), pitch: 0 } },
    gaze: null, gazeW: 0, tilt: 0, headPitch: 0, neckFwd: 0, jaw: 0, breath: 1,
    hairWind: 0.2,
  };
  // hair spring state (per hair bone: 2D angle + velocity)
  const hair = ['hairL0', 'hairR0', 'hairB0'].map((n) => ({ b: bone(n), ax: 0, az: 0, vx: 0, vz: 0 }));
  const headPrev = new THREE.Vector3(), headVel = new THREE.Vector3(), headAcc = new THREE.Vector3();
  let hairInit = false;

  function apply(dt, time) {
    for (const b of bones) b.quaternion.identity();
    const breath = Math.sin(time * 0.8) * 0.5 + 0.5;
    const r0 = bone('root');
    r0.position.set(0, 0.93, 0).add(pose.rootOff);
    r0.position.y += breath * 0.002 * pose.breath;
    _e.set(pose.lean * 0.4, pose.twist * 0.3, pose.side * 0.5, 'YXZ');
    r0.quaternion.setFromEuler(_e);
    _e.set(pose.lean * 0.3 + breath * 0.004 * pose.breath, pose.twist * 0.35, pose.side * 0.3, 'YXZ');
    bone('spine').quaternion.setFromEuler(_e);
    _e.set(pose.lean * 0.3 - breath * 0.012 * pose.breath, pose.twist * 0.35, pose.side * 0.2, 'YXZ');
    bone('chest').quaternion.setFromEuler(_e);
    root.updateMatrixWorld(true);
    // shoulder girdle takes ~30% of the arm's swing so the pec/deltoid region doesn't collapse
    groupQuat(bone('chest'), _q2);
    for (const s of ['L', 'R']) {
      const h = pose.hands[s], side = s === 'L' ? 1 : -1;
      const c = bone('clav' + s);
      if (h.w > 0.001) {
        groupPos(bone('upperArm' + s), _v);
        _v3.set(ARM.dir[0] * side, ARM.dir[1], ARM.dir[2]).applyQuaternion(_q2);
        _v2.copy(h.target).sub(_v).normalize();
        _q.setFromUnitVectors(_v3, _v2);
        _q3.copy(_q2).invert().multiply(_q).multiply(_q2);
        c.quaternion.identity().slerp(_q3, 0.14 * h.w);
      }
    }
    root.updateMatrixWorld(true);
    // legs
    for (const s of ['L', 'R']) {
      const f = pose.feet[s];
      const pole = _v.copy(f.target).add(_v2.set(s === 'L' ? 0.1 : -0.1, 0.4, 0.8));
      ik2(bone('thigh' + s), bone('shin' + s), 'foot' + s, f.target, pole, legL1, legL2);
      _q3.setFromAxisAngle(X, -f.pitch);
      _q3.premultiply(_q.setFromAxisAngle(Y, pose.twist * 0.2));
      setGroupQuat(bone('foot' + s), _q3);
    }
    // arms
    for (const s of ['L', 'R']) {
      const h = pose.hands[s];
      const side = s === 'L' ? 1 : -1;
      if (h.w > 0.001) {
        groupPos(bone('clav' + s), _v3);
        const hang = _v4.set(ARM.wrist[0] * side, ARM.wrist[1], ARM.wrist[2]).add(pose.rootOff);
        const tgt = new THREE.Vector3().copy(hang).lerp(h.target, h.w);
        const pole = _v3.add(_v2.set(side * 0.9, -0.35, -0.6));
        ik2(bone('upperArm' + s), bone('foreArm' + s), 'hand' + s, tgt, pole.clone(), ARM.upper, ARM.fore);
        handQuat(s, h.f, h.d, _q3);
        groupQuat(bone('hand' + s), _q2);
        _q2.slerp(_q3, h.w);
        setGroupQuat(bone('hand' + s), _q2);
      } else {
        bone('upperArm' + s).quaternion.setFromAxisAngle(Z, side * 0.1);
        bone('upperArm' + s).quaternion.multiply(_q.setFromAxisAngle(X, -pose.lean * 0.8));
        bone('foreArm' + s).quaternion.setFromAxisAngle(X, -0.2);
      }
      curlFingers(s, h.curl, h.thumb);
    }
    root.updateMatrixWorld(true);
    // gaze
    const hp = groupPos(bone('head'), _v3);
    let yaw = 0, pitch = 0.2;
    if (pose.gaze) {
      const gl = root.worldToLocal(_v2.copy(pose.gaze)).sub(hp);
      yaw = clamp(Math.atan2(gl.x, gl.z), -0.9, 0.9);
      pitch = clamp(Math.atan2(-gl.y, Math.hypot(gl.x, gl.z)), -0.6, 0.9);
    }
    const w = pose.gazeW;
    const wy = yaw * w, wp = pitch * w + (1 - w) * 0.25 + pose.headPitch;
    // the neck carries more of the downward look so the chin doesn't fold onto the chest
    _q3.setFromEuler(_e.set(wp * 0.55 + pose.neckFwd, wy * 0.45, pose.tilt * 0.3, 'YXZ'));
    setGroupQuat(bone('neck'), _q3.premultiply(_q2.setFromAxisAngle(X, pose.lean * 0.2)));
    _q3.setFromEuler(_e.set(Math.min(wp, 0.55) * 0.92 + pose.neckFwd * 0.6, wy, pose.tilt, 'YXZ'));
    setGroupQuat(bone('head'), _q3);
    bone('jaw').quaternion.setFromAxisAngle(X, 0.02 + pose.jaw * 0.5);
    root.updateMatrixWorld(true);
    // hair springs driven by head acceleration (in head space) + gravity + wind
    const hb = bone('head');
    hb.getWorldPosition(_v);
    if (!hairInit || dt <= 0) { headPrev.copy(_v); headVel.set(0, 0, 0); hairInit = true; }
    else {
      _v2.copy(_v).sub(headPrev).divideScalar(Math.max(dt, 1e-4));
      headAcc.copy(_v2).sub(headVel).divideScalar(Math.max(dt, 1e-4));
      headVel.copy(_v2); headPrev.copy(_v);
    }
    hb.getWorldQuaternion(_q).invert();
    const accL = _v4.copy(headAcc).applyQuaternion(_q).multiplyScalar(1 / 30);
    // effective gravity (gravity minus head acceleration) in head space: hair hangs along it
    const g = _v2.set(0, -1, 0).applyQuaternion(_q).sub(accL);
    for (let i = 0; i < hair.length; i++) {
      const hs = hair[i];
      const wind = pose.hairWind * (Math.sin(time * 1.3 + i * 2.1) * 0.6 + Math.sin(time * 2.7 + i) * 0.4);
      const gl = Math.max(0.3, Math.hypot(g.x, g.y, g.z));
      const tx = clamp(-g.z / gl * 0.85 + wind * 0.15, -0.9, 0.9);
      const tz = clamp(g.x / gl * 0.85 + wind * 0.1 * (i === 2 ? 1 : 0.5), -0.9, 0.9);
      const k = 18, c = 4.5;
      if (dt > 0) {
        hs.vx += ((tx - hs.ax) * k - hs.vx * c) * dt; hs.ax += hs.vx * dt;
        hs.vz += ((tz - hs.az) * k - hs.vz * c) * dt; hs.az += hs.vz * dt;
      }
      hs.b.quaternion.setFromEuler(_e.set(hs.ax, 0, hs.az, 'XYZ'));
    }
    root.updateMatrixWorld(true);
  }

  return { pose, apply, bone, bindPos, groupPos, groupQuat };
}
