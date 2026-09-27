// Survey Corps cloak: world-space verlet cloth pinned along the shoulders (chest bone), draped over the gas tank,
// colliding with body spheres, streaming and flapping with airspeed. Allocation-free per frame.
import * as THREE from 'three';
import { BIND, BI, RIG, RIG_GLSL } from './character.js';
import { cloakTexture } from './emblem.js';

const NX = 9, NY = 11;
const LEN = 1.08;           // collar -> hem (mid-calf when standing, reads as a full cloak in flight)
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0), PC = new THREE.Vector3();

export function createCloak(scene, bones) {
  const N = NX * NY;
  const P = new Float32Array(N * 3), Q = new Float32Array(N * 3); // current / previous
  const pinLocal = [];                                             // chest-space pin offsets (top row + 2nd row partial)
  const chest = bones[BI.chest];
  // pin arc around the back of the neck, from the left shoulder (+X) to the right (-X)
  for (let i = 0; i < NX; i++) {
    const th = 1.58 - 3.16 * (i / (NX - 1));
    const x = Math.sin(th) * 0.205, z = -Math.cos(th) * 0.125 - 0.035, y = 1.455 - Math.abs(Math.sin(th)) * 0.035 + (1 - Math.abs(Math.sin(th))) * 0.02;
    pinLocal.push(new THREE.Vector3(x - BIND.chest.x, y - BIND.chest.y, z - BIND.chest.z));
  }
  // rest layout (character space, hanging): used for rest lengths + uv
  const rest = [];
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const t = j / (NY - 1), p0 = pinLocal[i].clone().add(BIND.chest);
    const flare = 1 + 0.8 * t;
    rest.push(new THREE.Vector3(p0.x * flare, p0.y - t * LEN, p0.z * (1 - 0.3 * t) - 0.08 * Math.sin(t * Math.PI) - 0.04 * t));
  }
  const restChest = new Float32Array(N * 3); // rest layout in chest-local space (draping springs)
  for (let k = 0; k < N; k++) { restChest[k * 3] = rest[k].x - BIND.chest.x; restChest[k * 3 + 1] = rest[k].y - BIND.chest.y; restChest[k * 3 + 2] = rest[k].z - BIND.chest.z; }
  const TGT = new Float32Array(N * 3);
  const cons = []; // [a, b, restLen, stiffness]
  const link = (a, b, k) => cons.push(a, b, rest[a].distanceTo(rest[b]), k);
  const id = (i, j) => j * NX + i;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    if (i < NX - 1) link(id(i, j), id(i + 1, j), 1);
    if (j < NY - 1) link(id(i, j), id(i, j + 1), 1);
    if (i < NX - 1 && j < NY - 1) { link(id(i, j), id(i + 1, j + 1), 0.6); link(id(i + 1, j), id(i, j + 1), 0.6); }
    if (j < NY - 2) link(id(i, j), id(i, j + 2), 0.35);
  }
  const C = new Float32Array(cons);
  const TOP = NX * 3; // pinned top row (flat index)
  // collision spheres: [bone, local offset, radius]
  const spheres = [
    ['chest', [0, 0.1, -0.03], 0.17], ['chest', [0, -0.02, -0.02], 0.17], ['spine', [0, 0.02, -0.02], 0.155],
    ['hips', [0, 0.04, -0.135], 0.12], ['hips', [0, -0.08, -0.05], 0.15],
    ['upperLegL', [0, -0.12, -0.01], 0.1], ['upperLegL', [0, -0.3, -0.01], 0.085], ['upperLegR', [0, -0.12, -0.01], 0.1], ['upperLegR', [0, -0.3, -0.01], 0.085],
    ['upperArmL', [0, -0.06, 0], 0.08], ['upperArmR', [0, -0.06, 0], 0.08],
    ['hips', [0.26, -0.13, -0.05], 0.11], ['hips', [-0.26, -0.13, -0.05], 0.11], ['hips', [0.26, -0.12, -0.3], 0.11], ['hips', [-0.26, -0.12, -0.3], 0.11], // blade boxes
  ].map(([b, o, r]) => ({ bone: bones[BI[b]], off: new THREE.Vector3(...o), r, c: new THREE.Vector3() }));
  const NS = spheres.length, SC = new Float32Array(NS * 4); // flat x, y, z, r (+2 cm skin)

  // ---- mesh
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), uv = new Float32Array(N * 2);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { uv[id(i, j) * 2] = i / (NX - 1); uv[id(i, j) * 2 + 1] = 1 - j / (NY - 1); }
  const idx = [];
  for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
    idx.push(a, c, b, a, d, c);
  }
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const mat = new THREE.MeshStandardMaterial({ map: cloakTexture(512), side: THREE.DoubleSide, roughness: 0.88, metalness: 0, color: 0xa8e0a4, emissive: 0x040c05 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, RIG);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + RIG_GLSL).replace('#include <map_fragment>', `#include <map_fragment>
      if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.07, 0.115, 0.075) * (0.85 + 0.3 * diffuseColor.g / 0.12);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float rim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.2);
        totalEmissiveRadiance += vec3(0.03, 0.05, 0.03) * rim + heroRig(normal, vViewPosition, diffuseColor.rgb); }`);
  };
  mat.customProgramCacheKey = () => 'aot-cloak-v5';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'SoldierCloak'; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  scene.add(mesh);

  let inited = false, hPrev = 1 / 120, time = 0;
  const m4 = new THREE.Matrix4();

  function pinWorld(i, out) { return out.copy(pinLocal[i]).applyMatrix4(chest.matrixWorld); }
  function reset(root) {
    root.updateMatrixWorld(true);
    // rest layout in world: character-space rest points through the root matrix
    for (let k = 0; k < N; k++) { _v.copy(rest[k]).applyMatrix4(root.matrixWorld); P[k * 3] = Q[k * 3] = _v.x; P[k * 3 + 1] = Q[k * 3 + 1] = _v.y; P[k * 3 + 2] = Q[k * 3 + 2] = _v.z; }
    inited = true;
  }

  function step(h, speed, flutter, fwd) {
    const r = hPrev > 0 ? h / hPrev : 1; hPrev = h;
    const drag = 0.32 + 0.004 * speed, g = -12;
    for (let k = NX; k < N; k++) { // top row pinned
      const o = k * 3;
      const x = P[o], y = P[o + 1], z = P[o + 2];
      let vx = (x - Q[o]) * r, vy = (y - Q[o + 1]) * r, vz = (z - Q[o + 2]) * r;
      const ivh = 1 / h;
      // air drag toward still air (velocity-dependent) + flutter waves travelling down the cloak
      const j = (k / NX) | 0, i = k - j * NX;
      // drape spring toward the rest shape on the back (stiff at the collar, loose at the hem)
      const ks = 70 - 48 * (j / (NY - 1));
      const ax = -vx * ivh * drag + (TGT[o] - x) * ks, ay = g - vy * ivh * drag * 0.3 + (TGT[o + 1] - y) * ks, az = -vz * ivh * drag + (TGT[o + 2] - z) * ks;
      const f = flutter * (0.35 + 0.65 * j / (NY - 1));
      const wave = Math.sin(time * 17 - j * 0.9 + i * 0.55) + 0.5 * Math.sin(time * 29.3 - j * 1.7 - i * 0.8);
      const wave2 = Math.sin(time * 11.7 - j * 0.6 + i * 1.3);
      Q[o] = x; Q[o + 1] = y; Q[o + 2] = z;
      P[o] = x + vx * 0.995 + (ax + nor[o] * wave * f + fwd.x * wave2 * f * 0.3) * h * h;
      P[o + 1] = y + vy * 0.995 + (ay + nor[o + 1] * wave * f + wave2 * f * 0.25) * h * h;
      P[o + 2] = z + vz * 0.995 + (az + nor[o + 2] * wave * f + fwd.z * wave2 * f * 0.3) * h * h;
    }
    for (let i = 0; i < NX; i++) { pinWorld(i, _v); const o = i * 3; Q[o] = P[o]; Q[o + 1] = P[o + 1]; Q[o + 2] = P[o + 2]; P[o] = _v.x; P[o + 1] = _v.y; P[o + 2] = _v.z; }
    for (let it = 0; it < 3; it++) {
      for (let c = 0; c < C.length; c += 4) {
        const a = C[c] * 3, b = C[c + 1] * 3, L = C[c + 2], k = C[c + 3];
        if (b < TOP) continue; // both ends pinned
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        let diff = (d - L) / d * k;
        if (d < L) diff *= 0.5; // compresses softly (cloth buckles instead of pushing)
        if (a < TOP) { P[b] -= dx * diff; P[b + 1] -= dy * diff; P[b + 2] -= dz * diff; continue; } // pinned end
        const h2 = diff * 0.5;
        P[a] += dx * h2; P[a + 1] += dy * h2; P[a + 2] += dz * h2;
        P[b] -= dx * h2; P[b + 1] -= dy * h2; P[b + 2] -= dz * h2;
      }
    }
    // never above the shoulders: each row stays at least 5 cm/row below the pin line along the body's up axis
    const ux = UPV.x, uy = UPV.y, uz = UPV.z, px = PC.x, py = PC.y, pz = PC.z;
    for (let o = TOP; o < N * 3; o += 3) {
      const j = (o / 3 / NX) | 0, lim = -0.05 * j;
      const hgt = (P[o] - px) * ux + (P[o + 1] - py) * uy + (P[o + 2] - pz) * uz;
      if (hgt > lim) { const m = hgt - lim; P[o] -= ux * m; P[o + 1] -= uy * m; P[o + 2] -= uz * m; }
    }
    // body collision (once per substep, flat arrays)
    for (let q = 0; q < NS; q++) {
      const cx = SC[q * 4], cy = SC[q * 4 + 1], cz = SC[q * 4 + 2], rr = SC[q * 4 + 3], r2 = rr * rr;
      for (let o = TOP; o < N * 3; o += 3) {
        const dx = P[o] - cx, dy = P[o + 1] - cy, dz = P[o + 2] - cz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r2) { const d = Math.sqrt(d2) || 1e-6, m = (rr - d) / d; P[o] += dx * m; P[o + 1] += dy * m; P[o + 2] += dz * m; }
      }
    }
  }

  function computeNormals() {
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = id(i, j);
      const l = id(Math.max(0, i - 1), j), r = id(Math.min(NX - 1, i + 1), j), u = id(i, Math.max(0, j - 1)), d = id(i, Math.min(NY - 1, j + 1));
      _v.set(P[r * 3] - P[l * 3], P[r * 3 + 1] - P[l * 3 + 1], P[r * 3 + 2] - P[l * 3 + 2]);
      _w.set(P[d * 3] - P[u * 3], P[d * 3 + 1] - P[u * 3 + 1], P[d * 3 + 2] - P[u * 3 + 2]);
      _n.crossVectors(_w, _v).normalize();
      nor[k * 3] = _n.x; nor[k * 3 + 1] = _n.y; nor[k * 3 + 2] = _n.z;
    }
  }

  return {
    mesh,
    reset,
    // dt: game dt (scaled), vel: body velocity (world), root: character root object (for reset)
    update(dt, vel, root, fwd, camPos) {
      if (!inited) reset(root);
      if (dt <= 0) return;
      if (!mesh.visible) { inited = false; return; }
      for (let q = 0; q < NS; q++) { const sp = spheres[q]; sp.c.copy(sp.off).applyMatrix4(sp.bone.matrixWorld); SC[q * 4] = sp.c.x; SC[q * 4 + 1] = sp.c.y; SC[q * 4 + 2] = sp.c.z; SC[q * 4 + 3] = sp.r + 0.02; }
      const speed = vel.length();
      // teleport / huge jump: re-seed
      pinWorld(NX >> 1, _v); const o = (NX >> 1) * 3;
      if ((_v.x - P[o]) ** 2 + (_v.y - P[o + 1]) ** 2 + (_v.z - P[o + 2]) ** 2 > 16) reset(root);
      // far from the camera: skip the sim, just carry the cloth rigidly with the body (keeps its last shape)
      if (camPos && camPos.distanceToSquared(_v) > 70 * 70) {
        let dx = _v.x - P[o], dy = _v.y - P[o + 1], dz = _v.z - P[o + 2];
        for (let k = 0; k < N * 3; k += 3) { P[k] += dx; P[k + 1] += dy; P[k + 2] += dz; Q[k] = P[k]; Q[k + 1] = P[k + 1]; Q[k + 2] = P[k + 2]; }
      } else {
        UPV.setFromMatrixColumn(chest.matrixWorld, 1).normalize(); pinWorld(NX >> 1, PC);
      { const e = chest.matrixWorld.elements; // rest shape -> world (draping targets)
        for (let k = 0; k < N * 3; k += 3) { const x = restChest[k], y = restChest[k + 1], z = restChest[k + 2];
          TGT[k] = e[0] * x + e[4] * y + e[8] * z + e[12]; TGT[k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; TGT[k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; } }
      const flutter = 6 + Math.min(speed, 55) * 2.2;
        const n = dt > 1 / 55 ? 2 : 1, h = Math.min(dt, 1 / 20) / n;
        for (let st = 0; st < n; st++) { time += h; step(h, speed, flutter, fwd); }
      }
      computeNormals();
      pos.set(P);
      geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
    },
  };
}
