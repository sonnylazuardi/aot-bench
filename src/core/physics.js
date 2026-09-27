import * as THREE from 'three';
// Shared spatial queries. Systems register providers; consumers call the merged query.
//
// raycaster provider: (origin:Vector3, dir:Vector3 normalized, maxDist:number, opts) => Hit|null
//   Hit = { point:Vector3, normal:Vector3, distance:number,
//           kind:'ground'|'building'|'wall'|'titan'|'colossal'|'tree'|'prop',
//           ref?:any,                 // building / titan object
//           anchor?:THREE.Object3D,    // moving attachment (titan bone). Hook should follow anchor.localToWorld(local)
//           local?:THREE.Vector3 }     // hit point in anchor-local space
// collider provider: (center:Vector3, radius:number, out:Array) => void
//   push { normal:Vector3, depth:number, kind, ref } for every penetration
export function createPhysics() {
  const raycasters = [], colliders = [];
  const tmp = [];
  return {
    addRaycaster(name, fn) { raycasters.push({ name, fn }); },
    addCollider(name, fn) { colliders.push({ name, fn }); },
    raycast(origin, dir, maxDist = 1000, opts = {}) {
      let best = null;
      for (const r of raycasters) {
        if (opts.exclude && opts.exclude.includes(r.name)) continue;
        let h = null;
        try { h = r.fn(origin, dir, best ? best.distance : maxDist, opts); } catch (e) { console.error('[physics] raycaster', r.name, e); }
        if (h && h.distance <= (best ? best.distance : maxDist)) best = h;
      }
      return best;
    },
    collideSphere(center, radius, opts = {}) {
      tmp.length = 0;
      for (const c of colliders) {
        if (opts.exclude && opts.exclude.includes(c.name)) continue;
        try { c.fn(center, radius, tmp); } catch (e) { console.error('[physics] collider', c.name, e); }
      }
      return tmp;
    },
    // resolve a sphere out of all geometry, returns accumulated correction vector (mutates nothing)
    resolveSphere(center, radius, out = new THREE.Vector3(), opts) {
      out.set(0, 0, 0);
      const hits = this.collideSphere(center, radius, opts);
      for (const h of hits) out.addScaledVector(h.normal, h.depth);
      return { correction: out, hits };
    },
  };
}
