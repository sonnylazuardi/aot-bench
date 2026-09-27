// Procedural "Wings of Freedom" style emblem + fabric textures (canvas, no assets).
// drawEmblem(g, cx, cy, s): shield with a white wing (left) and a blue wing (right) overlapping.
import * as THREE from 'three';

function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function shieldPath(g, cx, cy, s) {
  // heraldic shield: flat top with small notches, straight sides, curved to a point at the bottom
  const w = 0.5 * s, top = cy - 0.56 * s, mid = cy + 0.12 * s, bot = cy + 0.62 * s;
  g.beginPath();
  g.moveTo(cx - w, top);
  g.lineTo(cx - w * 0.3, top + 0.05 * s);
  g.lineTo(cx, top - 0.02 * s);
  g.lineTo(cx + w * 0.3, top + 0.05 * s);
  g.lineTo(cx + w, top);
  g.lineTo(cx + w, mid);
  g.quadraticCurveTo(cx + w * 0.95, bot - 0.2 * s, cx, bot);
  g.quadraticCurveTo(cx - w * 0.95, bot - 0.2 * s, cx - w, mid);
  g.closePath();
}

// one wing: sx = -1 extends to the left, +1 to the right (canvas x)
function wing(g, cx, cy, s, sx, fill, line, shade) {
  const rx = cx + sx * 0.02 * s, ry = cy + 0.34 * s; // root near the lower centre
  g.save();
  // feathers: 3 rows (coverts -> secondaries -> primaries), drawn back to front
  const rows = [
    { n: 5, len: 0.78, w: 0.13, a0: -1.25, a1: -0.32, off: 0.0 },
    { n: 5, len: 0.6, w: 0.12, a0: -1.2, a1: -0.4, off: 0.06 },
    { n: 4, len: 0.4, w: 0.13, a0: -1.1, a1: -0.5, off: 0.12 },
  ];
  for (const r of rows) {
    for (let i = r.n - 1; i >= 0; i--) {
      const t = i / (r.n - 1);
      const a = r.a0 + (r.a1 - r.a0) * t; // angle from vertical (up), toward the wing side
      const L = r.len * s * (1 - 0.25 * t);
      const bx = rx + sx * r.off * s * 0.5, by = ry - r.off * s;
      const tx = bx + sx * Math.sin(-a) * L, ty = by - Math.cos(a) * L * 0.95;
      const nx = -(ty - by), ny = (tx - bx); const nl = Math.hypot(nx, ny) || 1;
      const hw = r.w * s * 0.5;
      g.beginPath();
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx + (tx - bx) * 0.5 + nx / nl * hw * 1.6, by + (ty - by) * 0.5 + ny / nl * hw * 1.6, tx, ty);
      g.quadraticCurveTo(bx + (tx - bx) * 0.55 - nx / nl * hw * 0.9, by + (ty - by) * 0.55 - ny / nl * hw * 0.9, bx, by);
      g.closePath();
      g.fillStyle = i % 2 ? fill : shade; g.fill();
      g.lineWidth = s * 0.012; g.strokeStyle = line; g.stroke();
    }
  }
  g.restore();
}

export function drawEmblem(g, cx, cy, s, { outline = '#2a1d14', field = '#efe8d6' } = {}) {
  g.save();
  g.lineJoin = 'round'; g.lineCap = 'round';
  shieldPath(g, cx, cy, s * 1.08); g.fillStyle = outline; g.fill();
  shieldPath(g, cx, cy, s); g.fillStyle = field; g.fill();
  shieldPath(g, cx, cy, s * 0.93); g.lineWidth = s * 0.014; g.strokeStyle = 'rgba(60,45,30,0.55)'; g.stroke();
  g.save(); shieldPath(g, cx, cy, s * 0.93); g.clip();
  wing(g, cx, cy, s, 1, '#2d5fae', '#12264d', '#3f74c4');   // blue wing (behind, right)
  wing(g, cx, cy, s, -1, '#f6f4ee', '#3a3a3a', '#dcdad2');  // white wing (front, left)
  g.restore();
  g.restore();
}

export function emblemTexture(size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  drawEmblem(g, size / 2, size / 2 + size * 0.02, size * 0.8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Survey Corps cloak: dark green wool with a woven grain, darker hem, emblem centred on the upper back.
// u across (0 = wearer's right shoulder edge .. 1 = left), v down from the collar.
export function cloakTexture(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const R = rng(11);
  g.fillStyle = '#2f6a3a'; g.fillRect(0, 0, size, size);
  // wool grain: a small 64x64 noise + weave tile, repeated (cheap: 4k pixels instead of 262k)
  const TS = 64, tc = document.createElement('canvas'); tc.width = tc.height = TS;
  const tg = tc.getContext('2d'), img = tg.createImageData(TS, TS), d = img.data;
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const i = (y * TS + x) * 4;
    const weave = ((x + (y >> 1)) & 3) < 2 ? 1 : -1, weave2 = ((y + (x >> 1)) & 3) < 2 ? 1 : -1;
    const n = (R() - 0.5) * 0.12 + weave * 0.025 + weave2 * 0.015;
    const v = n > 0 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = Math.min(255, Math.abs(n) * 255 * 2.2);
  }
  tg.putImageData(img, 0, 0);
  g.fillStyle = g.createPattern(tc, 'repeat'); g.fillRect(0, 0, size, size);
  // soft vertical folds: a few low-frequency gradient bands
  for (let k = 0; k < 7; k++) {
    const x0 = (k + 0.5) / 7 * size, w = size / 7;
    const gr = g.createLinearGradient(x0 - w / 2, 0, x0 + w / 2, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0.07)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0.07)');
    g.fillStyle = gr; g.fillRect(x0 - w / 2, 0, w, size);
  }
  // hem + stitching
  g.strokeStyle = 'rgba(20,34,22,0.9)'; g.lineWidth = size * 0.03;
  g.strokeRect(0, 0, size, size);
  g.setLineDash([size * 0.012, size * 0.01]); g.strokeStyle = 'rgba(160,170,130,0.35)'; g.lineWidth = size * 0.004;
  g.strokeRect(size * 0.035, size * 0.035, size * 0.93, size * 0.93); g.setLineDash([]);
  // collar band
  g.fillStyle = 'rgba(18,30,20,0.55)'; g.fillRect(0, 0, size, size * 0.06);
  drawEmblem(g, size * 0.5, size * 0.4, size * 0.4, { field: '#e9e2cf' });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// blade steel: brushed gradient with the snap-off segment lines of the ODM blades
export function bladeTexture() {
  const W = 256, H = 32, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#f4f7fa'); grd.addColorStop(0.18, '#c9d0d8'); grd.addColorStop(0.55, '#9aa3ad'); grd.addColorStop(1, '#6f7780');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const R = rng(5);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${R() * 0.08})`; g.fillRect(R() * W, R() * H, R() * 30 + 4, 1); }
  // segment lines (diagonal like the anime blades)
  g.strokeStyle = 'rgba(40,46,54,0.75)'; g.lineWidth = 1.5;
  for (let k = 1; k < 8; k++) { const x = k * W / 8; g.beginPath(); g.moveTo(x - 4, 0); g.lineTo(x + 4, H); g.stroke(); }
  // sharpened edge (bright) at the bottom
  g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(0, H - 3, W, 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
