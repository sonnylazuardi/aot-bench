// Real-GPU A/B by elimination: at one view, measure GPU ms (timer query) with each feature switched off in turn.
//   bun tools/gpuab.mjs [--url "/?skip=1&q=high"] [--eval "js to set the view"] [--secs 1.5]
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return a; }, []));
const secs = Number(args.secs || 1.5);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${args.port || 9333}`);
const ctxt = browser.contexts()[0] || await browser.newContext();
const page = await ctxt.newPage();
await page.setViewportSize({ width: Number(args.w || 1920), height: Number(args.h || 1080) });
await page.routeWebSocket(/.*/, () => {}).catch(() => {}); // no HMR reloads mid-measurement
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:5190' + (args.url || '/?skip=1&q=high'), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
if (args.eval) await page.evaluate(args.eval);
if (args.only) await page.evaluate((o) => { window.__abOnly = o.split(','); }, String(args.only));
await page.waitForTimeout(Number(args.settle || 6) * 1000);
const out = await page.evaluate(async (secs) => {
  const ctx = window.__ctx, R = ctx.renderer, S = ctx.scene;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function gpu() {
    window.__game.perf(); await wait(secs * 1000);
    const p = window.__game.perf(); return { gpu: p.gpuMs, cpu: p.renderCpuMs, js: p.jsMs, fps: p.fps, calls: p.calls };
  }
  const names = S.children.map((c) => c.name || c.type);
  const res = { names: names.join(','), base: await gpu() };
  const toggles = {
    ao: [() => { ctx.post.ao && (ctx.post.ao.enabled = false); }, () => { ctx.post.ao && (ctx.post.ao.enabled = true); }],
    shafts: [() => { window.__s = ctx.post.settings.shafts; ctx.post.settings.shafts = 0; }, () => { ctx.post.settings.shafts = window.__s; }],
    clouds: [() => { window.__rc = ctx.sky.renderClouds; ctx.sky.renderClouds = () => {}; }, () => { ctx.sky.renderClouds = window.__rc; }],
    shadows: [() => { R.shadowMap.autoUpdate = false; }, () => { R.shadowMap.autoUpdate = true; }],
    fx: [() => { window.__fr = ctx.fx.render; ctx.fx.render = () => {}; }, () => { ctx.fx.render = window.__fr; }],
    vapor: [() => { ctx._storyVapor && (ctx._storyVapor.mesh.visible = false); }, () => { ctx._storyVapor && (ctx._storyVapor.mesh.visible = true); }],
    colossal: [() => { ctx.colossal.object.visible = false; }, () => { ctx.colossal.object.visible = true; }],
    pointLights: [() => { S.traverse((o) => { if (o.isPointLight) o.visible = false; }); }, () => { S.traverse((o) => { if (o.isPointLight) o.visible = true; }); }],
    res075: [() => { R.setPixelRatio(0.75); ctx.post.resize(innerWidth, innerHeight); }, () => { R.setPixelRatio(1); ctx.post.resize(innerWidth, innerHeight); }],
  };
  for (const c of S.children) {
    if (!c.name || /sun|skyHemi|colossal|storyVapor/.test(c.name) || c.isLight || c.isCamera) continue;
    toggles['obj:' + c.name] = [() => { c.userData.__v = c.visible; c.visible = false; }, () => { c.visible = c.userData.__v; }];
  }
  const only = window.__abOnly;
  for (const [k, [off, on]] of Object.entries(toggles)) {
    if (only && !only.some((o) => k.includes(o))) continue;
    const d = [];
    for (let rep = 0; rep < 2; rep++) {
      try { const b = await gpu(); off(); await wait(250); const t = await gpu(); d.push(b.gpu - t.gpu); res[k] = { ...t, base: b.gpu }; } catch (e) { res[k] = String(e); } finally { on(); await wait(250); }
    }
    res[k].saves = d.map((x) => +x.toFixed(2));
  }
  return res;
}, secs);
const base = out.base.gpu;
console.log('scene:', out.names);
for (const [k, v] of Object.entries(out)) if (k !== 'names') console.log(k.padEnd(22), k === 'base' ? JSON.stringify(v) : `saves ${JSON.stringify(v.saves)} ms gpu (base ${v.base}, cpu ${v.cpu}, calls ${v.calls})`);
if (errs.length) console.log('pageerrors:', errs.slice(0, 5));
await page.close(); await browser.close();
