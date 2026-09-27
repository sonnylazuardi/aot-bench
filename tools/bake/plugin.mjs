// Vite plugin: serves / ships baked results of expensive pure builders (SDF titans, the giant's parts).
//   dev:   GET /__bake/<system>/<key>.bin?a=<argsJson>  -> 200 cached bytes | 204 (miss; baked in the background, niced)
//          a source edit in a builder's import closure re-bakes every known key for that system in the background.
//   build: every key ever requested in dev (node_modules/.cache/aot-bake/keys.json) is baked for the current sources
//          and emitted as dist/__bake/<system>/<key>.bin (AOT_BAKE=0 skips).
// Client: src/core/bake.js fetchBaked(system, args). Format: src/core/bakeCodec.js.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bakeKey, BAKE_FORMAT } from '../../src/core/bakeCodec.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKER = path.join(ROOT, 'tools/bake/worker.mjs');
const CACHE = path.join(ROOT, 'node_modules/.cache/aot-bake');
const KEYS = path.join(CACHE, 'keys.json');

// system -> pure builder (module path relative to the project root, exported function). args come from the client.
export const BAKERS = {
  colossal: { entry: 'src/story/colossalBuild.js', fn: 'buildPartArrays' },
  titans: { entry: 'src/titans/body.js', fn: 'buildTemplate' },
};

const IMPORT_RE = /(?:import|export)\s[^'"`;]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|import\s+['"](\.{1,2}\/[^'"]+)['"]/g;
export function closure(entryRel) {
  const seen = new Set();
  const stack = [path.join(ROOT, entryRel)];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !fs.existsSync(f)) continue;
    seen.add(f);
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) stack.push(path.resolve(path.dirname(f), m[1] || m[2] || m[3]));
  }
  return [...seen].sort();
}
export function sourceHash(system) {
  const h = crypto.createHash('sha1');
  h.update(`fmt${BAKE_FORMAT}|${fs.readFileSync(WORKER, 'utf8')}`);
  for (const f of closure(BAKERS[system].entry)) h.update(path.relative(ROOT, f) + '\0' + fs.readFileSync(f));
  return h.digest('hex').slice(0, 12);
}

const readKeys = () => { try { return JSON.parse(fs.readFileSync(KEYS, 'utf8')); } catch { return {}; } };
function rememberKey(system, key, args) {
  const k = readKeys();
  k[system] ||= {};
  if (k[system][key]) return;
  k[system][key] = args;
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(KEYS, JSON.stringify(k, null, 1));
}
const fileFor = (system, hash, key) => path.join(CACHE, `${system}-${hash}-${key}.bin`);

// ---- bake queue (child processes so each bake gets a fresh module cache; low priority in dev) ----
const inflight = new Map();   // file -> Promise
const queue = [];
let running = 0;
function pump(conc, nice) {
  while (running < conc && queue.length) {
    const job = queue.shift();
    running++;
    const child = spawn(process.execPath, [WORKER, path.join(ROOT, BAKERS[job.system].entry), BAKERS[job.system].fn, JSON.stringify(job.args), job.file],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    if (nice) { try { os.setPriority(child.pid, 15); } catch {} }
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', () => {
      running--;
      let r = null; try { r = JSON.parse(out.trim().split('\n').pop()); } catch {}
      if (r?.ok) {
        console.log(`[bake] ${job.system} ${job.key} ${r.ms}ms ${(r.bytes / 1048576).toFixed(1)}MB`);
        // drop stale versions of the same key
        try {
          for (const f of fs.readdirSync(CACHE)) {
            if (f.startsWith(job.system + '-') && f.endsWith(`-${job.key}.bin`) && path.join(CACHE, f) !== job.file) fs.rmSync(path.join(CACHE, f), { force: true });
          }
        } catch {}
      } else console.warn(`[bake] ${job.system} ${job.key} failed: ${(r?.error || err || 'no output').split('\n').slice(0, 3).join(' | ')}`);
      job.done(!!r?.ok);
      inflight.delete(job.file);
      pump(conc, nice);
    });
  }
}
function bake(system, key, args, hash, { conc = 2, nice = true } = {}) {
  const file = fileFor(system, hash, key);
  if (fs.existsSync(file)) return Promise.resolve(true);
  if (inflight.has(file)) return inflight.get(file);
  fs.mkdirSync(CACHE, { recursive: true });
  const p = new Promise((done) => queue.push({ system, key, args, file, done }));
  inflight.set(file, p);
  pump(conc, nice);
  return p;
}

export function bakePlugin() {
  const devConc = Math.max(1, Math.min(3, Math.floor(os.cpus().length / 4)));
  return {
    name: 'aot-bake',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/__bake/')) return next();
        const u = new URL(req.url, 'http://x');
        const m = u.pathname.match(/^\/__bake\/([a-z0-9_]+)\/([A-Za-z0-9._-]+)\.bin$/);
        if (!m || !BAKERS[m[1]]) { res.statusCode = 404; return res.end(); }
        const [, system, key] = m;
        let args = null;
        try { args = JSON.parse(u.searchParams.get('a') || 'null'); } catch {}
        if (!Array.isArray(args) || bakeKey(args) !== key) { res.statusCode = 400; return res.end('bad args'); }
        let hash;
        try { hash = sourceHash(system); } catch (e) { res.statusCode = 500; return res.end(String(e)); }
        const file = fileFor(system, hash, key);
        rememberKey(system, key, args);
        if (fs.existsSync(file)) {
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Bake-Hash', hash);
          return fs.createReadStream(file).pipe(res);
        }
        bake(system, key, args, hash, { conc: devConc, nice: true });
        res.statusCode = 204;
        res.end();
      });
      // proactive re-bake after edits to a builder's sources (debounced), so the next page load hits the cache
      const timers = {};
      server.watcher.on('change', (file) => {
        for (const system of Object.keys(BAKERS)) {
          let files; try { files = closure(BAKERS[system].entry); } catch { continue; }
          if (!files.includes(path.resolve(file))) continue;
          clearTimeout(timers[system]);
          timers[system] = setTimeout(() => {
            let hash; try { hash = sourceHash(system); } catch { return; }
            for (const [key, args] of Object.entries(readKeys()[system] || {})) bake(system, key, args, hash, { conc: devConc, nice: true });
          }, 15000);
        }
      });
    },
    async generateBundle() {
      if (process.env.AOT_BAKE === '0') return;
      const keys = readKeys();
      const conc = Math.max(1, os.cpus().length - 1);
      for (const system of Object.keys(BAKERS)) {
        let hash; try { hash = sourceHash(system); } catch (e) { this.warn(`bake ${system}: ${e.message}`); continue; }
        const entries = Object.entries(keys[system] || {});
        const ok = await Promise.all(entries.map(([key, args]) => bake(system, key, args, hash, { conc, nice: false })));
        let n = 0;
        entries.forEach(([key], i) => {
          const f = fileFor(system, hash, key);
          if (ok[i] && fs.existsSync(f)) { this.emitFile({ type: 'asset', fileName: `__bake/${system}/${key}.bin`, source: fs.readFileSync(f) }); n++; }
        });
        console.log(`[bake] emitted ${n}/${entries.length} ${system} results (sources ${hash})`);
      }
    },
  };
}
