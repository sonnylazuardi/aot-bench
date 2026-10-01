# Builder notes / cross-system requests

Append under your builder name. Lead reads this.


## TITANS (pure titans, civilians, intro + fight cinematics)
- ctx.titans.civilians: list, nearest(pos,maxDist), pickUp(civ, handObj) [emits 'civilian:grabbed'], eaten(civ) [emits 'civilian:eaten'],
  release(civ) (drops it), crush(pos, r), spawnCrowd(count, {center, radius}|{min,max}, {state:'flee'|'calm', roofFrac}), look(pos, secs), panic().
- REQUEST → COLOSSAL: for the intro horror beat I call `ctx.colossal.eat?.(civ)` if it exists (reach down to civ.position, call
  ctx.titans.civilians.pickUp(civ, handObj), lift to the mouth, bite at ~2.5 s calling civilians.eaten(civ)). Also nice: `chew()`
  (a few jaw open/close cycles) and `lookAt(target|null)` (already there). Until eat() exists the intro fakes the lift with a proxy
  hand and cuts away at the bite. I listen for 'colossal:grip' {point} and 'colossal:kick' {point} during the intro for fx/shake,
  and I call ctx.world.breach() on the kick if the colossal didn't.
- intro.playFight('phase2'|'phase3'|'kill') auto-plays on 'colossal:phase' {phase:2|3} and 'colossal:killed'; the kill cam emits
  'victory:cinematic-done' when finished (director: go to victory then). During these cameraOwner='intro' temporarily.

## PLAYER
- `ctx.player.position` = FEET (world, live Vector3). `ctx.player.center` = body centre (~0.92 m above the feet) — use it for grabs / hits / aim.
- `ctx.player.grab(titan, hand)` returns `false` when refused (invulnerable after a cut-free / dead / already grabbed). While grabbed the player follows `hand.getWorldPosition` and mashes F; on success player.state leaves `'grabbed'` and I call `titan.releaseGrab?.()` and `ctx.titans.releaseGrab?.(titan)` if present — TITANS/COLOSSAL: please stop holding when `ctx.player.state !== 'grabbed'`. After 2.5 s the player calls `kill('eaten')` itself.
- HUD reads: `player.gas`, `player.blades {count, durability}`, `player.hp`, `player.hooks[i].{state,attached,point}`, `player.aimHit {valid, point, distance, inRange, titan, kind}` (crosshair hint), `player.lockTarget {name, position, radius}` (lock marker; weak point object or `{name:'nape', titan, position}`), `player.speed`, `player.boosting`, `player.reeling`, `player.slashing`, `player.grabProgress` (0..1 while grabbed).
- RENDER (optional): I call `ctx.post.setSpeed?.(k 0..1)` every frame from the camera — speed lines / radial blur / motion blur strength. Also `setSlowmo`, `punch`, `flash` on nape kills.
- COLOSSAL: I use `weakPoints` (lock-on), `velocityAt(point,out)` (hooked player is dragged with the body), `steamForceAt(pos,out)` (acceleration every frame), `trySlash(pos, vel, 3)` (called BEFORE titans.trySlash; `{part, killed}`; part in hand_L/hand_R/ankle_L/ankle_R/nape gets the full hit-stop). Raycast hits with `anchor`+`local` are followed every frame; reeling to within 2.4 m of a moving body makes the soldier CLING to it (feet on the flesh, moves with it) — no collider needed.
- Emits: `hook:fire {side}`, `hook:attach {side, hit}`, `player:slash {position}`, `player:kill {titan, boss}`, `player:hurt {amount,hp,fromDir}`, `player:grabbed {titan}`, `player:died {cause}`.
- Debug: `?ptest=1` adds a street of test boxes (raycaster/collider 'ptest') near the player start.

## AUDIO+UI (hud / director)
- DIRECTOR emits `ui:*` events internally; flow per CONTRACT. It reads `ctx.colossal.{state,fighting,phase,hp,weakPoints,steaming,object,headPosition}`,
  calls `ctx.colossal.titlePose?.()` on the title screen (COLOSSAL: optional quiet pose for the title backdrop — e.g. only head/shoulders
  visible behind the wall, NO events/sounds), `appear()`+`startFight()` on skip=1, and listens for `colossal:killed` → waits for
  `victory:cinematic-done` (fallback 6 s if the camera stays with the player).
- HUD reads `ctx.player.{aimHit.valid/inRange/titan/distance, hooks, gas, blades, hp, velocity, state, grabProgress, lockTarget}`.
  Optional: `ctx.player.gasL/gasR` for independent canister gauges.
- Civilians: director calls `ctx.titans.civilians.spawnCrowd(60, {center, radius})` at fight start; HUD counts `civilian:eaten` + dead in `civilians.list`.
- Resupply points: `ctx.director.resupplies` = [{position, label}] (church roof via raycast on the church footprint; wall walkway at x=-62).
  WORLD: if you can, expose `ctx.world.church.roof` (Vector3 on a flat-ish roof) and/or `ctx.world.wallResupplyPoint`.
- AUDIO (handed off): note the offline sound rendering runs on the main thread between awaits at load (~10 s in headless swiftshader,
  showed up as a 14 s 'hud' load time) — consider yielding with setTimeout/requestIdleCallback between sounds or deferring until unlock().

## INTEGRATOR (main.js, core, tools, build)
- 18:25 Load pipeline (src/main.js): all modules imported in parallel; optional `export function prewarm(ctx)` per module is called
  right after import (start workers/fetches there, await in create()); titans+colossal create() run concurrently with world/audio;
  per-system create() timeout (45 s, `?loadTimeout=`; shot mode 240 s) → stub, late arrivals swapped in; loading screen with
  progress (src/core/loader.js); compileAsync skipped in shot mode, time-boxed 20 s otherwise; `?nocompile=1`.
  `window.__game.loadTimes` = per-system {start,end,ms,status}. PCFSoftShadowMap → PCFShadowMap (removed in r18x).
- Bake cache (tools/bake/plugin.mjs + src/core/bake.js): `await fetchBaked(system, args)` returns the cached result of a pure
  builder (colossal: buildPartArrays(name,q); titans: buildTemplate(name,opts)), keyed by a hash of the builder's source closure.
  Miss → 204 + background (niced) bake, next load instant. `npm run build` ships them. `?nobake=1` disables.
- Perf: `?perf=1` overlay; `window.__game.perf({breakdown:true})` (per-draw-call attribution main/shadow/post + scene census);
  shot.mjs `--perf`, `--print "expr"`, `--noshot`, `--timeout s`; HMR websocket stubbed in shots (`--hmr` to allow);
  AOT_VERBOSE=2 streams all console lines. Budgets (RTX 3060 laptop, 1080p, 60 fps) in src/core/perf.js BUDGET:
  <1500 draw calls (all passes, shadow <600), <4 M tris, <4 ms JS/frame (<1.5 ms per system), GPU <12 ms, <90 programs.

## RENDER (sky / post / fx)
- Sky: `ctx.sky.sun` is a three r186 **SunLight** (2 cascaded shadow maps fitted to the camera; has `.color/.intensity/.shadow`, a dummy `.target`). `ctx.sky.sunDir`, `sunColor`, `wind` (m/s), `uniforms` (shared live fog/sky uniforms), `glsl` (GLSL: `aotApplyFog(col, cameraPosition, worldPos)` for custom ShaderMaterials), `patchMaterial(mat)`, `setMood('golden'|'smoke'|'dusk'|'inferno', secs)`, `strike()` (in-cloud lightning now), `embers` (0..1). Every built-in material with `fog:true` gets the height fog automatically (fog chunks patched). Moods: 'golden' at start → 'inferno' over 20 s on `wall:breached` (or 8 s on `fight:start`). `?mood=inferno` URL param forces a mood. Emits `sky:lightning {position, distance}` and plays `thunder` via ctx.audio.
- COLOSSAL: for the glowing green eyes to bloom, give them HDR emission ≥ ~8 (e.g. MeshBasicMaterial color (0.3,1,0.45) * 10, or emissive + emissiveIntensity 10). Bloom threshold is ~1.1 scene units so the sky / sunlit skin do not bloom.
- FX extras beyond CONTRACT: `fx.steamJet(pos, dir, size=20, duration=2)` (vent), `fx.eruption(pos, size=30)` (hurt/kill steam burst), `fx.roar(pos, size=60, {dir})` (screen shockwave + dust ring + breath), `fx.stomp(pos, size=40)` (dust billow + ring + rubble + shake), `fx.embers(k)` (boost ember field), `fx.clear()`. Steam handles: mutate `handle.position` each frame to follow a bone. Sizes are metres (giant steam 20–40).
- POST extras: `post.setSpeed(k)`, `post.shockwave(worldPos, k)`, `post.flash(k, color?)`, `post.settings.{exposure, bloom, vignette, grain, shafts}`.

## COLOSSAL (giant boss) — src/story/colossal*.js
- ctx.colossal = smiling pure titan boss, ~70 m (model 1.8 m human x K=38; LAYOUT.colossal.height/60 scales it). Feet stand at z = wall outer face + 17 (not 440) so it can lean over and grip the parapet.
- API beyond the contract: `show()` (skip straight to the wall pose), `hide()`, `lookAt(Vector3|null)` (gaze override), `eat(civ, hand)` (grab + bite a civilian now), `chew()`, `setPhaseDebug(1|2|3)`, `releaseGrab()` (player calls it when cutting free), `position` (group position), `brain.S` (internal state).
- Extra events: `colossal:grip {point, hand}` (hand slams onto the parapet during appear()), `colossal:hurt {part, hp}` (weak point hit).
- Debug URL: `?cpose=wall|appear|kick|fight|p2|p3` shows it without the intro; `&cbind=1` bind pose.
- Geometry is sculpted in 5 parallel workers (colossalWorker.js), uses the integrator bake cache first, IDB cache in prod.

## WORLD
- ctx.world extras: `surfaceHeight(x,z,yMax?)` (top of buildings/wall/ground), `wallWalkway(angle,out?)` (Vector3 on the walkway, y = current wall top, honours bites), `supplyPoints` [garrison depot at (18,0,340), walkway west of the gate], `landmarks.church` / `landmarks.bellTower` (spire tops; bell tower is the onion-dome church just inside the outer gate at ~(-52,306)), `plan` (streets/lots), `buildings[i].{kind,lot,eaveY,ridgeY,destroyed}`.
- damage(point, radius, force): houses collapse (GPU state texel, ~0.7 ms/call), wall rim (y>36 m, ±100 m of arc around the outer gate) gets bitten, after breach() hits near the hole widen it; falling wall chunks go through ctx.fx.projectile (fallback timer if onImpact never fires). Emits 'building:collapse' {building, position} and 'wall:breached' {position}.
- raycast hit kinds: ground | building | wall | prop | tree; ~25 µs per ray, ~12 µs per collideSphere. `?breach=1` breaches at load.

## AUDIO (src/audio/** — rewritten)
- Load-time fix: create() returns immediately; sound synthesis starts after 'loaded' (or first unlock), 3 parallel OfflineAudioContext
  workers yielding via requestIdleCallback; per-sound main-thread work is graph build + one normalise pass (control signals/noise are pooled).
  play() on a not-yet-rendered sound silently skips; loop() handles start as soon as their buffer lands.
- Generic calls are auto-upgraded near the boss (ctx.colossal.active): titan_roar→giant_roar, titan_groan→giant_groan (rate≥1.1→giant_hurt),
  titan_step→giant_step, crunch at the mouth→giant_bite (scream bitten off + bone crunch), steam at the body→steam_jet, gas rate<0.6 far
  from the player→whoosh, grab at its hand→giant_grab, wall_break (vol<1.2, wall top / repeat within 8 s)→wall_crush. Same-sound calls
  within 60 ms / 10 m are de-duplicated, so emitting an event AND calling play() is safe.
- Extras: play('hook_hit', {surface:'stone'|'wood'|'flesh'}) (auto from the last hook:attach hit.kind), 'body_hit', 'giant_giggle',
  'giant_breath', 'giant_fall', 'cannon', 'impact'. ctx.audio.heroic(n) (horn call, used on colossal:hurt), shellshock(k, secs).
  loop('wind') returns a no-op handle: wind is engine-driven from ctx.player.velocity. The winch loop follows ctx.player.reeling.
- Listens to: hook:*, player:*, colossal:appear/kick/grip/attack/hurt/phase/killed, wall:breached, building:collapse,
  civilian:grabbed/eaten, titan:killed, fight:start. Music states: title calm dread breach combat boss2 boss3 death victory
  (bar-quantised transitions with risers, BRAAM + impact on escalation).
- 18:58 Health: `/` → Begin → intro → play → phase2/3 cinematics → kill cam → victory runs with 0 errors (headless, sim-advanced).
  Load (headless, contended): ready at 5–21 s, down from 89 s (bake cache + concurrency). Draw calls at 1280×720, q=high:
  player start 269 calls / 1.68 M tris (shadow 142 / 1.15 M); across town 408 / 2.43 M; over town 317 / 2.03 M. Programs 68.
  Biggest items: colossal shadow 442 k tris (2 cascades × 221 k), civilians shadow 254 k, town shadow up to 490 k.
  Per-system JS (headless, inflated ~2–4×): fx 4.5 ms, world 2.9 ms (spikes 58 ms), player 1.8, titans 1.8, hud 0.9, colossal 0.8.
- 19:10 Load (headless) ready at 3.5 s: sky 1.1 s, world 0.5 s (time-sliced jobs continue in play), titans/colossal 1.0 s concurrent
  (bake hits), player 0.06 s, hud 0.2 s. Gameplay JS hotspots sent to owners: fx.stepPool 3.1 ms/step headless (RENDER), cloak.step
  1.6 ms (PLAYER, fixed), world.pileHeight 0.9 ms (WORLD), radar buildStatic/getBoundingClientRect (UI, fixed).
  tools/health.mjs (quick: skip=1 + title→Begin→intro; --full: whole flow to victory) runs every 10 min.
  NOTE for everyone: editing vite.config.js or tools/bake/* restarts the dev server; src/main.js edits full-reload open pages.
- TITANS → COLOSSAL (critic r2): the intro reveal (appear() + ~0–12 s) whites out with steam. I cut my own steam there to 3 short
  plumes behind the wall. Please cap the colossal's appear-vapor density / keep it behind the wall and below the head, so the head
  and grin rise in clear air against the sky.
- 19:35 Stable build for playing: http://127.0.0.1:4173 (NOT 4190: browser-blocked port) (`node tools/publish.mjs [ref]` = clean git export → dist/ → preview restart;
  dist/SNAPSHOT.txt has the hash). Published 2cb928b, healthy. Intro views measured 8.4–9.8 M tris: WORLD "props flowers0..3"
  instanced flowers = 2.2 M main + 4.7 M shadow → asked WORLD for castShadow=false, ≤24 tris/flower, chunked instancing.
  'fight:start' was never emitted (sky inferno + colossal listen) → DIRECTOR now emits it.
- 19:45 Published 4bfef8b on :4173. Intro 1.7 M tris after WORLD flower fix. Gameplay profile (600 steps): fx 1.3 s (stepPool 0.84),
  three matrix updates 1.1 s, civilians 0.26, titans 0.19, world 0.13, radar 0.1, cloak 0.06 → ~4.5 ms/step headless total.
- RENDER (fog): hero materials can opt out of part of the aerial fog with a define — `material.defines = { ...material.defines, AOT_FOG_K: 0.4 }; material.needsUpdate = true` (0 = no fog, 1 = full). Suggested: COLOSSAL body/skin 0.4, WORLD wall 0.6. Everything within ~300 m also keeps ≥65% of its own contrast automatically.
- TITANS → COLOSSAL (critic r5): gripEvent's dust(16) at the parapet fogs the telephoto reveal shots (camera→head line passes ~6 m
  above the parapet). If possible spawn that dust ≥12 m below the parapet on the outer face (z > W.radius+14) and keep debris only
  at the top. (The intro now also clears fx at the over-the-shoulder shot, so it's not blocking.)
- 20:40 tools/watch.sh (integrator, running): every ~10–15 min health check (priority shot slot) → if OK and HEAD moved, publish HEAD
  to :4173. Load regression found: hud create 2.2–4.2 s = ui/screens.js grainURL per-pixel noise (sent to UI). perf.js now reports
  GPU uploads/frame (tex/buffer MB; overlay line) — steady state ≈0.5 MB/frame, one 40 MB texture burst when world jobs finish.
- 20:50 PAUSED by lead (user reviewing): watch.sh stopped, :4173 frozen on 331a67f. Resume with
  `setsid nohup tools/watch.sh /tmp/claude-1000/aot-watch.log >/dev/null 2>&1 &` (health every ~12 min, auto-publish HEAD).
  Open asks: UI grainURL (hud create 2.2–4.2 s), COLOSSAL shadow proxy (442 k shadow tris), TITANS civilians CPU/shadows,
  RENDER fx far-particle skipping, WORLD one-time 40 MB texture burst at job end.
- 20:58 UI fixed the HUD load regression (hud create 15 ms). WORLD TDZ bug in shot mode (terrain field job reads `const TF`
  before init because the ?shot drain/await at world/index.js:152 runs before :186) → sent to WORLD. Real browser unaffected.
- COLOSSAL: the giant casts shadows only from coarse proxy meshes (~17k tris, layer 0, colorWrite/depthWrite off, eroded to sit inside the skin); the hi-res giant has castShadow=false. No layer setup needed.
- 21:25 Resumed watch.sh (health → auto-commit if dirty → publish HEAD to :4173). Colossal shadow proxies on layer 1 don't render:
  SunLight cascades use shadow.getCamera(i) for the layer test, not shadow.camera → fix sent to COLOSSAL (+ RENDER note).
  21:15 feedback leftovers: damage.js:115 house collapse (WORLD, callers listed), unused 'fire' synth (AUDIO), inferno presets (RENDER).
- 21:20 CORRECTION (three r186): WebGLShadowMap tests caster layers against the MAIN view camera (renderObject :519-522), not the
  shadow/cascade cameras → shadow-only proxies must be on layer 0 with colorWrite:false/depthWrite:false. Giant had no shadow in
  2a4f746; fix sent to COLOSSAL. health.mjs now WARNs when shadow:colossal has 0 draws.
