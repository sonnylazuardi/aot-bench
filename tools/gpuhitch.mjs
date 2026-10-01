// Real-GPU hitch probe: per-second fps buckets + attribution of every long frame (per-system update ms, render ms,
// GPU ms when available) + CPU profile top self-time functions.
//   bun tools/gpuhitch.mjs --url "/?intro=1&q=high" [--eval "js"] [--secs 20] [--long 25] [--profile] [--mark "intro:done"]
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const port = args.port || 9333, secs = Number(args.secs || 20), longMs = Number(args.long || 25);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const ctxt = browser.contexts()[0] || await browser.newContext();
const page = await ctxt.newPage();
await page.setViewportSize({ width: Number(args.w || 1920), height: Number(args.h || 1080) });
await page.routeWebSocket(/.*/, () => {}).catch(() => {}); // no HMR reloads mid-measurement
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (args.console && (m.type() === 'error' || m.type() === 'warning' || args.console === 'all')) console.log('[console]', m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:5190' + (args.url || '/?skip=1&q=high'), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
if (args.eval) await page.evaluate(args.eval);
let cdp = null;
if (args.profile) { cdp = await ctxt.newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start'); }
const r = await page.evaluate(async ({ secs, longMs, mark }) => {
  const ctx = window.__ctx;
  const names = ['director', 'intro', 'player', 'titans', 'colossal', 'world', 'fx', 'cam', 'sky', 'audio', 'hud'];
  const cur = {}; let renderMs = 0;
  for (const n of names) {
    const s = ctx[n]; if (!s?.update) continue;
    const o = s.update.bind(s);
    s.update = (...a) => { const t = performance.now(); try { return o(...a); } finally { cur[n] = (cur[n] || 0) + performance.now() - t; } };
  }
  { const o = ctx.post.render.bind(ctx.post); ctx.post.render = (...a) => { const t = performance.now(); try { return o(...a); } finally { renderMs += performance.now() - t; } }; }
  const marks = [];
  const slow = [];
  { const E = ctx.events; const o = E.emit.bind(E); E.emit = (n, ...a) => { const t = performance.now(); try { return o(n, ...a); } finally { const d = performance.now() - t; if (d > 4) slow.push(`emit ${n} ${d.toFixed(0)}ms @${((t - t0) / 1000).toFixed(2)}`); } }; }
  const wrapF = (obj, fn, label) => { if (!obj || typeof obj[fn] !== 'function') return; const o = obj[fn].bind(obj); obj[fn] = (...a) => { const t = performance.now(); try { return o(...a); } finally { const d = performance.now() - t; if (d > 3) slow.push(`${label} ${d.toFixed(0)}ms @${((t - t0) / 1000).toFixed(2)}`); } }; };
  wrapF(ctx.titans?.civilians, 'spawnCrowd', 'civ.spawnCrowd'); wrapF(ctx.audio, 'music', 'audio.music'); wrapF(ctx.audio, 'play', 'audio.play'); wrapF(ctx.sky, 'setMood', 'sky.setMood');
  wrapF(ctx.hud, 'banner', 'hud.banner'); wrapF(ctx.hud, 'objective', 'hud.objective'); wrapF(ctx.hud, 'setVisible', 'hud.setVisible'); wrapF(ctx.hud, 'letterbox', 'hud.letterbox');
  wrapF(ctx.colossal, 'startFight', 'colossal.startFight'); wrapF(ctx.player, 'setEnabled', 'player.setEnabled'); wrapF(ctx.player, 'teleport', 'player.teleport'); wrapF(ctx.titans, 'spawn', 'titans.spawn');
  wrapF(ctx.world, 'breach', 'world.breach'); wrapF(ctx.fx, 'clear', 'fx.clear');
  if (mark) for (const m of mark.split(',')) ctx.events.on(m, () => marks.push({ ev: m, t: performance.now() }));
  for (const m of ['intro:done', 'fight:start', 'wall:breached', 'colossal:phase']) ctx.events.on(m, () => marks.push({ ev: m, t: performance.now() }));
  const gl = ctx.renderer.getContext(); let upB = 0; const bigUp = [];
  for (const fn of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'bufferData', 'bufferSubData', 'compressedTexImage2D', 'generateMipmap', 'linkProgram', 'compileShader', 'texStorage2D', 'texStorage3D']) {
    const o = gl[fn]; if (!o) continue;
    gl[fn] = function (...a) {
      const t = performance.now(); const r = o.apply(gl, a); const d = performance.now() - t;
      let b = 0; for (const x of a) { if (x && x.byteLength) b += x.byteLength; else if (x && x.width && x.height) b += x.width * x.height * 4; }
      if (fn.startsWith('tex') && !b && typeof a[3] === 'number' && typeof a[4] === 'number') b = a[3] * a[4] * 4;
      upB += b;
      if (b > 2e6 || d > 8 || fn === 'linkProgram') bigUp.push({ fn, MB: +(b / 1e6).toFixed(1), ms: +d.toFixed(1), t: performance.now(), stack: new Error().stack.split('\n').slice(2, 7).map((l) => l.trim().replace(/https?:\/\/[^/]+\//, '').replace(/\?[^:]*/, '')).join(' < ') });
      return r;
    };
  }
  const loaf = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration > longMs * 2) loaf.push(e); }).observe({ type: 'long-animation-frame', buffered: false }); } catch {}
  const frames = []; const t0 = performance.now(); let last = t0;
  await new Promise((res) => {
    const f = (t) => {
      const dt = t - last; last = t;
      const p = window.__game.perf ? null : null;
      frames.push({ up: upB, t: t - t0, dt, render: renderMs, sys: { ...cur }, mode: ctx.mode, owner: ctx.cameraOwner, fx: ctx.fx?.count ?? 0, vap: ctx._storyVapor?.live ?? 0, calls: ctx.renderer.info.render.calls, tris: ctx.renderer.info.render.triangles });
      renderMs = 0; upB = 0; for (const k in cur) cur[k] = 0;
      if (t - t0 < secs * 1000) requestAnimationFrame(f); else res();
    };
    requestAnimationFrame(f);
  });
  frames.shift();
  // buckets per second
  const buckets = [];
  for (const fr of frames) { const b = Math.floor(fr.t / 1000); (buckets[b] ||= []).push(fr); }
  const rows = buckets.map((B, i) => {
    if (!B) return null;
    const avg = B.reduce((a, f) => a + f.dt, 0) / B.length; const worst = Math.max(...B.map((f) => f.dt));
    const js = B.reduce((a, f) => a + Object.values(f.sys).reduce((x, y) => x + y, 0), 0) / B.length;
    const ren = B.reduce((a, f) => a + f.render, 0) / B.length;
    const acc = {}; for (const f of B) for (const [k, v] of Object.entries(f.sys)) acc[k] = (acc[k] || 0) + v / B.length;
    const topS = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${v.toFixed(1)}`).join(' ');
    return `${String(i).padStart(3)}s [${topS}] fps ${(1000 / avg).toFixed(0).padStart(3)} worst ${worst.toFixed(0).padStart(4)} js ${js.toFixed(1)} render ${ren.toFixed(1)} mode ${B[0].mode}/${B[0].owner} fx ${B[B.length - 1].fx} vap ${B[B.length - 1].vap} calls ${B[B.length - 1].calls} tris ${(B[B.length - 1].tris / 1e6).toFixed(2)}M`;
  }).filter(Boolean);
  const longs = frames.filter((f) => f.dt > longMs).slice(0, 40).map((f) => {
    const top = Object.entries(f.sys).filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ');
    return `@${(f.t / 1000).toFixed(2)}s ${f.dt.toFixed(0)}ms up ${(f.up / 1e6).toFixed(1)}MB render ${f.render.toFixed(1)} [${top}] ${f.mode}`;
  });
  const loafs = loaf.slice(0, 12).map((e) => `@${((e.startTime - t0) / 1000).toFixed(2)}s ${e.duration.toFixed(0)}ms block ${e.blockingDuration?.toFixed(0)} render ${e.renderStart ? (e.startTime + e.duration - e.renderStart).toFixed(0) : '?'} | ` + e.scripts.map((sc) => `${sc.invokerType}:${sc.invoker} ${sc.sourceFunctionName || ''}@${(sc.sourceURL || '').split('/').pop().split('?')[0]}:${sc.sourceCharPosition} ${sc.duration.toFixed(0)}ms`).join(' ; '));
  const ups = bigUp.slice(0, 30).map((u) => `@${((u.t - t0) / 1000).toFixed(2)}s ${u.fn} ${u.MB}MB ${u.ms}ms  ${u.stack}`);
  return { slow: slow.slice(0, 40), ups, rows, longs, loafs, marks: marks.map((m) => `${m.ev} @${((m.t - t0) / 1000).toFixed(2)}s`), gpuMs: window.__game.perf().gpuMs };
}, { secs, longMs, mark: args.mark || '' });
console.log(r.rows.join('\n'));
console.log('marks:', r.marks.join(' | '));
console.log('slow calls:\n' + r.slow.join('\n'));
console.log('big uploads / slow gl calls:\n' + r.ups.join('\n'));
console.log('long animation frames:\n' + r.loafs.join('\n'));
console.log(`long frames (>${longMs} ms):\n` + r.longs.join('\n'));
if (cdp) {
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dts = profile.timeDeltas; const counts = new Map();
  profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (dts[i] || 0)));
  for (const [id, us] of counts) { const n = byId.get(id); const cf = n.callFrame; const k = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + us); }
  const tot = [...self.values()].reduce((a, b) => a + b, 0);
  console.log('CPU self time top (ms over run):');
  for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(args.top || 30))) console.log(`  ${(us / 1000).toFixed(0).padStart(6)} ${(us / tot * 100).toFixed(1).padStart(5)}%  ${k}`);
}
if (errs.length) console.log('pageerrors:', errs.slice(0, 5));
await page.close(); await browser.close();
