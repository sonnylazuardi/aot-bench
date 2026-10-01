// The mixing engine. Context-agnostic: the live game uses an AudioContext, the verification harness
// builds the exact same graph on an OfflineAudioContext.
//
//  voice ─ gain ─ air LP ─ dir ─ HRTF panner ─┐                      ┌ sfx bus ─ sfx glue comp ─┐
//        │                  └ width (2D bed) ─┼─> bus ──────────────┤ amb bus ─ amb duck ──────┤
//        ├ LFE send (non-directional sub, gentle distance law) ─────> lfe bus ─ LP 110 ─ comp ──┤
//        └ sends: town verb (2.8 s stone streets) · big verb (6.5 s wall/valley) · wall echo ────┤
//  score ─ music bus ─ duck ─ slow-mo LP ─────────────────────────────────────────────────────── pre
//  pre ─ shell-shock LP ─ master LP (pause/death) ─ glue comp ─ limiter ─ soft clip ─ master vol ─ out
//  ui bus + tinnitus bypass the muffling.
import * as THREE from 'three';
import { makeImpulse } from './kit.js';

// g gain · ref/roll distance model (inverse) · send/big/echo reverb sends · lfe sub send · width = share of a 2D stereo bed
// max voices · rv rate variance · duck = auto-duck music/amb · shock = shell-shock when close · phys = speed-of-sound delay
// self = the player's own gear (close-miked 2D, panned by camera-relative direction) · bus amb|ui
export const MIX = {
  giant_roar: { g: 1.9, ref: 140, roll: 0.5, send: 0.3, big: 0.55, echo: 0.5, lfe: 0.54, width: 0.25, max: 2, rv: 0.03, duck: 0.6, shock: 1, phys: 1 },
  giant_step: { g: 1.6, ref: 100, roll: 0.6, send: 0.25, big: 0.4, echo: 0.3, lfe: 0.6, max: 6, rv: 0.05, phys: 1 },
  giant_giggle: { g: 1.35, ref: 60, roll: 0.7, send: 0.25, big: 0.35, echo: 0.15, lfe: 0.18, max: 2, rv: 0.04 },
  giant_breath: { g: 0.6, ref: 60, roll: 0.8, send: 0.2, big: 0.3, lfe: 0.06, max: 1 },
  giant_groan: { g: 1.35, ref: 70, roll: 0.7, send: 0.25, big: 0.4, echo: 0.2, lfe: 0.3, max: 3, rv: 0.05 },
  giant_hurt: { g: 1.6, ref: 100, roll: 0.6, send: 0.25, big: 0.5, echo: 0.35, lfe: 0.36, max: 2, rv: 0.04, duck: 0.3 },
  giant_bite: { g: 1.5, ref: 45, roll: 0.8, send: 0.3, big: 0.35, echo: 0.2, lfe: 0.18, max: 3, rv: 0.05 },
  giant_grab: { g: 1.3, ref: 45, roll: 0.8, send: 0.25, big: 0.3, lfe: 0.24, max: 3, rv: 0.06 },
  giant_fall: { g: 1.9, ref: 150, roll: 0.5, send: 0.3, big: 0.6, echo: 0.5, lfe: 0.6, width: 0.3, max: 1, duck: 0.5, phys: 1 },
  wall_crush: { g: 1.45, ref: 80, roll: 0.7, send: 0.3, big: 0.5, echo: 0.35, lfe: 0.36, max: 4, rv: 0.08, phys: 1 },
  steam_blast: { g: 1.7, ref: 90, roll: 0.6, send: 0.25, big: 0.4, echo: 0.35, lfe: 0.18, max: 3, rv: 0.06, duck: 0.35, shock: 0.5 },
  steam_jet: { g: 1.1, ref: 55, roll: 0.8, send: 0.25, big: 0.3, lfe: 0.12, max: 4, rv: 0.08 },
  whoosh: { g: 1.3, ref: 50, roll: 0.8, send: 0.2, big: 0.2, lfe: 0.3, max: 4, rv: 0.1 },
  wall_break: { g: 2.0, ref: 160, roll: 0.5, send: 0.3, big: 0.7, echo: 0.6, lfe: 0.6, width: 0.35, max: 2, duck: 0.7, shock: 0.8, phys: 1 },
  boom: { g: 1.3, ref: 80, roll: 0.7, send: 0.3, big: 0.5, echo: 0.45, lfe: 0.48, max: 4, rv: 0.08, phys: 1 },
  cannon: { g: 1.0, ref: 80, roll: 0.7, send: 0.3, big: 0.5, echo: 0.6, lfe: 0.24, max: 3, rv: 0.06, phys: 1 },
  rubble: { g: 1.0, ref: 40, roll: 1, send: 0.4, big: 0.25, echo: 0.15, lfe: 0.24, max: 5, rv: 0.1 },
  bell: { g: 0.9, ref: 80, roll: 0.8, send: 0.45, big: 0.4, echo: 0.4, max: 3 },
  scream: { g: 0.62, ref: 20, roll: 1, send: 0.45, big: 0.15, echo: 0.15, max: 5, rv: 0.08 },
  crowd: { g: 0.55, ref: 80, roll: 1, send: 0.35, big: 0.2, width: 0.6, max: 2, bus: 'amb' },
  fire: { g: 0.9, ref: 14, roll: 1.1, send: 0.25, max: 10, bus: 'amb' },
  thunder: { g: 1.3, ref: 200, roll: 0.5, send: 0.3, big: 0.6, echo: 0.3, lfe: 0.36, width: 0.6, max: 2, rv: 0.1 },
  transform: { g: 1.9, ref: 220, roll: 0.5, send: 0.3, big: 0.6, echo: 0.5, lfe: 0.6, width: 0.4, max: 1, duck: 0.6, shock: 0.6 },
  titan_step: { g: 1.2, ref: 34, roll: 0.9, send: 0.35, big: 0.2, lfe: 0.24, max: 10, rv: 0.06 },
  titan_roar: { g: 1.2, ref: 45, roll: 0.9, send: 0.4, big: 0.3, echo: 0.2, max: 4, rv: 0.05 },
  titan_groan: { g: 0.9, ref: 25, roll: 1, send: 0.4, big: 0.2, max: 5, rv: 0.08 },
  steam: { g: 0.5, ref: 14, roll: 1, send: 0.25, max: 6, rv: 0.1 },
  town_calm: { g: 0.15, bus: 'amb', max: 1, send: 0.1 },
  war_bed: { g: 0.1, bus: 'amb', max: 1, send: 0.1 },
  hook_fire: { g: 1.5, self: 1, send: 0.12, max: 4, rv: 0.06 },
  hook_hit_stone: { g: 1.3, ref: 14, roll: 1, send: 0.3, big: 0.1, max: 4, rv: 0.1 },
  hook_hit_wood: { g: 1.3, ref: 14, roll: 1, send: 0.3, max: 4, rv: 0.1 },
  hook_hit_flesh: { g: 1.4, ref: 16, roll: 1, send: 0.25, max: 4, rv: 0.1 },
  reel: { g: 0.6, self: 1, send: 0.05, max: 2, rv: 0.04 },
  gas: { g: 0.5, self: 1, send: 0.08, max: 3, rv: 0.1 },
  gas_empty: { g: 0.8, self: 1, send: 0.05, max: 1 },
  slash: { g: 1.55, self: 1, send: 0.2, max: 4, rv: 0.08 },
  nape_kill: { g: 1.2, ref: 18, roll: 0.8, send: 0.3, big: 0.2, lfe: 0.3, max: 2, rv: 0.05 },
  blade_break: { g: 1.3, self: 1, send: 0.2, max: 2 },
  blade_swap: { g: 1.0, self: 1, send: 0.1, max: 2 },
  grab: { g: 0.9, self: 1, send: 0.2, max: 2 },
  crunch: { g: 1.0, ref: 10, send: 0.25, max: 3, rv: 0.08 },
  body_hit: { g: 1.4, self: 1, send: 0.1, max: 2, rv: 0.06 },
  heartbeat: { g: 0.8, self: 1, send: 0, max: 1, bus: 'ui' },
  ui_tick: { g: 0.25, bus: 'ui', send: 0.05, max: 3 },
  ui_confirm: { g: 0.8, bus: 'ui', send: 0.4, max: 1 },
};
const DEF = { g: 0.8, ref: 15, roll: 1, send: 0.3, max: 6 };

const att = (d, ref, roll) => ref / (ref + roll * (Math.max(d, ref) - ref));
const airCut = (d) => THREE.MathUtils.clamp(20000 * Math.exp(-d / 420), 1600, 20000); // air absorption (gentle: far things must still read)
export let MASTER_MAKEUP = 0.45; // NB: Chrome's DynamicsCompressors add their own auto-makeup (~+9 dB across glue/sfx/limiter)

function smoothBuf(ac, rate, secs, seed) {
  let s = seed >>> 0 || 1; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const SRc = 3000, n = Math.ceil(secs * SRc), b = ac.createBuffer(1, n, SRc), d = b.getChannelData(0); // control rate
  const step = SRc / rate, K = Math.round(n / step); const pts = []; for (let i = 0; i < K; i++) pts.push(r()); // periodic → seamless loop
  for (let i = 0; i < n; i++) { const x = i / step, i0 = Math.floor(x) % K, i1 = (i0 + 1) % K, f = x - Math.floor(x); d[i] = pts[i0] + (pts[i1] - pts[i0]) * (0.5 - 0.5 * Math.cos(Math.PI * f)); }
  return b;
}

export class Mixer {
  constructor(ac, { buffers, loopBuffers, volume = 1, wallRadius = 380 } = {}) {
    this.ac = ac; this.buffers = buffers || {}; this.loopBuffers = loopBuffers || {};
    this.wallRadius = wallRadius;
    this.voices = []; this.loops = new Set();
    this.listener = new THREE.Vector3(); this.right = new THREE.Vector3(1, 0, 0); this.playerPos = null;
    this.stats = { played: 0, stolen: 0 };
    this.g = this._build(volume);
  }
  _gain(v = 1) { const g = this.ac.createGain(); g.gain.value = v; return g; }
  _filt(type, f, Q = 0.707) { const b = this.ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; return b; }
  _comp(th, ratio, att, rel, knee) { const c = this.ac.createDynamicsCompressor(); c.threshold.value = th; c.ratio.value = ratio; c.attack.value = att; c.release.value = rel; c.knee.value = knee; return c; }
  _build(vol) {
    const ac = this.ac, g = {};
    g.out = this._gain(vol); g.out.connect(ac.destination);
    // soft clip with a -1 dBFS ceiling (4x oversampled: keeps inter-sample peaks under control)
    g.clip = ac.createWaveShaper(); { const n = 4096, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x); c[i] = Math.sign(x) * (a < 0.7 ? a : 0.7 + 0.19 * Math.tanh((a - 0.7) / 0.19)); } g.clip.curve = c; g.clip.oversample = '4x'; }
    g.clip.connect(g.out);
    g.limiter = this._comp(-3, 20, 0.001, 0.12, 0); g.limiter.connect(g.clip);
    g.makeup = this._gain(MASTER_MAKEUP); g.makeup.connect(g.limiter);       // loudness: ~-15 LUFS in play
    g.glue = this._comp(-16, 1.8, 0.02, 0.25, 8); g.glue.connect(g.makeup);   // light glue only
    g.masterHP = this._filt('highpass', 32, 0.7); g.masterHP.connect(g.glue); // no sub mud driving the dynamics
    g.masterLP = this._filt('lowpass', 20000, 0.5); g.masterLP.connect(g.masterHP);
    g.shockLP = this._filt('lowpass', 20000, 0.6); g.shockLP.connect(g.masterLP);
    g.pre = this._gain(0.8); g.pre.connect(g.shockLP);
    g.ui = this._gain(1); g.ui.connect(g.glue);
    // sfx
    g.sfxComp = this._comp(-10, 2, 0.004, 0.15, 6); g.sfxComp.connect(g.pre);
    g.sfx = this._gain(1); g.sfx.connect(g.sfxComp);
    // ambience + music (duckable)
    g.ambDuck = this._gain(1); g.amb = this._gain(1); { const ls = this._filt('lowshelf', 80); ls.gain.value = -4; g.ambDuck.connect(ls); ls.connect(g.pre); } g.amb.connect(g.ambDuck);
    g.musicLP = this._filt('lowpass', 20000); g.musicLP.connect(g.pre);
    g.musicDuck = this._gain(1); g.musicDuck.connect(g.musicLP);
    g.music = this._gain(0.12); g.music.connect(g.musicDuck);
    // LFE: the ground-shaking sub layer of giant events (non-directional, gentle distance law)
    g.lfe = this._gain(1); const lfeLP = this._filt('lowpass', 110, 0.8), lfeHP = this._filt('highpass', 22, 0.7), lfeC = this._comp(-14, 4, 0.01, 0.4, 6);
    g.lfe.connect(lfeLP); lfeLP.connect(lfeHP); lfeHP.connect(lfeC); const lfeOut = this._gain(0.4); lfeC.connect(lfeOut); lfeOut.connect(g.pre);
    // town reverb
    g.verbIn = this._gain(1); { const pd = ac.createDelay(0.2); pd.delayTime.value = 0.015; const hp = this._filt('highpass', 120); g.verb = ac.createConvolver(); g.verb.normalize = true; g.verb.buffer = makeImpulse(ac.sampleRate, 'town'); g.verbOut = this._gain(0.5); g.verbIn.connect(pd); pd.connect(hp); hp.connect(g.verb); g.verb.connect(g.verbOut); g.verbOut.connect(g.pre); }
    // big reverb: the ring wall / valley
    g.bigIn = this._gain(1); { const pd = ac.createDelay(0.2); pd.delayTime.value = 0.045; const hp = this._filt('highpass', 55), lp = this._filt('lowpass', 5000); const cv = ac.createConvolver(); cv.normalize = true; cv.buffer = makeImpulse(ac.sampleRate, 'big'); g.bigOut = this._gain(0.55); g.bigIn.connect(pd); pd.connect(hp); hp.connect(lp); lp.connect(cv); cv.connect(g.bigOut); g.bigOut.connect(g.pre); }
    // wall echo: two taps (nearest / far side of the ring wall), delay = 2·distance / 343, panned toward the wall
    g.echoIn = this._gain(1); {
      const hp = this._filt('highpass', 160), lp = this._filt('lowpass', 2200); g.echoIn.connect(hp); hp.connect(lp);
      g.echoA = ac.createDelay(4); g.echoB = ac.createDelay(4); g.echoA.delayTime.value = 1.2; g.echoB.delayTime.value = 2.8;
      const ga = this._gain(0.5), gb = this._gain(0.26); g.echoPanA = ac.createStereoPanner(); g.echoPanB = ac.createStereoPanner();
      lp.connect(g.echoA); lp.connect(g.echoB);
      g.echoA.connect(ga); ga.connect(g.echoPanA); g.echoB.connect(gb); gb.connect(g.echoPanB);
      const fbLP = this._filt('lowpass', 1400), fb = this._gain(0.22); g.echoA.connect(fbLP); fbLP.connect(fb); fb.connect(g.echoA);
      const eo = this._gain(1); g.echoPanA.connect(eo); g.echoPanB.connect(eo); eo.connect(g.pre); const ed = this._gain(0.35); eo.connect(ed); ed.connect(g.bigIn);
    }
    // music has its own hall send
    { const ms = this._gain(0.3); g.music.connect(ms); ms.connect(g.verbIn); const mb = this._gain(0.12); g.music.connect(mb); mb.connect(g.bigIn); }
    // tinnitus (shell-shock)
    g.tinG = this._gain(0); { const o = ac.createOscillator(); o.frequency.value = 3950; const o2 = ac.createOscillator(); o2.frequency.value = 4012; const og = this._gain(0.5); o.connect(g.tinG); o2.connect(og); og.connect(g.tinG); o.start(); o2.start(); g.tinG.connect(g.glue); }
    g.meter = ac.createAnalyser(); g.meter.fftSize = 2048; g.out.connect(g.meter);
    return g;
  }

  // ------------------------------------------------ routing
  _bus(m) { return m.bus === 'amb' ? this.g.amb : m.bus === 'ui' ? this.g.ui : this.g.sfx; }
  _selfPan(pos) {
    if (!pos) return 0;
    const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, dz = pos.z - this.listener.z, l = Math.hypot(dx, dy, dz) || 1;
    return THREE.MathUtils.clamp((dx * this.right.x + dy * this.right.y + dz * this.right.z) / l, -1, 1) * 0.45;
  }
  route(name, src, opts = {}) {
    const ac = this.ac, g = this.g, m = MIX[name] || DEF, pos = opts.position;
    const v = this._gain((opts.volume ?? 1) * m.g); src.connect(v);
    const r = { v, nodes: [src, v], m, d: 0, spatial: false };
    const bus = this._bus(m);
    const self = m.self && (!pos || !this.playerPos || pos.distanceTo(this.playerPos) < 14);
    if (pos && !self) r.d = pos.distanceTo(this.listener);
    if (pos && !self && r.d > 1.5 && m.bus !== 'ui') {
      r.spatial = true;
      const d = r.d, ref = m.ref ?? 15, roll = m.roll ?? 1;
      r.air = this._filt('lowpass', airCut(d), 0.5);
      r.pan = ac.createPanner(); r.pan.panningModel = d < 220 ? 'HRTF' : 'equalpower'; r.pan.distanceModel = 'inverse';
      r.pan.refDistance = ref; r.pan.rolloffFactor = roll; r.pan.maxDistance = 20000;
      r.pan.positionX.value = pos.x; r.pan.positionY.value = pos.y; r.pan.positionZ.value = pos.z;
      v.connect(r.air);
      if (m.width) { r.dir = this._gain(1 - m.width); r.air.connect(r.dir); r.dir.connect(r.pan); r.wid = this._gain(m.width * att(d, ref, roll)); r.air.connect(r.wid); r.wid.connect(bus); r.nodes.push(r.dir, r.wid); }
      else r.air.connect(r.pan);
      r.pan.connect(bus); r.nodes.push(r.air, r.pan);
      this._sends(r, r.air, opts);
    } else {
      const p = ac.createStereoPanner(); p.pan.value = opts.pan ?? (self ? this._selfPan(pos) : 0);
      v.connect(p); p.connect(bus); r.nodes.push(p); r.sp = p;
      this._sends(r, v, opts);
    }
    return r;
  }
  _sendLevels(r) {
    const m = r.m, d = r.d, ref = m.ref ?? 15, roll = m.roll ?? 1, a = r.spatial ? att(d, ref, roll) : 1;
    const lref = Math.max(ref * 1.5, 150);
    return { send: (m.send ?? 0.3) * Math.sqrt(a), big: (m.big || 0) * Math.pow(a, 0.3), echo: (m.echo || 0) * Math.pow(a, 0.25), lfe: (m.lfe || 0) * (r.spatial ? att(d, lref, 0.3) : 1), wid: (m.width || 0) * a };
  }
  _sends(r, from, opts) {
    const L = this._sendLevels(r), s = opts.send;
    const mk = (lvl, dest, key, src = from) => { if (lvl <= 0.001) return; const gg = this._gain(lvl); src.connect(gg); gg.connect(dest); r.nodes.push(gg); r[key] = gg; };
    mk(s ?? L.send, this.g.verbIn, 'sT'); mk(L.big, this.g.bigIn, 'sB'); mk(L.echo, this.g.echoIn, 'sE');
    mk(L.lfe, this.g.lfe, 'sL', r.v); // sub is taken pre-air-filter
  }
  _refresh(r, pos, t) {
    if (!r.spatial || !pos) return;
    r.d = pos.distanceTo(this.listener);
    r.pan.positionX.setTargetAtTime(pos.x, t, 0.05); r.pan.positionY.setTargetAtTime(pos.y, t, 0.05); r.pan.positionZ.setTargetAtTime(pos.z, t, 0.05);
    r.air.frequency.setTargetAtTime(airCut(r.d), t, 0.1);
    const L = this._sendLevels(r);
    if (r.sT) r.sT.gain.setTargetAtTime(L.send, t, 0.1); if (r.sB) r.sB.gain.setTargetAtTime(L.big, t, 0.1);
    if (r.sE) r.sE.gain.setTargetAtTime(L.echo, t, 0.1); if (r.sL) r.sL.gain.setTargetAtTime(L.lfe, t, 0.1); if (r.wid) r.wid.gain.setTargetAtTime(L.wid, t, 0.1);
  }

  pickBuf(name, loop) {
    const list = (loop && this.loopBuffers[name]) || this.buffers[name];
    return list && list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }

  // ------------------------------------------------ one-shots
  // opts: position, volume, rate, pan, send, delay, when (absolute ctx time), physical (speed-of-sound delay), slow (0..1 slow-mo pitch)
  play(name, opts = {}) {
    const ac = this.ac, buf = this.pickBuf(name); if (!buf) return null;
    const m = MIX[name] || DEF;
    const same = this.voices.filter((x) => x.name === name);
    if (same.length >= (m.max || 6)) { this.kill(same[0], 0.05); this.stats.stolen++; }
    if (this.voices.length > 56) { this.kill(this.voices[0], 0.05); this.stats.stolen++; }
    const src = ac.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = Math.max(0.25, (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (m.rv || 0)) * (opts.slow ?? 1));
    const r = this.route(name, src, { ...opts, volume: (opts.volume ?? 1) * (buf._gain ?? 1) }); r.bg = buf._gain ?? 1;
    let t = (opts.when ?? ac.currentTime) + (opts.delay || 0);
    if (m.phys && r.spatial && r.d > 120 && opts.physical !== false) t += Math.min(1.2, r.d / 343) * 0.6;
    src.start(t);
    const voice = { name, src, t, r, nodes: r.nodes };
    this.voices.push(voice); this.stats.played++;
    src.onended = () => { const i = this.voices.indexOf(voice); if (i >= 0) this.voices.splice(i, 1); for (const n of voice.nodes) try { n.disconnect(); } catch {} };
    if (m.duck) this.duck(m.duck * Math.min(1, (opts.volume ?? 1)) * (r.spatial ? Math.min(1, att(r.d, m.ref ?? 15, m.roll ?? 1) * 1.6) : 1), Math.min(4, buf.duration * 0.5), t);
    return voice;
  }
  kill(v, fade = 0.08) {
    const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1);
    try { const t = this.ac.currentTime; v.r.v.gain.cancelScheduledValues(t); v.r.v.gain.setTargetAtTime(0, t, fade / 3); v.src.stop(t + fade + 0.05); } catch {}
  }

  // ------------------------------------------------ loops (handles work before buffers exist)
  loop(name, opts = {}) {
    const mx = this;
    const h = {
      name, opts: { ...opts }, live: null, stopped: false, pos: opts.position ? opts.position.clone() : null, vol: opts.volume ?? 1, rate: opts.rate ?? 1,
      stop(fade = 0.6) {
        this.stopped = true; mx.loops.delete(this);
        if (this.live) { const t = mx.ac.currentTime, l = this.live; const g = l.r.v.gain; g.cancelScheduledValues(t); g.setTargetAtTime(0, t, Math.max(0.01, fade / 3)); try { l.src.stop(t + fade + 0.2); } catch {} l.src.onended = () => { for (const n of l.r.nodes) try { n.disconnect(); } catch {} }; this.live = null; }
      },
      setVolume(v, ramp = 0.1) { this.vol = v; if (this.live) this.live.r.v.gain.setTargetAtTime(v * (this.live.r.m.g || 1) * this.live.r.bg, mx.ac.currentTime, Math.max(0.005, ramp / 3)); },
      setRate(r) { this.rate = r; if (this.live) this.live.src.playbackRate.setTargetAtTime(Math.max(0.1, r), mx.ac.currentTime, 0.05); },
      setPosition(p) { if (!p) return; (this.pos ||= new THREE.Vector3()).copy(p); },
      get playing() { return !!this.live; },
    };
    this.loops.add(h); this._startLoop(h);
    return h;
  }
  _startLoop(h) {
    if (h.live || h.stopped) return;
    const buf = this.pickBuf(h.name, true); if (!buf) return;
    const ac = this.ac, src = ac.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = h.rate;
    const end = buf._loopEnd || buf.duration; if (buf._loopEnd) { src.loopStart = 0; src.loopEnd = end; }
    const r = this.route(h.name, src, { position: h.pos, volume: 0, pan: h.opts.pan, send: h.opts.send }); r.bg = buf._gain ?? 1;
    src.start(ac.currentTime, Math.random() * end * 0.98);
    r.v.gain.setTargetAtTime(h.vol * (r.m.g || 1) * r.bg, ac.currentTime, Math.max(0.01, (h.opts.fadeIn ?? 0.8) / 3));
    h.live = { src, r };
  }
  _updateLoops(t) {
    for (const h of this.loops) {
      if (!h.live) { this._startLoop(h); continue; }
      const r = h.live.r;
      if (r.spatial) this._refresh(r, h.pos, t);
      else if (r.sp && r.m.self && h.pos) r.sp.pan.setTargetAtTime(this._selfPan(h.pos), t, 0.05);
    }
  }

  // ------------------------------------------------ bus control
  duck(k = 0.5, secs = 1.5, at = this.ac.currentTime) {
    const t = Math.max(at, this.ac.currentTime);
    for (const p of [this.g.musicDuck.gain, this.g.ambDuck.gain]) {
      const cur = p.value; if (1 - k > cur + 0.05 && t - this.ac.currentTime < 0.05) continue; // already ducked deeper
      p.cancelScheduledValues(t); p.setTargetAtTime(1 - k, t, 0.05); p.setTargetAtTime(1, t + secs, secs * 0.4);
    }
  }
  // close to something enormous: world goes muffled, ears ring
  shellshock(k = 1, secs = 2.5) {
    const t = this.ac.currentTime, f = this.g.shockLP.frequency, tg = this.g.tinG.gain;
    f.cancelScheduledValues(t); f.setTargetAtTime(THREE.MathUtils.lerp(4000, 380, THREE.MathUtils.clamp(k, 0, 1)), t, 0.03); f.setTargetAtTime(20000, t + secs * 0.35, secs * 0.3);
    tg.cancelScheduledValues(t); tg.setTargetAtTime(0.012 * k, t, 0.05); tg.setTargetAtTime(0, t + secs * 0.4, secs * 0.3);
  }
  setVolume(v) { this.g.out.gain.setTargetAtTime(v, this.ac.currentTime, 0.05); }

  // ------------------------------------------------ listener + per-frame
  setListener(pos, fwd, up, t = this.ac.currentTime) {
    this.listener.copy(pos); this.right.crossVectors(fwd, up).normalize();
    const L = this.ac.listener;
    if (L.positionX) {
      L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
      L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t);
      L.upX.setValueAtTime(up.x, t); L.upY.setValueAtTime(up.y, t); L.upZ.setValueAtTime(up.z, t);
    } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  }
  update(t = this.ac.currentTime) {
    this._updateLoops(t);
    // wall echo taps follow the listener inside the ring
    const x = this.listener.x, z = this.listener.z, rr = Math.hypot(x, z), R = this.wallRadius;
    const dn = Math.max(8, Math.abs(R - rr)), df = R + rr;
    this.g.echoA.delayTime.setTargetAtTime(THREE.MathUtils.clamp(2 * dn / 343, 0.06, 3.9), t, 0.8);
    this.g.echoB.delayTime.setTargetAtTime(THREE.MathUtils.clamp(2 * df / 343, 0.06, 3.9), t, 0.8);
    const ox = rr > 1 ? x / rr : 0, oz = rr > 1 ? z / rr : 1, p = THREE.MathUtils.clamp(ox * this.right.x + oz * this.right.z, -1, 1) * 0.6;
    this.g.echoPanA.pan.setTargetAtTime(p, t, 0.3); this.g.echoPanB.pan.setTargetAtTime(-p, t, 0.3);
  }

  // ------------------------------------------------ wind: rushing air shaped by the player's speed
  buildWind() {
    if (this.wind) return this.wind;
    const buf = this.pickBuf('wind', true); if (!buf) return null;
    const ac = this.ac, W = {};
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true; const end = buf._loopEnd || buf.duration; if (buf._loopEnd) { src.loopStart = 0; src.loopEnd = end; }
    src.start(ac.currentTime, Math.random() * end * 0.98);
    const mod = (rate, secs, seed, depth) => { const s = ac.createBufferSource(); s.buffer = smoothBuf(ac, rate, secs, seed); s.loop = true; s.start(); const gg = this._gain(depth); s.connect(gg); return gg; };
    W.pan = ac.createStereoPanner(); W.out = this._gain((buf._gain ?? 1) * 0.45); W.pan.connect(W.out); W.out.connect(this.g.sfx);
    const layer = (nodes, amNode) => { const g = this._gain(0); let prev = src; for (const n of nodes) { prev.connect(n); prev = n; } if (amNode) { prev.connect(amNode); prev = amNode; } prev.connect(g); g.connect(W.pan); return g; };
    // gusting amplitude on the low layers
    const gust = this._gain(0.75); mod(0.35, 17, 7, 0.25).connect(gust.gain);
    W.rumbleF = this._filt('lowpass', 160, 0.7); W.rumble = layer([W.rumbleF], gust);
    W.bodyF = this._filt('bandpass', 400, 0.7); W.body = layer([W.bodyF]);
    W.rushF = this._filt('highpass', 1200, 0.6); W.rushPk = this._filt('peaking', 3500, 0.9); W.rushPk.gain.value = 5; W.rush = layer([W.rushF, W.rushPk]);
    W.whisF = this._filt('bandpass', 1600, 14); W.whis = layer([W.whisF]);
    // cloak / strap flutter: square-ish LFO chopping a mid band, rate rises with speed
    W.flapF = this._filt('bandpass', 700, 1.1); const flapAm = this._gain(0.5); W.flapLfo = ac.createOscillator(); W.flapLfo.type = 'triangle'; W.flapLfo.frequency.value = 9; const fl = this._gain(0.5); W.flapLfo.connect(fl); fl.connect(flapAm.gain); W.flapLfo.start();
    mod(3, 11, 3, 0.15).connect(flapAm.gain);
    W.flap = layer([W.flapF], flapAm);
    // ear buffeting: low turbulence, random
    W.bufF = this._filt('lowpass', 85, 2); const bufAm = this._gain(0.5); mod(7, 9, 5, 0.5).connect(bufAm.gain); W.buf = layer([W.bufF], bufAm);
    W.speed = 0;
    return (this.wind = W);
  }
  // speed m/s (0 .. ~50), altitude m, pan -1..1 (wind side), mute during pause
  updateWind(speed, alt, pan, mute, t = this.ac.currentTime) {
    const W = this.wind || this.buildWind(); if (!W) return;
    const k = THREE.MathUtils.clamp((speed - 6) / 39, 0, 1.25), a = THREE.MathUtils.clamp((alt - 8) / 60, 0, 1);
    const set = (g, v, tc = 0.08) => g.gain.setTargetAtTime(mute ? 0 : v, t, tc);
    set(W.rumble, 0.5 * Math.pow(k, 0.7), 0.12);
    set(W.body, 0.035 + 0.05 * a + 0.7 * Math.pow(k, 0.7));
    set(W.rush, 0.75 * Math.pow(k, 2));
    set(W.whis, 0.07 * Math.pow(k, 3));
    set(W.flap, 0.3 * Math.max(0, k - 0.3));
    set(W.buf, 0.7 * Math.max(0, k - 0.4));
    W.rumbleF.frequency.setTargetAtTime(150 + 250 * k, t, 0.1);
    W.bodyF.frequency.setTargetAtTime(350 + 900 * k, t, 0.1);
    W.rushF.frequency.setTargetAtTime(1500 - 400 * k, t, 0.1);
    W.whisF.frequency.setTargetAtTime(1500 + 1300 * k, t, 0.2);
    W.flapLfo.frequency.setTargetAtTime(8 + 18 * k, t, 0.2);
    W.pan.pan.setTargetAtTime(THREE.MathUtils.clamp(pan, -1, 1) * 0.35, t, 0.15);
    W.speed = speed;
  }

  meter() {
    const a = new Float32Array(this.g.meter.fftSize); this.g.meter.getFloatTimeDomainData(a); let s = 0, p = 0;
    for (const x of a) { s += x * x; p = Math.max(p, Math.abs(x)); }
    return { rmsDb: +(10 * Math.log10(s / a.length + 1e-12)).toFixed(1), peakDb: +(20 * Math.log10(p + 1e-12)).toFixed(1) };
  }
}
