// Blind A/B compositor for critics.
//   node tools/ab.mjs <ours.png> <bar.jpg> <out.jpg>
// Places the two images side by side in random order, labels them only "A" and "B",
// and writes the answer key to <out>.key (critic must not read it before judging).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const [ours, bar, out] = process.argv.slice(2);
const oursFirst = Math.random() < 0.5;
const [l, r] = oursFirst ? [ours, bar] : [bar, ours];
const f = '[0:v]scale=-2:720,crop=1120:720,drawtext=text=A:x=24:y=20:fontsize=56:fontcolor=white:box=1:boxcolor=black@0.6[a];' +
          '[1:v]scale=-2:720,crop=1120:720,drawtext=text=B:x=24:y=20:fontsize=56:fontcolor=white:box=1:boxcolor=black@0.6[b];[a][b]hstack';
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', l, '-i', r, '-filter_complex', f, '-q:v', '3', out]);
fs.writeFileSync(out + '.key', oursFirst ? 'ours=A' : 'ours=B');
console.log('wrote', out);
