// WORLD: tileable noise texture generated once at load (RGBA = fbm at 4 base frequencies), mipmapped + repeat.
// Shaders sample it for plaster stains, stone grain, weathering streaks, moss, crop texture... (cheap, AA'd by mips).
import * as THREE from 'three';
import { hash2i } from './util.js';

function tileNoise(x, y, P, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const m = (v) => ((v % P) + P) % P;
  const a = hash2i(m(ix), m(iy), seed), b = hash2i(m(ix + 1), m(iy), seed), c = hash2i(m(ix), m(iy + 1), seed), d = hash2i(m(ix + 1), m(iy + 1), seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function makeNoiseTexture(size = 512) {
  const data = new Uint8Array(size * size * 4);
  const bases = [4, 16, 48, 128];
  for (let ch = 0; ch < 4; ch++) {
    const B = bases[ch];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let s = 0, amp = 1, n = 0, P = B;
      for (let o = 0; o < 4; o++) {
        if (P > size) break;
        s += amp * tileNoise((x / size) * P, (y / size) * P, P, 11 + ch * 7 + o * 13);
        n += amp; amp *= 0.5; P *= 2;
      }
      let v = s / n;
      v = (v - 0.5) * 1.6 + 0.5; // stretch contrast (fbm clusters around 0.5)
      data[(y * size + x) * 4 + ch] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
