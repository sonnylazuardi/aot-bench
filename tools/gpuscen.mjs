// Real-GPU scenario benchmark (one page load, several camera / boss-phase scenarios measured in sequence).
//   bun tools/gpuscen.mjs [--q high] [--secs 5] [--settle 2] [--only start,head,chest,p2,p3,fly] [--intro] [--params "&pr=1"]
// Needs tools/gpuchrome.sh running (CDP on :9333). Each row: avg fps / 1% low / worst ms / frames>20 / >33 ms, gpu ms, calls, tris.
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const port = args.port || 9333, secs = Number(args.secs || 5), settle = Number(args.settle || 2);
const q = args.q || 'high';
const extra = args.params || '';
const only = args.only ? new Set(String(args.only).split(',')) : null;
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const ctxt = browser.contexts()[0] || await browser.newContext();

const SCEN = {
  start: `window.__follow = null; window.__ctx.cameraOwner = 'player';`,
  head: `(() => { const c = window.__ctx.colossal; c.setPhaseDebug(1); window.__follow = () => { const h = c.headPosition; const d = new window.__ctx.THREE.Vector3(-h.x, 0, -h.z).normalize(); window.__game.setCam([h.x + d.x * 38 + 6, h.y - 4, h.z + d.z * 38], [h.x, h.y, h.z]); }; })()`,
  chest: `(() => { const c = window.__ctx.colossal; c.setPhaseDebug(1); window.__follow = () => { const h = c.headPosition; const d = new window.__ctx.THREE.Vector3(-h.x, 0, -h.z).normalize(); window.__game.setCam([h.x + d.x * 30 - 8, h.y - 22, h.z + d.z * 30], [h.x, h.y - 18, h.z]); }; })()`,
  p2: `(() => { const c = window.__ctx.colossal; c.setPhaseDebug(2); window.__follow = () => { const h = c.headPosition; const d = new window.__ctx.THREE.Vector3(-h.x, 0, -h.z).normalize(); window.__game.setCam([h.x + d.x * 110 + 20, 35, h.z + d.z * 110], [h.x, h.y - 20, h.z]); }; })()`,
  p3: `(() => { const c = window.__ctx.colossal; c.setPhaseDebug(3); window.__follow = () => { const h = c.headPosition; const d = new window.__ctx.THREE.Vector3(-h.x, 0, -h.z).normalize(); window.__game.setCam([h.x + d.x * 75 + 15, h.y - 15, h.z + d.z * 75], [h.x, h.y - 20, h.z]); }; })()`,
  fly: `(() => { let t0 = performance.now(); window.__follow = () => { const t = (performance.now() - t0) / 1000; const a = t * 0.16; const r = 200; const x = Math.sin(a) * r, z = Math.cos(a) * r; window.__game.setCam([x, 28 + Math.sin(t) * 8, z], [Math.sin(a + 0.35) * r, 22, Math.cos(a + 0.35) * r]); }; })()`,
};

async function measure(page, label) {
  await page.waitForTimeout(settle * 1000);
  const r = await page.evaluate(async (secs) => {
    window.__game.perf();
    const times = []; let last = performance.now(); const end = last + secs * 1000; const gpus = [];
    let nextP = last + 1000;
    await new Promise((res) => { const f = (t) => { times.push(t - last); last = t; if (t > nextP) { nextP += 1000; const p = window.__game.perf(); if (p.gpuMs) gpus.push(p.gpuMs); } if (t < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    times.shift(); const s = [...times].sort((a, b) => b - a); const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const p1 = s.slice(0, Math.max(1, Math.floor(s.length / 100))); const low1 = p1.reduce((a, b) => a + b, 0) / p1.length;
    const p = window.__game.perf(); if (p.gpuMs) gpus.push(p.gpuMs);
    return { fps: +(1000 / avg).toFixed(1), low1: +(1000 / low1).toFixed(1), worst: +s[0].toFixed(1), o20: times.filter((t) => t > 20).length, o33: times.filter((t) => t > 33).length,
      gpu: gpus.length ? +(gpus.reduce((a, b) => a + b, 0) / gpus.length).toFixed(2) : null, gpuMax: gpus.length ? Math.max(...gpus) : null, cpu: p.renderCpuMs, js: p.jsMs, calls: p.calls, tris: +(p.triangles / 1e6).toFixed(2), prog: p.programs,
      pr: +p.pixelRatio.toFixed(2), size: p.size.join('x'), scale: window.__ctx.quality.renderScale ?? 1 };
  }, secs);
  console.log(label.padEnd(7), JSON.stringify(r));
  return r;
}

async function run(url, list) {
  const page = await ctxt.newPage();
  await page.setViewportSize({ width: Number(args.w || 1920), height: Number(args.h || 1080) });
  await page.routeWebSocket(/.*/, () => {}).catch(() => {}); // no HMR reloads mid-measurement
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const t0 = Date.now();
  await page.goto('http://127.0.0.1:5190' + url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
  const gpu = await page.evaluate(() => { const gl = document.querySelector('canvas').getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?'; });
  console.log(`# ${url} ready in ${((Date.now() - t0) / 1000).toFixed(1)} s — ${gpu.replace(/ANGLE \(|\(0x.*$/g, '')}`);
  await page.evaluate(() => { const f = () => { try { window.__follow?.(); } catch (e) { console.error(e); } requestAnimationFrame(f); }; requestAnimationFrame(f); });
  for (const [name, js] of list) {
    if (js) await page.evaluate(js);
    await measure(page, name);
  }
  if (errs.length) console.log('pageerrors:', errs.slice(0, 5));
  await page.close();
}

if (args.intro) {
  await run(`/?intro=1&q=${q}${extra}`, [['intro0', null], ['intro1', null], ['intro2', null]]);
} else {
  // first window right after load (hitches: shader compiles, streaming jobs)
  const list = [['load', null]];
  for (const [k, v] of Object.entries(SCEN)) if (!only || only.has(k)) list.push([k, v]);
  await run(`/?skip=1&q=${q}${extra}`, list);
}
await browser.close();
