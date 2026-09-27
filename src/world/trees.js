// WORLD trees: instanced lindens / oaks / poplars in the town and along hedgerows, forest clumps and far woodland on
// the hills (three LOD families by distance from the town, sectored for frustum culling). Foliage shader: leafy clump
// relief + colour breakup from world-space noise, gentle wind sway.
import * as THREE from 'three';
import { GB } from './geom.js';
import { Rng, lin, fbm, smooth } from './util.js';
import { terrainHeight } from './ground.js';
import { makeProcMaterial } from './shaders.js';

const FOLIAGE_GLSL = /* glsl */`
Surf surf() {
  float id = floor(vMat.x + 0.5);
  vec3 tint = vTint;
  if (id < 0.5) {
    vec3 p = vWPos * 0.9;
    float n1 = nF(p.xz * 0.35 + p.y * 0.21), n2 = nH(p.xy * 0.13 + p.z * 0.07), n3 = nM(p.zy * 0.05 + p.x * 0.03);
    float clump = smoothstep(0.25, 0.8, n1 * 0.6 + n2 * 0.4);
    vec3 c = tint * (0.55 + 0.75 * clump) * (0.85 + 0.3 * n3);
    c = mix(c, c * vec3(1.2, 1.1, 0.6), smoothstep(0.7, 0.95, n2) * 0.5);
    // darker towards the bottom / inside of the crown
    c *= mix(0.55, 1.0, smoothstep(-0.6, 0.6, vWN.y));
    Surf s = surfInit(c, 0.85);
    s.h = n2 * 0.35;
    s.ao = mix(0.6, 1.0, clump);
    return s;
  }
  float g = nF(vec2(atan(vWN.z, vWN.x) * 3.0, vWPos.y * 0.6));
  Surf s = surfInit(tint * (0.6 + 0.6 * g), 0.9);
  s.h = g * 0.03;
  return s;
}
`;

function blob(gb, cx, cy, cz, rx, ry, rz, detail, rng, col) {
  // indexed, jittered icosphere (shared vertices -> 5x fewer vertex shader runs than the soup)
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const key = (x, y, z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const map = new Map();
  gb.set({ mat: 0, col });
  const idx = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = key(x, y, z);
    let vi = map.get(k);
    if (vi === undefined) {
      const j = 1 + rng.range(-0.18, 0.18);
      const X = cx + x * rx * j, Y = cy + y * ry * j, Z = cz + z * rz * j;
      let nx = x / rx, ny = y / ry, nz = z / rz; const l = Math.hypot(nx, ny, nz) || 1;
      vi = gb.vtx(X, Y, Z, nx / l, ny / l, nz / l, X + Z, Y);
      map.set(k, vi);
    }
    idx.push(vi);
  }
  for (let i = 0; i < idx.length; i += 3) gb.tri(idx[i], idx[i + 1], idx[i + 2]);
  g.dispose();
}
function trunk(gb, h, r0, r1, seg, col) {
  gb.set({ mat: 1, col });
  gb.cyl(0, 0, -0.3, h, r0, r1, seg, false);
}

// geometry variants (unit ~ real metres, scaled per instance)
function* makeVariantsGen() {
  const rng = new Rng(8080);
  const V = {};
  const leafA = lin(0x3f5a26), leafB = lin(0x4d6a2c), leafC = lin(0x5c6e30), bark = lin(0x3d3226), con = lin(0x2c4428);
  // detailed linden / oak
  yield;
  V.oak = (() => {
    const gb = new GB(4000);
    trunk(gb, 5.5, 0.38, 0.26, 7, bark);
    // two main limbs
    gb.set({ mat: 1, col: bark });
    blob(gb, 0, 8.6, 0, 4.2, 3.4, 4.0, 1, rng, leafA);
    blob(gb, 2.2, 7.4, 1.0, 2.9, 2.4, 2.8, 1, rng, leafB);
    blob(gb, -2.3, 7.8, -0.8, 3.0, 2.6, 3.0, 1, rng, leafA);
    blob(gb, 0.6, 10.6, -1.2, 2.6, 2.2, 2.6, 1, rng, leafC);
    blob(gb, -0.8, 6.4, 2.1, 2.4, 1.8, 2.2, 1, rng, leafB);
    return gb.build();
  })();
  yield;
  V.poplar = (() => {
    const gb = new GB(3000);
    trunk(gb, 4, 0.3, 0.22, 6, bark);
    blob(gb, 0, 9.5, 0, 2.1, 6.8, 2.1, 1, rng, leafB);
    blob(gb, 0.4, 14.5, 0.2, 1.4, 3.2, 1.4, 1, rng, leafC);
    return gb.build();
  })();
  yield;
  V.fir = (() => {
    const gb = new GB(2000);
    trunk(gb, 3, 0.28, 0.12, 6, bark);
    gb.set({ mat: 0, col: con });
    const tiers = [[1.6, 4.2, 5.5], [4.2, 3.4, 5], [6.8, 2.6, 4.5], [9.2, 1.7, 4]];
    for (const [y, r, h] of tiers) gb.cyl(0, 0, y, y + h, r, 0.05, 8, true);
    return gb.build();
  })();
  yield;
  V.oakMid = (() => {
    const gb = new GB(600);
    trunk(gb, 5, 0.38, 0.28, 5, bark);
    blob(gb, 0, 8.6, 0, 4.4, 3.6, 4.2, 0, rng, leafA);
    blob(gb, 1.4, 7.2, 1.2, 3.2, 2.6, 3.0, 0, rng, leafB);
    return gb.build();
  })();
  yield;
  V.firMid = (() => {
    const gb = new GB(300);
    trunk(gb, 2, 0.28, 0.12, 4, bark);
    gb.set({ mat: 0, col: con });
    gb.cyl(0, 0, 1.4, 12.5, 4.2, 0.05, 6, true);
    return gb.build();
  })();
  yield;
  V.far = (() => {
    const gb = new GB(100);
    blob(gb, 0, 7.5, 0, 4.2, 5.0, 4.2, 0, rng, leafA);
    return gb.build();
  })();
  yield;
  V.bush = (() => {
    const gb = new GB(600);
    blob(gb, 0, 1.2, 0, 2.2, 1.6, 2.0, 0, rng, leafB);
    blob(gb, 1.6, 1.0, 0.4, 1.6, 1.3, 1.5, 0, rng, leafA);
    return gb.build();
  })();
  return V;
}

export function makeFoliageMaterial(shared) { return makeProcMaterial('foliage', shared, FOLIAGE_GLSL); }

// time-sliced: yields between phases; the group is added to the scene at the start and fills in
export function* buildTreesGen(ctx, shared, mat, plan, land, solids, out) {
  const V = yield* makeVariantsGen();
  const rng = new Rng(4040);
  const group = new THREE.Group(); group.name = 'trees';
  const sets = new Map(); // key -> [{x,y,z,s,ry,sy}]
  const put = (key, x, z, s, extra = {}) => {
    if (!sets.has(key)) sets.set(key, []);
    const y = Math.hypot(x, z) < 400 ? 0 : terrainHeight(x, z);
    sets.get(key).push({ x, y, z, s, ry: rng.range(0, Math.PI * 2), sy: rng.range(0.85, 1.15), ...extra });
  };
  // town trees (detailed)
  for (const [x, z, s] of plan.trees) {
    put(rng.chance(0.85) ? 'oak' : 'poplar', x, z, s * 0.85);
    solids.addBox(x, 4, z, 0.45, 4, 0.45, 0, 'tree', null);
    solids.addBox(x, 8.6 * s * 0.85, z, 3.4 * s * 0.85, 2.6 * s * 0.85, 3.4 * s * 0.85, 0, 'tree', null);
  }
  // hedgerow trees + bushes
  yield;
  for (const h of land.hedges) {
    yield;
    for (let i = 1; i < h.length; i++) {
      const [ax, az] = h[i - 1], [bx, bz] = h[i];
      const L = Math.hypot(bx - ax, bz - az);
      for (let d = rng.range(0, 8); d < L; d += rng.range(9, 18)) {
        const t = d / L, x = ax + (bx - ax) * t + rng.range(-1.2, 1.2), z = az + (bz - az) * t + rng.range(-1.2, 1.2);
        const r = Math.hypot(x, z);
        if (r < 425) continue;
        if (rng.chance(0.35)) put(r < 520 ? 'oak' : 'oakMid', x, z, rng.range(0.6, 1.05));
        else put(r < 1100 ? 'bush' : 'far', x, z, r < 1100 ? rng.range(0.8, 1.5) : rng.range(0.4, 0.6));
      }
    }
  }
  // poplar rows along the south road (dramatic avenue out of the gate)
  for (let r = 470; r < 1700; r += 13) for (const s of [-1, 1]) { const a = Math.PI / 2 + s * 9 / r; put(r < 900 ? 'poplar' : 'far', Math.cos(a) * r, Math.sin(a) * r, rng.range(0.85, 1.1)); }
  // forest clumps from the landuse map
  let nfo = 0;
  for (const [fx, fz] of land.forest) {
    if (++nfo % 300 === 0) yield;
    const n = rng.int(2, 5);
    for (let i = 0; i < n; i++) {
      const x = fx + rng.range(-9, 9), z = fz + rng.range(-9, 9);
      const r = Math.hypot(x, z);
      const conifer = fbm(x / 500, z / 500, 2, 3) > 0.5;
      put(r < 800 ? (conifer ? 'fir' : 'oakMid') : (conifer ? 'firMid' : r < 1300 ? 'oakMid' : 'far'), x, z, rng.range(0.75, 1.3));
    }
  }
  // far woodland on the hills (beyond the painted map)
  yield;
  for (let k = 0; k < 16000; k++) {
    if (k % 1500 === 1499) yield;
    const a = rng.range(0, Math.PI * 2), r = 1750 + Math.pow(rng.next(), 0.8) * 3600;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const f = fbm(x / 700, z / 700, 3, 91);
    if (f < 0.52) continue;
    put(f > 0.62 && r < 2600 ? 'firMid' : 'far', x, z, rng.range(1.2, 2.0));
  }
  // build instanced meshes, split in 8 sectors
  ctx.scene.add(group);
  out.group = group;
  yield;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  let draws = 0, total = 0;
  for (const [key, list] of sets) {
    const bySector = new Map();
    for (const it of list) {
      const s = Math.floor(((Math.atan2(it.z, it.x) + Math.PI) / (Math.PI * 2)) * 8) % 8;
      const band = Math.hypot(it.x, it.z) < 420 ? 't' : 'o';
      const k = s + band;
      if (!bySector.has(k)) bySector.set(k, []);
      bySector.get(k).push(it);
    }
    for (const [k, arr] of bySector) {
      const im = new THREE.InstancedMesh(V[key], mat, arr.length);
      arr.forEach((it, i) => {
        q.setFromAxisAngle(Y, it.ry);
        sc.set(it.s, it.s * it.sy, it.s);
        p.set(it.x, it.y - 0.1, it.z);
        m4.compose(p, q, sc);
        im.setMatrixAt(i, m4);
      });
      im.computeBoundingSphere();
      const near = key === 'oak' || key === 'poplar' || key === 'fir' || key === 'bush';
      im.castShadow = near; im.receiveShadow = near;
      im.name = 'trees ' + key + ' ' + k;
      group.add(im);
      draws++; total += arr.length;
      yield;
    }
  }
  console.log(`[world] trees ${total} instances in ${draws} meshes`);
}
