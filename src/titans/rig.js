// Per-titan skeleton + character-space pose builder (FK + analytic two-bone IK).
// Character space = the titan root's local frame (template units, feet at y=0, facing +Z, +X = left).
// All bind rotations are identity, so a bone's bind frame is aligned with character axes.
import * as THREE from 'three';
import { BI } from './body.js';

const _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4();
const _a0 = new THREE.Vector3(), _b0 = new THREE.Vector3(), _c0 = new THREE.Vector3();
const _a1 = new THREE.Vector3(), _b1 = new THREE.Vector3(), _c1 = new THREE.Vector3();
// rotation taking frame (d0, h0) onto (d1, h1)
export function frameRot(d0, h0, d1, h1, out) {
  _a0.copy(d0).normalize(); _b0.copy(h0).addScaledVector(_a0, -h0.dot(_a0)).normalize(); _c0.crossVectors(_a0, _b0);
  _a1.copy(d1).normalize(); _b1.copy(h1).addScaledVector(_a1, -h1.dot(_a1)).normalize(); _c1.crossVectors(_a1, _b1);
  _m0.makeBasis(_a0, _b0, _c0); _m1.makeBasis(_a1, _b1, _c1);
  return out.setFromRotationMatrix(_m1.multiply(_m0.transpose()));
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _pv = new THREE.Vector3();
const _mid = new THREE.Vector3(), _end = new THREE.Vector3(), _up = new THREE.Vector3(), _lo = new THREE.Vector3(), _h1 = new THREE.Vector3();

export class Rig {
  constructor(tpl, material, depth) {
    const meta = tpl.meta;
    this.meta = meta;
    this.tpl = tpl;
    const B = meta.bones;
    this.N = B.length;
    this.parent = B.map((b) => b.parent);
    this.rest = B.map((b) => new THREE.Vector3(...b.pos));
    this.off = B.map((b, i) => (b.parent < 0 ? this.rest[i].clone() : this.rest[i].clone().sub(this.rest[b.parent])));
    this.bones = B.map((b) => { const o = new THREE.Bone(); o.name = b.name; return o; });
    for (let i = 0; i < this.N; i++) {
      this.bones[i].position.copy(this.off[i]);
      if (B[i].parent >= 0) this.bones[B[i].parent].add(this.bones[i]);
    }
    this.mesh = new THREE.SkinnedMesh(tpl.geo0, material);
    this.mesh.customDepthMaterial = depth;
    this.mesh.add(this.bones[0]);
    this.mesh.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    this.mesh.bind(this.skeleton);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    const H = meta.H;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H * 0.45, H * 0.15), H * 0.95);
    this.mesh.boundingBox = new THREE.Box3(new THREE.Vector3(-H, -H * 0.1, -H), new THREE.Vector3(H, H * 1.2, H * 1.3));
    // pose buffers (character space)
    this.cq = B.map(() => new THREE.Quaternion());
    this.cp = B.map((b, i) => this.rest[i].clone());
    // limb bind data
    const dirOf = (a, b) => this.rest[b].clone().sub(this.rest[a]).normalize();
    this.limbs = {};
    for (const S of ['L', 'R']) {
      const sx = S === 'L' ? 1 : -1;
      this.limbs['leg' + S] = {
        a: BI['thigh' + S], b: BI['shin' + S], c: BI['foot' + S],
        la: this.rest[BI['shin' + S]].distanceTo(this.rest[BI['thigh' + S]]),
        lb: this.rest[BI['foot' + S]].distanceTo(this.rest[BI['shin' + S]]),
        da: dirOf(BI['thigh' + S], BI['shin' + S]), db: dirOf(BI['shin' + S], BI['foot' + S]),
        h0: new THREE.Vector3(-1, 0, 0), // hinge: cross(down, forward)
        pole0: new THREE.Vector3(0, 0, 1),
      };
      const da = dirOf(BI['upperArm' + S], BI['foreArm' + S]);
      const db = dirOf(BI['foreArm' + S], BI['hand' + S]);
      const pole0 = new THREE.Vector3(0, 0, -1);
      this.limbs['arm' + S] = {
        a: BI['upperArm' + S], b: BI['foreArm' + S], c: BI['hand' + S],
        la: this.rest[BI['foreArm' + S]].distanceTo(this.rest[BI['upperArm' + S]]),
        lb: this.rest[BI['hand' + S]].distanceTo(this.rest[BI['foreArm' + S]]),
        da, db, h0: new THREE.Vector3().crossVectors(da, pole0).normalize(), pole0,
      };
      const hd = new THREE.Vector3(...meta.hands[S].hd), dorsal = new THREE.Vector3(...meta.hands[S].dorsal);
      const palm = dorsal.clone().negate();
      this.limbs['hand' + S] = {
        hd, dorsal, palm,
        curlAxis: new THREE.Vector3().crossVectors(hd, palm).normalize(),
        thumbAxis: new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), palm).normalize().multiplyScalar(1),
        sx,
      };
    }
    this.hipY = this.rest[0].y;
    this.legLen = this.limbs.legL.la + this.limbs.legL.lb;
    this.ankleY = this.rest[BI.footL].y;
  }

  setGeometry(g) { if (this.mesh.geometry !== g) this.mesh.geometry = g; }

  // ---- char-space posing (call in hierarchy order) ----
  hips(pos, q) { this.cp[0].copy(pos); this.cq[0].copy(q); }
  // local rotation relative to parent
  local(i, q) {
    const p = this.parent[i];
    this.cq[i].multiplyQuaternions(this.cq[p], q);
    this.cp[i].copy(this.off[i]).applyQuaternion(this.cq[p]).add(this.cp[p]);
    return this;
  }
  // absolute char-space rotation
  char(i, q) {
    const p = this.parent[i];
    this.cq[i].copy(q);
    this.cp[i].copy(this.off[i]).applyQuaternion(this.cq[p]).add(this.cp[p]);
    return this;
  }
  // position of bone i given its parent's current transform (without setting its rotation)
  place(i) { const p = this.parent[i]; return this.cp[i].copy(this.off[i]).applyQuaternion(this.cq[p]).add(this.cp[p]); }

  // Two-bone IK: target (char space) for the end joint, pole = char-space direction the middle joint bends toward.
  ik(limb, target, pole, twist = 0) {
    const L = this.limbs[limb];
    const A = this.place(L.a);
    _v.copy(target).sub(A);
    const dRaw = _v.length();
    const d = Math.min(Math.max(dRaw, Math.abs(L.la - L.lb) + 1e-3), (L.la + L.lb) * 0.999);
    const dir = _v.normalize();
    _pv.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (_pv.lengthSq() < 1e-8) _pv.copy(L.pole0);
    _pv.normalize();
    const x = (L.la * L.la - L.lb * L.lb + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L.la * L.la - x * x));
    _mid.copy(A).addScaledVector(dir, x).addScaledVector(_pv, h);
    _end.copy(A).addScaledVector(dir, d);
    _up.copy(_mid).sub(A).normalize();
    _lo.copy(_end).sub(_mid).normalize();
    // current hinge axis = cross(upper dir, pole dir) (bind: cross(da, pole0) == h0)
    _h1.crossVectors(_up, _pv).normalize();
    if (twist) _h1.applyAxisAngle(_up, twist);
    frameRot(L.da, L.h0, _up, _h1, this.cq[L.a]);
    frameRot(L.db, L.h0, _lo, _h1, this.cq[L.b]);
    this.cp[L.b].copy(this.off[L.b]).applyQuaternion(this.cq[L.a]).add(A);
    this.place(L.c);
    return dRaw / (L.la + L.lb);
  }

  // write the character-space pose into the THREE bones
  commit() {
    const bones = this.bones;
    bones[0].position.copy(this.cp[0]);
    bones[0].quaternion.copy(this.cq[0]);
    for (let i = 1; i < this.N; i++) {
      const p = this.parent[i];
      bones[i].quaternion.copy(this.cq[p]).invert().multiply(this.cq[i]);
    }
  }
}

export { _q as tmpQ, _q2 as tmpQ2, _v2 as tmpV2, _v3 as tmpV3 };
