// Stage D capture: the 6 matched stills + a scripted walkthrough, all rendered live from the running dev build.
//
//   bun tools/capture.mjs                      # stills + walkthrough (stills ~10 min, walkthrough ~15-25 min on SwiftShader)
//   bun tools/capture.mjs --only stills        # just artifacts/stills/still-01..06.png + MANIFEST.md
//   bun tools/capture.mjs --only walk          # just artifacts/walkthrough-frames/ + artifacts/walkthrough.mp4
//   bun tools/capture.mjs --only stills --stills 1,4    # re-shoot a subset (MANIFEST rows of the others are kept)
//   options: --fps 6 (walkthrough frame rate)  --seed 7 (Math.random seed)  --frames 16 (sampled walkthrough PNGs)
//            --out artifacts  --keep (keep the raw walkthrough JPEG sequence in artifacts/.walk-raw)
//
// Uses the dev server at AOT_URL (default http://127.0.0.1:5190) with ?shot=1&freeze=1: the real-time loop is stopped
// (__game.hold) and the sim is stepped only by __game.advance(sec) (fixed 60 Hz, then one render), so every frame is
// deterministic game time regardless of how slow software GL is. Math.random is replaced by a seeded PRNG before any
// game code runs. The Vite HMR socket is stubbed so other agents' edits can't reload the page mid-capture.
// Shares the headless-browser slot queue in /tmp/claude-1000/aot-shot-slots with tools/shot.mjs.
// Nothing here edits the game: all state is driven through ctx APIs (player.teleport/debugHook, colossal.setPhaseDebug,
// sky.setMood, hud.setVisible, keyboard events) and __game.setCam for the pinned still cameras.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
// bun-only tooling (project rule): refuse to run under node or an older bun
if (!globalThis.Bun || Bun.version.split('.').map(Number).reduce((a, v, i) => a || (v !== [1, 4, 2][i] ? (v > [1, 4, 2][i] ? 1 : -1) : 0), 0) < 0) {
  console.error(`run with bun >= 1.4.2 (got ${globalThis.Bun ? 'bun ' + Bun.version : 'node ' + process.version})`); process.exit(2);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));
const BASE = process.env.AOT_URL || 'http://127.0.0.1:5190';
const OUT = path.resolve(ROOT, args.out || 'artifacts');
const ONLY = args.only || 'all';
const SEED = Number(args.seed ?? 7);
const FPS = Number(args.fps || 6);
const NFRAMES = Number(args.frames || 16);
const STILL_W = 1920, STILL_H = 1080, WALK_W = 1280, WALK_H = 720;
if (!['all', 'stills', 'walk'].includes(ONLY)) { console.error('--only must be stills | walk'); process.exit(2); }

const sh = (c) => { try { return execSync(c, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
const COMMIT = sh('git rev-parse --short HEAD') + (sh('git status --porcelain') ? '+dirty' : '');
const log = (...a) => console.log(`[capture ${new Date().toISOString().slice(11, 19)}]`, ...a);

// ------------------------------------------------------------------ browser slot (shared with tools/shot.mjs)
const LOCKDIR = '/tmp/claude-1000/aot-shot-slots';
const MAXSLOTS = Number(process.env.AOT_SHOT_SLOTS || 3);
fs.mkdirSync(LOCKDIR, { recursive: true });
let slot = null;
async function acquireSlot() {
  const t0 = Date.now();
  for (;;) {
    for (const name of Array.from({ length: MAXSLOTS }, (_, i) => `slot${i}`)) {
      const d = `${LOCKDIR}/${name}`;
      try { fs.mkdirSync(d); fs.writeFileSync(`${d}/pid`, String(process.pid)); return d; }
      catch {
        try {
          const pid = Number(fs.readFileSync(`${d}/pid`, 'utf8'));
          let alive = true; try { process.kill(pid, 0); } catch { alive = false; }
          // a long capture keeps its slot fresh (touchSlot); reclaim only dead holders or stale (>6 min untouched) ones
          if (!alive || Date.now() - fs.statSync(d).mtimeMs > 360000) fs.rmSync(d, { recursive: true, force: true });
        } catch { try { if (Date.now() - fs.statSync(d).mtimeMs > 20000) fs.rmSync(d, { recursive: true, force: true }); } catch {} }
      }
    }
    if (Date.now() - t0 > 1800 * 1000) throw new Error('shot queue timeout');
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
  }
}
const touchSlot = () => { if (slot) { try { const now = new Date(); fs.utimesSync(slot, now, now); } catch {} } };
const releaseSlot = () => { if (slot) { try { fs.rmSync(slot, { recursive: true, force: true }); } catch {} slot = null; } };
process.on('exit', releaseSlot);
process.on('SIGINT', () => { releaseSlot(); process.exit(130); });
process.on('SIGTERM', () => { releaseSlot(); process.exit(143); });

let browser = null;
async function launch() {
  if (browser) return browser;
  slot = await acquireSlot();
  const home = process.env.HOME;
  const pwChrome = `${home}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
  browser = await chromium.launch({
    env: { ...process.env, LD_LIBRARY_PATH: [`${home}/.local/chromelibs/usr/lib/x86_64-linux-gnu`, `${home}/.local/chromelibs/usr/lib/x86_64-linux-gnu/nss`, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
    executablePath: process.env.AOT_CHROME || (fs.existsSync(pwChrome) ? pwChrome : undefined),
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  return browser;
}

// In-page helpers, installed after the game is ready.
function installHelpers() {
  const c = window.__ctx, G = window.__game, T = c.THREE;
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const key = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
  const DOWN = V(0, -1, 0);
  window.__cap = {
    V,
    adv: (s) => G.advance(s),
    // pin the still camera (debug owner); fov optional
    cam(p, t, fov) {
      if (fov) { c.camera.fov = fov; c.camera.updateProjectionMatrix(); }
      G.setCam(p.toArray ? p.toArray() : p, t.toArray ? t.toArray() : t);
      window.__cap.lastCam = { pos: [...(p.toArray ? p.toArray() : p)], target: [...(t.toArray ? t.toArray() : t)], fov: c.camera.fov };
    },
    key, tap(code) { key(code, true); key(code, false); },
    // converge the half-res temporally accumulated clouds for the pinned camera (cloud pass only, then one full render)
    settle(n = 24) { for (let i = 0; i < n; i++) c.sky?.renderClouds?.(c.camera); G.render(); return n; },
    // jump every running CSS transition/animation (HUD fades, banners) to its end state: DOM timing is wall-clock,
    // so without this a still could catch the HUD mid-fade
    finish() { for (const a of document.getAnimations()) { try { a.finish(); } catch {} } },
    hold(code) { key(code, true); }, release(code) { key(code, false); },
    // highest solid surface under (x,z) excluding characters
    surface(x, z, from = 200) { return c.physics.raycast(V(x, from, z), DOWN, from + 50, { exclude: ['titans', 'colossal', 'player'] }); },
    camInfo() {
      const cam = c.camera, d = new T.Vector3(); cam.getWorldDirection(d);
      const p = cam.position;
      const lc = window.__cap.lastCam;
      const target = c.cameraOwner === 'debug' && lc ? lc.target : p.clone().addScaledVector(d, 30).toArray();
      return { owner: c.cameraOwner, pos: p.toArray(), target, fov: cam.fov };
    },
    state() {
      const C = c.colossal, P = c.player;
      return {
        mode: c.mode, cameraOwner: c.cameraOwner, mood: c.sky?.mood, phase: C?.phase, bossState: C?.state, bossHp: C?.hp,
        bossRoot: C?.object?.position?.toArray(), bossHead: C?.headPosition?.toArray(), steaming: !!C?.steaming,
        weakPoints: (C?.weakPoints || []).map((w) => ({ name: w.name, active: !!w.active, hp: +(w.hp ?? 1).toFixed(2) })),
        player: { pos: P?.position?.toArray(), state: P?.state, hooks: (P?.hooks || []).map((h) => `${h.side}:${h.attached ? 'attached' : h.state}`), lock: P?.lockTarget?.name || null, hp: P?.hp },
        hudVisible: !document.querySelector('.aot-hud')?.classList.contains('off'),
        clock: +c.clock.time.toFixed(2), errors: c.errors.slice(),
      };
    },
  };
  // a clean, calm boss for posed stills: no attack picked while we set the frame up (cooldown never expires)
  window.__cap.calm = () => { const S = c.colossal?.brain?.S; if (S) { S.cool = 1e9; S.action = null; } };
  return true;
}

const r3 = (a) => (a || []).map((v) => Math.round(v * 10) / 10);
async function openGame(query, W, H) {
  const b = await launch();
  const page = await b.newPage({ viewport: { width: W, height: H } });
  await page.routeWebSocket(/.*/, () => {}).catch(() => {});
  // seeded Math.random before any game module runs (mulberry32)
  await page.addInitScript((seed) => {
    let a = seed >>> 0;
    Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }, SEED);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[error] ${m.text()}`); if (process.env.AOT_VERBOSE) console.log(`  [${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  const url = `${BASE}/?${query}${query ? '&' : ''}shot=1&freeze=1&q=high`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 300000, polling: 500 });
  await page.evaluate(() => window.__game.hold());
  await page.evaluate(installHelpers);
  touchSlot();
  return { page, errors, url };
}

// ------------------------------------------------------------------ stills
// Each setup runs in the page (window.__cap helpers), poses a real game state and pins the camera.
// Returns { scene } (plain-language state summary); camera + state are read back afterwards.
const STILLS = [
  {
    n: 1, ref: 'ref-01-colossal-head-closeup.png', query: 'skip=1', hud: false,
    desc: 'Tight low-angle close-up: head in the upper-left third, neck/trapezius/shoulder lower right, sky behind. Phase 1 fight (boss leaning over the outer wall at the breach), mood day.',
    setup: () => {
      const c = __ctx, k = __cap; k.calm(); c.hud.setVisible(false);
      k.adv(4); k.calm(); c.sky.setMood('day', 0); k.adv(0.5);
      const h = c.colossal.headPosition.clone();
      // on the wall walkway between the two gripping hands, ~20 m under/in front of the face, looking up at it
      k.cam(k.V(-4, 52.5, 386), k.V(h.x - 7, h.y - 5, h.z), 60);
      k.adv(1 / 60);
      return 'phase 1 fight, boss gripping the wall (calm: attack cooldown held), HUD hidden, debug camera on the wall walkway between its hands';
    },
  },
  {
    n: 2, ref: 'ref-02-colossal-wall-wide.png', query: 'skip=1', hud: false,
    desc: 'Boss standing in front of the wall face filling most of the frame height, town roofs and the gate church tower below it, soldier large in the foreground on two taut cables. Phase 2 (boss inside the walls), mood golden.',
    setup: () => {
      const c = __ctx, k = __cap, C = c.colossal, P = c.player, T = c.THREE; c.hud.setVisible(false);
      k.adv(2); C.setPhaseDebug(2); k.adv(6); k.calm(); c.sky.setMood('golden', 0);
      const r = C.object.position.clone();
      const camP = k.V(r.x + 6, 24, r.z - 78), tgt = k.V(r.x - 3, 31, r.z);
      const dir = tgt.clone().sub(camP).normalize(), right = new T.Vector3().crossVectors(dir, k.V(0, 1, 0)).normalize();
      const up = new T.Vector3().crossVectors(right, dir);
      const wallPt = (x) => k.V(x, 49, Math.sqrt(387 * 387 - x * x));
      const off = (v) => v.clone().addScaledVector(dir, 4.6).addScaledVector(right, -1.7).addScaledVector(up, 0.75);
      P.teleport(off(camP), Math.atan2(dir.x, dir.z) - 1.2);
      P.debugHook('L', wallPt(r.x - 60)); P.debugHook('R', wallPt(r.x - 48));
      P.velocity.set(-4, 3, 8);
      k.adv(0.2);
      // place the lens relative to where the swinging soldier actually is (same offset as planned)
      const p = P.position.clone().add(k.V(0, 1, 0));
      const cam2 = p.clone().addScaledVector(dir, -4.6).addScaledVector(right, 1.7).addScaledVector(up, -0.75);
      k.cam(cam2, cam2.clone().add(tgt.clone().sub(camP)), 50);
      k.adv(0.02);
      return 'phase 2 fight (setPhaseDebug(2): hands severed, boss striding inside the wall), player airborne on both hooks (debugHook) anchored to the wall top, HUD hidden, debug camera ~4.5 m behind the soldier; the gate church stands west of the boss, so it lands right of it in this south-facing view';
    },
  },
  {
    n: 3, ref: 'ref-03-colossal-lowangle-steam.png', query: 'skip=1', hud: false,
    desc: 'Low-angle full body against the sky, steam veiling the body/legs. Phase 3 fury (venting), mood afternoon.',
    setup: () => {
      const c = __ctx, k = __cap, C = c.colossal, P = c.player; c.hud.setVisible(false);
      k.adv(2); C.setPhaseDebug(3); k.adv(6); c.sky.setMood('afternoon', 0);
      P.teleport(k.V(60, 40, -60), 0); P.setEnabled(false);   // soldier out of this shot
      k.adv(0.5);
      const r = C.object.position.clone();
      k.cam(k.V(r.x - 5, r.y + 1.8, r.z - 36), k.V(r.x, r.y + 25, r.z), 78);
      k.adv(0.02);
      return 'phase 3 fight (setPhaseDebug(3): fury, venting steam), player moved out of shot, HUD hidden, debug camera at street level on the main avenue ~36 m in front of the boss';
    },
  },
  {
    n: 4, ref: 'ref-04-weakpoint-hud.png', query: 'skip=1', hud: true,
    desc: 'Gameplay: soldier hanging on both hooks in front of the boss in phase 1, soft lock-on (Tab) on a hand; weak-point HUD markers (nape ring, limb X + HP bar) on the body. Real chase camera, HUD on.',
    setup: () => {
      const c = __ctx, k = __cap, C = c.colossal, P = c.player;
      P.noPointerLock = true; k.calm();
      k.adv(4); k.calm(); c.sky.setMood('day', 0);
      const h = C.headPosition.clone();
      const pp = k.V(h.x - 10, 58, 350);
      P.teleport(pp, Math.atan2(h.x - pp.x, h.z - pp.z));
      P.pitch = 0.12;
      k.adv(0.1);
      k.tap('Tab'); k.adv(0.05);
      k.tap('KeyQ'); k.tap('KeyE'); k.adv(0.7);
      return 'phase 1 fight (calm), player teleported airborne ~30 m in front of the boss above the wall top, soft lock-on (Tab) + both hooks fired (Q/E) at the lock target, real chase camera (owner=player), HUD on';
    },
  },
  {
    n: 5, ref: 'ref-05-rooftop-blue-sky.png', query: 'skip=1', hud: true,
    desc: 'Soldier running on a tiled pitched house roof near the ridge, third person from low beside him on the roof, clear blue day sky with cumulus behind. Phase 1, mood day, HUD on.',
    setup: () => {
      const c = __ctx, k = __cap, P = c.player;
      P.noPointerLock = true; k.calm();
      k.adv(3); k.calm(); c.sky.setMood('day', 0);
      // the tallest mid-size pitched-roof house south-west of the plaza (open sky above its ridge)
      const B = c.world.buildings.filter((b) => b.kind === 'house' && !b.destroyed && b.box.max.y > 14 && b.box.max.y < 24
        && Math.hypot(b.center.x + 90, b.center.z - 120) < 80);
      B.sort((a, b) => b.box.max.y - a.box.max.y);
      const b = B[0], bx = b.box, sx = bx.max.x - bx.min.x, sz = bx.max.z - bx.min.z, alongX = sx >= sz;
      const cx = (bx.min.x + bx.max.x) / 2, cz = (bx.min.z + bx.max.z) / 2;
      const px = alongX ? cx + sx * 0.2 : cx + sx * 0.1, pz = alongX ? cz + sz * 0.1 : cz + sz * 0.2;
      const hit = k.surface(px, pz);
      P.teleport(hit.point.clone(), alongX ? -Math.PI / 2 : Math.PI);
      k.hold('KeyW'); k.hold('ShiftLeft'); k.adv(0.35); k.release('ShiftLeft'); k.release('KeyW');
      const p = P.position.clone();
      const fwd = k.V(Math.sin(P.yaw), 0, Math.cos(P.yaw)), side = k.V(fwd.z, 0, -fwd.x);
      const camP = p.clone().addScaledVector(fwd, 2.3).addScaledVector(side, -1.5).add(k.V(0, 0.3, 0));
      const tgt = p.clone().addScaledVector(fwd, -1.2).addScaledVector(side, 0.9).add(k.V(0, 2.6, 0));
      k.cam(camP, tgt, 64);
      k.adv(0.02);
      return `phase 1 fight (calm), player teleported onto house #${b.id} roof (${Math.round(cx)}, ${Math.round(hit.point.y)}, ${Math.round(cz)}) and running (W+Shift, 0.35 s), HUD on, debug camera low on the roof ahead of him`;
    },
  },
  {
    n: 6, ref: 'ref-06-afternoon-swing-town.png', query: 'skip=1', hud: true,
    desc: 'Soldier mid-swing on two taut cables high over the town and its spires, near-level camera close on him, phase 3 afternoon pink mood, HUD on.',
    setup: () => {
      const c = __ctx, k = __cap, C = c.colossal, P = c.player, T = c.THREE;
      P.noPointerLock = true;
      k.adv(2); C.setPhaseDebug(3); k.adv(6); c.sky.setMood('afternoon', 0);
      const sp = c.world.buildings.find((b) => b.kind === 'church');
      const top = sp ? k.V(sp.center.x, sp.box.max.y - 3, sp.center.z) : k.V(38, 52, 42);
      P.teleport(k.V(-12, 44, 98), 2.2);
      P.debugHook('L', top.clone().add(k.V(-0.8, 0, 0.8)));
      P.debugHook('R', top.clone().add(k.V(0.8, -1.5, -0.8)));
      P.velocity.set(-10, -4, -14);
      k.adv(0.35);
      const p = P.position.clone().add(k.V(0, 1, 0));
      const a = top.clone().sub(p).setY(0).normalize();
      const s = k.V(-a.z, 0, a.x);
      const look = a.clone().multiplyScalar(1.2).addScaledVector(s, -2.6).normalize();
      if (a.dot(new T.Vector3().crossVectors(look, k.V(0, 1, 0))) < 0) s.negate();   // cables run off to the right
      const camP = p.clone().addScaledVector(a, -1.2).addScaledVector(s, 2.6).add(k.V(0, -0.5, 0));
      const tgt = p.clone().addScaledVector(a, 0.9).add(k.V(0, -0.45, 0));
      k.cam(camP, tgt, 55);
      k.adv(0.02);
      return 'phase 3 fight (setPhaseDebug(3)), player mid-swing on both hooks (debugHook) anchored to the plaza church spire, HUD on, debug camera ~3 m off his side';
    },
  },
];

function readManifestRows(file) {
  const rows = {};
  if (!fs.existsSync(file)) return rows;
  const txt = fs.readFileSync(file, 'utf8');
  for (const m of txt.matchAll(/<!-- still-(\d\d) -->\n([\s\S]*?)<!-- \/still-\1 -->/g)) rows[m[1]] = m[2];
  const w = /<!-- walkthrough -->\n([\s\S]*?)<!-- \/walkthrough -->/.exec(txt);
  if (w) rows.walk = w[1];
  return rows;
}
function writeManifest(rows) {
  const file = path.join(OUT, 'stills', 'MANIFEST.md');
  const parts = [`# Capture manifest

Generated by \`tools/capture.mjs\` from the running dev build (\`${BASE}\`), headless Chromium + SwiftShader (software WebGL2),
\`?shot=1&freeze=1&q=high\`, seeded Math.random. Every image is a single live screenshot of the game page (WebGL canvas + DOM HUD);
nothing is composited, retouched or cropped. Refs are never loaded into the game.

Still procedure: fresh page per still -> pose the state through ctx APIs -> pin/keep the camera -> wait 2.5 s wall-clock, then
\`sky.renderClouds(camera)\` x24 (converges the half-res temporally accumulated cloud history for that exact camera) + one full
render -> \`document.getAnimations().finish()\` (HUD fades/banners at their end state) -> screenshot. Note: the cloud history
blends at 0.82 per frame (~5-6 effective samples), so residual cloud dither is the steady state of the current build, not a
convergence shortfall of the capture.
`];
  for (let i = 1; i <= 6; i++) { const k = String(i).padStart(2, '0'); if (rows[k]) parts.push(`<!-- still-${k} -->\n${rows[k]}<!-- /still-${k} -->`); }
  if (rows.walk) parts.push(`<!-- walkthrough -->\n${rows.walk}<!-- /walkthrough -->`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, parts.join('\n\n') + '\n');
}

async function captureStills() {
  const pick = args.stills ? String(args.stills).split(',').map(Number) : [1, 2, 3, 4, 5, 6];
  const dir = path.join(OUT, 'stills'); fs.mkdirSync(dir, { recursive: true });
  const mf = path.join(dir, 'MANIFEST.md');
  const rows = readManifestRows(mf);
  const t0 = Date.now();
  for (const s of STILLS.filter((s) => pick.includes(s.n))) {
    const k = String(s.n).padStart(2, '0'), file = path.join(dir, `still-${k}.png`);
    log(`still-${k}: loading`);
    const ts = Date.now();
    const { page, errors, url } = await openGame(s.query, STILL_W, STILL_H);
    let scene = '', setupErr = null;
    try { scene = await page.evaluate(s.setup); } catch (e) { setupErr = e.message.split('\n')[0]; log(`still-${k}: setup error ${setupErr}`); }
    // DOM HUD transitions/banners run on wall-clock time: let any pending ones start, then jump them to their end state;
    // converge the temporally accumulated clouds for the pinned camera (cloud pass x24 + one full render)
    await page.waitForTimeout(2500);
    await page.evaluate(() => { window.__cap.settle(24); window.__cap.finish(); });
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => ({ cam: window.__cap.camInfo(), st: window.__cap.state() }));
    await page.screenshot({ path: file, timeout: 300000 });
    const iso = new Date().toISOString();
    await page.close();
    touchSlot();
    const st = info.st;
    const wp = st.weakPoints.map((w) => `${w.name}${w.active ? '*' : ''}=${w.hp}`).join(' ');
    rows[k] = `## still-${k}.png  ↔  refs-locked/${s.ref}

- file: \`artifacts/stills/still-${k}.png\`
- build: \`${COMMIT}\`
- resolution: ${STILL_W}x${STILL_H} (renderer pixel ratio 1, native)
- captured: ${iso} (wall time ${((Date.now() - ts) / 1000).toFixed(0)} s)
- matched ref: \`refs-locked/${s.ref}\`
- intent: ${s.desc}
- scene/state: ${scene || '(setup failed)'}; url \`${url.replace(BASE, '')}\`; seed ${SEED}
  - mode=${st.mode}, phase=${st.phase}, boss=${st.bossState}${st.steaming ? ' (steaming)' : ''}, boss hp=${(st.bossHp ?? 0).toFixed(2)}, mood=${st.mood}, HUD ${st.hudVisible && s.hud ? 'on' : 'off'}, game clock ${st.clock} s
  - boss root ${JSON.stringify(r3(st.bossRoot))}, head ${JSON.stringify(r3(st.bossHead))}; weak points (*=active): ${wp}
  - player ${JSON.stringify(r3(st.player.pos))} state=${st.player.state}, hooks ${st.player.hooks.join(', ')}, lock-on=${st.player.lock || 'none'}
- camera: owner=${info.cam.owner}, position ${JSON.stringify(r3(info.cam.pos))}, target ${JSON.stringify(r3(info.cam.target))}, vfov ${info.cam.fov.toFixed(1)}°
- console errors: ${errors.length + (setupErr ? 1 : 0)}${setupErr ? ` (setup: ${setupErr})` : ''}${errors.length ? '\n' + errors.slice(0, 6).map((e) => `  - \`${e.slice(0, 200)}\``).join('\n') : ''}
`;
    writeManifest(rows);
    log(`still-${k}: wrote ${path.relative(ROOT, file)} (${((Date.now() - ts) / 1000).toFixed(0)} s, ${errors.length} console errors)`);
  }
  return (Date.now() - t0) / 1000;
}

// ------------------------------------------------------------------ walkthrough
// Script: title -> intro beats -> phase 1 fight (real lock-on, hooks, gas, slashes on a hand) -> phase change to II
// (cinematic + golden) -> phase III (cinematic + afternoon) -> nape cut -> kill cam -> victory screen.
// Every step is game time at FPS; jumps between intro beats are advanced without frames and noted in the MANIFEST.
async function captureWalkthrough() {
  const t0 = Date.now();
  const raw = path.join(OUT, '.walk-raw'); fs.rmSync(raw, { recursive: true, force: true }); fs.mkdirSync(raw, { recursive: true });
  const framesDir = path.join(OUT, 'walkthrough-frames'); fs.mkdirSync(framesDir, { recursive: true });
  for (const f of fs.readdirSync(framesDir)) if (/^frame-\d+\.png$/.test(f)) fs.rmSync(path.join(framesDir, f));
  log('walkthrough: loading title');
  const { page, errors, url } = await openGame('', WALK_W, WALK_H);
  const dt = 1 / FPS;
  let n = 0;
  const beats = [];   // [frameIndex, label]
  const jumps = [];
  const beat = (label) => { beats.push([n, label]); log(`walkthrough: frame ${n} — ${label}`); };
  const frame = async () => {
    const p = path.join(raw, `f${String(n).padStart(5, '0')}.jpg`);
    await page.screenshot({ path: p, type: 'jpeg', quality: 92, timeout: 300000 });
    n++; if (n % 20 === 0) { touchSlot(); }
  };
  const ev = (fn, a) => page.evaluate(fn, a);
  // run `secs` of game time at FPS, calling `tick(i)` (in page) before each step
  const run = async (secs, tick) => {
    const steps = Math.round(secs * FPS);
    for (let i = 0; i < steps; i++) {
      if (tick) await ev(tick, i);
      await ev((d) => window.__game.advance(d), dt);
      await frame();
    }
  };
  const skipTime = async (secs, label) => { jumps.push(`${label}: ${secs}s skipped at frame ${n}`); await ev((s) => { for (let t = 0; t < s; t += 0.5) window.__game.advance(Math.min(0.5, s - t)); }, secs); };

  // 1. title
  beat('title screen');
  await run(2.5);
  // 2. begin -> intro (the begin fade runs on wall-clock time)
  await ev(() => window.__ctx.events.emit('ui:begin'));
  await page.waitForTimeout(1300);
  beat('intro: calm crane over the town');
  await run(2.5);
  await skipTime(7.7, 'intro');
  beat('intro: lightning strike at the wall');
  await run(3);
  await skipTime(3.6, 'intro');
  beat('intro: reveal — hand on the wall, head rises');
  await run(4);
  await skipTime(12.6, 'intro');
  beat('intro: kick / breach');
  await run(4.5);
  // 3. skip the rest of the intro -> fight
  await ev(() => window.__ctx.intro.skip());
  await page.waitForTimeout(1500);
  await ev(() => window.__game.advance(0.1));
  beat('fight phase I: hand-off, Bring Down the Titan');
  await run(2);
  // 4. phase I: real input on a hand. Fly off a wall-adjacent spot toward the boss, lock on, hooks, gas, slash.
  await ev(() => {
    const c = __ctx, P = c.player, C = c.colossal, k = __cap;
    P.noPointerLock = true;
    const h = C.headPosition.clone();
    const pp = k.V(h.x - 30, 40, 340);
    P.teleport(pp, Math.atan2(h.x - pp.x, h.z - pp.z)); P.pitch = 0.25;
    C.brain.S.cool = Math.max(C.brain.S.cool, 6);   // a breath before its first swat
  });
  beat('fight phase I: lock-on + hooks onto the boss');
  await ev(() => { __cap.tap('Tab'); });
  await run(0.4);
  await ev(() => { __cap.tap('KeyQ'); __cap.tap('KeyE'); __cap.hold('Space'); });
  // reel in with gas; slash whenever the lock target is close
  const attack = async (secs) => {
    await run(secs, () => {
      const P = __ctx.player, t = P.lockTarget;
      if (!t || t.active === false) { __cap.tap('Tab'); return; }
      const d = t.position.distanceTo(P.position);
      if (d < 9 && !P.slashing) __cap.tap('KeyF');
      // re-fire hooks if both dropped
      if (!P.hooks[0].attached && !P.hooks[1].attached && P.hooks[0].state === 'idle') { __cap.tap('KeyQ'); __cap.tap('KeyE'); }
    });
  };
  await attack(8);
  await ev(() => { __cap.release('Space'); });
  beat('fight phase I: swinging / slashing');
  await attack(3);
  const wpAfter = await ev(() => __ctx.colossal.weakPoints.map((w) => `${w.name}=${(w.hp ?? 1).toFixed(2)}`).join(' '));
  log('walkthrough: weak points after phase I attack: ' + wpAfter);
  // 5. phase change II (both hands treated as severed)
  await ev(() => { __cap.release('Space'); __cap.tap('KeyQ'); __cap.tap('KeyE'); __ctx.colossal.setPhaseDebug(2); });
  beat('phase change -> II (cinematic, golden mood)');
  await run(5);
  await ev(() => {
    const c = __ctx, P = c.player, C = c.colossal, k = __cap, r = C.object.position;
    const pp = k.V(r.x - 40, 30, r.z - 60);
    P.teleport(pp, Math.atan2(r.x - pp.x, r.z - pp.z)); P.pitch = 0.15;
    __cap.tap('Tab');
  });
  beat('fight phase II: lock on ankles, hooks');
  await ev(() => { __cap.tap('KeyQ'); __cap.tap('KeyE'); __cap.hold('Space'); });
  await attack(4);
  await ev(() => { __cap.release('Space'); __cap.tap('KeyQ'); __cap.tap('KeyE'); });
  // 6. phase III
  await ev(() => __ctx.colossal.setPhaseDebug(3));
  beat('phase change -> III (cinematic, afternoon mood)');
  await run(4);
  // 7. nape: approach from behind, slash; if the nape window is shut (steam), cut it through the same trySlash path
  await ev(() => {
    const c = __ctx, P = c.player, C = c.colossal, k = __cap, np = C.nape.position.clone();
    const back = k.V(Math.sin(C.object.rotation.y), 0, Math.cos(C.object.rotation.y)).multiplyScalar(-1);
    const pp = np.clone().addScaledVector(back, 22).add(k.V(0, 6, 0));
    P.teleport(pp, Math.atan2(np.x - pp.x, np.z - pp.z)); P.pitch = -0.2;
    C.brain.S.steaming = false;
    __cap.tap('Tab');
  });
  beat('fight phase III: dive on the nape');
  await ev(() => { __cap.tap('KeyQ'); __cap.tap('KeyE'); __cap.hold('Space'); });
  let killed = false;
  for (let i = 0; i < 4 * FPS && !killed; i++) {
    await ev(() => {
      const P = __ctx.player, C = __ctx.colossal, np = C.nape.position;
      if (np.distanceTo(P.position) < 10 && !P.slashing) __cap.tap('KeyF');
    });
    await ev((d) => window.__game.advance(d), dt);
    await frame();
    killed = await ev(() => __ctx.colossal.state === 'dying' || __ctx.colossal.state === 'dead');
  }
  let forcedKill = false;
  if (!killed) {
    forcedKill = true;
    await ev(() => {
      const C = __ctx.colossal, w = C.weakPoints.find((x) => x.name === 'nape');
      w.hp = 0.01; w.active = true;
      C.trySlash(w.position.clone(), new __ctx.THREE.Vector3(0, -10, 40), 3);
    });
  }
  await ev(() => { __cap.release('Space'); });
  beat(`nape cut (${forcedKill ? 'trySlash at the nape' : 'player slash'}) -> kill cam`);
  await run(12.5);
  // 8. victory screen (DOM; give its entrance animation wall-clock time)
  await page.waitForTimeout(2500);
  beat('victory screen');
  await run(3);
  const endState = await ev(() => __cap.state());
  await page.close();
  touchSlot();
  releaseSlot(); await browser?.close(); browser = null;

  // video + sampled frames
  const mp4 = path.join(OUT, 'walkthrough.mp4');
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(raw, 'f%05d.jpg'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
  if (ff.status !== 0) log('ffmpeg mp4 failed: ' + ff.stderr);
  const picks = Array.from({ length: NFRAMES }, (_, i) => Math.round((i + 0.5) * n / NFRAMES));
  const sampled = [];
  for (const [i, f] of picks.entries()) {
    const src = path.join(raw, `f${String(f).padStart(5, '0')}.jpg`), dst = path.join(framesDir, `frame-${String(i + 1).padStart(2, '0')}.png`);
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, dst]);
    sampled.push([i + 1, f]);
  }
  if (!args.keep) fs.rmSync(raw, { recursive: true, force: true });
  const secs = n / FPS;
  const beatAt = (f) => { let l = ''; for (const [bf, lab] of beats) if (bf <= f) l = lab; return l; };
  const rows = readManifestRows(path.join(OUT, 'stills', 'MANIFEST.md'));
  rows.walk = `## walkthrough

- video: \`artifacts/walkthrough.mp4\` — ${n} frames @ ${FPS} fps = ${secs.toFixed(1)} s of game time (1 frame per ${(1 / FPS).toFixed(3)} s of sim; H.264 CRF 18)
- frames: \`artifacts/walkthrough-frames/frame-01..${String(NFRAMES).padStart(2, '0')}.png\` (${NFRAMES} evenly spaced, converted losslessly from the JPEG-q92 capture sequence)
- build: \`${COMMIT}\`; resolution ${WALK_W}x${WALK_H}; url \`${url.replace(BASE, '')}\`; seed ${SEED}; captured ${new Date().toISOString()} (wall time ${((Date.now() - t0) / 60000).toFixed(1)} min)
- script beats (frame index — beat):
${beats.map(([f, l]) => `  - ${f} — ${l}`).join('\n')}
- intro time skipped between beats (no frames captured): ${jumps.join('; ') || 'none'}; rest of the intro skipped via ctx.intro.skip()
- phase changes driven by colossal.setPhaseDebug(2/3) (real phase events, cinematics and mood changes); weak points after the phase I attack: ${wpAfter}
- kill: ${forcedKill ? 'nape window closed during the dive, so the cut went through colossal.trySlash at the nape position (same kill path)' : 'player slash on the nape'}
- end state: mode=${endState.mode}, boss=${endState.bossState}, mood=${endState.mood}
- note: DOM HUD animations (banners, toasts, fades) run on wall-clock time while the sim runs on fixed game time, so they last fewer frames than in real play
- sampled frames: ${sampled.map(([i, f]) => `frame-${String(i).padStart(2, '0')}=#${f} (${(f / FPS).toFixed(1)} s, ${beatAt(f)})`).join('; ')}
- console errors: ${errors.length}${errors.length ? '\n' + errors.slice(0, 8).map((e) => `  - \`${e.slice(0, 200)}\``).join('\n') : ''}
`;
  writeManifest(rows);
  log(`walkthrough: ${n} frames, ${secs.toFixed(1)} s @ ${FPS} fps, ${errors.length} console errors`);
  return (Date.now() - t0) / 1000;
}

// ------------------------------------------------------------------ main
const times = {};
try {
  if (ONLY === 'all' || ONLY === 'stills') times.stills = await captureStills();
  if (ONLY === 'all' || ONLY === 'walk') times.walk = await captureWalkthrough();
} finally {
  await browser?.close().catch(() => {});
  releaseSlot();
}
log(`done: ${Object.entries(times).map(([k, v]) => `${k} ${(v / 60).toFixed(1)} min`).join(', ')} · build ${COMMIT}`);
