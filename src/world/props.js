// WORLD props / street dressing: lamps, barrels, crates, carts, market stalls with striped awnings, wells, the plaza
// fountain, hanging shop signs, laundry lines strung across lanes, hay, woodpiles, garrison supply wagons and cannon.
// Instanced per type with the building material (procedural wood / iron / stone / cloth).
import * as THREE from 'three';
import { GB, rot3 } from './geom.js';
import { Rng, lin, scalec } from './util.js';

const WOOD = lin(0x6a4a30), WOOD_D = lin(0x4a3322), IRON = lin(0x1c1b1a), STONE = lin(0x9a907e);

function geoBarrel() {
  const gb = new GB(400);
  gb.set({ mat: 2, col: WOOD });
  const seg = 8;
  const prof = [[0, 0.27], [0.5, 0.33], [1.0, 0.27]];
  for (let i = 0; i + 1 < prof.length; i++) gb.cyl(0, 0, prof[i][0], prof[i + 1][0], prof[i][1], prof[i + 1][1], seg, false);
  gb.set({ col: WOOD_D }); gb.cyl(0, 0, 0.98, 1.0, 0.27, 0.27, seg, true);
  gb.set({ mat: 5, col: IRON });
  for (const y of [0.12, 0.84]) gb.cyl(0, 0, y, y + 0.05, 0.305, 0.305, seg, false);
  return gb.build();
}
function geoCrate() {
  const gb = new GB(200);
  gb.set({ mat: 2, col: lin(0x8a6a44) });
  gb.box(-0.4, 0, -0.4, 0.4, 0.8, 0.4);
  gb.set({ col: WOOD_D });
  for (const s of [-1, 1]) { gb.box(-0.42, 0.05, s * 0.4 - 0.02, 0.42, 0.14, s * 0.4 + 0.02); gb.box(-0.42, 0.66, s * 0.4 - 0.02, 0.42, 0.75, s * 0.4 + 0.02); }
  return gb.build();
}
function geoCart() {
  const gb = new GB(800);
  gb.set({ mat: 2, col: WOOD });
  gb.box(-0.8, 0.75, -1.3, 0.8, 0.85, 1.3);          // bed
  for (const s of [-1, 1]) gb.box(s * 0.8 - 0.04, 0.85, -1.3, s * 0.8 + 0.04, 1.3, 1.3); // sides
  gb.box(-0.8, 0.85, -1.34, 0.8, 1.3, -1.26);
  gb.set({ col: WOOD_D });
  for (const s of [-1, 1]) gb.box(s * 0.35 - 0.05, 0.6, 1.3, s * 0.35 + 0.05, 0.7, 3.0); // shafts
  // wheels
  for (const s of [-1, 1]) {
    const pts = [];
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; pts.push([s * 0.95, 0.62 + Math.sin(a) * 0.62, Math.cos(a) * 0.62]); }
    gb.set({ mat: 2, col: WOOD_D });
    gb.poly(s > 0 ? pts.slice().reverse() : pts);
    gb.poly(s > 0 ? pts.map(([x, y, z]) => [x - 0.08, y, z]) : pts.map(([x, y, z]) => [x + 0.08, y, z]).reverse());
  }
  // load: hay / sacks
  gb.set({ mat: 8, col: lin(0xb89a58), p3: 0 });
  gb.obox(0, 1.35, 0, 0.7, 0.35, 1.1, rot3(0, 0, 0));
  return gb.build();
}
function geoStall(col) {
  const gb = new GB(800);
  gb.set({ mat: 2, col: WOOD });
  for (const [x, z] of [[-1.4, -0.9], [1.4, -0.9], [-1.4, 0.9], [1.4, 0.9]]) gb.box(x - 0.06, 0, z - 0.06, x + 0.06, z > 0 ? 2.3 : 2.0, z + 0.06);
  gb.box(-1.45, 0.85, -0.9, 1.45, 0.95, 0.5);        // counter
  gb.box(-1.45, 0, -0.9, 1.45, 0.85, -0.8);
  // awning (striped cloth), sloped
  gb.set({ mat: 7, col, p3: 1 });
  gb.poly([[-1.6, 2.0, -1.2], [1.6, 2.0, -1.2], [1.6, 2.35, 1.1], [-1.6, 2.35, 1.1]]);
  gb.poly([[-1.6, 2.35, 1.1], [1.6, 2.35, 1.1], [1.6, 2.0, -1.2], [-1.6, 2.0, -1.2]]);
  gb.poly([[-1.6, 1.75, -1.2], [1.6, 1.75, -1.2], [1.6, 2.0, -1.2], [-1.6, 2.0, -1.2]]);
  // produce
  const r = new Rng(col[0] * 1000);
  for (let i = 0; i < 7; i++) {
    gb.set({ mat: 8, col: r.pick([lin(0xa0402a), lin(0xc08a30), lin(0x6a8a30), lin(0x8a6a44), lin(0xd0c080)]) });
    gb.obox(-1.1 + i * 0.36, 1.02, -0.3 + r.range(-0.15, 0.15), 0.15, 0.08, 0.2, rot3(r.range(0, 1), 0, 0));
  }
  return gb.build();
}
function geoLamp() {
  const gb = new GB(300);
  gb.set({ mat: 5, col: IRON });
  gb.cyl(0, 0, 0, 0.35, 0.14, 0.1, 6, false);
  gb.cyl(0, 0, 0.35, 3.4, 0.06, 0.05, 6, false);
  gb.box(-0.04, 3.3, -0.04, 0.04, 3.36, 0.7);
  gb.box(-0.16, 2.75, 0.52, 0.16, 2.8, 0.84);
  gb.box(-0.16, 3.2, 0.52, 0.16, 3.25, 0.84);
  gb.set({ mat: 9, col: lin(0xffc070) });
  gb.box(-0.13, 2.8, 0.55, 0.13, 3.2, 0.81, 1 | 2 | 16 | 32);
  return gb.build();
}
function geoWell() {
  const gb = new GB(600);
  gb.set({ mat: 4, col: STONE, p2: 0.3 });
  gb.cyl(0, 0, 0, 0.9, 1.2, 1.2, 12, true);
  gb.set({ mat: 2, col: WOOD_D });
  gb.box(-1.1, 0.9, -0.08, -0.95, 2.6, 0.08); gb.box(0.95, 0.9, -0.08, 1.1, 2.6, 0.08);
  gb.box(-1.1, 2.1, -0.05, 1.1, 2.2, 0.05);
  gb.set({ mat: 1, col: lin(0x7c3f2a), p3: 0 });
  gb.poly([[-1.4, 2.5, 0.9], [1.4, 2.5, 0.9], [1.4, 3.2, 0], [-1.4, 3.2, 0]]);
  gb.poly([[1.4, 2.5, -0.9], [-1.4, 2.5, -0.9], [-1.4, 3.2, 0], [1.4, 3.2, 0]]);
  return gb.build();
}
function geoSign() {
  const gb = new GB(200);
  gb.set({ mat: 5, col: IRON });
  gb.box(-0.03, 0, 0, 0.03, 0.05, 1.1);                // bracket arm (local +z out of the wall)
  gb.box(-0.02, -0.4, 0.02, 0.02, 0.0, 0.05);
  gb.set({ mat: 2, col: lin(0x7a5230) });
  gb.box(-0.03, -0.75, 0.3, 0.03, -0.05, 1.0);
  return gb.build();
}
// flower box: ~18 tris. The box + a planted mound whose petals are drawn by the shader (mat 11, colour variant p3)
function geoFlowerBox(v) {
  const gb = new GB(64);
  gb.set({ mat: 2, col: [lin(0x5a3a22), lin(0x3a5a3a), lin(0x6a2a1e), lin(0x4a4038)][v], p3: 0 });
  gb.box(-0.5, -0.2, -0.1, 0.5, 0.0, 0.1, 1 | 2 | 8 | 16);
  gb.set({ mat: 11, col: [lin(0xc81e1e), lin(0xe86aa0), lin(0xf2c040), lin(0x8a4ab8)][v], p3: v });
  // mound: front and back slopes, end caps, trailing leaves hanging over the front
  gb.poly([[-0.5, 0.0, 0.1], [0.5, 0.0, 0.1], [0.46, 0.2, 0.0], [-0.46, 0.2, 0.0]]);
  gb.poly([[0.5, 0.0, -0.1], [-0.5, 0.0, -0.1], [-0.46, 0.2, 0.0], [0.46, 0.2, 0.0]]);
  gb.poly([[0.5, 0.0, 0.1], [0.5, 0.0, -0.1], [0.46, 0.2, 0.0]]);
  gb.poly([[-0.5, 0.0, -0.1], [-0.5, 0.0, 0.1], [-0.46, 0.2, 0.0]]);
  gb.poly([[-0.48, -0.26, 0.115], [0.48, -0.22, 0.115], [0.5, 0.0, 0.102], [-0.5, 0.0, 0.102]]);
  return gb.build();
}
function geoSacks() {
  const gb = new GB(200);
  const r = new Rng(19);
  for (let i = 0; i < 5; i++) {
    gb.set({ mat: 8, col: r.pick([lin(0xb8a078), lin(0xa89068), lin(0xc4b088)]) });
    const x = (i % 3) * 0.55 - 0.55, z = Math.floor(i / 3) * 0.5 - 0.2, y = i >= 3 ? 0.42 : 0;
    gb.cyl(x, z, y, y + 0.42, 0.26, 0.2, 6, true);
  }
  return gb.build();
}
function geoBench() {
  const gb = new GB(100);
  gb.set({ mat: 2, col: lin(0x6a4a30) });
  gb.box(-0.9, 0.42, -0.2, 0.9, 0.5, 0.2, 63 & ~8);
  for (const x of [-0.75, 0.75]) gb.box(x - 0.05, 0, -0.18, x + 0.05, 0.42, 0.18, 1 | 2 | 16 | 32);
  return gb.build();
}
function geoHay() {
  const gb = new GB(200);
  gb.set({ mat: 8, col: lin(0xb89a58) });
  gb.cyl(0, 0, 0, 0.9, 0.55, 0.5, 8, true);
  return gb.build();
}
function geoWoodpile() {
  const gb = new GB(600);
  gb.set({ mat: 2, col: lin(0x7a5a3a) });
  for (let r = 0; r < 4; r++) for (let i = 0; i < 6 - (r % 2); i++) gb.cyl(-1.1 + i * 0.42 + (r % 2) * 0.21, 0, 0.2 + r * 0.36 - 0.2, 0.2 + r * 0.36 + 0.14, 0.18, 0.18, 6, true);
  return gb.build();
}
function geoGasTank() {
  const gb = new GB(300);
  gb.set({ mat: 5, col: lin(0x4a5a58) });
  gb.cyl(0, 0, 0, 1.6, 0.32, 0.32, 10, true);
  gb.set({ mat: 5, col: lin(0x8a7a50) });
  gb.cyl(0, 0, 1.6, 1.8, 0.1, 0.08, 6, true);
  return gb.build();
}
function geoFountain() {
  const gb = new GB(1200);
  gb.set({ mat: 4, col: lin(0xaaa08c), p2: 0.35 });
  const n = 16;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
    const p = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
    gb.poly([p(a1, 4.2, 0), p(a0, 4.2, 0), p(a0, 4.2, 0.8), p(a1, 4.2, 0.8)]);
    gb.poly([p(a0, 3.7, 0.2), p(a1, 3.7, 0.2), p(a1, 3.7, 0.8), p(a0, 3.7, 0.8)]);
    gb.poly([p(a1, 4.2, 0.8), p(a0, 4.2, 0.8), p(a0, 3.7, 0.8), p(a1, 3.7, 0.8)]);
  }
  gb.cyl(0, 0, 0, 2.6, 0.45, 0.35, 10, true);
  gb.cyl(0, 0, 2.6, 2.9, 1.4, 1.4, 12, true);
  gb.cyl(0, 0, 2.9, 4.2, 0.28, 0.2, 8, true);
  gb.set({ mat: 5, col: lin(0x3a5a4a) });
  gb.cyl(0, 0, 4.2, 5.3, 0.35, 0.05, 8, true);
  gb.set({ mat: 10, col: [1, 1, 1] });
  gb.poly([[-3.7, 0.55, -3.7], [-3.7, 0.55, 3.7], [3.7, 0.55, 3.7], [3.7, 0.55, -3.7]].map(([x, y, z]) => [x * 0.98, y, z * 0.98]).reverse());
  return gb.build();
}
function geoCannonField() {
  const gb = new GB(600);
  gb.set({ mat: 2, col: lin(0x4a3524) });
  gb.box(-0.5, 0.3, -1.1, 0.5, 0.7, 1.0);
  for (const s of [-1, 1]) { const pts = []; for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; pts.push([s * 0.62, 0.55 + Math.sin(a) * 0.55, 0.4 + Math.cos(a) * 0.55]); } gb.poly(s > 0 ? pts.slice().reverse() : pts); }
  gb.set({ mat: 5, col: IRON });
  gb.with = null;
  const seg = 8;
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const p = (a, r, z) => [Math.cos(a) * r, 1.0 + Math.sin(a) * r + z * 0.08, z];
    gb.poly([p(a0, 0.28, -1.2), p(a1, 0.28, -1.2), p(a1, 0.19, 1.8), p(a0, 0.19, 1.8)].reverse());
  }
  return gb.build();
}

export function* buildPropsGen(ctx, shared, plan, buildings, solids, out) {
  const rng = new Rng(2024);
  const mat = shared.buildingMat;
  const T = {
    barrel: { g: geoBarrel(), list: [] }, crate: { g: geoCrate(), list: [] }, cart: { g: geoCart(), list: [] },
    stallA: { g: geoStall(lin(0xb03a2a)), list: [] }, stallB: { g: geoStall(lin(0x2f5a8a)), list: [] }, stallC: { g: geoStall(lin(0xc8b070)), list: [] },
    lamp: { g: geoLamp(), list: [] }, well: { g: geoWell(), list: [] }, sign: { g: geoSign(), list: [] }, hay: { g: geoHay(), list: [] },
    wood: { g: geoWoodpile(), list: [] }, gas: { g: geoGasTank(), list: [] }, sacks: { g: geoSacks(), list: [] }, bench: { g: geoBench(), list: [] }, fountain: { g: geoFountain(), list: [] }, cannon: { g: geoCannonField(), list: [] },
  };
  const free = (x, z, r = 1) => {
    for (let dz = -r; dz <= r; dz += r) for (let dx = -r; dx <= r; dx += r) {
      const c = plan.cellIdx(x + dx, z + dz); if (c < 0 || plan.occ[c] >= 0 || plan.street[c] === 3 || plan.street[c] === 4) return false;
    }
    return true;
  };
  const BLOB = { barrel: 0.9, crate: 1.2, cart: 3.2, stallA: 3.8, stallB: 3.8, stallC: 3.8, lamp: 0.7, well: 3.2, hay: 1.6, wood: 3.0, gas: 0.9, fountain: 10, cannon: 2.8, sacks: 2.0, bench: 2.2 };
  const blobs = [];
  const place = (type, x, z, ry, s = 1, col = null, y = 0, tilt = 0) => {
    T[type].list.push({ x, y, z, ry, s, tilt });
    if (y < 0.1 && BLOB[type]) blobs.push([x, z, BLOB[type] * s, ry]);
    return true;
  };
  const colBox = (x, z, hx, hy, hz, a, kind = 'prop') => solids.addBox(x, hy, z, hx, hy, hz, a, kind, null);

  // the main avenue (the fight's corridor): dense frontage dressing on both sides, centre kept clear
  {
    const av = plan.avenue;
    for (const side of [-1, 1]) {
      let s = 6;
      while (s < av.poly.len - 6) {
        const [px, pz, tx, tz] = av.poly.at(s);
        const nx = -tz * side, nz = tx * side;
        const face = Math.atan2(-nx, -nz);                     // yaw that points local +z at the avenue centre
        const e = av.w / 2 - 1.6;
        const x = px + nx * e, z = pz + nz * e;
        const r0 = Math.hypot(x, z);
        if (r0 > 368 || !free(x, z, 1.2)) { s += 3; continue; }
        const roll = rng.next();
        let step = rng.range(5, 9);
        if (roll < 0.2) {
          place(rng.pick(['stallA', 'stallB', 'stallC']), x - nx * 0.3, z - nz * 0.3, face); colBox(x, z, 1.6, 1.2, 1.2, face);
          if (rng.chance(0.5)) place('sacks', x + tx * 2.2, z + tz * 2.2, rng.range(0, 6.28));
          step = rng.range(6, 9);
        } else if (roll < 0.33) {
          const tip = rng.chance(0.35);
          place('cart', x + nx * 0.4, z + nz * 0.4, Math.atan2(tx, tz) + rng.range(-0.4, 0.4), 1, null, 0, tip ? rng.range(0.9, 1.3) * (rng.chance(0.5) ? 1 : -1) : 0);
          colBox(x, z, 1.0, 0.8, 1.7, Math.atan2(tx, tz));
          if (rng.chance(0.6)) place('crate', x + tx * 2.4, z + tz * 2.4, rng.range(0, 6.28));
        } else if (roll < 0.62) {
          const n = rng.int(2, 6);
          for (let i = 0; i < n; i++) {
            const ox = x + tx * rng.range(-1.6, 1.6) + nx * rng.range(-0.2, 0.9), oz = z + tz * rng.range(-1.6, 1.6) + nz * rng.range(-0.2, 0.9);
            const t = rng.wpick([[4, 'barrel'], [3, 'crate'], [2, 'sacks'], [0.8, 'hay']]);
            place(t, ox, oz, rng.range(0, 6.28), rng.range(0.85, 1.15));
            if (t === 'crate' && rng.chance(0.35)) place('crate', ox, oz, rng.range(0, 6.28), 0.85, null, 0.8);
          }
          colBox(x, z, 1.8, 0.5, 1.0, Math.atan2(tz, tx));
        } else if (roll < 0.72) {
          place('bench', x + nx * 0.6, z + nz * 0.6, face);
        } else if (roll < 0.8) { place('wood', x + nx * 0.7, z + nz * 0.7, face + Math.PI / 2); }
        if (Math.floor(s / 22) !== Math.floor((s + step) / 22)) {
          const lx = px + nx * (av.w / 2 - 0.55), lz = pz + nz * (av.w / 2 - 0.55);
          if (free(lx, lz, 0.4)) { place('lamp', lx, lz, face); colBox(lx, lz, 0.15, 1.7, 0.15, 0); }
        }
        s += step;
      }
    }
  }
  yield;
  // along streets: lamps at edges, clutter clusters near house fronts
  for (const st of plan.streets) {
    yield;
    if (st.kind === 'avenue') continue;
    const main = st.kind === 'ring' || st.kind === 'street';
    for (const side of [-1, 1]) {
      let s = rng.range(2, 12);
      while (s < st.poly.len - 2) {
        const [px, pz, tx, tz] = st.poly.at(s);
        const nx = -tz * side, nz = tx * side;
        const edge = st.w / 2 - 0.7;
        const x = px + nx * edge, z = pz + nz * edge;
        const face = Math.atan2(-nx, -nz) + Math.PI; // local +z towards the street centre
        if (Math.hypot(x, z) < 372 && free(x, z, 0.6)) {
          const roll = rng.next();
          if (main && roll < 0.3) { place('lamp', x, z, Math.atan2(-nx, -nz)); colBox(x, z, 0.15, 1.7, 0.15, 0); }
          else if (roll < 0.42) {
            // clutter cluster
            const n = rng.int(1, 4);
            for (let i = 0; i < n; i++) {
              const ox = x + tx * rng.range(-1.2, 1.2) + nx * rng.range(-0.3, 0.3), oz = z + tz * rng.range(-1.2, 1.2) + nz * rng.range(-0.3, 0.3);
              const t = rng.wpick([[4, 'barrel'], [3, 'crate'], [1.5, 'sacks'], [0.6, 'hay'], [0.5, 'wood']]);
              const stack = t === 'crate' && rng.chance(0.3);
              place(t, ox, oz, rng.range(0, 6.28), rng.range(0.85, 1.15));
              if (stack) place('crate', ox, oz, rng.range(0, 6.28), 0.9, null, 0.8);
            }
            colBox(x, z, 1.4, 0.5, 0.6, Math.atan2(tz, tx));
          } else if (roll < 0.56 && st.w > 6.5) {
            place('cart', x - nx * 1.5, z - nz * 1.5, Math.atan2(tx, tz) + rng.range(-0.3, 0.3));
            colBox(x - nx * 1.5, z - nz * 1.5, 0.9, 0.8, 1.6, Math.atan2(tx, tz));
          }
        }
        s += main ? rng.range(10, 18) : rng.range(12, 26);
      }
    }
  }
  yield;
  // market stalls on the plaza and the gate square
  const P = plan.plaza;
  for (let i = 0; i < 22; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(12, P.radius - 5);
    const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r * 0.9;
    if (Math.abs(x) < 10 || !free(x, z, 1.5)) continue;
    place(rng.pick(['stallA', 'stallB', 'stallC']), x, z, Math.atan2(P.x - x, P.z - z) + Math.PI);
    colBox(x, z, 1.6, 1.2, 1.2, a);
  }
  place('fountain', P.x - 20, P.z - 8, 0); colBox(P.x - 20, P.z - 8, 4.2, 0.45, 4.2, 0);
  // wells in some yards
  for (const [x, z] of plan.yards.slice(0, 40)) if (rng.chance(0.25) && free(x, z, 1.5)) { place('well', x, z, rng.range(0, 6.28)); colBox(x, z, 1.2, 0.5, 1.2, 0); }
  // garrison near the outer gate: gas tanks, supply carts, field cannons
  const gs = [];
  for (let i = 0; i < 14; i++) { const x = 16 + (i % 7) * 0.8, z = 340 + Math.floor(i / 7) * 0.9; place('gas', x, z, 0); }
  colBox(18.4, 340.5, 3, 0.9, 1, 0);
  for (let i = 0; i < 3; i++) { place('cart', 24 + i * 3.2, 334, 0.1); colBox(24 + i * 3.2, 334, 0.9, 0.8, 1.6, 0.1); }
  for (let i = 0; i < 4; i++) { place('cannon', -26 + i * 4.5, 352, Math.PI + rng.range(-0.1, 0.1)); }
  void gs;
  // hanging shop signs on fronts of avenue / plaza houses
  for (const b of buildings) {
    if (b.kind !== 'house' || !(b.lot.main ? rng.chance(0.55) : b.lot.z > 150 && rng.chance(0.18))) continue;
    const l = b.lot;
    const ex = Math.cos(l.a), ez = Math.sin(l.a), fx = -Math.sin(l.a), fz = Math.cos(l.a);
    const off = rng.range(-l.w / 3, l.w / 3);
    const x = l.x + ex * off + fx * (l.d / 2 + 0.05), z = l.z + ez * off + fz * (l.d / 2 + 0.05);
    place('sign', x, z, -l.a, 1, null, 3.1);
  }
  // flower boxes under windows (positions decided with the window masks in houses.js)
  const fl = buildings.decor?.flowers || [];
  for (let v = 0; v < 4; v++) T['flowers' + v] = { g: geoFlowerBox(v), list: [] };
  for (const f of fl) T['flowers' + f.c].list.push({ x: f.x, y: f.y, z: f.z, ry: f.a, s: 1, sx: f.w });
  yield;
  // build the instanced meshes
  const group = new THREE.Group(); group.name = 'props';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), eul = new THREE.Euler();
  for (const [k, t] of Object.entries(T)) {
    if (!t.list.length) continue;
    yield;
    const im = new THREE.InstancedMesh(t.g, mat, t.list.length);
    t.list.forEach((it, i) => {
      if (it.tilt) { eul.set(0, it.ry, it.tilt, 'YXZ'); q.setFromEuler(eul); } else q.setFromAxisAngle(Y, it.ry);
      sc.setScalar(it.s); if (it.sx) sc.x = it.sx;
      p.set(it.x, it.y + (it.tilt ? 0.55 : 0), it.z); m4.compose(p, q, sc); im.setMatrixAt(i, m4);
    });
    im.computeBoundingSphere();
    im.castShadow = !/^(flowers|sign|sacks|bench|lamp|crate|barrel|gas)/.test(k); im.receiveShadow = true; im.name = 'props ' + k;
    group.add(im);
  }
  yield;
  // contact-shadow blobs under every ground prop (one instanced decal, soft radial alpha)
  if (blobs.length) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g2 = cv.getContext('2d');
    const grd = g2.createRadialGradient(32, 32, 2, 32, 32, 31);
    grd.addColorStop(0, 'rgba(255,255,255,0.42)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.22)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = grd; g2.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    const bm = new THREE.MeshBasicMaterial({ color: 0x0a0806, alphaMap: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const bg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const bi = new THREE.InstancedMesh(bg, bm, blobs.length);
    blobs.forEach(([x, z, r, ry], i) => { q.setFromAxisAngle(Y, ry); sc.set(r * 0.75, 1, r * 0.6); p.set(x, 0.02, z); m4.compose(p, q, sc); bi.setMatrixAt(i, m4); });
    bi.computeBoundingSphere(); bi.renderOrder = 1; bi.name = 'prop-blobs';
    group.add(bi);
  }
  yield;
  // laundry lines across narrow lanes (merged)
  const gb = new GB(20000);
  const cloth = [lin(0xe8e4d8), lin(0xc8b89a), lin(0x9a4a3a), lin(0x4a6a8a), lin(0xd8d0b0), lin(0x6a7a4a)];
  for (const st of plan.streets) {
    if (st.kind !== 'lane' && st.kind !== 'street') continue;
    yield;
    for (let s = rng.range(5, 20); s < st.poly.len - 5; s += rng.range(14, 34)) {
      if (!rng.chance(0.55)) continue;
      const [px, pz, tx, tz] = st.poly.at(s);
      const nx = -tz, nz = tx, hw = st.w / 2 + 0.3;
      const y = rng.range(5.2, 8.5);
      const ax = px - nx * hw, az = pz - nz * hw, bx = px + nx * hw, bz = pz + nz * hw;
      const a = Math.atan2(bz - az, bx - ax);
      // rope with sag
      gb.set({ mat: 2, col: lin(0x6a5a4a), id: 0 });
      const N = 6, sag = 0.45;
      const pts = [];
      for (let i = 0; i <= N; i++) { const t = i / N; pts.push([ax + (bx - ax) * t, y - sag * 4 * t * (1 - t), az + (bz - az) * t]); }
      for (let i = 0; i < N; i++) {
        const A = pts[i], B = pts[i + 1];
        gb.poly([[A[0], A[1] - 0.02, A[2]], [B[0], B[1] - 0.02, B[2]], [B[0], B[1] + 0.02, B[2]], [A[0], A[1] + 0.02, A[2]]]);
        gb.poly([[A[0], A[1] + 0.02, A[2]], [B[0], B[1] + 0.02, B[2]], [B[0], B[1] - 0.02, B[2]], [A[0], A[1] - 0.02, A[2]]]);
      }
      // cloths
      const nC = rng.int(2, 5);
      for (let i = 0; i < nC; i++) {
        const t = (i + 0.5) / nC + rng.range(-0.05, 0.05);
        const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t, cy = y - sag * 4 * t * (1 - t);
        const w = rng.range(0.5, 1.1), h = rng.range(0.6, 1.2);
        const ux = Math.cos(a) * w / 2, uz = Math.sin(a) * w / 2;
        gb.set({ mat: 7, col: rng.pick(cloth), p3: rng.chance(0.3) ? 1 : 0 });
        const q0 = [[cx - ux, cy - h, cz - uz], [cx + ux, cy - h, cz + uz], [cx + ux, cy, cz + uz], [cx - ux, cy, cz - uz]];
        gb.poly(q0); gb.poly(q0.slice().reverse());
      }
    }
  }
  const lines = new THREE.Mesh(gb.build(), mat); lines.castShadow = true; lines.receiveShadow = true; lines.name = 'laundry';
  group.add(lines);
  ctx.scene.add(group);
  out.group = group;
}
export const SUPPLY = new THREE.Vector3(18.4, 0, 340.5);
