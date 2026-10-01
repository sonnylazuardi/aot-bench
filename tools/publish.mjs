// Build the committed HEAD into dist/ and (re)start the stable preview server on :4173.
//   bun tools/publish.mjs [ref]    -> http://127.0.0.1:4173 serves exactly that commit (default HEAD)
// The dev server (:5190) keeps hot-reloading for builders; the preview never reloads under the player.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.AOT_PREVIEW_PORT || 4173);   // not 4190: it is on the browsers' blocked-port list (ERR_UNSAFE_PORT)
const PIDFILE = '/tmp/claude-1000/aot-preview.pid';
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });

const REF = process.argv[2] || 'HEAD';
const hash = sh(`git rev-parse --short ${REF}`).trim();
fs.mkdirSync('/tmp/claude-1000', { recursive: true });
const snap = fs.mkdtempSync(`/tmp/claude-1000/aot-snap-${hash}-`);
try {
  sh(`git archive ${hash} | tar -x -C ${JSON.stringify(snap)}`, { shell: '/bin/bash' });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(snap, 'node_modules'));
  const tmpOut = path.join(ROOT, 'dist.tmp');
  fs.rmSync(tmpOut, { recursive: true, force: true });
  const log = sh(`nice -n 10 bun node_modules/vite/bin/vite.js build --outDir ${JSON.stringify(tmpOut)} --emptyOutDir`, { cwd: snap });
  for (const l of log.split('\n')) if (/\[bake\]|built in|error/i.test(l)) console.log(l.trim());
  fs.writeFileSync(path.join(tmpOut, 'SNAPSHOT.txt'), `${hash}\n${new Date().toISOString()}\n`);
  const dist = path.join(ROOT, 'dist'), old = path.join(ROOT, 'dist.old');
  fs.rmSync(old, { recursive: true, force: true });
  if (fs.existsSync(dist)) fs.renameSync(dist, old);
  fs.renameSync(tmpOut, dist);
  fs.rmSync(old, { recursive: true, force: true });
} finally {
  fs.rmSync(snap, { recursive: true, force: true });
}

// restart the preview server (only the one this script started — by pid file)
try {
  const pid = Number(fs.readFileSync(PIDFILE, 'utf8'));
  if (pid) { try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} } }
} catch {}
await new Promise((r) => setTimeout(r, 800));
const out = fs.openSync('/tmp/claude-1000/aot-preview.log', 'w');
const child = spawn('bun', [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, detached: true, stdio: ['ignore', out, out] });
child.unref();
fs.writeFileSync(PIDFILE, String(child.pid));
for (let i = 0; i < 160; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try { const r = await fetch(`http://127.0.0.1:${PORT}/SNAPSHOT.txt`); if (r.ok && (await r.text()).startsWith(hash)) { console.log(`[publish] ${hash} live at http://127.0.0.1:${PORT}/`); process.exit(0); } } catch {}
}
console.error('[publish] preview did not come up; see /tmp/claude-1000/aot-preview.log');
process.exit(1);
