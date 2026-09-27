import * as THREE from 'three';
import { LAYOUT } from './core/layout.js';
import { createEvents } from './core/events.js';
import { createInput } from './core/input.js';
import { createPhysics } from './core/physics.js';
import { createShake } from './core/shake.js';
import { STUBS } from './core/stubs.js';
import { createLoaderUI } from './core/loader.js';
import { createPerf } from './core/perf.js';

// Systems, in creation order (later systems may use earlier ones at create time)
// and in update order. Each module exports `async create(ctx)` -> system object.
// Optional: `export function prewarm(ctx)` — called as soon as the module is imported, BEFORE any create();
// start heavy off-thread work there (workers, fetches) and await its promise inside create(). ctx then only has
// THREE, LAYOUT, quality, params, renderer, scene, camera, events, physics — no other systems.
const MODULES = import.meta.glob(['./render/sky.js', './render/post.js', './render/fx.js', './world/index.js', './audio/index.js',
  './titans/index.js', './story/colossal.js', './player/index.js', './player/camera.js', './ui/index.js', './story/intro.js', './game/director.js']);
const SYSTEMS = [
  ['sky', './render/sky.js'], ['post', './render/post.js'], ['fx', './render/fx.js'], ['world', './world/index.js'],
  ['audio', './audio/index.js'], ['titans', './titans/index.js'], ['colossal', './story/colossal.js'], ['player', './player/index.js'],
  ['cam', './player/camera.js'], ['hud', './ui/index.js'], ['intro', './story/intro.js'], ['director', './game/director.js'],
];
// Worker-bound systems whose create() does not read other systems before its first await: they are started as soon
// as EARLY_AFTER exists and run concurrently with world/audio (their SDF builds happen in workers).
const EARLY = ['titans', 'colossal'];
const EARLY_AFTER = 'fx';
// Rough share of load time per system (loading bar only).
const LOAD_WEIGHTS = { sky: 2, post: 1, fx: 1, world: 10, audio: 1, titans: 10, colossal: 12, player: 2, cam: 1, hud: 1, intro: 1, director: 1, shaders: 4 };
const UPDATE_ORDER = ['director', 'intro', 'player', 'titans', 'colossal', 'world', 'fx', 'cam', 'sky', 'audio', 'hud'];

const params = Object.fromEntries(new URLSearchParams(location.search));
const only = params.only ? new Set(params.only.split(',')) : null;
const shotMode = !!params.shot;
// a system whose create() hasn't resolved after this many seconds is replaced by its stub (swapped in if it lands later)
const LOAD_TIMEOUT = Number(params.loadTimeout || (shotMode ? 240 : 45)) * 1000;

let qualityLevel = params.q;
try { qualityLevel ||= localStorage.getItem('aot.quality'); } catch {}
qualityLevel ||= 'high';
const quality = {
  level: qualityLevel,
  pixelRatio: 1,
  shadows: qualityLevel !== 'low',
  shadowMapSize: qualityLevel === 'high' ? 4096 : 2048,
};

// Render resolution: devicePixelRatio capped per quality AND by a pixel budget (~1080p on high), so 1440p/4K or
// HiDPI laptop screens don't render 2-4x the pixels the 60 fps budget assumes. ?pr=<ratio> overrides.
const PR_CAP = qualityLevel === 'low' ? 1 : qualityLevel === 'medium' ? 1.25 : 1.5;
const PIXEL_BUDGET = qualityLevel === 'low' ? 1.0e6 : qualityLevel === 'medium' ? 1.6e6 : 2.2e6;
const pixelRatioFor = (w, h) => params.pr ? Number(params.pr)
  : Math.max(0.5, Math.min(devicePixelRatio, PR_CAP, Math.sqrt(PIXEL_BUDGET / Math.max(1, w * h))));
quality.pixelRatio = pixelRatioFor(innerWidth, innerHeight);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: shotMode });
renderer.setPixelRatio(quality.pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = quality.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;    // PCFSoftShadowMap was removed in r18x (it warns and falls back)
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 16000);
camera.position.set(LAYOUT.playerStart.x, 8, LAYOUT.playerStart.z - 12);
camera.lookAt(0, 30, LAYOUT.outerGate.z);
scene.add(camera);

const shake = createShake(camera);
const ctx = {
  THREE, LAYOUT, renderer, scene, camera, quality, params,
  uiRoot: document.getElementById('ui'),
  events: createEvents(),
  input: createInput(renderer.domElement),
  physics: createPhysics(),
  clock: { time: 0, dt: 0, rawDt: 0, timeScale: 1, frame: 0 },
  cameraOwner: 'title',        // 'title' | 'intro' | 'player' | 'debug' — who positions ctx.camera this frame
  mode: 'loading',             // 'loading' | 'title' | 'intro' | 'play' | 'dead' | 'paused' | 'victory'
  shake: (amount, opts) => shake.add(amount, opts),
  get trauma() { return shake.trauma; },
  errors: [],
};
window.__ctx = ctx;

const perf = createPerf(renderer, scene, { overlay: !!params.perf });
addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); perf.setOverlay(!perf.overlay); } });

// ---- load systems (each isolated: a broken or hung module falls back to its stub) ----
const disabled = new Set();
const errorCounts = {};
const loadTimes = {};          // name -> { start, end, ms, status }  (ms since navigation start)
const wanted = (name) => (!only || only.has(name)) && !!MODULES[SYSTEMS.find((s) => s[0] === name)[1]];
const loaderUI = createLoaderUI(SYSTEMS.map((s) => s[0]), { hidden: shotMode, weights: LOAD_WEIGHTS });

async function load() {
  const tLoad = performance.now();
  // 1. fetch/evaluate every module in parallel; call prewarm() as soon as each arrives
  const imports = {};
  for (const [name, file] of SYSTEMS) {
    imports[name] = !wanted(name) ? Promise.resolve(null) : MODULES[file]().then((mod) => {
      if (typeof mod.prewarm === 'function') {
        try { mod.prewarm(ctx); } catch (e) { console.warn(`[load] ${name} prewarm failed`, e); }
      }
      return mod;
    });
    imports[name].catch(() => {});
  }
  // 2. create() in order; EARLY systems start as soon as EARLY_AFTER exists and overlap the rest
  const running = {};
  const start = (name) => {
    if (running[name]) return running[name];
    loadTimes[name] = { start: Math.round(performance.now()), end: 0, ms: 0, status: 'run' };
    if (wanted(name)) loaderUI.set(name, 'run');
    running[name] = (async () => {
      const mod = await imports[name];
      if (!mod) return null;
      const t0 = performance.now();
      const sys = await mod.create(ctx);
      loadTimes[name].createMs = Math.round(performance.now() - t0);
      return sys;
    })();
    running[name].catch(() => {});
    return running[name];
  };
  for (const [name] of SYSTEMS) {
    const p = start(name);
    let sys = null, timedOut = false, timer = null;
    try {
      sys = await Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => { timedOut = true; rej(new Error(`create() timed out after ${LOAD_TIMEOUT / 1000}s`)); }, LOAD_TIMEOUT); })]);
      const lt = loadTimes[name];
      lt.end = Math.round(performance.now()); lt.ms = lt.end - lt.start; lt.status = sys ? 'ok' : wanted(name) ? 'stub' : 'skipped';
      if (sys) console.log(`[load] ok ${name} ${lt.ms}ms${EARLY.includes(name) ? ' (concurrent)' : ''}`);
    } catch (e) {
      console.error(`[load] ${name} failed, using stub`, e);
      ctx.errors.push(`${name}: ${e.message}`);
      loadTimes[name].status = timedOut ? 'timeout' : 'error';
      if (timedOut) {
        // keep the game going on the stub; if the real system lands later, swap it in
        p.then((late) => {
          if (!late) return;
          ctx[name] = late;
          loadTimes[name].status = 'late'; loadTimes[name].end = Math.round(performance.now());
          console.warn(`[load] late ${name} arrived after ${loadTimes[name].end - loadTimes[name].start}ms — swapped in`);
        }).catch(() => {});
      }
    } finally { clearTimeout(timer); }
    if (!sys) sys = STUBS[name](ctx);
    ctx[name] = sys;
    loaderUI.set(name, /^(ok|skipped)$/.test(loadTimes[name].status) ? 'ok' : 'stub');
    if (name === EARLY_AFTER) for (const n of EARLY) start(n);
  }
  loadTimes.total = { ms: Math.round(performance.now() - tLoad) };
}

function step(rawDt) {
  const tStep = perf.t();
  const c = ctx.clock;
  c.rawDt = rawDt;
  c.dt = rawDt * c.timeScale;
  c.time += c.dt;
  c.frame++;
  for (const name of UPDATE_ORDER) {
    const sys = ctx[name];
    if (!sys?.update || disabled.has(name)) continue;
    const t0 = perf.t();
    try { sys.update(c.dt, c.time, rawDt); }
    catch (e) {
      errorCounts[name] = (errorCounts[name] || 0) + 1;
      if (errorCounts[name] < 4) console.error(`[update] ${name}`, e);
      if (errorCounts[name] > 60) { disabled.add(name); console.error(`[update] ${name} disabled after repeated errors`); }
    }
    perf.sys(name, t0);
  }
  if (debugCam && (ctx.cameraOwner === 'debug' || params.cam)) { camera.position.copy(debugCam.p); camera.lookAt(debugCam.t); }
  ctx.input.endFrame();
  perf.step(perf.t() - tStep);
}

function render(rawDt) {
  shake.apply(rawDt);
  camera.updateMatrixWorld();
  const t0 = perf.beginRender();
  try { ctx.post.render(rawDt); }
  catch (e) {
    errorCounts.post = (errorCounts.post || 0) + 1;
    if (errorCounts.post < 4) console.error('[render] post', e);
    renderer.render(scene, camera);
  }
  perf.endRender(t0);
  shake.restore();
}

let debugCam = null;
if (params.cam) {
  const v = params.cam.split(',').map(Number);
  debugCam = { p: new THREE.Vector3(v[0], v[1], v[2]), t: new THREE.Vector3(v[3], v[4], v[5]) };
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  quality.pixelRatio = pixelRatioFor(innerWidth, innerHeight);
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  ctx.post?.resize?.(innerWidth, innerHeight);
});

// ---- test / screenshot hooks ----
let frozen = !!params.freeze;
let held = false;
window.__game = {
  ctx,
  // simulate `seconds` of game time at fixed step without rendering each step, then render once
  advance(seconds, dt = 1 / 60) { const n = Math.round(seconds / dt); for (let i = 0; i < n; i++) step(dt); render(dt); return ctx.clock.time; },
  render() { render(1 / 60); },
  freeze(v = true) { frozen = v; },
  // stop the real-time loop entirely and render one frame (screenshot tool uses this so the compositor is free)
  hold() { held = true; renderer.setAnimationLoop(null); render(1 / 60); },
  // pin a debug camera (applies immediately; shadows/sky follow on the next step — use advance(0.02) before measuring)
  setCam(p, t) { debugCam = { p: new THREE.Vector3(...p), t: new THREE.Vector3(...t) }; ctx.cameraOwner = 'debug'; camera.position.copy(debugCam.p); camera.lookAt(debugCam.t); camera.updateMatrixWorld(); },
  // perf report; perf({breakdown:true}) renders one extra frame attributing every draw call to its scene object
  perf(opts = {}) { return perf.report({ ...opts, render: () => render(0) }); },
  loadTimes,
  ready: null,
};

const timer = new THREE.Timer();
timer.connect?.(document);
window.__game.ready = load().then(async () => {
  if (debugCam) ctx.cameraOwner = 'debug';
  ctx.events.emit('loaded', ctx);
  if (ctx.mode === 'loading') ctx.mode = 'title';
  // Precompile shaders so the first seconds don't hitch (parallel via KHR_parallel_shader_compile on real GPUs).
  // Skipped headless: SwiftShader has no parallel compile, so it would only delay `ready` — the first render compiles anyway.
  const tc = performance.now();
  if (!shotMode && !params.nocompile) {
    loaderUI.step('Compiling shaders…', 0);
    try { await Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 20000))]); } catch {}
    // warm-up frame under the loading screen: compiles what compileAsync can't see (shadow depth variants,
    // post-processing passes, lazily created fx materials) so the hitch happens behind the loader, not in play
    loaderUI.step('Warming up…', 0.9);
    await new Promise((r) => requestAnimationFrame(r));
    try { render(0); } catch (e) { console.warn('[load] warm-up render', e); }
  }
  loadTimes.shaders = { ms: Math.round(performance.now() - tc) };
  if (params.t) window.__game.advance(Number(params.t));
  timer.update();
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 1 / 20);
    if (!frozen) step(dt);
    render(dt);
  });
  loaderUI.done(shotMode);
  document.body.dataset.ready = '1';
  loadTimes.ready = { ms: Math.round(performance.now()) };
  console.log(`[load] total ${loadTimes.total.ms}ms, shaders ${loadTimes.shaders.ms}ms, ready at ${loadTimes.ready.ms}ms since navigation`);
  console.log('[game] ready', ctx.errors.length ? ctx.errors : '');
});
