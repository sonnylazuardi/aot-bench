// Dynamic procedural film score (live WebAudio graph; runs on AudioContext or OfflineAudioContext).
//   choir   – high 'aah' (4 voices x 4 detuned saws -> vowel formant bank -> ensemble chorus) + breath
//   mchoir  – low male 'ooh/oh' choir on root/fifth/octave
//   drone   – low string/brass drone with filter swells
//   trem    – high string tremolo (dread)
//   ost     – spiccato string ostinato (16ths)          bass – cello/bass 8th-note pulse
//   drums   – taiko ensemble (doubled, panned), odaiko, war drums, gran cassa, rims
//   brass   – stabs, stingers, BRAAMs, the heroic horn motif
// setState() is quantised: the new state lands on the next bar line (or beat) with a riser + taiko roll into it.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const CH = { // choir voicing (4 notes), bass root
  Dm: { v: [57, 62, 65, 69], r: 38 }, Bb: { v: [58, 62, 65, 70], r: 34 }, Gm: { v: [58, 62, 67, 70], r: 31 },
  A: { v: [57, 61, 64, 69], r: 33 }, F: { v: [57, 60, 65, 69], r: 29 }, C: { v: [55, 60, 64, 67], r: 36 },
  Eb: { v: [58, 63, 67, 70], r: 39 }, Bbm: { v: [58, 61, 65, 70], r: 34 }, D: { v: [57, 62, 66, 69], r: 38 },
  Dsus: { v: [57, 62, 64, 69], r: 38 }, Gm6: { v: [58, 62, 64, 67], r: 31 }, Csm: { v: [56, 61, 64, 68], r: 37 },
};
const VOWELS = { a: [760, 1180, 2600], o: [560, 860, 2450], u: [330, 780, 2300], e: [520, 1760, 2500] };
const LAYERS = ['choir', 'mchoir', 'drone', 'trem', 'ost', 'bass', 'drums'];
const RANK = { death: -1, calm: 0, title: 1, victory: 2, dread: 3, breach: 4, combat: 5, boss2: 6, boss3: 7 };

export const STATES = {
  title:   { bpm: 70, prog: [['Dm', 2], ['Bb', 2], ['Gm', 2], ['A', 2]], mix: { choir: 0.8, mchoir: 0.5, drone: 0.5, trem: 0.12, ost: 0, bass: 0, drums: 0.55 }, vowel: 'a', cut: 520, drums: 'title' },
  calm:    { bpm: 64, prog: [['Dm', 2], ['F', 2], ['C', 2], ['Bb', 2]], mix: { choir: 0.45, mchoir: 0.25, drone: 0.3, trem: 0, ost: 0, bass: 0, drums: 0 }, vowel: 'o', cut: 320, drums: null },
  dread:   { bpm: 66, prog: [['Dm', 2], ['Eb', 2], ['Dm', 2], ['Csm', 1], ['A', 1]], mix: { choir: 0.35, mchoir: 0.75, drone: 0.85, trem: 0.5, ost: 0, bass: 0, drums: 0.8 }, vowel: 'u', cut: 360, drums: 'dread' },
  breach:  { bpm: 92, prog: [['Dm', 1], ['Bb', 1], ['C', 1], ['A', 1]], mix: { choir: 1, mchoir: 0.8, drone: 1, trem: 0.3, ost: 0.55, bass: 0.6, drums: 1 }, vowel: 'a', cut: 1500, drums: 'breach', stabs: [[0, 0.9]] },
  combat:  { bpm: 132, prog: [['Dm', 2], ['Bb', 2], ['F', 2], ['C', 2], ['Dm', 2], ['Bb', 2], ['Gm', 2], ['A', 2]], mix: { choir: 0.7, mchoir: 0.55, drone: 0.75, trem: 0, ost: 0.85, bass: 0.7, drums: 1 }, vowel: 'a', cut: 950, drums: 'combat', stabs: [[0, 0.7]], stabEvery: 2 },
  boss2:   { bpm: 140, prog: [['Dm', 1], ['Bb', 1], ['Gm', 1], ['A', 1], ['Dm', 1], ['Bb', 1], ['Eb', 1], ['A', 1]], mix: { choir: 0.9, mchoir: 0.8, drone: 0.9, trem: 0.25, ost: 0.95, bass: 0.85, drums: 1 }, vowel: 'a', cut: 1300, drums: 'boss2', stabs: [[0, 1], [6, 0.8], [10, 0.7]] },
  boss3:   { bpm: 152, prog: [['Dm', 1], ['Eb', 1], ['C', 1], ['A', 1], ['Dm', 1], ['Bbm', 1], ['Gm', 1], ['Csm', 1]], mix: { choir: 0.9, mchoir: 0.9, drone: 0.95, trem: 0.4, ost: 0.95, bass: 0.95, drums: 1 }, vowel: 'a', cut: 1900, drums: 'boss3', stabs: [[0, 1], [3, 0.7], [6, 0.9], [8, 0.8], [11, 0.7], [14, 0.9]] },
  death:   { bpm: 54, prog: [['Dm', 4], ['Bbm', 4], ['Gm6', 4], ['Dsus', 4]], mix: { choir: 0.6, mchoir: 0.5, drone: 0.4, trem: 0.1, ost: 0, bass: 0, drums: 0 }, vowel: 'u', cut: 240, drums: null },
  victory: { bpm: 80, prog: [['Bb', 2], ['C', 2], ['Dm', 2], ['F', 1], ['A', 1], ['D', 4]], mix: { choir: 0.95, mchoir: 0.7, drone: 0.6, trem: 0, ost: 0.35, bass: 0.3, drums: 0.8 }, vowel: 'a', cut: 1100, drums: 'victory', motif: true },
};
// 16-step drum patterns: [step, velocity(, every n bars)]
const PAT = {
  title:   { taiko: [[0, 0.8], [10, 0.45]], gran: [[0, 0.7, 2]], hi: [], rim: [], od: [] },
  dread:   { taiko: [[0, 0.75], [3, 0.5]], gran: [[0, 0.6, 4]], hi: [], rim: [[12, 0.12]], od: [[0, 0.5, 2]] },
  breach:  { taiko: [[0, 1], [6, 0.7], [8, 0.9], [11, 0.6], [14, 0.8]], gran: [[0, 1, 1]], hi: [[12, 0.4], [13, 0.5], [14, 0.6], [15, 0.8]], rim: [[4, 0.3], [12, 0.3]], od: [[0, 0.9]] },
  combat:  { taiko: [[0, 1], [3, 0.65], [6, 0.8], [8, 0.9], [11, 0.6], [13, 0.7]], gran: [[0, 0.9, 2]], hi: [[2, 0.45], [6, 0.35], [10, 0.5], [14, 0.4], [15, 0.55]], rim: [[4, 0.35], [12, 0.4], [7, 0.15], [15, 0.2]], od: [[0, 0.6, 4]] },
  boss2:   { taiko: [[0, 1], [2, 0.6], [3, 0.7], [6, 0.9], [8, 1], [10, 0.6], [11, 0.7], [14, 0.9]], gran: [[0, 1, 1]], hi: [[4, 0.4], [5, 0.3], [12, 0.5], [13, 0.5], [14, 0.6], [15, 0.8]], rim: [[4, 0.4], [12, 0.45], [7, 0.2], [15, 0.25]], od: [[0, 0.8]] },
  boss3:   { taiko: [[0, 1], [1, 0.5], [3, 0.8], [4, 0.6], [6, 1], [8, 1], [9, 0.5], [11, 0.8], [12, 0.6], [14, 1]], gran: [[0, 1, 1], [8, 0.85, 1]], hi: [[2, 0.5], [5, 0.5], [7, 0.4], [10, 0.5], [12, 0.6], [13, 0.7], [14, 0.8], [15, 0.9]], rim: [[4, 0.45], [12, 0.5]], od: [[0, 1], [8, 0.8]] },
  victory: { taiko: [[0, 0.9], [8, 0.8], [11, 0.5]], gran: [[0, 0.9, 2]], hi: [[12, 0.4], [14, 0.5]], rim: [[4, 0.25], [12, 0.25]], od: [[0, 0.7, 2]] },
};
const OST = [0, 2, 1, 2, 0, 2, 1, 3, 0, 2, 1, 2, 3, 2, 1, 2];
const MOTIF = [[57, 1], [62, 0.75], [64, 0.25], [65, 1.5], [64, 0.5], [62, 1], [69, 3]];
const MOTIF_MAJOR = [[57, 1], [62, 0.75], [64, 0.25], [66, 1.5], [64, 0.5], [66, 1], [74, 3]];

export class Score {
  constructor(ac, out, drums) {
    this.ac = ac; this.drums = drums || {}; this.state = null; this.target = null; this.queued = null; this.pending = false;
    this.out = ac.createGain(); this.out.gain.value = 1; this.out.connect(out);
    const g = (v = 0) => { const n = ac.createGain(); n.gain.value = v; return n; };
    this.bus = {};
    for (const k of [...LAYERS, 'brass']) { this.bus[k] = g(k === 'brass' ? 1 : 0); this.bus[k].connect(this.out); }
    this.rand = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    this.noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    { const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = this.rand() * 2 - 1; }
    this._buildChoir(); this._buildMaleChoir(); this._buildDrone(); this._buildTrem();
    this.step = 0; this.bar = 0; this.nextTime = 0; this.chordIdx = 0; this.chordBars = 0; this.chord = CH.Dm;
    this.cfg = STATES.title; this.motifPending = false; this.intensity = 0;
  }
  _osc(type, f, detune = 0) { const o = this.ac.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune; o.start(); return o; }
  _buildChoir() {
    const ac = this.ac;
    this.choirVoices = [];
    const sum = ac.createGain(); sum.gain.value = 0.16;
    const pans = [-0.45, -0.15, 0.2, 0.45];
    for (let i = 0; i < 4; i++) {
      const vg = ac.createGain(); const pn = ac.createStereoPanner(); pn.pan.value = pans[i];
      const oscs = [-11, -3, 4, 12].map((d) => { const o = this._osc('sawtooth', mtof(CH.Dm.v[i]), d + i * 1.7); o.connect(vg); return o; });
      const l = this._osc('sine', 4.6 + i * 0.37); const lg = ac.createGain(); lg.gain.value = 7; l.connect(lg); oscs.forEach((o) => lg.connect(o.detune));
      vg.connect(pn); pn.connect(sum);
      this.choirVoices.push({ oscs, vg });
    }
    // breath: noise into the same vocal tract
    const br = ac.createBufferSource(); br.buffer = this.noiseBuf; br.loop = true; br.start();
    const brf = ac.createBiquadFilter(); brf.type = 'highpass'; brf.frequency.value = 1200; const brg = ac.createGain(); brg.gain.value = 0.05;
    br.connect(brf); brf.connect(brg); brg.connect(sum);
    const out = ac.createGain();
    this.formants = [[760, 5, 1], [1180, 6, 0.55], [2600, 7, 0.22], [3300, 6, 0.08]].map(([f, Q, gg]) => {
      const b = ac.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = Q;
      const gn = ac.createGain(); gn.gain.value = gg * 2.2; sum.connect(b); b.connect(gn); gn.connect(out); return b;
    });
    const body = ac.createBiquadFilter(); body.type = 'lowpass'; body.frequency.value = 700; const bg = ac.createGain(); bg.gain.value = 0.35; sum.connect(body); body.connect(bg); bg.connect(out);
    const vl = this._osc('sine', 0.07); const vlg = ac.createGain(); vlg.gain.value = 60; vl.connect(vlg); vlg.connect(this.formants[0].frequency); vlg.connect(this.formants[1].frequency);
    const hs = ac.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 3000; hs.gain.value = -6; out.connect(hs);
    const dry = ac.createGain(); dry.gain.value = 0.7; hs.connect(dry); dry.connect(this.bus.choir);
    for (const [ms, rate, p] of [[14, 0.31, -0.8], [21, 0.23, 0.8]]) { // ensemble chorus
      const d = ac.createDelay(0.1); d.delayTime.value = ms / 1000; const lf = this._osc('sine', rate); const lfg = ac.createGain(); lfg.gain.value = 0.004;
      lf.connect(lfg); lfg.connect(d.delayTime);
      const pn = ac.createStereoPanner(); pn.pan.value = p; const gg = ac.createGain(); gg.gain.value = 0.5;
      hs.connect(d); d.connect(gg); gg.connect(pn); pn.connect(this.bus.choir);
    }
  }
  _buildMaleChoir() {
    const ac = this.ac;
    this.maleVoices = [];
    const sum = ac.createGain(); sum.gain.value = 0.14;
    const pans = [-0.3, 0.3, -0.1, 0.15];
    for (let i = 0; i < 4; i++) {
      const vg = ac.createGain(); const pn = ac.createStereoPanner(); pn.pan.value = pans[i];
      const oscs = [-9, 0, 8].map((d) => { const o = this._osc('sawtooth', 110, d - i * 1.3); o.connect(vg); return o; });
      const l = this._osc('sine', 4.1 + i * 0.29); const lg = ac.createGain(); lg.gain.value = 6; l.connect(lg); oscs.forEach((o) => lg.connect(o.detune));
      vg.connect(pn); pn.connect(sum);
      this.maleVoices.push({ oscs, vg });
    }
    const out = ac.createGain();
    this.mformants = [[520, 6, 1], [840, 7, 0.5], [2450, 8, 0.15]].map(([f, Q, gg]) => {
      const b = ac.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = Q;
      const gn = ac.createGain(); gn.gain.value = gg * 2.4; sum.connect(b); b.connect(gn); gn.connect(out); return b;
    });
    const body = ac.createBiquadFilter(); body.type = 'lowpass'; body.frequency.value = 420; const bg = ac.createGain(); bg.gain.value = 0.5; sum.connect(body); body.connect(bg); bg.connect(out);
    out.connect(this.bus.mchoir);
  }
  _buildDrone() {
    const ac = this.ac;
    this.droneF = ac.createBiquadFilter(); this.droneF.type = 'lowpass'; this.droneF.frequency.value = 400; this.droneF.Q.value = 1.2;
    const g = ac.createGain(); g.gain.value = 0.22; this.droneF.connect(g); g.connect(this.bus.drone);
    this.droneOsc = [[0, -6, 'sawtooth', 1], [0, 7, 'sawtooth', 1], [12, 3, 'sawtooth', 0.5], [7, 0, 'sawtooth', 0.35], [-12, 0, 'sine', 1.6]].map(([st, dt, type, lvl]) => {
      const o = this._osc(type, mtof(38 + st), dt); const og = ac.createGain(); og.gain.value = lvl; o.connect(og); og.connect(this.droneF); return { o, st };
    });
    const l = this._osc('sine', 0.11); const lg = ac.createGain(); lg.gain.value = 140; l.connect(lg); lg.connect(this.droneF.frequency);
  }
  _buildTrem() {
    const ac = this.ac;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
    const am = ac.createGain(); am.gain.value = 0.5; const l = this._osc('sine', 11); const lg = ac.createGain(); lg.gain.value = 0.5; l.connect(lg); lg.connect(am.gain);
    const g = ac.createGain(); g.gain.value = 0.05; f.connect(am); am.connect(g); g.connect(this.bus.trem);
    this.tremOsc = [0, 1].map((i) => { const o = this._osc('sawtooth', mtof(74 + i * 3), i ? 8 : -8); o.connect(f); return o; });
  }

  get stepDur() { return 60 / this.cfg.bpm / 4; }
  // time of the next bar line (step 0) as currently scheduled
  nextBarTime() { return this.step === 0 ? this.nextTime : this.nextTime + (16 - this.step) * this.stepDur; }

  setState(name, when = this.ac.currentTime, { immediate = false } = {}) {
    const cfg = STATES[name]; if (!cfg || name === this.target) return;
    this.target = name;
    if (name === this.state) { this.queued = null; return; } // changed our mind before the bar line
    const now = Math.max(when, this.ac.currentTime);
    if (!this.state || immediate || name === 'death' || this.nextTime < now - 0.5) { this.queued = null; this._apply(name, now, true); return; }
    let at = this.nextBarTime(), atStep = 0;
    if (at - now > 2.2) { const to = (4 - (this.step % 4)) % 4; at = this.nextTime + to * this.stepDur; atStep = (this.step + to) % 16; }
    if (at - now < 0.12) { at += 4 * this.stepDur; atStep = (atStep + 4) % 16; }
    const up = (RANK[name] ?? 0) > (RANK[this.state] ?? 0);
    this.queued = { name, at, atStep, up };
    if (up && at - now > 0.5) this._riser(now, at);
  }
  _apply(name, t, hard = false) {
    const cfg = STATES[name], prev = this.state;
    this.state = name; this.cfg = cfg;
    const fadeTc = name === 'death' ? 0.6 : (RANK[name] > (RANK[prev] ?? 0) ? 0.25 : 1.4);
    for (const k of LAYERS) { const p = this.bus[k].gain; p.cancelScheduledValues(t); p.setTargetAtTime(cfg.mix[k] * (k === 'drums' ? 1 : 1), t, k === 'drums' && name === 'death' ? 0.15 : fadeTc); }
    this.droneF.frequency.setTargetAtTime(cfg.cut, t, 1.5);
    const v = VOWELS[cfg.vowel];
    this.formants.forEach((b, i) => { if (i < 3) b.frequency.setTargetAtTime(v[i], t, 1.2); });
    if (hard) { this.nextTime = t + 0.03; }
    this.step = 0; this.pending = true;
    if (cfg.motif) this.motifPending = true;
    const up = (RANK[name] ?? 0) > (RANK[prev] ?? 0);
    if (name === 'death') { this._drum('gran', t + 0.02, 1, 0, this.bus.brass); this._drum('impact', t + 0.02, 0.8, 0, this.bus.brass); }
    else if (prev && up && RANK[name] >= RANK.breach) { this._drum('gran', t, 1, 0, this.bus.brass); this._drum('impact', t, 0.9, 0, this.bus.brass); this.braam(t, CH[cfg.prog[0][0]], name === 'boss3' ? 1 : 0.8); }
  }
  _riser(now, at) {
    const b = this.drums.swell?.[0]; if (!b) return;
    const s = this.ac.createBufferSource(); s.buffer = b; const g = this.ac.createGain(); g.gain.value = 0.55 * (b._gain ?? 1);
    s.connect(g); g.connect(this.bus.brass);
    const peak = 3.0, lead = Math.min(peak, at - now); s.start(now, peak - lead); s.onended = () => { s.disconnect(); g.disconnect(); };
  }

  _chordAt(time) {
    const c = this.chord, T = 0.09;
    this.choirVoices.forEach((v, i) => {
      v.oscs.forEach((o) => o.frequency.setTargetAtTime(mtof(c.v[i]), time, T));
      v.vg.gain.setTargetAtTime(0.55, Math.max(0, time - 0.05), 0.04); v.vg.gain.setTargetAtTime(1, time + 0.06, 0.9);
    });
    const mv = [c.r + 12, c.r + 19, c.r + 24, c.v[2] - 12];
    this.maleVoices.forEach((v, i) => { v.oscs.forEach((o) => o.frequency.setTargetAtTime(mtof(mv[i]), time, 0.12)); v.vg.gain.setTargetAtTime(0.6, Math.max(0, time - 0.05), 0.05); v.vg.gain.setTargetAtTime(1, time + 0.08, 1.2); });
    this.droneOsc.forEach(({ o, st }) => o.frequency.setTargetAtTime(mtof(c.r + st), time, 0.12));
    this.tremOsc.forEach((o, i) => o.frequency.setTargetAtTime(mtof(c.v[2 + i] + 12), time, 0.05));
  }

  _drum(name, time, vel, pan = 0, dest = null) {
    const bufs = this.drums[name]; if (!bufs || !bufs.length) return;
    const ac = this.ac, s = ac.createBufferSource(); s.buffer = bufs[Math.floor(this.rand() * bufs.length)];
    s.playbackRate.value = 1 + (this.rand() - 0.5) * 0.04;
    const g = ac.createGain(); g.gain.value = (s.buffer._gain ?? 1) * vel * ({ gran: 0.9, taiko: 0.75, odaiko: 0.9, rim: 0.35, impact: 0.8 }[name] ?? 0.45);
    let last = g; s.connect(g);
    if (pan) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); last = p; }
    last.connect(dest || this.bus.drums);
    s.start(Math.max(time, ac.currentTime)); s.onended = () => { s.disconnect(); g.disconnect(); if (last !== g) last.disconnect(); };
  }
  // taiko ensemble: lead hit + a second player a hair late, panned
  _taiko(time, vel) {
    const p = (this.rand() - 0.5) * 0.5;
    this._drum('taiko', time, vel, p);
    if (vel > 0.55) this._drum('taiko', time + 0.009 + this.rand() * 0.012, vel * 0.6, -p * 1.6);
  }

  _ostNote(time, midi, vel, dur, bus = this.bus.ost, lvl = 0.055, cut = 900) {
    const ac = this.ac;
    const g = ac.createGain(); g.gain.setValueAtTime(0, time); g.gain.linearRampToValueAtTime(lvl * vel, time + 0.006); g.gain.setTargetAtTime(0, time + 0.02, dur * 0.35);
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(cut * 3.5, time); f.frequency.setTargetAtTime(cut, time, 0.05); f.Q.value = 2;
    for (const d of [-7, 7]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(midi); o.detune.value = d; o.connect(f); o.start(time); o.stop(time + dur + 0.2); if (d > 0) o.onended = () => { f.disconnect(); g.disconnect(); }; }
    f.connect(g); g.connect(bus);
  }

  brassNote(time, midi, dur, vel = 1, dest = this.bus.brass) {
    const ac = this.ac;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.5;
    f.frequency.setValueAtTime(260, time); f.frequency.linearRampToValueAtTime(700 + 2600 * vel, time + 0.07); f.frequency.setTargetAtTime(900 + 1100 * vel, time + 0.08, 0.3);
    const g = ac.createGain(); g.gain.setValueAtTime(0, time); g.gain.linearRampToValueAtTime(0.11 * vel, time + 0.045);
    g.gain.setTargetAtTime(0.085 * vel, time + 0.05, 0.2); g.gain.setTargetAtTime(0, time + dur, 0.09);
    const oscs = [];
    for (const [d, type, lv, oct] of [[-6, 'sawtooth', 1, 0], [5, 'sawtooth', 1, 0], [0, 'sawtooth', 0.6, -12], [2, 'square', 0.25, 0]]) {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = mtof(midi + oct); o.detune.value = d;
      o.detune.setValueAtTime(d - 40, time); o.detune.linearRampToValueAtTime(d, time + 0.06); // lip scoop
      const og = ac.createGain(); og.gain.value = lv; o.connect(og); og.connect(f); o.start(time); o.stop(time + dur + 0.6); oscs.push(o);
    }
    oscs[0].onended = () => { f.disconnect(); g.disconnect(); };
    f.connect(g); g.connect(dest);
  }
  // BRAAM: low brass cluster ripping open (filter sweep + drive) over a sub
  braam(time, chord = this.chord, vel = 1) {
    const ac = this.ac, r = chord.r, L = 3.6;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(140, time); f.frequency.exponentialRampToValueAtTime(1500 * vel + 300, time + 0.32); f.frequency.setTargetAtTime(420, time + 0.4, 0.9);
    const sh = ac.createWaveShaper(); const c = new Float32Array(512); for (let i = 0; i < 512; i++) { const x = i / 255.5 - 1; c[i] = Math.tanh(2.4 * x); } sh.curve = c;
    const g = ac.createGain(); g.gain.setValueAtTime(0, time); g.gain.linearRampToValueAtTime(0.16 * vel, time + 0.07); g.gain.setTargetAtTime(0.1 * vel, time + 0.1, 0.8); g.gain.setTargetAtTime(0, time + L - 1, 0.35);
    const oscs = [];
    for (const m of [r, r + 7, r + 12, r + 19]) for (const d of [-12, 0, 11]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = d; o.connect(f); o.start(time); o.stop(time + L + 0.5); oscs.push(o); }
    const sub = ac.createOscillator(); sub.frequency.value = mtof(r - 12); const sg = ac.createGain(); sg.gain.setValueAtTime(0, time); sg.gain.linearRampToValueAtTime(0.35 * vel, time + 0.05); sg.gain.setTargetAtTime(0, time + 0.6, 0.8); sub.connect(sg); sg.connect(g); sub.start(time); sub.stop(time + L + 0.5);
    f.connect(sh); sh.connect(g); g.connect(this.bus.brass);
    oscs[0].onended = () => { f.disconnect(); sh.disconnect(); g.disconnect(); sg.disconnect(); };
  }
  // kill stinger (streak raises it)
  stinger(streak = 1, when = this.ac.currentTime + 0.03) {
    const top = [62, 65, 69, 74][Math.min(3, Math.max(0, streak - 1))];
    this.brassNote(when, top - 5, 0.16, 0.8);
    this.brassNote(when + 0.15, top, 0.9, 1);
    this.brassNote(when + 0.15, top - 12, 0.9, 0.7);
    this._taiko(when + 0.15, 0.9);
  }
  // heroic horn call for a weak-point cut (n = cuts so far; climbs higher each time), snapped to the next 8th
  heroic(n = 1) {
    const now = this.ac.currentTime, sd = this.stepDur;
    let t = this.nextTime; if (this.step % 2) t += sd; if (t < now + 0.03) t += 2 * sd;
    const lift = [0, 3, 5, 7][Math.min(3, Math.max(0, n - 1))];
    const line = [[57 + lift, 1], [62 + lift, 1], [69 + lift, 4]];
    let tt = t;
    for (const [m, b] of line) { this.brassNote(tt, m, b * sd * 1.9, 1); this.brassNote(tt, m - 12, b * sd * 1.9, 0.7); tt += b * sd * 2; }
    this._drum('gran', t, 0.8); this._taiko(t, 1);
  }
  motif(when = this.ac.currentTime + 0.05, major = false) {
    const beat = 60 / Math.max(70, this.cfg.bpm || 80); let t = when;
    for (const [m, b] of major ? MOTIF_MAJOR : MOTIF) { this.brassNote(t, m, b * beat * 0.95, 1); this.brassNote(t, m - 12, b * beat * 0.95, 0.6); t += b * beat; }
  }

  // schedule musical events up to `until` (audio clock)
  schedule(until) {
    if (!this.state) return;
    const now = this.ac.currentTime;
    if (this.nextTime < now - 0.2) this.nextTime = now + 0.02; // hitch: skip, don't burst
    while (this.nextTime < until) {
      let t = this.nextTime;
      if (this.queued && t >= this.queued.at - 1e-3) { const q = this.queued; this.queued = null; this._apply(q.name, t); }
      const cfg = this.cfg, s = this.step;
      if (s === 0) {
        if (this.pending) { this.pending = false; this.chordIdx = 0; this.chordBars = 0; this.chord = CH[cfg.prog[0][0]]; this._chordAt(t); }
        else {
          this.chordBars++;
          if (this.chordBars >= cfg.prog[this.chordIdx][1]) { this.chordBars = 0; this.chordIdx = (this.chordIdx + 1) % cfg.prog.length; this.chord = CH[cfg.prog[this.chordIdx][0]]; this._chordAt(t); }
        }
        if (this.motifPending) { this.motifPending = false; this.motif(t, this.state === 'victory'); }
        this.bar++;
      }
      const pat = cfg.drums && PAT[cfg.drums];
      if (pat) {
        const hum = () => t + (this.rand() - 0.5) * 0.008;
        for (const [st, v] of pat.taiko) if (st === s) this._taiko(hum(), v * (0.9 + this.rand() * 0.15));
        for (const [st, v, every = 1] of pat.gran) if (st === s && this.bar % every === 1 % every) this._drum('gran', t, v);
        for (const [st, v, every = 1] of pat.od) if (st === s && this.bar % every === 1 % every) this._drum('odaiko', t, v);
        for (const [st, v] of pat.hi) if (st === s) this._drum('taiko_hi', hum(), v, (this.rand() - 0.5) * 0.6);
        for (const [st, v] of pat.rim) if (st === s) this._drum('rim', hum(), v, 0.25);
      }
      // taiko roll into a queued (escalating) state over the last beat
      if (this.queued?.up) { const left = this.queued.at - t; if (left > 0 && left <= 4 * this.stepDur + 1e-3) this._drum('taiko_hi', t, 0.35 + 0.5 * (1 - left / (4 * this.stepDur)), (s % 2 ? 0.3 : -0.3)); }
      if (cfg.stabs && this.bar % (cfg.stabEvery || 1) === 0) {
        for (const [st, v] of cfg.stabs) if (st === s) { const c = this.chord.v; const dur = 60 / cfg.bpm * 0.45; this.brassNote(t, c[0] - 12, dur, v * 0.8); this.brassNote(t, c[1] - 12, dur, v * 0.7); this.brassNote(t, c[2] - 12, dur, v * 0.6); this.brassNote(t, this.chord.r + 12, dur, v * 0.7); }
      }
      if (cfg.mix.ost > 0.01) {
        const idx = OST[s];
        if (idx >= 0) { const m = this.chord.v[idx] - 12 + (s >= 12 && this.bar % 2 ? 12 : 0); this._ostNote(t, m, s % 4 === 0 ? 1 : 0.7, this.stepDur * 0.9); }
      }
      if (cfg.mix.bass > 0.01 && s % 2 === 0) { // cello/bass 8ths on the root, octave jump on the "and" of 4
        const m = this.chord.r + 12 + (s === 14 ? 12 : 0);
        this._ostNote(t, m, s % 8 === 0 ? 1 : 0.75, this.stepDur * 1.6, this.bus.bass, 0.09, 420);
      }
      this.step = (s + 1) % 16;
      this.nextTime += this.stepDur;
    }
  }
}
