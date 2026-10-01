# Attack on Titan — The Fall of Shiganshina · Engine contract

## ⚠ SCOPE CHANGE (user direction, 17:25): ONE hero scene — a GIANT boss fight at the breached wall.
THE ENEMY GIANT IS A SMILING PURE TITAN (user direction 17:35, supersedes the Attack Titan look). Character refs (Read them):
`ref/enemy_face_front.png`, `ref/enemy_face_grin_town.png` (THE face): straight shoulder-length brown hair parted in the middle,
an enormous wide grin showing rows of flat human teeth, squinting crescent eyes with crow's-feet, deep nasolabial folds and lined
cheeks, a big nose, a soft skin-covered body (pale peach to tan, slightly soft chest, mild muscle), sexless. It EATS NORMAL HUMANS:
it grabs fleeing townspeople from streets/rooftops and bites them (and the player, if caught). `ref/enemy_weakpoint_hud.png` is the
weak-point HUD reference (yellow crosshair ring on the nape; red X markers with small green vertical HP bars on limbs).
It is rendered at GIANT scale (~60 m) so it towers over the 50 m wall, grips and smashes it. It lives at ctx.colossal (key kept).
Mood/scene references (Read them): `ref/colossal_wall_poster.png` (hands gripping and breaking the wall top, lightning, embers,
backlit fiery sky), `ref/colossal_face_fire.png` (burning orange smoke sky, soldier with ODM gear in the foreground),
`ref/colossal_fullbody_town.png` (giant standing at the wall beside the church tower and red roofs, steam wafting, soldiers
flying around it on ODM gear). Ignore the skinless-muscle look of those three and ref/attack_titan.png (superseded); take composition, sky, steam, scale, ODM soldiers.
Flow: title → intro (lightning strike, the giant rises over the wall, grips it, smashes/kicks the gate in) → BOSS FIGHT "Bring
down the Titan" (it stays; phases; attacks the player, wrecks the wall and town) → nape kill → victory. Pure titans are
secondary: at most 2–4 small ambient ones for scale. CIVILIANS: fleeing townspeople (ctx.titans.civilians, TITANS builder) that
the giant grabs and eats. Sky mood after the breach: 'inferno' (smoke-choked orange/red, embers,
lightning in the clouds).

## ⚠ USER FEEDBACK (Oct 1) — FINAL BOSS = COLOSSAL TITAN; fix sound; fix shake shimmer
Playtest video: /mnt/c/Users/sonny/Downloads/aot.mp4 (1080p30, 153 s) — extract frames/audio with ffmpeg to see the real issues.
BOSS: replace the Smiling Titan with the COLOSSAL TITAN (`ref/final_boss_colossal.png`): skinless, deep red striated muscle meat
everywhere, white/pale fascia + skin plates on the skull (forehead, brow, cheekbones, around the eye sockets), lipless jaw with a full
exposed row of teeth and cheek muscle strands, deep shadowed eye sockets, bald, massive neck/trapezius cords, heavy steam venting.
HIGH DETAIL on head and body. No grin, no hair, no human eating — its signature attack is scalding STEAM BLASTS. HUD name
"THE COLOSSAL TITAN". ctx.colossal API unchanged.
SOUND: the user says the sound is terrible (measured: −24.7 LUFS integrated, −13.7 dBFS peak, LRA 4.4 → quiet, flat, lifeless).
SHAKE: during camera shake textures look "glitching" (shimmer/aliasing/ghosting) — must be clean.

## ⚠ USER FEEDBACK (21:15) — supersedes the 'inferno' mood and house destruction
SKY/MOOD: NO inferno, minimal fire. The battle happens under an EPIC CLEAR SKY: vivid blue with crisp, sunlit white cumulus
(`ref/sky_blue_day.png`) that WARMS INTO a soft afternoon glow — peach/pink/lavender sky, luminous haze, pastel aerial perspective on
the town and spires (`ref/sky_afternoon_pink.png`) — as the fight progresses (phase 1 blue day → phase 2 golden → phase 3 pink afternoon).
Moods: 'day' → 'golden' → 'afternoon'. At most a few thin smoke/dust wisps at the breach; no burning town, no embers field.
BUILDINGS STAY INTACT: houses never collapse (no crushing by the giant, boulders or damage calls). Only the WALL breaks (the gate breach
+ wall-top bites where the giant grips). world.damage() on houses → dust/debris puff only.

## Run / see it
- Dev server is already running at **http://127.0.0.1:5190** (Vite HMR). Do NOT start another one on 5190.
- Screenshot: `bun tools/shot.mjs --url "/?skip=1" --out shots/<you>/<name>.png [--advance 3] [--wait 1500] [--eval "js"] [--seq 6 --every 0.5]`
  - Prints page console errors. Headless GPU may be software — FPS it prints is NOT real; judge visuals, not fps.
  - `window.__game.advance(seconds)` steps the simulation at fixed 60 Hz then renders once (use it to fast-forward).
  - `window.__game.setCam([x,y,z],[tx,ty,tz])` or URL `?cam=x,y,z,tx,ty,tz` pins a debug camera.
  - `window.__ctx` is the live ctx.
- URL params: `skip=1` straight to gameplay · `intro=1` straight to the breach cinematic · `only=sky,world` load only those systems (others stub) · `q=low|medium|high` · `t=secs` advance after load · `freeze=1` no real-time stepping (only `advance`).
- Check the page never throws: `bun tools/shot.mjs` prints `[pageerror]` / `[error]` lines.

## Ownership (edit ONLY your files; never edit another builder's files or src/main.js / src/core/*)
| System (ctx key) | Files | Builder |
|---|---|---|
| sky, post, fx | `src/render/**` | RENDER |
| world | `src/world/**` | WORLD |
| titans (ambient pure titans, secondary) | `src/titans/**` | TITANS |
| colossal (the boss) | `src/story/colossal*.js`, `sculpt.js`, `muscleMaterial.js`, `vapor.js` and any new `src/story/colossal*` | COLOSSAL (was CINEMATIC) |
| intro + fight cinematics | `src/story/intro.js`, `src/story/cine*.js` | TITANS (now also cinematics) |
| player, cam | `src/player/**` | PLAYER |
| audio | `src/audio/**` | AUDIO+UI |
| hud, director | `src/ui/**`, `src/game/**` | AUDIO+UI |

Each module exports `export async function create(ctx) { ...; return system }`. `src/core/stubs.js` is the minimal API of every
system — your real system must expose at least those members with the same signatures (add more freely).
If your module throws at load, the game silently uses the stub — check the console output of the shot tool.
Call other systems ONLY through `ctx.<system>` at runtime (they may still be stubs while others work — code defensively,
e.g. `ctx.fx.dust?.(...)`). Need something from another system that isn't in the contract? Use it with optional chaining
and append a line to `NOTES.md` under your builder name describing what you need.

## Frame
`ctx.clock` `{time, dt, rawDt, timeScale, frame}`. `update(dt, time, rawDt)` — `dt` is already scaled by `timeScale`
(slow-mo on nape kills sets `ctx.clock.timeScale`). Update order:
director → intro → player → titans → colossal → world → fx → cam → sky → audio → hud, then `ctx.post.render(rawDt)`.
Camera shake is applied by core after all updates: `ctx.shake(amount 0..1.5, {at?:Vector3, radius?:m, duration?:s})`.
`ctx.cameraOwner` = `'title'|'intro'|'player'|'debug'` — only the owner positions `ctx.camera`
(title → director/hud owns the title camera, intro → story/intro.js, player → player/camera.js).
`ctx.mode` = `'loading'|'title'|'intro'|'play'|'dead'|'paused'|'victory'` (director owns transitions).

## Shared geography — `src/core/layout.js` (`ctx.LAYOUT`)
Town disc radius ~360 m at y≈0 centred on origin, circular wall inner radius 380 m, 14 m thick, **50 m tall**.
Outer gate at (0, 0, +380) — the breach. Inner gate at (0,0,-380). Colossal stands at (0, 0, 440). Pure titans spawn
around (0, 0, 470) and walk north through the breach. Player starts at (-22, ground, 120) looking +Z at the outer gate.
Sun is low in the south behind the outer wall (`LAYOUT.sunDir`) → the breach is backlit, silhouettes against a warm sky.

## Physics (`ctx.physics`, core/physics.js)
- `addRaycaster(name, fn)` / `raycast(origin, dir, maxDist, {exclude:[names]}) -> Hit|null`
  Hit = `{point, normal, distance, kind, ref?, anchor?, local?}`. Moving targets (titans) set `anchor` (Object3D) + `local`
  (hit point in anchor space); a hook must re-evaluate `anchor.localToWorld(local.clone())` each frame.
- `addCollider(name, fn(center, radius, outArray))` / `collideSphere(center, radius)` / `resolveSphere(center, radius)`.
- WORLD registers `'world'` (ground, buildings, wall, props). TITANS registers `'titans'` (raycast only, bodies).
  CINEMATIC registers `'colossal'` raycast (you can hook onto the Colossal).

## System APIs (minimum)
**world**: `groundHeight(x,z)`, `damage(point:Vector3, radius, force)` (collapse/damage buildings & wall edges near point,
spawns debris/dust via fx), `breach()` (blow the outer gate open: hole ~40 m wide/≈35 m tall, emits `'wall:breached'`),
`breached`, `buildings` (array of `{box:Box3, center, height, destroyed}`), `wallTopAt(angle)`.
**titans**: `list` (live titans: `{id, object, position, height, alive, state, nape:{position, radius}, velocity}`),
`spawn({position, height?, variant?, target?}) -> titan`, `trySlash(pos, vel, radius) -> {titan, part:'nape'|'limb', killed}|null`,
`nearestNape(pos, maxDist) -> titan|null`, `killAll()`. Titans hunt the player (`ctx.player.position`), crush buildings
through `ctx.world.damage`, grab the player via `ctx.player.grab(titan, handObject3D)`. Footsteps → `ctx.shake(...,{at})`,
`ctx.audio.play('titan_step',{position})`, `ctx.fx.dust`. Death → collapse + evaporating steam (`ctx.fx.steam`).
Emit `'titan:killed' {titan, byPlayer}` and `'titan:spawned'`.
**colossal** (the boss): `appear()`, `kick()`, `vanish()`, `startFight()`, `active`, `state`, `phase` (1..3), `hp` (0..1), `object`,
`headPosition`, `nape:{position, radius}`, `trySlash(pos, vel, radius) -> {part, killed}|null`, `steamForceAt(pos, outVec3) -> outVec3`
(push acceleration m/s² from steam vents; zero when calm), `steaming`. Emits `'colossal:appear'`, `'colossal:kick'`, `'colossal:phase' {phase}`,
`'colossal:attack' {type, point}`, `'colossal:killed'`. Registers raycaster `'colossal'` with anchor+local so hooks stick to its moving body.
`weakPoints: [{name:'hand_L'|'hand_R'|'ankle_L'|'ankle_R'|'nape', position:Vector3, radius, active:boolean, hp:0..1}]` (live positions;
PLAYER lock-on and HUD markers read these). `velocityAt(point, outVec3)` (so a hooked player inherits the body's motion).
Attacks on the player go through `ctx.player.hurt(amount, fromDir)` and `ctx.player.knock(impulseVec3)` (roar shockwave, swats, steam).
**intro**: `start()`, `skip()`, `playing`. Emits `'intro:done'` when control should go to the player.
**player**: `position, velocity, yaw, pitch, object, state('ground'|'air'|'grabbed'|'dead'|'cinematic'), gas 0..1,
blades {count, durability 0..1}, hp 0..1, hooks [{side:'L'|'R', active, attached, point:Vector3}], enabled,
setEnabled(b), teleport(pos, yaw), hurt(amount, fromDir), knock(impulseVec3), grab(titan, hand), kill(), respawn(), refill()`.
Emits `'player:slash'`, `'player:kill' {titan}`, `'player:hurt'`, `'player:died'`, `'hook:fire' {side}`, `'hook:attach' {side,hit}`.
**cam**: owns `ctx.camera` when `cameraOwner==='player'`; `fovKick(amount)`, `getAimRay(outOrigin, outDir)`.
**fx**: `dust(pos, size, opts)`, `debris(pos, count, speed, opts)`, `blood(pos, dir)`, `gasPuff(pos, dir)`, `sparks(pos, dir)`,
`explosion(pos, size)`, `lightning(from, to)`, `projectile({pos, vel, size, onImpact(point)})` (flying boulders),
`steam(pos, size, duration, opts) -> handle{stop(), position, setIntensity(k)}`, `fire(pos,size) -> handle`, `smoke(pos,size) -> handle`.
**post**: `render(rawDt)`, `flash(k)`, `setDamage(k 0..1)`, `setSlowmo(k 0..1)`, `punch(k)` (radial blur / chromatic kick), `resize(w,h)`.
**sky**: `sun` (DirectionalLight, shadows following camera), `setMood('golden'|'smoke'|'dusk')`.
**audio**: `unlock()` (call from a click), `play(name, {position?, volume?, rate?})`, `loop(name, opts) -> handle`,
`music(state:'title'|'calm'|'dread'|'breach'|'combat'|'death'|'victory')`, `duck(k, secs)`.
Sound names: titan_step, titan_roar, titan_groan, wall_break, boom, rubble, bell, scream, crowd, hook_fire, hook_hit,
reel, gas, gas_empty, slash, nape_kill, blade_break, blade_swap, steam, thunder, transform, wind(loop), fire(loop), heartbeat, grab, crunch.
**hud**: `showTitle()/hideTitle()`, `objective(title, sub)`, `banner(text, sub)`, `subtitle(text, secs)`, `toast(text)`,
`showDeath()/hideDeath()`, `letterbox(on)`, `fade(toBlack:boolean, secs)`, `setVisible(b)`. DOM lives in `ctx.uiRoot` (#ui).
**director**: game flow title → intro → play (waves of titans through the breach) → death/respawn → victory. Owns `ctx.mode`.

## Events (ctx.events)
`loaded`, `intro:done`, `civilian:grabbed`, `civilian:eaten`, `colossal:phase`, `colossal:attack`, `colossal:killed`, `fight:start`, `wall:breached`, `colossal:appear`, `colossal:kick`, `titan:spawned`, `titan:killed`,
`player:slash`, `player:kill`, `player:hurt`, `player:grabbed`, `player:died`, `hook:fire`, `hook:attach`, `building:collapse`.

## Scale reference
Human 1.7 m · houses 8–16 m · church spire ~38 m · pure titans 3–15 m · Colossal 60 m · wall 50 m.
ODM cable range ~70 m. Top speed while boosting ~45 m/s.
