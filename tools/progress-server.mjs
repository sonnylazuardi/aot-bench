// Live progress page: http://127.0.0.1:5191  (reads PROGRESS.json + newest screenshots in shots/<piece>/)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
function state() {
  let p = {};
  try { p = JSON.parse(fs.readFileSync(path.join(root, 'PROGRESS.json'), 'utf8')); } catch {}
  const shots = {};
  const sd = path.join(root, 'shots');
  for (const d of fs.existsSync(sd) ? fs.readdirSync(sd) : []) {
    const full = path.join(sd, d);
    if (!fs.statSync(full).isDirectory()) continue;
    shots[d] = fs.readdirSync(full).filter((f) => /\.(png|jpg)$/.test(f))
      .map((f) => ({ f: `shots/${d}/${f}`, t: fs.statSync(path.join(full, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t).slice(0, 6);
  }
  // critics write shots/critic/verdict_<piece>.json → merged over PROGRESS.json pieces
  const cd = path.join(root, 'shots/critic');
  p.pieces = p.pieces || {};
  for (const f of fs.existsSync(cd) ? fs.readdirSync(cd) : []) {
    const m = f.match(/^verdict_(\w+)\.json$/);
    if (!m) continue;
    try { p.pieces[m[1]] = { ...(p.pieces[m[1]] || {}), ...JSON.parse(fs.readFileSync(path.join(cd, f), 'utf8')) }; } catch {}
  }
  return { ...p, shots, now: Date.now() };
}
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/api/state') { res.writeHead(200, { 'content-type': types['.json'], 'cache-control': 'no-store' }); return res.end(JSON.stringify(state())); }
  const file = u === '/' ? path.join(root, 'tools/progress.html') : path.join(root, u);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(5191, '127.0.0.1', () => console.log('progress on http://127.0.0.1:5191'));
