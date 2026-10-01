// Sound bank: definitions from sfx_*.js rendered offline (one OfflineAudioContext per variant).
import { Kit, SR, makeLoop, normalise } from './kit.js';
import { GIANT } from './sfx_giant.js';
import { WORLD } from './sfx_world.js';
import { PLAYER } from './sfx_player.js';
import { V2 } from './sfx_v2.js';

export const SOUNDS = { ...WORLD, ...GIANT, ...PLAYER, ...V2 };
// saturation added to existing world sounds (layers glued, harmonic density in the mids)
for (const [n, s] of Object.entries({ wall_break: 1.7, wall_crush: 1.7, boom: 2, cannon: 2, rubble: 1.5, thunder: 1.5, transform: 1.8, nape_kill: 1.7, giant_fall: 1.8, hook_hit_stone: 1.5, hook_hit_flesh: 1.5, blade_break: 1.3, body_hit: 1.5, whoosh: 1.4 })) if (SOUNDS[n] && !SOUNDS[n].sat) SOUNDS[n].sat = s;

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// memory: big world / giant sounds live below ~10 kHz (and are heard through air absorption) -> 32 kHz;
// the crowd and war beds are low-passed at 3.4 kHz -> 22.05 kHz. Player gear, UI and drums stay at 44.1 kHz.
const LO = new Set(['steam_blast', 'wall_break', 'boom', 'cannon', 'rubble', 'thunder', 'transform', 'titan_step', 'titan_roar', 'titan_groan', 'steam', 'bell', 'fire', 'town_calm', 'scream',
  'giant_giggle', 'giant_breath', 'giant_groan', 'giant_hurt', 'giant_roar', 'giant_bite', 'giant_step', 'giant_grab', 'wall_crush', 'steam_jet', 'whoosh', 'giant_fall']);
const VLO = new Set(['crowd', 'war_bed']);
export const rateOf = (name) => (VLO.has(name) ? 22050 : LO.has(name) ? 32000 : SR);

export async function renderSound(name, v = 0, asLoop = false) {
  const def = SOUNDS[name];
  const dur = asLoop && def.loopDur ? def.loopDur : def.dur, sr = rateOf(name);
  const oc = new OfflineAudioContext(def.ch, Math.ceil(dur * sr), sr);
  const k = new Kit(oc, (hash(name) + v * 977 + (asLoop ? 5 : 0)) >>> 0);
  def.build(k, v);
  let buf = await oc.startRendering();
  let { bad } = normalise(buf);
  if (def.sat) { // native saturation pass on the level-normalised render
    const o2 = new OfflineAudioContext(def.ch, buf.length, sr), s = o2.createBufferSource(), g = o2.createGain(), w = o2.createWaveShaper();
    const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(def.sat * x) / Math.tanh(def.sat); }
    w.curve = c; w.oversample = '4x'; s.buffer = buf; g.gain.value = buf._gain; s.connect(g); g.connect(w); w.connect(o2.destination); s.start();
    buf = await o2.startRendering(); ({ bad } = normalise(buf));
  }
  if (bad) console.warn('[audio] non-finite samples in', name, v, bad);
  if (def.loop) buf = makeLoop(buf, def.loop);
  else if (asLoop && def.loopDur) buf = makeLoop(buf, 0.4);
  return buf;
}
