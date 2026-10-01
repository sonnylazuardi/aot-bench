// Real-GPU per-pass timing: wraps every postprocessing pass (+ cloud raymarch) in its own timer query.
//   bun tools/gpupass.mjs [--url "/?skip=1&q=high&dynres=0"] [--eval "js"] [--settle 5] [--frames 120]
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${args.port || 9333}`);
const ctxt = browser.contexts()[0] || await browser.newContext();
const page = await ctxt.newPage();
try {
  await page.setViewportSize({ width: Number(args.w || 1920), height: Number(args.h || 1080) });
  await page.routeWebSocket(/.*/, () => {}).catch(() => {});
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://127.0.0.1:5190' + (args.url || '/?skip=1&q=high&dynres=0'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
  if (args.eval) { const ev = await page.evaluate(args.eval); if (ev !== undefined) console.log("eval:", ev); }
  if (args.print) { await page.waitForTimeout(3000); console.log("print:", await page.evaluate(args.print)); }
  await page.waitForTimeout(Number(args.settle || 5) * 1000);
  const r = await page.evaluate(async ([frames, hide]) => {
    const ctx = window.__ctx;
    if (hide) for (const n of hide.split(',')) { if (n === 'shadows') ctx.renderer.shadowMap.autoUpdate = false; else if (n === 'ao') ctx.post.ao.enabled = false; else ctx.scene.traverse((o) => { if (o.name === n) o.visible = false; }); }
    const  gl = ctx.renderer.getContext(), tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const ob = gl.beginQuery.bind(gl), oe = gl.endQuery.bind(gl);
    let mine = false;
    gl.beginQuery = (t, q) => { if (mine) ob(t, q); };
    gl.endQuery = (t) => { if (mine) oe(t); };
    const acc = {}, pend = [];
    const timed = (name, fn) => function (...a) {
      const q = gl.createQuery(); mine = true; ob(tq.TIME_ELAPSED_EXT, q); mine = false;
      try { return fn.apply(this, a); } finally { oe(tq.TIME_ELAPSED_EXT); pend.push([name, q]); }
    };
    const P = ctx.post.composer.passes;
    P.forEach((p, i) => { const n = `${i}:${p.name}${p.effects ? '(' + p.effects.map((e) => e.name).join('+') + ')' : ''}`; p.render = timed(n, p.render); });
    ctx.sky.renderClouds = timed('clouds', ctx.sky.renderClouds);
    const poll = () => { for (let i = 0; i < pend.length; i++) { const [n, q] = pend[i]; if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue; const ns = gl.getQueryParameter(q, gl.QUERY_RESULT); (acc[n] ||= []).push(ns / 1e6); gl.deleteQuery(q); pend.splice(i, 1); i--; } };
    for (let f = 0; f < frames; f++) { await new Promise((r) => requestAnimationFrame(r)); poll(); }
    await new Promise((r) => setTimeout(r, 200)); poll();
    const out = {}; let tot = 0;
    for (const [n, v] of Object.entries(acc)) { const s = v.slice(5).sort((a, b) => a - b); const med = s[s.length >> 1] || 0; out[n] = +med.toFixed(2); tot += med; }
    out.TOTAL = +tot.toFixed(2); out.size = ctx.renderer.domElement.width + 'x' + ctx.renderer.domElement.height;
    return out;
  }, [Number(args.frames || 120), args.hide || '']);
  for (const [k, v] of Object.entries(r)) console.log(k.padEnd(48), v);
  if (errs.length) console.log('pageerrors:', errs.slice(0, 5));
} finally { await page.close(); await browser.close(); }
