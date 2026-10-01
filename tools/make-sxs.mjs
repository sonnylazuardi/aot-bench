// Side-by-side review composites: refs-locked ref-NN (left) vs artifacts/stills/still-NN (right), ffmpeg only.
//   bun tools/make-sxs.mjs [--sigma 16] [--only 1,4]
// Writes artifacts/sxs-vs-refs/sxs-NN.png (both halves scaled to 1080 px tall, labelled "REF (review only)" / "GAME")
// and sxs-NN-blur.png (both halves Gaussian-blurred with the same sigma so any in-image text is unreadable, labels
// redrawn on top after the blur, then downscaled to 50%). Refs appear ONLY in these review composites.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
// bun-only tooling (project rule): refuse to run under node or an older bun
if (!globalThis.Bun || Bun.version.split('.').map(Number).reduce((a, v, i) => a || (v !== [1, 4, 2][i] ? (v > [1, 4, 2][i] ? 1 : -1) : 0), 0) < 0) {
  console.error(`run with bun >= 1.4.2 (got ${globalThis.Bun ? 'bun ' + Bun.version : 'node ' + process.version})`); process.exit(2);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));
const SIGMA = Number(args.sigma || 16);
const H = 1080, GAP = 12;
const REFS = path.join(ROOT, 'refs-locked'), STILLS = path.join(ROOT, 'artifacts', 'stills'), OUT = path.join(ROOT, 'artifacts', 'sxs-vs-refs');
const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find((f) => fs.existsSync(f));
fs.mkdirSync(OUT, { recursive: true });

const pick = args.only ? String(args.only).split(',').map(Number) : [1, 2, 3, 4, 5, 6];
const label = (txt, size) => `drawtext=fontfile=${FONT}:text='${txt}':x=24:y=20:fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.72:boxborderw=14`;
let made = 0;
for (const n of pick) {
  const k = String(n).padStart(2, '0');
  const ref = fs.readdirSync(REFS).find((f) => f.startsWith(`ref-${k}`) && f.endsWith('.png'));
  const still = path.join(STILLS, `still-${k}.png`);
  if (!ref || !fs.existsSync(still)) { console.log(`skip ${k}: ${!ref ? 'no ref' : 'no still'}`); continue; }
  const refP = path.join(REFS, ref);
  // gap: pad the ref half on the right with a dark divider
  const base = `[0:v]scale=-2:${H}:flags=lanczos,setsar=1,format=rgb24[r];[1:v]scale=-2:${H}:flags=lanczos,setsar=1,format=rgb24[g];`;
  const sharp = `${base}[r]${label('REF (review only)', 34)},pad=iw+${GAP}:ih:0:0:color=0x111111[rl];[g]${label('GAME', 34)}[gl];[rl][gl]hstack=inputs=2[o]`;
  const blur = `${base}[r]gblur=sigma=${SIGMA}:steps=3,${label('REF (review only)', 34)},pad=iw+${GAP}:ih:0:0:color=0x111111[rl];[g]gblur=sigma=${SIGMA}:steps=3,${label('GAME', 34)}[gl];[rl][gl]hstack=inputs=2,scale=trunc(iw/4)*2:trunc(ih/4)*2:flags=area[o]`;
  for (const [fc, out] of [[sharp, `sxs-${k}.png`], [blur, `sxs-${k}-blur.png`]]) {
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', refP, '-i', still, '-filter_complex', fc, '-map', '[o]', '-frames:v', '1', path.join(OUT, out)], { encoding: 'utf8' });
    if (r.status !== 0) { console.error(`ffmpeg failed for ${out}: ${r.stderr}`); process.exitCode = 1; } else made++;
  }
  console.log(`sxs-${k}: ${ref} | still-${k}.png`);
}
console.log(`wrote ${made} images to ${path.relative(ROOT, OUT)}/ (blur sigma ${SIGMA}, blurred pairs at 50%)`);
