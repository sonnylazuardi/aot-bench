// Headless screenshot tool for builders and critics.
//   bun tools/shot.mjs --url "/?skip=1" --out shots/x.png [--wait 1500] [--advance 3] [--w 1600 --h 900]
//                       [--eval "js run in page after ready"] [--seq 5 --every 0.5]  (sequence of frames, advancing sim)
//                       [--noshot] (health check, no screenshot) [--print "js expr"] (JSON of the value after --advance/--wait) [--perf] (print window.__game.perf({breakdown:true}) as JSON) [--timeout 240] (s to wait for ready)
//                       [--profile [out.cpuprofile]] (main-thread CPU profile to ready: hotspots by file/function)
//                       [--profileplay] (CPU profile of --eval/--advance after ready instead: per-frame hotspots)
//                       [--hmr] (allow Vite HMR; by default its websocket is stubbed so other agents' edits can't reload the page mid-load)
// AOT_VERBOSE=1 streams errors/warnings/[load] lines live; AOT_VERBOSE=2 streams every console line.
// Prints console errors from the page. Uses the running dev server (default http://127.0.0.1:5190).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));
const base = process.env.AOT_URL || 'http://127.0.0.1:5190';
let url = args.url || '/?skip=1';
if (url.startsWith('/')) url = base + url;
url += (url.includes('?') ? '&' : '?') + 'shot=1';
const out = args.out || 'shots/shot.png';
const W = Number(args.w || 1280), H = Number(args.h || 720);
fs.mkdirSync(path.dirname(out), { recursive: true });

// Global screenshot queue: at most MAX headless browsers at once across all agents (machine has little RAM).
const LOCKDIR = '/tmp/claude-1000/aot-shot-slots';
const MAX = Number(process.env.AOT_SHOT_SLOTS || 3);
fs.mkdirSync(LOCKDIR, { recursive: true });
let slot = null;
async function acquireSlot() {
  const t0 = Date.now();
  for (;;) {
    // AOT_SHOT_PRIORITY=1 (integrator health checks): one extra dedicated slot so the publish cadence isn't starved
    const names = [...(process.env.AOT_SHOT_PRIORITY ? ['prio'] : []), ...Array.from({ length: MAX }, (_, i) => `slot${i}`)];
    for (const name of names) {
      const d = `${LOCKDIR}/${name}`;
      try { fs.mkdirSync(d); fs.writeFileSync(`${d}/pid`, String(process.pid)); return d; }
      catch {
        // reclaim slots held by dead processes or older than 6 minutes
        try {
          const pid = Number(fs.readFileSync(`${d}/pid`, 'utf8'));
          let alive = true; try { process.kill(pid, 0); } catch { alive = false; }
          if (!alive || Date.now() - fs.statSync(d).mtimeMs > 360000) fs.rmSync(d, { recursive: true, force: true });
        } catch { try { if (Date.now() - fs.statSync(d).mtimeMs > 20000) fs.rmSync(d, { recursive: true, force: true }); } catch {} }
      }
    }
    if (Date.now() - t0 > Number(process.env.AOT_SHOT_QUEUE_TIMEOUT || 600) * 1000) throw new Error('shot queue timeout');
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 800));
  }
}
const releaseSlot = () => { if (slot) { try { fs.rmSync(slot, { recursive: true, force: true }); } catch {} slot = null; } };
process.on('exit', releaseSlot);
process.on('SIGINT', () => { releaseSlot(); process.exit(130); });
process.on('SIGTERM', () => { releaseSlot(); process.exit(143); });
slot = await acquireSlot();

const browser = await chromium.launch({
  env: { ...process.env, LD_LIBRARY_PATH: [process.env.HOME + '/.local/chromelibs/usr/lib/x86_64-linux-gnu', process.env.HOME + '/.local/chromelibs/usr/lib/x86_64-linux-gnu/nss', process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
  executablePath: process.env.AOT_CHROME || (fs.existsSync(process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome') ? process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome' : undefined),
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
// Stub the Vite HMR socket: builders edit files constantly and every edit would full-reload the page mid-load.
if (!args.hmr) await page.routeWebSocket(/.*/, () => {}).catch(() => {});
const logs = [];
page.on('console', (m) => { if (process.env.AOT_VERBOSE === '2' && !(m.type() === 'error' || m.type() === 'warning' || /\[game\]|\[load\]/.test(m.text()))) console.log(`[${m.type()}] ${m.text()}`); if (m.type() === 'error' || m.type() === 'warning' || /\[game\]|\[load\]/.test(m.text())) { logs.push(`[${m.type()}] ${m.text()}`); if (process.env.AOT_VERBOSE) console.log(`[${m.type()}] ${m.text()}`); } });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
// --profile: CPU-profile the main thread from navigation to ready; prints self-time hotspots by function and by file
let cdp = null;
if (args.profile || args.profileplay) {
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  if (!args.profileplay) await cdp.send('Profiler.start');
}
async function stopProfile(label) {
  const { profile } = await cdp.send('Profiler.stop');
  const pf = typeof args.profile === 'string' ? args.profile : typeof args.profileplay === 'string' ? args.profileplay : null;
  if (pf) fs.writeFileSync(pf, JSON.stringify(profile));
  const self = new Map(), byFile = new Map();
  const dt = new Map();
  for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0));
  for (const n of profile.nodes) {
    const us = dt.get(n.id) || 0; if (!us) continue;
    const cf = n.callFrame, file = (cf.url || '(native)').replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '');
    const key = `${cf.functionName || '(anon)'} ${file}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + us); byFile.set(file, (byFile.get(file) || 0) + us);
  }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `  ${(v / 1000).toFixed(0).padStart(7)} ms  ${k}`).join('\n');
  // who calls the hottest functions (self time attributed to the caller frame, 1 level up)
  const byId = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n);
  const keyOf = (n) => { const cf = n.callFrame; return `${cf.functionName || '(anon)'} ${(cf.url || '(native)').replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`; };
  const callerMap = new Map();
  for (const n of profile.nodes) {
    const us = dt.get(n.id) || 0; if (!us) continue;
    const k = keyOf(n); let p = parent.get(n.id);
    while (p && keyOf(p).includes('three.module')) p = parent.get(p.id);   // skip three internals to reach game code
    const ck = p ? keyOf(p) : '(root)';
    const m = callerMap.get(k) || new Map(); m.set(ck, (m.get(ck) || 0) + us); callerMap.set(k, m);
  }
  const hot = [...self].sort((a, b) => b[1] - a[1]).slice(0, 12).filter(([k]) => k.includes('three.module') || k.includes('(native)'));
  const callersTxt = hot.map(([k]) => `  ${k}\n` + [...(callerMap.get(k) || [])].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, v]) => `      ${(v / 1000).toFixed(0).padStart(6)} ms  <- ${c}`).join('\n')).join('\n');
  console.log(`[profile] main-thread self time, ${label}\n-- by file --\n${top(byFile, 25)}\n-- by function --\n${top(self, 40)}\n-- game callers of hot three/native functions --\n${callersTxt}`);
}
const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
const readyTimeout = Number(args.timeout || 240) * 1000;
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: readyTimeout, polling: 500 }).catch(async () => {
  logs.push(`[tool] timeout waiting for ready (${readyTimeout / 1000}s)`);
  const lt = await page.evaluate(() => JSON.stringify(window.__game?.loadTimes || {})).catch(() => '?');
  logs.push(`[tool] loadTimes at timeout: ${lt}`);
});
if (cdp && !args.profileplay) await stopProfile('navigation -> ready');
const info = await page.evaluate(() => {
  const gl = document.querySelector('canvas')?.getContext('webgl2');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return { gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown' };
}).catch(() => ({}));
if (args.profileplay) await cdp.send('Profiler.start');
if (args.eval) await page.evaluate(args.eval).catch((e) => logs.push(`[tool] eval error ${e.message}`));
if (args.advance) await page.evaluate((s) => window.__game.advance(s), Number(args.advance));
if (args.profileplay) await stopProfile(`gameplay (--eval / --advance ${args.advance || 0}s)`);
await page.waitForTimeout(Number(args.wait || 1200));
await page.evaluate(() => window.__game?.hold?.()).catch(() => {});
if (args.seq) {
  const n = Number(args.seq), every = Number(args.every || 0.5);
  for (let i = 0; i < n; i++) {
    await page.evaluate((s) => window.__game.advance(s), every);
    await page.waitForTimeout(150);
    const f = out.replace(/\.png$/, `_${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: f, timeout: 180000 });
    console.log('wrote', f);
  }
} else if (!args.noshot) {
  try { await page.screenshot({ path: out, timeout: 180000 }); console.log('wrote', out); }
  catch (e) { logs.push(`[tool] screenshot failed: ${e.message.split('\n')[0]}`); }
}
if (args.print) {
  const r = await page.evaluate(async (src) => { const v = await (0, eval)(src); return JSON.stringify(v); }, args.print).catch((e) => `print error ${e.message}`);
  console.log('[print] ' + r);
}
if (args.perf) {
  const rep = await page.evaluate(() => { const r = window.__game.perf({ breakdown: true }); return JSON.stringify({ ...r, loadTimes: window.__game.loadTimes }); }).catch((e) => `perf error ${e.message}`);
  console.log('[perf] ' + rep);
}
const fps = args.fps ? await page.evaluate(() => new Promise((r) => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 1000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); })).catch(() => -1) : 'n/a (pass --fps)';
console.log(`gpu: ${info.gpu} | rAF fps (headless, indicative only): ${fps} | load ${(Date.now() - t0) / 1000}s`);
if (logs.length) console.log(logs.slice(0, 40).join('\n'));
await browser.close();
releaseSlot();
