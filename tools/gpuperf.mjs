// Real-GPU perf probe: drives the user's Windows Chrome (RTX GPU) over CDP from WSL (mirrored networking).
//   bun tools/gpuperf.mjs [--url "/?skip=1&q=high"] [--secs 8] [--w 1920 --h 1080] [--port 9333]
// Start Chrome first (see tools/gpuchrome.sh). Prints GPU renderer, fps stats (avg / 1% low / worst frame) and renderer.info.
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const port = args.port || 9333, secs = Number(args.secs || 8);
const url = 'http://127.0.0.1:5190' + (args.url || '/?skip=1');
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const ctxt = browser.contexts()[0] || await browser.newContext();
const page = await ctxt.newPage();
await page.setViewportSize({ width: Number(args.w || 1920), height: Number(args.h || 1080) });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
if (args.eval) await page.evaluate(args.eval);
await page.waitForTimeout(3000); // settle (shader compiles, streaming jobs)
const r = await page.evaluate(async (secs) => {
  const gl = document.querySelector('canvas').getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info');
  const times = []; let last = performance.now(); const end = last + secs * 1000;
  await new Promise((res) => { const f = (t) => { times.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  times.shift(); const s = [...times].sort((a, b) => b - a); const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const p1 = s.slice(0, Math.max(1, Math.floor(s.length / 100))); const low1 = p1.reduce((a, b) => a + b, 0) / p1.length;
  const info = window.__ctx.renderer.info; const c = window.__ctx.renderer.domElement;
  return { gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?', canvas: `${c.width}x${c.height}`, frames: times.length,
    avgFps: +(1000 / avg).toFixed(1), low1Fps: +(1000 / low1).toFixed(1), worstMs: +s[0].toFixed(1), over20ms: times.filter((t) => t > 20).length,
    calls: info.render.calls, tris: info.render.triangles, programs: info.programs?.length, quality: window.__ctx.quality?.level,
    perf: window.__game.perf ? window.__game.perf({ breakdown: false }) : null };
}, secs);
console.log(JSON.stringify(r, null, 1)); if (errs.length) console.log('pageerrors:', errs.slice(0, 5));
await page.close(); await browser.close();
