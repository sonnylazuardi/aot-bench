// Sound bank: definitions from sfx_*.js rendered offline (one OfflineAudioContext per variant).
import { Kit, SR, makeLoop, normalise } from './kit.js';
import { GIANT } from './sfx_giant.js';
import { WORLD } from './sfx_world.js';
import { PLAYER } from './sfx_player.js';

export const SOUNDS = { ...WORLD, ...GIANT, ...PLAYER };

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// memory: big world / giant sounds live below ~10 kHz (and are heard through air absorption) -> 32 kHz;
// the crowd and war beds are low-passed at 3.4 kHz -> 22.05 kHz. Player gear, UI and drums stay at 44.1 kHz.
const LO = new Set(['wall_break', 'boom', 'cannon', 'rubble', 'thunder', 'transform', 'titan_step', 'titan_roar', 'titan_groan', 'steam', 'bell', 'fire', 'town_calm', 'scream',
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
  const { bad } = normalise(buf);
  if (bad) console.warn('[audio] non-finite samples in', name, v, bad);
  if (def.loop) buf = makeLoop(buf, def.loop);
  else if (asLoop && def.loopDur) buf = makeLoop(buf, 0.4);
  return buf;
}
