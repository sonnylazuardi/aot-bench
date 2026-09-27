# Attack on Titan — The Fall of Shiganshina

A browser boss-fight game written by Claude, inspired by [xikhar/spiderbench](https://github.com/xikhar/spiderbench). It is a non-commercial fan project and a benchmark of what Claude, working through Claude Code with a team of parallel builder and critic agents, can produce for a real-time 3D game in the browser.

A ~70 m Smiling Titan rises over the 50 m wall of Shiganshina, kicks in the gate and wades into the town eating the townspeople. You fly at it with ODM gear.

Everything is generated in code at load time: the town and wall, the titans (SDF sculpting, then meshing, then a skinned rig), the soldier, the textures, the particle effects, and every sound and note of music. There are no downloaded assets.

## What's in it
- **Scene:** the Shiganshina district.
  - A 50 m ring wall with buttresses, gatehouses and cannon rails.
  - About 2,700 half-timbered houses with tiled roofs, a canal and bridges, churches and a dressed market avenue.
  - Farmland and a mountain ring outside the wall.
  - Houses collapse when hit, and the wall top can be bitten away.
- **Boss:** the Smiling Titan, in three phases.
  1. It grips the wall. Cut both wrist tendons.
  2. It rampages through the town. Cut both ankles.
  3. Steam fury. Cut the nape between bursts.

  Between attacks it grabs and eats fleeing townspeople.
- **ODM gear:**
  - Two independent hooks with a rope-pendulum swing.
  - Gas boost and reel.
  - You can cling to the moving titan.
  - Spin slash with hit-stop, and weak-point lock-on.
- **Cinematics:** a roughly one-minute intro (lightning strike, the reveal, the breach), shots on each phase change, and a kill cam.
- **Rendering (three.js):**
  - Raymarched golden-hour and inferno skies, and height fog.
  - Cascaded sun shadows, AO, bloom, sun shafts and AgX grading.
  - GPU particles for steam, dust, debris, fire and embers.
- **Audio:** fully procedural WebAudio. Spatial sound effects and a dynamic choir, drums and brass score that escalates with each phase.

## Run it
You need Node.js 20.19+ or 22.12+ and a WebGL2-capable browser. A discrete GPU is recommended.

```bash
npm install
npm run dev          # http://127.0.0.1:5190
npm run build && npm run preview   # production build on http://127.0.0.1:4173
```

URL flags:
- `?skip=1`: jump straight into the fight.
- `?intro=1`: play the intro cinematic.
- `?q=low|medium|high`: rendering quality.
- `?perf=1`: performance overlay.

## Controls
| Input | Action |
|---|---|
| Click | Lock the mouse |
| LMB / RMB (or Q / E) | Fire the left / right hook |
| Space | Gas boost / jump |
| Shift | Strong reel / sprint |
| WASD | Move / air control |
| F or middle click | Spin slash (mash F to escape a grab) |
| Tab / hold C | Lock onto weak points |
| R | Swap blades |
| H / Esc | Controls / pause |

## How it was built
`CONTRACT.md` is the engine contract the parallel agents built against, covering file ownership, system APIs and shared layout. `NOTES.md` holds their cross-team notes. Systems live under `src/`: `render`, `world`, `titans`, `story` (the boss and the cinematics), `player`, `audio`, `ui` and `game`. Each one loads in isolation and falls back to a stub if it fails. `tools/` contains the headless screenshot rig, a blind A/B compositor used by the critic agents, a health check and the publish script.

## Disclaimer
This is an unofficial fan project, made only as a technical demonstration. It is not affiliated with, endorsed by or sponsored by Hajime Isayama, Kodansha, Wit Studio, MAPPA, Koei Tecmo or any rights holder of *Attack on Titan*. *Attack on Titan* and related names, characters and likenesses are trademarks and copyrighted material of their respective owners, and no rights to them are claimed. This project is not for sale and may not be used commercially.
