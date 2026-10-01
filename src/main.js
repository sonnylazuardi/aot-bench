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

function applyResolution() {
  renderer.setPixelRatio(quality.pixelRatio * quality.renderScale);
  renderer.setSize(innerWidth, innerHeight);
  ctx.post?.resize?.(innerWidth, innerHeight);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  quality.pixelRatio = pixelRatioFor(innerWidth, innerHeight);
  applyResolution();
});

// Adaptive resolution (perf): keeps the GPU under the 60 fps budget by scaling the render resolution in coarse steps
// (render targets are reallocated, so it moves at most every ~1.5 s, with hysteresis). Reads the GPU timer query
// (perf.gpuEma); without the extension it does nothing. ?dynres=0 disables, ?pr= pins the pixel ratio.
quality.renderScale = 1;
const dynres = { on: !shotMode && params.dynres !== '0' && !params.pr, min: qualityLevel === 'low' ? 0.6 : 0.7, hi: 13.6, lo: 10.2, overT: 0, underT: 0, cool: 3 };
function updateDynRes(dt) {
  if (!dynres.on) return;
  const g = perf.gpuEma;
  if (g == null || g < 0 || perf.gpuSamples < 30) return;
  dynres.cool -= dt;
  dynres.overT = g > dynres.hi ? dynres.overT + dt : 0;
  dynres.underT = g < dynres.lo ? dynres.underT + dt : 0;
  if (dynres.cool > 0) return;
  let s = quality.renderScale;
  if (dynres.overT > 0.4 && s > dynres.min) s = Math.max(dynres.min, s - (g > dynres.hi * 1.3 ? 0.15 : 0.075));
  else if (dynres.underT > 2.5 && s < 1) s = Math.min(1, s + 0.075);
  if (s !== quality.renderScale) {
    quality.renderScale = +s.toFixed(3);
    applyResolution();
    dynres.overT = dynres.underT = 0; dynres.cool = 1.5;
  }
}

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

// Shader warm-up (perf): every program variant the game will ever use is linked behind the loader, not on first sight.
// - compileAsync must run with an off-screen render target bound: the scene is drawn into the composer's HDR buffer,
//   whose programs differ from the default-framebuffer (sRGB output) variants compile() would otherwise build.
// - hidden objects (the Colossal before appear(), cinematic props, pools) are made visible for the warm-up so their
//   main AND shadow-depth variants link; the cinematic DOF pass and the particle pools are switched on for one frame.
// Shadow depth materials (perf): three draws every caster without a customDepthMaterial with ONE shared
// MeshDepthMaterial whose program variant (instanced / skinned / side / map) flips from caster to caster, so each flip
// re-runs getProgram (parameters + cache-key string) — ~18x per frame here. One stable depth material per variant.
const depthVariants = new Map();
let depthScanT = 0;
function stabilizeDepthMaterials() {
  scene.traverse((o) => {
    if (!o.isMesh || !o.castShadow || o.customDepthMaterial || o.isPoints) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || (m.clipShadows && m.clippingPlanes?.length)) return;
    const key = `${o.isInstancedMesh ? (o.instanceColor ? 2 : 1) : 0}${o.isSkinnedMesh ? 1 : 0}${o.isBatchedMesh ? 1 : 0}|${m.shadowSide ?? m.side}|${m.map ? 1 : 0}${m.alphaMap ? 1 : 0}${m.alphaTest > 0 ? 1 : 0}${m.displacementMap && m.displacementScale !== 0 ? 1 : 0}${o.morphTargetInfluences ? 1 : 0}`;
    let d = depthVariants.get(key);
    if (!d) { d = new THREE.MeshDepthMaterial(); d.name = 'shadowDepth' + key; depthVariants.set(key, d); }
    o.customDepthMaterial = d;
  });
}

async function warmShaders() {
  stabilizeDepthMaterials();
  const hidden = [];
  scene.traverse((o) => { if (!o.visible && o !== scene) { hidden.push(o); o.visible = true; } });
  if (ctx.post) ctx.post.warmup = true;
  try {
    const p = ctx.camera.position;
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    const at = p.clone().addScaledVector(fwd, 30);
    ctx.fx?.dust?.(at.clone(), 4); ctx.fx?.sparks?.(at.clone(), fwd.clone()); ctx.fx?.blood?.(at.clone(), fwd.clone());
    ctx.fx?.debris?.(at.clone(), 4, 5); ctx.fx?.gasPuff?.(at.clone(), fwd.clone());
    ctx._storyVapor?.emit?.({ pos: at.clone(), size: 3, life: 1 });
    ctx._storyVapor?.update?.(1 / 60);
  } catch (e) { console.warn('[load] warm-up fx', e); }
  const rt = ctx.post?.composer?.inputBuffer;
  const prevRT = renderer.getRenderTarget();
  try {
    if (rt) renderer.setRenderTarget(rt);
    await Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 25000))]);
  } catch (e) { console.warn('[load] compileAsync', e); }
  finally { renderer.setRenderTarget(prevRT); }
  // warm-up frames under the loading screen: shadow depth variants, post passes, particles
  loaderUI.step('Warming up…', 0.9);
  for (let i = 0; i < 2; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    try { render(1 / 60); } catch (e) { console.warn('[load] warm-up render', e); }
  }
  for (const o of hidden) o.visible = false;
  if (ctx.post) ctx.post.warmup = false;
  try { ctx.fx?.clear?.(); ctx._storyVapor?.clear?.(); } catch {}
  await new Promise((r) => requestAnimationFrame(r));
  try { render(1 / 60); } catch {}
}

const timer = new THREE.Timer();
timer.connect?.(document);
window.__game.ready = load().then(async () => {
  if (debugCam) ctx.cameraOwner = 'debug';
  ctx.events.emit('loaded', ctx);
  if (ctx.mode === 'loading') ctx.mode = 'title';
  // Precompile shaders so the first seconds don't hitch (parallel via KHR_parallel_shader_compile on real GPUs).
  // Skipped headless: SwiftShader has no parallel compile, so it would only delay `ready` — the first render compiles anyway.
  const tc = performance.now();
  // audio bank synthesis runs on the main thread (OfflineAudioContext graph building): finish it behind the loader
  if (!shotMode && ctx.audio?.bankReady) {
    loaderUI.step('Preparing sound…', 0);
    await Promise.race([ctx.audio.bankReady, new Promise((r) => setTimeout(r, Number(params.audioWait || 30) * 1000))]);
  }
  loadTimes.audio = { ms: Math.round(performance.now() - tc) };
  if (!shotMode && !params.nocompile) {
    loaderUI.step('Compiling shaders…', 0);
    await warmShaders();
  }
  loadTimes.shaders = { ms: Math.round(performance.now() - tc) };
  if (params.t) window.__game.advance(Number(params.t));
  timer.update();
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 1 / 20);
    if (!frozen) step(dt);
    if ((depthScanT -= dt) <= 0) { depthScanT = 1; stabilizeDepthMaterials(); }   // new casters (titans, debris)
    render(dt);
    updateDynRes(dt);
  });
  loaderUI.done(shotMode);
  document.body.dataset.ready = '1';
  loadTimes.ready = { ms: Math.round(performance.now()) };
  console.log(`[load] total ${loadTimes.total.ms}ms, shaders ${loadTimes.shaders.ms}ms, ready at ${loadTimes.ready.ms}ms since navigation`);
  console.log('[game] ready', ctx.errors.length ? ctx.errors : '');
});
