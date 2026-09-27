// DEBUG ONLY (?ptest=1): a street of box houses + a tower near the player start so ODM swinging can be tested
// before / without the real world. Registers raycaster + collider 'ptest'.
import * as THREE from 'three';

export function createTestWorld(ctx) {
  const boxes = [];
  const rnd = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const add = (x, z, w, d, h, color) => boxes.push({ min: new THREE.Vector3(x - w / 2, 0, z - d / 2), max: new THREE.Vector3(x + w / 2, h, z + d / 2), color });
  for (let i = 0; i < 9; i++) {
    const z = 120 + i * 17;
    add(-44, z, 12 + rnd() * 4, 13, 9 + rnd() * 9, 0xcfc2a8);
    add(2, z + 6, 12 + rnd() * 4, 13, 10 + rnd() * 10, 0xd8ccb4);
  }
  add(-21, 300, 14, 14, 38, 0xb8ab93); // tower at the end of the street
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const geos = [];
  for (const b of boxes) {
    const s = new THREE.Vector3().subVectors(b.max, b.min), c = new THREE.Vector3().addVectors(b.max, b.min).multiplyScalar(0.5);
    const g = new THREE.BoxGeometry(s.x, s.y, s.z); g.translate(c.x, c.y, c.z);
    const col = new THREE.Color(b.color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const y = g.attributes.position.getY(i); const k = 0.75 + 0.25 * (y / b.max.y); arr[i * 3] = col.r * k; arr[i * 3 + 1] = col.g * k; arr[i * 3 + 2] = col.b * k; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    // roof
    const r = new THREE.BoxGeometry(s.x + 0.6, 0.6, s.z + 0.6); r.translate(c.x, b.max.y + 0.3, c.z);
    const rc = new Float32Array(r.attributes.position.count * 3).fill(0.35); for (let i = 0; i < rc.length; i += 3) { rc[i] = 0.5; rc[i + 1] = 0.25; rc[i + 2] = 0.2; }
    r.setAttribute('color', new THREE.BufferAttribute(rc, 3));
    geos.push(g.toNonIndexed(), r.toNonIndexed());
    b.max.y += 0.6;
  }
  let total = 0; for (const g of geos) total += g.attributes.position.count;
  const P = new Float32Array(total * 3), N = new Float32Array(total * 3), Cc = new Float32Array(total * 3); let o = 0;
  for (const g of geos) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); Cc.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
  const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'ptest';
  ctx.scene.add(mesh);
  const inv = new THREE.Vector3();
  ctx.physics.addRaycaster('ptest', (org, dir, max) => {
    let best = null, bt = max;
    inv.set(1 / dir.x, 1 / dir.y, 1 / dir.z);
    for (const b of boxes) {
      let t0 = -Infinity, t1 = Infinity, ax = -1, sg = 0;
      for (const [k, i] of [['x', 0], ['y', 1], ['z', 2]]) {
        const ta = (b.min[k] - org[k]) * inv[k], tb = (b.max[k] - org[k]) * inv[k];
        const lo = Math.min(ta, tb), hi = Math.max(ta, tb);
        if (lo > t0) { t0 = lo; ax = i; sg = ta < tb ? -1 : 1; }
        t1 = Math.min(t1, hi);
      }
      if (t0 <= t1 && t0 > 0 && t0 < bt) { bt = t0; best = { t: t0, ax, sg, b }; }
    }
    if (!best) return null;
    const n = new THREE.Vector3(); n.setComponent(best.ax, best.sg);
    return { point: org.clone().addScaledVector(dir, best.t), normal: n, distance: best.t, kind: 'building', ref: best.b };
  });
  ctx.physics.addCollider('ptest', (c, r, out) => {
    for (const b of boxes) {
      const qx = Math.max(b.min.x, Math.min(c.x, b.max.x)), qy = Math.max(b.min.y, Math.min(c.y, b.max.y)), qz = Math.max(b.min.z, Math.min(c.z, b.max.z));
      const dx = c.x - qx, dy = c.y - qy, dz = c.z - qz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); out.push({ normal: new THREE.Vector3(dx / d, dy / d, dz / d), depth: r - d, kind: 'building', ref: b }); }
      else { // centre inside: push out along the shallowest face
        const pen = [[c.x - b.min.x, -1, 0], [b.max.x - c.x, 1, 0], [c.y - b.min.y, -1, 1], [b.max.y - c.y, 1, 1], [c.z - b.min.z, -1, 2], [b.max.z - c.z, 1, 2]].sort((a, b2) => a[0] - b2[0])[0];
        const n = new THREE.Vector3(); n.setComponent(pen[2], pen[1]); out.push({ normal: n, depth: pen[0] + r, kind: 'building', ref: b });
      }
    }
  });
  return { boxes, mesh };
}
