// WORLD: analytic ray / sphere queries for the ring wall (outside the hero section and the inner gate zone, which are
// convex boxes in the grid). Cross-section: inner face r = R (0..H), battered outer face r = A - k*y (0..46.5),
// cornice band r = RO+0.4 (46.5..H), walkway y = H (R-1.4 .. RO-1.2), parapet (RO-1.2 .. RO+0.25, H .. H+PARA).
import { WALL, outerR } from './wall.js';

const { R, RO, H, PARA_H } = WALL;
const A = RO + WALL.BATTER, K = WALL.BATTER / 46.5;
const RC = RO + 0.4;           // cornice band radius
const RP0 = RO - 1.2, RP1 = RO + 0.25;

// -> {t, nx, ny, nz} or null ; isAnalytic(angle) filters out the non-analytic arcs
export function rayWall(ox, oy, oz, dx, dy, dz, maxT, isAnalytic) {
  let best = maxT, bn = null;
  const test = (t, nx, ny, nz) => {
    if (t <= 1e-4 || t >= best) return;
    const x = ox + dx * t, z = oz + dz * t;
    if (!isAnalytic(Math.atan2(z, x))) return;
    best = t; bn = [nx, ny, nz];
  };
  const a2 = dx * dx + dz * dz, b2 = 2 * (ox * dx + oz * dz), c0 = ox * ox + oz * oz;
  const cyl = (Rr, y0, y1, fromInside) => {
    if (a2 < 1e-12) return;
    const c = c0 - Rr * Rr, disc = b2 * b2 - 4 * a2 * c;
    if (disc < 0) return;
    const sq = Math.sqrt(disc);
    const t = fromInside ? (-b2 + sq) / (2 * a2) : (-b2 - sq) / (2 * a2);
    const y = oy + dy * t;
    if (y < y0 || y > y1) return;
    const x = ox + dx * t, z = oz + dz * t, r = Math.hypot(x, z);
    test(t, fromInside ? -x / r : x / r, 0, fromInside ? -z / r : z / r);
  };
  // inner face (from the town, moving outward)
  cyl(R, 0, H - 1.8, true);
  // cornice underside region approximated by the face at R-1.4 near the top
  cyl(R - 1.4, H - 1.8, H, true);
  // parapet inner face (from the walkway)
  cyl(RP0, H, H + PARA_H, true);
  // outer cornice band and parapet outer face (from outside)
  cyl(RC, 46.5, H, false);
  cyl(RP1, H, H + PARA_H, false);
  // battered outer face (cone)
  {
    const a = a2 - K * K * dy * dy, B = A - K * oy;
    const b = 2 * (ox * dx + oz * dz + K * dy * B), c = c0 - B * B;
    if (Math.abs(a) > 1e-12) {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
          const y = oy + dy * t; if (y < 0 || y > 46.5) continue;
          const x = ox + dx * t, z = oz + dz * t, r = Math.hypot(x, z);
          const l = Math.hypot(1, K); const nx = x / r / l, ny = K / l, nz = z / r / l;
          if (dx * nx + dy * ny + dz * nz < 0) test(t, nx, ny, nz);
        }
      }
    }
  }
  // walkway and parapet tops (from above)
  if (dy < -1e-9) {
    for (const [yy, r0, r1] of [[H, R - 1.4, RP0], [H + PARA_H, RP0, RP1], [46.5, RO, RC]]) {
      const t = (yy - oy) / dy;
      if (t <= 0) continue;
      const x = ox + dx * t, z = oz + dz * t, r = Math.hypot(x, z);
      if (r >= r0 && r <= r1) test(t, 0, 1, 0);
    }
  }
  return bn ? { t: best, nx: bn[0], ny: bn[1], nz: bn[2] } : null;
}

// closest point on a convex polygon (2D) -> [inside, qx, qy, nx, ny, depthIfInside]
function closestConvex(px, py, poly) {
  let inside = true, bestD = Infinity, bq = null, minPen = Infinity, pn = null;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const ex = bx - ax, ey = by - ay, L = Math.hypot(ex, ey);
    const nx = ey / L, ny = -ex / L; // outward for CCW polygons in (r,y) with r right / y up
    const sd = (px - ax) * nx + (py - ay) * ny;
    if (sd > 0) inside = false;
    if (-sd < minPen) { minPen = -sd; pn = [nx, ny]; }
    let t = ((px - ax) * ex + (py - ay) * ey) / (L * L); t = Math.max(0, Math.min(1, t));
    const qx = ax + ex * t, qy = ay + ey * t, d = Math.hypot(px - qx, py - qy);
    if (d < bestD) { bestD = d; bq = [qx, qy]; }
  }
  return inside ? { inside, nx: pn[0], ny: pn[1], depth: minPen } : { inside, qx: bq[0], qy: bq[1], d: bestD };
}
// CCW in (r, y): r to the right, y up
const BODY = [[R, 0], [A, 0], [RO, 46.5], [RC, 46.5], [RC, H], [R - 1.4, H], [R - 1.4, H - 1.8], [R, H - 2.4]];
const BODY_CVX = [[R, 0], [A, 0], [RC, 46.5], [RC, H], [R, H]];
const PARA = [[RP0, H], [RP1, H], [RP1, H + PARA_H], [RP0, H + PARA_H]];
void BODY; void outerR;

export function collideWall(cx, cy, cz, rad, out, isAnalytic, makeVec) {
  const r = Math.hypot(cx, cz);
  if (r < R - 2 - rad || r > A + 1 + rad || cy > H + PARA_H + rad || cy < -rad) return;
  if (!isAnalytic(Math.atan2(cz, cx))) return;
  const ux = cx / r, uz = cz / r;
  for (const poly of [BODY_CVX, PARA]) {
    const q = closestConvex(r, cy, poly);
    if (q.inside) out.push({ normal: makeVec(q.nx * ux, q.ny, q.nx * uz), depth: q.depth + rad, kind: 'wall', ref: 'wall' });
    else if (q.d < rad) {
      const nr = (r - q.qx) / q.d, ny = (cy - q.qy) / q.d;
      out.push({ normal: makeVec(nr * ux, ny, nr * uz), depth: rad - q.d, kind: 'wall', ref: 'wall' });
    }
  }
}
