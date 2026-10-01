// Integrated-build health check (headless, uses tools/shot.mjs and its slot queue).
//   bun tools/health.mjs            quick: /?skip=1 (load + 5 s of fight) and / (load + Begin + 10 s of intro)
//   bun tools/health.mjs --full     also plays the whole flow: intro -> fight -> phase 2/3 -> kill -> victory
// Prints one summary line per run, then every [error]/[pageerror]/stub/timeout line. Exit code 1 if anything failed.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const full = process.argv.includes('--full');

const PROBE = `(async () => {
  const g = window.__game, c = window.__ctx, log = [], warn = [];
  const snap = (tag) => log.push([tag, c.mode, c.cameraOwner, c.colossal?.state, c.colossal?.phase].join(' '));
  const stubs = Object.entries(g.loadTimes || {}).filter(([k, v]) => v && v.status && !/^(ok|skipped)$/.test(v.status)).map(([k, v]) => k + ':' + v.status);
  if (__FLOW__) {
    snap('title');
    c.events.emit('ui:begin');
    await new Promise((r) => setTimeout(r, 2500));
    snap('begin');
    for (let i = 0; i < __INTRO__ && c.mode !== 'play'; i++) { g.advance(5); snap('intro+' + (i + 1) * 5); }
    if (__FULL__) {
      g.advance(3); snap('play');
      c.colossal?.setPhaseDebug?.(2); g.advance(4); snap('phase2');
      c.colossal?.setPhaseDebug?.(3); g.advance(4); snap('phase3');
      c.events.emit('colossal:killed', {});
      for (let i = 0; i < 12 && c.mode !== 'victory'; i++) { g.advance(5); snap('kill+' + (i + 1) * 5); }
    }
  } else {
    g.advance(5); snap('fight+5');
    // visual invariants that don't throw: the giant must cast a shadow; the frame must stay inside the draw budget
    const bd = g.perf({ breakdown: true }).breakdown;
    const gs = bd.rows.filter((r) => r.key === 'shadow:colossal').reduce((a, r) => a + r.calls, 0);
    if (!gs) warn.push('giant casts no shadow (0 shadow draws under colossal)');
  }
  return { log, warn, stubs, errors: c.errors, ready: g.loadTimes?.ready?.ms, perf: (({ calls, triangles, programs, jsMs }) => ({ calls, triangles, programs, jsMs }))(g.perf()) };
})()`;

function run(url, flow) {
  const probe = PROBE.replace('__FLOW__', flow ? 'true' : 'false').replace('__FULL__', full ? 'true' : 'false').replace('__INTRO__', full ? '16' : '2');
  const r = spawnSync('bun', ['tools/shot.mjs', '--url', url, '--noshot', '--w', '640', '--h', '360', '--wait', '100', '--timeout', '300', '--print', probe],
    { cwd: ROOT, encoding: 'utf8', timeout: 3000000, env: { ...process.env, AOT_SHOT_QUEUE_TIMEOUT: '1800', AOT_SHOT_PRIORITY: '1' } });
  const out = (r.stdout || '') + (r.stderr || '');
  const bad = out.split('\n').filter((l) => /\[error\]|\[pageerror\]|failed, using stub|timeout|\[tool\]|late |Error:/.test(l));
  let res = null;
  const pl = out.split('\n').find((l) => l.startsWith('[print] '));
  try { res = JSON.parse(pl.slice(8)); } catch { /* print failed */ }
  const ok = !bad.length && res && !res.errors?.length && !res.stubs?.length;
  const t = new Date().toTimeString().slice(0, 5);
  console.log(`[health ${t}] ${ok ? 'OK  ' : 'FAIL'} ${url}  ready ${res?.ready ?? '?'}ms  ${res ? `calls ${res.perf.calls} tris ${(res.perf.triangles / 1e6).toFixed(2)}M programs ${res.perf.programs}` : ''}  ${res?.log?.slice(-2).join(' | ') ?? ''}`);
  for (const l of [...new Set(bad)].slice(0, 15)) console.log('   ' + l.slice(0, 400));
  if (res?.errors?.length) console.log('   ctx.errors: ' + JSON.stringify(res.errors).slice(0, 400));
  if (res?.stubs?.length) console.log('   stubs: ' + res.stubs.join(' '));
  for (const w of res?.warn || []) console.log('   WARN ' + w);
  if (full && flow && res) console.log('   flow: ' + res.log.join(' | '));
  return ok;
}

const a = run('/?skip=1', false);
const b = run('/', true);
process.exitCode = a && b ? 0 : 1;
