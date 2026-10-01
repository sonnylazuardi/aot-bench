// Adaptive orchestral score — adventure / anime-battle hype: choir pads + "hey!/ha!" shouts, driving staccato strings,
// taiko ensemble + a punchy kit (kick/snare/hats), bold brass, an original heroic theme.
//
//   Instruments are SAMPLED ONCE per page, lazily (ensureBank(): at 'loaded' via index.js, or the first Score): every note
//   family is rendered at a few anchor pitches on OfflineAudioContexts (native DSP on the render thread). Main-thread work
//   per buffer = building a small graph + one level/loop-crossfade pass, with a yield between buffers.
//   Families: choirF (female 'aah', 2×5 detuned singers → vowel formants, vibrato, breath), choirM (male 'oh'), hey/ha
//   (shouts), strL / strH (string sections, bowed attack), spic (staccato), horn (legato section), stab (trombones+tuba
//   with growl), braam, kick, snare, hat, taiko ×3, odaiko, gran cassa, shime, crash, swell, impact.
//   Playback = buffer voices on the AudioContext clock; schedule(until) is a 16th-note lookahead scheduler.
//
//   Arc: title = soaring adventure theme (D major, I–bVII–IV lift, 112 bpm) · calm/dread = anticipation, pulsing strings
//   and building drums (124/138 bpm) · breach = big heroic hit into a 150 bpm groove · combat 152 (Dm) → boss2 160 (Em)
//   → boss3 168 (Fm): 16-bar phrases, A = ostinato + kit + shouts, B = the theme on horns (+choir/strings) · victory =
//   major-key fanfare · death = two bars of breath, then a "get back up" groove. setState() lands on the next bar
//   (next beat if the bar is > 2.5 s away; breach/death near-immediate) with riser + roll in, BRAAM/impact on landing.
//   API (used by src/audio/index.js): new Score(ac, out, drums), Score.ready(), setState(name, when?, {immediate}),
//   schedule(until), stinger(streak), heroic(n), motif(when, major), braam(time, chord, vel), nextBarTime(), state, cfg.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const range = (a, b, s) => { const o = []; for (let m = a; m <= b; m += s) o.push(m); return o; };

// ================================================================ instrument bank
const BSR = 32000;
const NB = new Map(); // white-noise AudioBuffer per sample rate (context-independent)
function noiseBuf(sr) {
  let b = NB.get(sr); if (b) return b;
  const r = mulberry32(777 + sr), n = Math.round(sr * 1.25); b = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: sr });
  const d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
  NB.set(sr, b); return b;
}
// tiny graph DSL bound to one OfflineAudioContext
function K(oc, r) {
  const k = {
    oc, r, T: oc.length / oc.sampleRate,
    g(v = 1) { const n = oc.createGain(); n.gain.value = v; return n; },
    f(type, freq, Q = 0.707, gain = 0) { const b = oc.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.Q.value = Q; b.gain.value = gain; return b; },
    o(type, freq, det = 0, t0 = 0) { const o = oc.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = det; o.start(t0); return o; },
    lfo(rate, depth, param, delay = 0, type = 'sine', t0 = 0) {
      const o = k.o(type, rate, 0, t0), g = oc.createGain();
      if (delay > 0) { g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(depth, delay); } else g.gain.value = depth;
      o.connect(g); g.connect(param); return o;
    },
    noise(t0 = 0) { const s = oc.createBufferSource(); s.buffer = noiseBuf(oc.sampleRate); s.loop = true; s.start(t0, r() * 1.1); return s; },
    shaper(drive) { const ws = oc.createWaveShaper(), n = 1024, c = new Float32Array(n), d = Math.tanh(drive); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(drive * x) / d; } ws.curve = c; return ws; },
    chain(...ns) { for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; },
    env(param, pts) { param.setValueAtTime(pts[0][1], pts[0][0]); for (let i = 1; i < pts.length; i++) { const [t, v, kind] = pts[i]; if (kind === 'x') param.exponentialRampToValueAtTime(Math.max(1e-4, v), t); else if (kind === 'tc') param.setTargetAtTime(v, t, pts[i][3]); else param.linearRampToValueAtTime(v, t); } },
  };
  return k;
}

// ---- voices
function bChoir(k, midi, male) {
  const { oc, r } = k, f0 = mtof(midi);
  const merger = oc.createChannelMerger(2); merger.connect(oc.destination);
  // vowel formants [Hz, Q, gain]: female 'aah', male 'oh'
  const FM = male ? [[420, 5, 1], [800, 7, 0.55], [2450, 9, 0.16], [2900, 10, 0.07]] : [[800, 4.5, 1], [1180, 6, 0.55], [2850, 9, 0.24], [3800, 10, 0.08]];
  for (let side = 0; side < 2; side++) {
    const sum = k.g(1), n = male ? 4 : 5;
    for (let i = 0; i < n; i++) {
      const jit = r() * 0.05, det = (r() - 0.5) * 18;
      const o = k.o('sawtooth', f0, det, jit);
      k.lfo(4.7 + r() * 1.3, 13 + r() * 11, o.detune, 0.3 + r() * 0.35, 'sine', jit);
      const vg = k.g(0); vg.gain.setValueAtTime(0, jit); vg.gain.linearRampToValueAtTime(1, jit + 0.07 + r() * 0.05);
      o.connect(vg); vg.connect(sum);
    }
    const wob = k.g(0.9); k.lfo(0.3 + r() * 0.3, 0.1, wob.gain); sum.connect(wob);
    const br = k.chain(k.noise(), k.f('highpass', 900, 0.6), k.g(male ? 0.07 : 0.1)); br.connect(wob); // breath
    const tilt = k.f('lowpass', male ? 2000 : 4000, 0.5); wob.connect(tilt);
    const out = k.g(1), shift = side ? 1.035 : 0.965;
    for (const [F, Q, gg] of FM) { const bp = k.f('bandpass', Math.max(F, f0 * 1.15) * shift, Q); const g = k.g(gg * 3); tilt.connect(bp); bp.connect(g); g.connect(out); }
    k.chain(tilt, k.f('lowpass', male ? 380 : 650, 0.7), k.g(0.22), out);
    k.chain(out, k.f('highpass', male ? 75 : 150, 0.7)).connect(merger, 0, side);
  }
}
// string sections: type 'low' (celli+basses sustain) | 'high' (violins) | 'spic' (staccato)
function bStrings(k, midi, type) {
  const { oc, r } = k, f0 = mtof(midi), spic = type === 'spic', low = type === 'low', n = spic ? 4 : low ? 6 : 8;
  const sum = k.g(1 / n);
  for (let i = 0; i < n; i++) {
    const jit = spic ? r() * 0.008 : r() * 0.03, det = (r() - 0.5) * (spic ? 12 : 16);
    const o = k.o('sawtooth', f0, det, jit);
    if (!spic) { k.lfo(5 + r() * 1.3, 7 + r() * 9, o.detune, 0.25 + r() * 0.3, 'sine', jit); k.lfo(0.1 + r() * 0.2, 4, o.detune); }
    o.connect(sum);
  }
  const bow = k.chain(k.noise(), k.f('bandpass', low ? 2200 : 3800, 0.8), k.g(0)); bow.connect(sum);
  const amp = k.g(0), lp = k.f('lowpass', 1000, 0.6);
  const cut = Math.min(spic ? 7000 : 6500, Math.max(low ? 1300 : 2600, f0 * (low ? 9 : 7)));
  if (spic) {
    k.env(amp.gain, [[0, 0], [0.004, 1], [0.03, 1, 'tc', 0.075]]);
    k.env(lp.frequency, [[0, cut * 1.6], [0.01, cut * 1.6], [0.012, cut * 0.45, 'tc', 0.06]]);
    k.env(bow.gain, [[0, 0], [0.003, 0.9], [0.01, 0, 'tc', 0.012]]);
  } else {
    const a = low ? 0.13 : 0.1;
    k.env(amp.gain, [[0, 0], [a, 1]]);
    k.env(lp.frequency, [[0, cut * 0.3], [a * 1.4, cut, 'x']]);
    k.env(bow.gain, [[0, 0], [0.02, 0.5], [0.05, 0.05, 'tc', 0.04]]);
  }
  const body = low ? [[230, 4, 1.2], [700, 2, 1.5]] : [[480, 2.5, 1.5], [2600, 3, 1.2]];
  let last = k.chain(sum, lp);
  for (const [f, gdb, q] of body) last = k.chain(last, k.f('peaking', f, q, gdb));
  k.chain(last, amp, k.f('highpass', Math.max(30, f0 * 0.6), 0.7), oc.destination);
}
function bHorn(k, midi) {
  const { oc, r } = k, f0 = mtof(midi), n = 5, sum = k.g(1 / n);
  for (let i = 0; i < n; i++) {
    const jit = r() * 0.025, det = (r() - 0.5) * 12;
    const o = k.o('sawtooth', f0, det, jit);
    o.detune.setValueAtTime(det - 35, jit); o.detune.linearRampToValueAtTime(det, jit + 0.07); // lip scoop
    k.lfo(4.8 + r(), 6 + r() * 5, o.detune, 0.6 + r() * 0.3);
    o.connect(sum);
  }
  const lp = k.f('lowpass', 300, 0.9), top = Math.min(4200, f0 * 16), mid = Math.min(2600, Math.max(900, f0 * 6.5));
  k.env(lp.frequency, [[0, 280], [0.06, top, 'x'], [0.08, mid, 'tc', 0.22]]);
  const amp = k.g(0); k.env(amp.gain, [[0, 0], [0.045, 1], [0.07, 0.82, 'tc', 0.2]]);
  k.chain(sum, k.shaper(1.8), lp, k.f('peaking', 520, 1.2, 3), amp, k.f('highpass', 70, 0.7), oc.destination);
}
function bStab(k, midi) {
  const { oc, r } = k, f0 = mtof(midi), sum = k.g(0.22);
  for (let i = 0; i < 4; i++) { const o = k.o('sawtooth', f0, (r() - 0.5) * 14, r() * 0.006); o.connect(sum); }
  for (let i = 0; i < 2; i++) { const o = k.o('sawtooth', f0 / 2, (r() - 0.5) * 10, r() * 0.006); const g = k.g(0.5); o.connect(g); g.connect(sum); }
  const growl = k.g(0.85); k.lfo(33 + r() * 6, 0.15, growl.gain);
  const lp = k.f('lowpass', 200, 1.4); k.env(lp.frequency, [[0, 200], [0.025, Math.min(4500, f0 * 40), 'x'], [0.03, Math.min(1600, f0 * 12), 'tc', 0.12]]);
  const amp = k.g(0); k.env(amp.gain, [[0, 0], [0.012, 1], [0.05, 0.55, 'tc', 0.1], [0.42, 0, 'tc', 0.1]]);
  k.chain(sum, growl, k.shaper(2.6), lp, amp, k.f('highpass', 40, 0.7), oc.destination);
}
function bBraam(k, midi) {
  const { oc, r } = k, f0 = mtof(midi), merger = oc.createChannelMerger(2); merger.connect(oc.destination);
  const sub = k.o('sine', f0 / 2), sg = k.g(0); k.env(sg.gain, [[0, 0], [0.04, 0.35], [0.3, 0, 'tc', 0.7]]); sub.connect(sg);
  for (let side = 0; side < 2; side++) {
    const sum = k.g(0.16);
    for (let i = 0; i < 5; i++) { const o = k.o(i === 4 ? 'square' : 'sawtooth', f0 * (i === 3 ? 2 : 1), (r() - 0.5) * 22, r() * 0.01); o.connect(sum); }
    const growl = k.g(0.8); k.lfo(26 + r() * 6, 0.2, growl.gain);
    const lp = k.f('lowpass', 110, 2.2); k.env(lp.frequency, [[0, 110], [0.32, 2400, 'x'], [0.36, 650, 'tc', 0.7]]);
    const amp = k.g(0); k.env(amp.gain, [[0, 0], [0.06, 1], [0.3, 0.6, 'tc', 0.6], [2.4, 0, 'tc', 0.45]]);
    const out = k.chain(sum, growl, k.shaper(3), lp, amp); sg.connect(out);
    k.chain(out, k.f('highpass', 32, 0.7)).connect(merger, 0, side);
  }
}
// ---- percussion
function membrane(k, out, { f0, f1, f2 = f1 * 0.9, glide = 0.035, tc, gain = 1, at = 0 }) {
  const o = k.o('sine', f0, 0, at); o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + glide); o.frequency.exponentialRampToValueAtTime(f2, at + tc * 3);
  const g = k.g(0); k.env(g.gain, [[at, 0], [at + 0.003, gain], [at + 0.008, 0, 'tc', tc]]); o.connect(g); g.connect(out);
}
function burst(k, out, { type = 'bandpass', f, Q = 0.8, tc, gain, at = 0, hold = 0 }) {
  const g = k.g(0); k.env(g.gain, [[at, 0], [at + 0.001, gain], [at + 0.002 + hold, 0, 'tc', tc]]);
  k.chain(k.noise(at), k.f(type, f, Q), g, out);
}
function bTaiko(k, m, v) {
  const { oc, r } = k, sum = k.g(1), f = 78 + v * 7 + r() * 4;
  membrane(k, sum, { f0: f * 1.8, f1: f, f2: f * 0.88, tc: 0.2 });
  membrane(k, sum, { f0: f * 2.6, f1: f * 1.59, tc: 0.1, gain: 0.55 });
  membrane(k, sum, { f0: f * 3.6, f1: f * 2.31, tc: 0.06, gain: 0.35 });
  burst(k, sum, { f: 420 + v * 60, Q: 0.9, tc: 0.05, gain: 0.7 });
  burst(k, sum, { f: 1400, Q: 0.7, tc: 0.02, gain: 0.35 });
  burst(k, sum, { type: 'highpass', f: 3200, tc: 0.006, gain: 0.3 });
  k.chain(sum, k.shaper(2), k.f('highpass', 48, 0.7), k.f('peaking', 180, 1, 3), oc.destination);
}
function bOdaiko(k) {
  const { oc } = k, sum = k.g(1);
  membrane(k, sum, { f0: 95, f1: 50, f2: 44, glide: 0.06, tc: 0.55 });
  membrane(k, sum, { f0: 150, f1: 80, tc: 0.25, gain: 0.5 });
  burst(k, sum, { f: 280, Q: 0.7, tc: 0.07, gain: 0.5 });
  burst(k, sum, { type: 'lowpass', f: 160, tc: 0.3, gain: 0.35 });
  burst(k, sum, { type: 'highpass', f: 2500, tc: 0.008, gain: 0.25 });
  k.chain(sum, k.shaper(1.4), k.f('highpass', 38, 0.7), oc.destination);
}
function bGran(k) {
  const { oc } = k, sum = k.g(1);
  membrane(k, sum, { f0: 90, f1: 62, f2: 55, glide: 0.05, tc: 0.42 });
  membrane(k, sum, { f0: 140, f1: 98, tc: 0.22, gain: 0.5 });
  burst(k, sum, { type: 'lowpass', f: 700, tc: 0.08, gain: 0.5 });
  burst(k, sum, { f: 1800, Q: 0.7, tc: 0.015, gain: 0.2 });
  k.chain(sum, k.shaper(1.4), k.f('highpass', 42, 0.7), oc.destination);
}
function bShime(k, m, v) {
  const { oc, r } = k, sum = k.g(1), f = 340 + v * 70 + r() * 20;
  membrane(k, sum, { f0: f * 1.4, f1: f, glide: 0.01, tc: 0.055 });
  membrane(k, sum, { f0: f * 2.2, f1: f * 1.65, glide: 0.01, tc: 0.03, gain: 0.35 });
  burst(k, sum, { f: 2300, Q: 1.1, tc: 0.03, gain: 0.7 });
  burst(k, sum, { type: 'highpass', f: 5000, tc: 0.004, gain: 0.35 });
  k.chain(sum, k.f('highpass', 140, 0.7), oc.destination);
}
function bSnare(k, m, v) {
  const { oc } = k, sum = k.g(1);
  membrane(k, sum, { f0: 240, f1: 195 + v * 12, glide: 0.012, tc: 0.05, gain: 0.6 });
  const g = k.g(0); k.env(g.gain, [[0, 0], [0.001, 1], [0.004, 0, 'tc', 0.1 + v * 0.02]]);
  k.chain(k.noise(), k.f('highpass', 1700, 0.7), k.f('peaking', 5200, 1, 6), g, sum);
  k.chain(sum, k.f('highpass', 120, 0.7), oc.destination);
}
function bKick(k) {
  const { oc } = k, sum = k.g(1);
  membrane(k, sum, { f0: 170, f1: 58, f2: 50, glide: 0.03, tc: 0.13 });
  membrane(k, sum, { f0: 260, f1: 110, glide: 0.02, tc: 0.04, gain: 0.4 });
  burst(k, sum, { type: 'highpass', f: 2800, tc: 0.005, gain: 0.45 });
  burst(k, sum, { f: 900, Q: 0.8, tc: 0.012, gain: 0.3 });
  k.chain(sum, k.shaper(2.2), k.f('highpass', 38, 0.7), oc.destination);
}
function bHat(k, m, v) {
  const { oc } = k, g = k.g(0); k.env(g.gain, [[0, 0], [0.001, 1], [0.003, 0, 'tc', v ? 0.13 : 0.022]]);
  k.chain(k.noise(), k.f('highpass', 7000, 0.7), k.f('peaking', 10500, 1.2, 5), g, oc.destination);
}
// choir shout ('hey!' / 'ha!'): 4 men + 2 women an octave up, gritty, pitch falling, h-onset → vowel formants
function bShout(k, midi, hey) {
  const { oc, r } = k, f0 = mtof(midi), merger = oc.createChannelMerger(2); merger.connect(oc.destination);
  for (let side = 0; side < 2; side++) {
    const sum = k.g(0.2);
    for (let i = 0; i < 6; i++) {
      const fem = i >= 4, jit = r() * 0.03, det = (r() - 0.5) * 35;
      const o = k.o('sawtooth', f0 * (fem ? 2 : 1), det, jit);
      o.detune.setValueAtTime(det + 70, jit); o.detune.linearRampToValueAtTime(det - 130, jit + 0.4);
      o.connect(sum);
    }
    const amp = k.g(0); k.env(amp.gain, [[0, 0], [0.035, 0], [0.05, 1], [0.09, 0.75, 'tc', 0.08], [0.24, 0, 'tc', 0.05]]);
    const hh = k.g(0); k.env(hh.gain, [[0, 0], [0.004, 0.35], [0.045, 0]]); k.chain(k.noise(), k.f('bandpass', 1600, 0.5), hh);
    const pre = k.chain(sum, k.shaper(1.8), amp); const out = k.g(1); hh.connect(out);
    const F = hey ? [[540, 330, 5, 1], [1850, 2250, 7, 0.6], [2550, 2950, 8, 0.3]] : [[820, 760, 5, 1], [1250, 1200, 7, 0.55], [2750, 2700, 8, 0.25]];
    for (const [a, b, Q, gg] of F) { const bp = k.f('bandpass', a, Q); k.env(bp.frequency, [[0.05, a], [0.25, b]]); k.chain(pre, bp, k.g(gg * 3), out); }
    k.chain(pre, k.f('lowpass', 500, 0.7), k.g(0.2), out);
    k.chain(out, k.f('highpass', 110, 0.7)).connect(merger, 0, side);
  }
}
function bCrash(k) {
  const { oc, r } = k, merger = oc.createChannelMerger(2); merger.connect(oc.destination);
  for (let side = 0; side < 2; side++) {
    const sum = k.g(1), amp = k.g(0); k.env(amp.gain, [[0, 0], [0.002, 1], [0.01, 0, 'tc', 1.25]]);
    k.chain(k.noise(), k.f('highpass', 2800, 0.6), k.g(0.8), sum);
    for (const fr of [317, 529, 797, 1213, 1789]) { const o = k.o('square', fr * (1 + side * 0.023 + r() * 0.01)); k.chain(o, k.g(0.06), sum); }
    const hit = k.g(0); k.env(hit.gain, [[0, 0], [0.001, 0.8], [0.004, 0, 'tc', 0.06]]); k.chain(k.noise(), k.f('bandpass', 4000, 0.5), hit, sum);
    k.chain(sum, k.f('bandpass', 5200, 0.35), amp, k.f('highpass', 400, 0.7)).connect(merger, 0, side);
  }
}
function bSwell(k) { // reverse-cymbal riser, peak at the very end (T)
  const { oc, r, T } = k, merger = oc.createChannelMerger(2); merger.connect(oc.destination);
  for (let side = 0; side < 2; side++) {
    const amp = k.g(0); k.env(amp.gain, [[0, 0.0005], [T - 0.04, 1, 'x'], [T - 0.005, 0]]);
    const sum = k.g(1);
    k.chain(k.noise(), k.f('highpass', 3000, 0.6), k.g(0.7), sum);
    for (const fr of [331, 547, 811, 1237]) k.chain(k.o('square', fr * (1 + side * 0.02 + r() * 0.01)), k.g(0.05), sum);
    const w = k.f('bandpass', 400, 1.2); k.env(w.frequency, [[0, 400], [T, 5000, 'x']]); k.chain(k.noise(), w, k.g(0.8), sum);
    k.chain(sum, amp, k.f('highpass', 250, 0.7)).connect(merger, 0, side);
  }
}
function bImpact(k) {
  const { oc, r } = k, merger = oc.createChannelMerger(2); merger.connect(oc.destination);
  const boom = k.g(1); membrane(k, boom, { f0: 110, f1: 45, f2: 30, glide: 0.08, tc: 0.7 });
  for (let side = 0; side < 2; side++) {
    const sum = k.g(1); boom.connect(sum);
    burst(k, sum, { type: 'lowpass', f: 190, tc: 1.1, gain: 0.55, at: 0.01 });
    burst(k, sum, { f: 1300, Q: 0.6, tc: 0.06, gain: 0.7 });
    const sh = k.g(0); k.env(sh.gain, [[0, 0], [0.02, 0.12], [0.05, 0, 'tc', 1.3]]);
    for (const fr of [233, 349, 523, 698]) k.chain(k.o('sawtooth', fr * (1 + side * 0.012), (r() - 0.5) * 20), k.f('bandpass', 2600, 1.5), sh);
    sh.connect(sum);
    k.chain(sum, k.shaper(1.5), k.f('highpass', 30, 0.7)).connect(merger, 0, side);
  }
}

// dur s · loop [start,end] s (sustains) · ch · sr · anchors (pitched) or variants (drums) · fam gain at playback
const FAM = {
  taiko: { variants: 3, dur: 1.5, build: bTaiko },
  gran: { variants: 1, dur: 3.6, build: bGran },
  shime: { variants: 2, dur: 0.45, sr: 44100, build: bShime },
  odaiko: { variants: 1, dur: 3.2, build: bOdaiko },
  crash: { variants: 1, dur: 4, ch: 2, sr: 44100, build: bCrash },
  swell: { variants: 1, dur: 4, ch: 2, sr: 44100, build: bSwell },
  impact: { variants: 1, dur: 4.5, ch: 2, build: bImpact },
  snare: { variants: 2, dur: 0.5, sr: 44100, build: bSnare },
  kick: { variants: 1, dur: 0.6, build: bKick },
  hat: { variants: 2, dur: 0.45, sr: 44100, build: bHat },
  hey: { anchors: [46, 50, 54, 58], dur: 0.6, ch: 2, build: (k, m) => bShout(k, m, true) },
  ha: { anchors: [46, 50, 54, 58], dur: 0.6, ch: 2, build: (k, m) => bShout(k, m, false) },
  choirF: { anchors: range(57, 81, 3), dur: 4.6, loop: [1.2, 4.4], ch: 2, build: (k, m) => bChoir(k, m, false) },
  choirM: { anchors: range(38, 62, 3), dur: 4.6, loop: [1.2, 4.4], ch: 2, build: (k, m) => bChoir(k, m, true) },
  strL: { anchors: range(26, 54, 4), dur: 4.6, loop: [1.2, 4.4], build: (k, m) => bStrings(k, m, 'low') },
  spic: { anchors: range(26, 82, 4), dur: 0.7, build: (k, m) => bStrings(k, m, 'spic') },
  horn: { anchors: range(46, 82, 4), dur: 4.6, loop: [1.2, 4.4], build: bHorn },
  stab: { anchors: range(31, 63, 4), dur: 1.0, build: bStab },
  braam: { anchors: range(26, 44, 3), dur: 3.6, ch: 2, build: bBraam },
  strH: { anchors: range(62, 90, 4), dur: 4.6, loop: [1.2, 4.4], build: (k, m) => bStrings(k, m, 'high') },
};
const BANK = {}; // fam -> [{m, v, buf}]
export const bankStats = { items: 0, done: 0, ms: 0, maxSyncMs: 0, ready: false, errors: 0 };
let bankP = null;
// level (subsampled RMS for sustains / peak for one-shots → playback gain buf._g; no full-buffer rewrite) + loop crossfade
function finish(buf, d) {
  const sr = buf.sampleRate, C = buf.numberOfChannels, chs = []; for (let c = 0; c < C; c++) chs.push(buf.getChannelData(c));
  const a0 = d.loop ? Math.floor(d.loop[0] * sr) : 0, a1 = d.loop ? Math.floor(d.loop[1] * sr) : buf.length;
  let s = 0, pk = 0, n = 0;
  const stride = d.loop ? 3 : 1;
  for (const x of chs) for (let i = a0; i < a1; i += stride) { const v = x[i]; s += v * v; n++; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
  const rms = Math.sqrt(s / Math.max(1, n));
  if (!Number.isFinite(rms) || !(pk > 0)) throw new Error('silent/non-finite buffer');
  buf._g = d.loop ? 0.16 / rms : 0.9 / pk;
  if (d.loop) { // equal-power crossfade of the loop tail into the material before loopStart → seamless sustain
    const F = Math.floor(0.4 * sr);
    for (const x of chs) for (let i = 0; i < F; i++) { const u = i / F, j = a1 - F + i; x[j] = x[j] * Math.sqrt(1 - u) + x[a0 - F + i] * Math.sqrt(u); }
    buf._loop = [a0 / sr, a1 / sr];
  }
  return buf;
}
async function renderItem(it) {
  const d = FAM[it.fam], sr = d.sr || BSR, ch = d.ch || 1;
  let t0 = performance.now();
  const oc = new OfflineAudioContext(ch, Math.ceil(d.dur * sr), sr);
  const t1 = performance.now();
  d.build(K(oc, mulberry32(hash(it.fam) + it.m * 131 + it.v * 7919)), it.m, it.v);
  const t2 = performance.now();
  const buf = await oc.startRendering();
  const t3 = performance.now(); finish(buf, d); const t4 = performance.now();
  const sync = Math.max(t2 - t0, t4 - t3);
  bankStats.maxSyncMs = Math.max(bankStats.maxSyncMs, +sync.toFixed(2));
  if (sync > 5 && (bankStats.slow ||= []).length < 12) bankStats.slow.push(`${it.fam}${it.m} ctx${(t1 - t0).toFixed(1)} build${(t2 - t1).toFixed(1)} fin${(t4 - t3).toFixed(1)}`);
  const list = (BANK[it.fam] ||= []); list.push({ m: it.m, v: it.v, buf }); list.sort((a, b) => a.m - b.m);
  bankStats.done++;
}
// start (once) rendering every instrument; resolves when the whole bank is ready. Safe to call any time after unlock.
export function ensureBank() {
  if (bankP) return bankP;
  const t0 = performance.now(), items = [];
  for (const fam of Object.keys(FAM)) { const d = FAM[fam]; if (d.anchors) for (const m of d.anchors) items.push({ fam, m, v: 0 }); else for (let v = 0; v < d.variants; v++) items.push({ fam, m: 60, v }); }
  bankStats.items = items.length;
  let i = 0;
  const idle = () => new Promise((r) => setTimeout(r, 0));
  const worker = async () => { while (i < items.length) { const it = items[i++]; try { await renderItem(it); } catch (e) { bankStats.errors++; if (bankStats.errors < 4) console.warn('[score] render failed', it.fam, e); } await idle(); } };
  bankP = Promise.all([worker(), worker()]).then(() => { bankStats.ready = true; bankStats.ms = Math.round(performance.now() - t0); });
  return bankP;
}
function pick(fam, midi, r) {
  const L = BANK[fam]; if (!L || !L.length) return null;
  if (!FAM[fam].anchors) return L[Math.floor(r() * L.length) % L.length];
  let best = L[0], bd = 1e9; for (const e of L) { const dd = Math.abs(e.m - midi); if (dd < bd) { bd = dd; best = e; } }
  return bd > 9 ? null : best;
}

// ================================================================ harmony + material
const QUAL = { m: [0, 3, 7], M: [0, 4, 7], sus: [0, 5, 7], M7: [0, 4, 7, 11], m6: [0, 3, 7, 9], add9: [0, 4, 7, 14] };
const P_MIN = [[0, 'm'], [8, 'M'], [10, 'M'], [7, 'M'], [0, 'm'], [8, 'M'], [5, 'm'], [7, 'M']];   // i VI VII V i VI iv V (the theme's harmony)
const P_MAJ = [[0, 'M'], [9, 'm'], [7, 'M'], [7, 'M'], [0, 'M'], [9, 'm'], [5, 'M'], [7, 'M']];   // I vi V V I vi IV V (theme in major)
const P_MIXO = [[0, 'M'], [10, 'M'], [5, 'M'], [0, 'M']];                                          // I bVII IV I — the adventurous lift
const P_HERO = [[0, 'm'], [0, 'm'], [8, 'M'], [8, 'M'], [3, 'M'], [3, 'M'], [10, 'M'], [10, 'M']]; // i VI III VII — rising, hopeful
// the heroic theme (original): [semitones above the tonic, beats]; 8 bars over P_MIN (or P_MAJ when mapped to major)
const THEME = [
  [[0, 1.5], [7, 0.5], [7, 1], [3, 1]], [[8, 1.5], [7, 0.5], [3, 1], [0, 1]], [[2, 1], [5, 0.5], [10, 0.5], [14, 1.5], [12, 0.5]], [[11, 2], [14, 1], [7, 1]],
  [[12, 1.5], [14, 0.5], [15, 1], [19, 1]], [[15, 1.5], [14, 0.5], [12, 1], [8, 1]], [[17, 1.5], [15, 0.5], [12, 1], [8, 1]], [[14, 1.5], [12, 0.5], [11, 2]],
];
const TO_MAJ = { 3: 4, 8: 9, 10: 11, 15: 16, 20: 21, 22: 23 };
// string ostinati [step, note (R root · 8 octave · 5 fifth · 3 third), vel]
const OSTS = {
  gallop: [[0, 'R', 1], [1, 'R', 0.42], [2, 'R', 0.55], [3, '8', 0.9], [4, 'R', 0.42], [5, 'R', 0.55], [6, '5', 0.9], [7, 'R', 0.42],
    [8, 'R', 0.95], [9, 'R', 0.42], [10, 'R', 0.55], [11, '8', 0.9], [12, 'R', 0.42], [13, '5', 0.6], [14, '3', 0.85], [15, '5', 0.55]],
  pulse: [[0, 'R', 1], [2, 'R', 0.6], [4, '8', 0.85], [6, 'R', 0.6], [8, 'R', 0.95], [10, 'R', 0.6], [12, '8', 0.85], [14, '5', 0.7]],
  drive: [[0, 'R', 1], [1, 'R', 0.5], [2, '8', 0.7], [3, 'R', 0.5], [4, '5', 0.85], [5, 'R', 0.5], [6, '8', 0.75], [7, 'R', 0.5],
    [8, 'R', 0.95], [9, 'R', 0.5], [10, '8', 0.7], [11, 'R', 0.5], [12, '3', 0.85], [13, 'R', 0.5], [14, '5', 0.8], [15, '8', 0.6]],
};
const ARP = [0, 1, 2, 3, 2, 1, 2, 3, 4, 3, 2, 1, 2, 3, 2, 1];
const ACC = new Set([0, 3, 6, 8, 11, 14]);
const h16 = (a, b) => range(0, 15, 1).map((st) => [st, st % 4 === 2 ? a : b]); // 16th hats, offbeat 8ths accented
// drum kits per state: [step, vel(, every n bars)]. kick/snare/hat = the kit; taiko/gran/odaiko/shime = the ensemble
const DR = {
  title: { kick: [[0, 0.85], [8, 0.65], [10, 0.5]], snare: [[4, 0.55], [12, 0.65]], hat: [[2, 0.35], [6, 0.35], [10, 0.35], [14, 0.4]], taiko: [[0, 0.65], [14, 0.45]], gran: [[0, 0.5, 4]] },
  calm: { kick: [[0, 0.75], [8, 0.65]], hat: [[2, 0.25], [6, 0.25], [10, 0.25], [14, 0.3]], taiko: [[0, 0.55], [8, 0.4]], shime: [[4, 0.2], [12, 0.25]] },
  dread: { kick: [[0, 0.9], [4, 0.7], [8, 0.9], [12, 0.7]], hat: [[2, 0.35], [6, 0.35], [10, 0.35], [14, 0.4]], taiko: [[0, 0.95], [3, 0.5], [6, 0.7], [8, 0.9], [11, 0.5], [14, 0.7]], shime: [[2, 0.2], [5, 0.2], [10, 0.2], [13, 0.25]], gran: [[0, 0.6, 4]] },
  breach: { kick: [[0, 1], [6, 0.8], [8, 0.95], [10, 0.6]], snare: [[4, 1], [12, 1], [15, 0.3]], hat: h16(0.5, 0.22), taiko: [[0, 1], [3, 0.6], [6, 0.85], [8, 0.95], [11, 0.6], [14, 0.85]], gran: [[0, 0.9]] },
  combat: { kick: [[0, 1], [6, 0.8], [8, 0.95], [10, 0.6]], snare: [[4, 1], [12, 1], [15, 0.25]], hat: h16(0.45, 0.2), taiko: [[0, 1], [3, 0.55], [6, 0.8], [8, 0.92], [11, 0.55], [14, 0.78]], shime: [[7, 0.3], [13, 0.25]], gran: [[0, 0.75, 2]] },
  boss2: { kick: [[0, 1], [3, 0.6], [6, 0.85], [8, 1], [10, 0.65], [14, 0.6]], snare: [[4, 1], [12, 1], [7, 0.2], [15, 0.3]], hat: h16(0.5, 0.25), taiko: [[0, 1], [2, 0.5], [3, 0.7], [6, 0.9], [8, 1], [10, 0.5], [11, 0.7], [14, 0.9]], gran: [[0, 0.85]], odaiko: [[0, 0.6, 4]] },
  boss3: { kick: [[0, 1], [2, 0.6], [6, 0.85], [8, 1], [10, 0.7], [11, 0.6], [14, 0.8]], snare: [[4, 1], [12, 1], [7, 0.25], [13, 0.2], [15, 0.4]], hat: h16(0.55, 0.28), taiko: [[0, 1], [1, 0.5], [3, 0.8], [4, 0.55], [6, 1], [8, 1], [9, 0.5], [11, 0.8], [12, 0.55], [14, 1], [15, 0.6]], gran: [[0, 0.95], [8, 0.6]], odaiko: [[0, 0.7, 2]] },
  victory: { kick: [[0, 1], [8, 0.85]], snare: [[4, 0.8], [12, 0.9], [14, 0.35], [15, 0.5]], hat: [[2, 0.35], [6, 0.35], [10, 0.35], [14, 0.4]], taiko: [[0, 1], [8, 0.85], [11, 0.5], [14, 0.6]], gran: [[0, 0.8, 2]] },
  death: { kick: [[0, 0.85], [4, 0.6], [8, 0.85], [12, 0.6]], hat: [[2, 0.3], [6, 0.3], [10, 0.3], [14, 0.35]], taiko: [[0, 0.8], [6, 0.5], [8, 0.7], [14, 0.6]] },
};
const SNARE = { drive: [[0, 0.3], [2, 0.2], [6, 0.25], [7, 0.2], [10, 0.25], [13, 0.2], [14, 0.35]] };
const STAB = { sparse: [[0, 1]], mid: [[0, 1], [6, 0.75]], full: [[0, 1], [3, 0.6], [6, 0.85], [8, 0.9], [11, 0.6], [14, 0.8]] };
// choir shouts [step, 'hey'|'ha', vel, every n bars]
const SHOUT = { two: [[12, 'hey', 0.9, 2]], one: [[12, 'hey', 1, 1]], hype: [[0, 'ha', 0.75, 2], [12, 'hey', 1, 1]] };

// sections (levels 0..1). I = optional intro (introBars), then A = first 8 bars of a 16-bar phrase, B = last 8.
// cF/cM choir pads · sL low strings · sH high strings · hp horn pad · sp ostinato (+ost pattern) · arp hi-string 16ths
// theme instruments + tv level · st brass stabs · sn extra snare · sh shouts · br braam every 4 bars · dk drum level · prog override
// tone = female-choir brightness · att = pad attack
export const STATES = {
  title: { bpm: 112, key: 0, major: true, prog: P_MAJ, phrase: 16, drums: 'title', rel: 0.45, riser: 8, crash: true,
    A: { prog: P_MIXO, cF: 0.4, cM: 0.45, sL: 0.6, sp: 0.7, ost: 'pulse', hp: 0.3, dk: 0.7, tone: 3000, att: 0.2 },
    B: { cF: 0.6, cM: 0.5, sL: 0.7, sH: 0.35, sp: 0.75, ost: 'pulse', theme: ['horn', 'strH'], tv: 0.9, dk: 0.9, sh: 'two', tone: 5500, att: 0.1 } },
  calm: { bpm: 124, key: 0, prog: P_HERO, phrase: 16, drums: 'calm', rel: 0.5, riser: 8,
    A: { cF: 0.3, sL: 0.5, sH: 0.3, sp: 0.6, ost: 'pulse', dk: 0.6, tone: 2500, att: 0.3 },
    B: { cF: 0.4, cM: 0.4, sL: 0.6, sH: 0.35, sp: 0.75, ost: 'gallop', hp: 0.3, dk: 0.85, tone: 3500, att: 0.2 } },
  dread: { bpm: 138, key: 0, prog: [[0, 'm'], [8, 'M'], [10, 'M'], [10, 'M'], [0, 'm'], [8, 'M'], [7, 'sus'], [7, 'M']], phrase: 16, drums: 'dread', rel: 0.35, riser: 4,
    A: { cF: 0.45, cM: 0.6, sL: 0.7, sp: 0.85, hp: 0.35, st: 'sparse', dk: 0.8, tone: 3000, att: 0.1 },
    B: { cF: 0.6, cM: 0.75, sL: 0.8, sH: 0.35, sp: 0.9, arp: 0.4, st: 'mid', sh: 'two', dk: 1, tone: 5000, att: 0.08 } },
  breach: { bpm: 150, key: 0, prog: [[0, 'm'], [8, 'M'], [10, 'M'], [7, 'M']], phrase: 4, drums: 'breach', rel: 0.3, crash: true,
    A: { cF: 0.85, cM: 0.85, sL: 0.9, sp: 1, arp: 0.4, st: 'full', sh: 'one', tone: 7000, att: 0.05 } },
  combat: { bpm: 152, key: 0, prog: P_MIN, phrase: 16, drums: 'combat', rel: 0.25, riser: 8, crash: true,
    A: { cF: 0.45, cM: 0.6, sL: 0.8, sp: 0.9, st: 'mid', sh: 'two', hp: 0.3, dk: 0.85, tone: 3500, att: 0.08 },
    B: { cF: 0.75, cM: 0.75, sL: 0.9, sp: 0.95, arp: 0.35, st: 'mid', sh: 'one', theme: ['horn'], tv: 1, tone: 7000, att: 0.05 } },
  boss2: { bpm: 160, key: 2, prog: P_MIN, phrase: 16, drums: 'boss2', rel: 0.25, riser: 8, crash: true,
    A: { cF: 0.55, cM: 0.7, sL: 0.9, sp: 1, arp: 0.5, st: 'full', sh: 'one', theme: ['strH'], tv: 0.8, hp: 0.3, dk: 0.9, tone: 5000, att: 0.05 },
    B: { cF: 0.8, cM: 0.85, sL: 0.95, sp: 1, ost: 'drive', arp: 0.4, st: 'full', sn: 'drive', sh: 'hype', theme: ['horn', 'choirF'], tv: 1, tone: 8000, att: 0.05 } },
  boss3: { bpm: 168, key: 3, prog: P_MIN, phrase: 16, drums: 'boss3', rel: 0.2, riser: 8, crash: true,
    A: { cF: 0.7, cM: 0.8, sL: 1, sp: 1, ost: 'drive', arp: 0.55, st: 'full', sh: 'hype', theme: ['horn', 'strH'], tv: 0.95, br: 0.5, dk: 0.95, tone: 6000, att: 0.05 },
    B: { cF: 0.85, cM: 0.9, sL: 1, sp: 1, ost: 'drive', arp: 0.45, st: 'full', sn: 'drive', sh: 'hype', theme: ['horn', 'choirF', 'strH'], tv: 1, br: 0.6, tone: 9000, att: 0.04 } },
  // death: two bars of breath, then straight into a rising "get back up" groove
  death: { bpm: 140, key: 0, prog: P_HERO, phrase: 16, drums: 'death', rel: 0.4, riser: 8, introBars: 2,
    I: { prog: [[0, 'm'], [8, 'M']], cF: 0.3, sL: 0.4, sH: 0.2, nod: true, tone: 1800, att: 0.4 },
    A: { cF: 0.35, cM: 0.4, sL: 0.55, sp: 0.7, ost: 'pulse', dk: 0.65, tone: 2500, att: 0.15 },
    B: { cF: 0.5, cM: 0.55, sL: 0.7, sH: 0.3, sp: 0.85, hp: 0.35, st: 'sparse', sh: 'two', dk: 0.9, tone: 4000, att: 0.08 } },
  victory: { bpm: 120, key: 0, major: true, prog: P_MAJ, phrase: 16, drums: 'victory', rel: 0.6, crash: true,
    A: { cF: 0.9, cM: 0.75, sL: 0.85, sH: 0.4, sp: 0.6, ost: 'pulse', theme: ['horn', 'choirF', 'strH'], tv: 1, tone: 8000, att: 0.08 },
    B: { cF: 0.6, cM: 0.5, sL: 0.65, sH: 0.5, sp: 0.55, ost: 'pulse', theme: ['horn', 'strH'], tv: 0.8, sh: 'two', dk: 0.8, tone: 5000, att: 0.2 } },
};
const RANK = { death: -1, calm: 0, title: 1, victory: 2, dread: 3, breach: 4, combat: 5, boss2: 6, boss3: 7 };
// family playback trims (after bank normalisation: sustains at equal RMS, one-shots at equal peak)
const TRIM = { choirF: 1.0, choirM: 0.9, strL: 0.8, strH: 0.6, spic: 0.85, horn: 1.2, stab: 1.0, braam: 0.6, hey: 0.75, ha: 0.7,
  taiko: 0.6, gran: 0.6, odaiko: 0.7, shime: 0.35, snare: 0.4, kick: 0.7, hat: 0.2, crash: 0.38, swell: 0.4, impact: 1.1 };
const OUT_GAIN = 2.1; // into the mixer's music fader (g.music 0.16): music-only ≈ −21..−20 LUFS in combat/boss, peaks ≈ −10 dBFS

export class Score {
  static ready() { return ensureBank(); } // await before building a Score on an OfflineAudioContext (renders need the bank)
  constructor(ac, out, drums) {
    this.ac = ac; this.drums = drums || {}; this.state = null; this.target = null; this.queued = null;
    this.r = mulberry32(4242);
    ensureBank();
    const g = (v = 1) => { const n = ac.createGain(); n.gain.value = v; return n; };
    const flt = (type, f, Q = 0.707, gain = 0) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; b.gain.value = gain; return b; };
    this.out = g(OUT_GAIN); this.out.connect(out);
    // music master: HPF (no sub mud) → gentle glue → out
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 2; comp.attack.value = 0.012; comp.release.value = 0.25; comp.knee.value = 8;
    this.master = g(1); const hp = flt('highpass', 34, 0.7), lsh = flt('lowshelf', 100, 0.7, -3.5), pres = flt('highshelf', 2500, 0.7, 4.5);
    this.master.connect(hp); hp.connect(lsh); lsh.connect(pres); pres.connect(comp); comp.connect(this.out);
    this.comp = comp;
    // hall (own convolver; IR built in chunks so the main thread never stalls)
    this.hallIn = g(1); const hhp = flt('highpass', 160, 0.7); this.hall = ac.createConvolver(); this.hall.normalize = true;
    const hallOut = g(0.9); this.hallIn.connect(hhp); hhp.connect(this.hall); this.hall.connect(hallOut); hallOut.connect(this.master);
    this._buildIR();
    // instrument buses: [level, hall send, pan]
    this.bus = {};
    const BUS = { choirF: [1, 0.55, 0], choirM: [1, 0.5, 0], strL: [1, 0.3, 0.18], spic: [1, 0.28, 0.22], strH: [1, 0.5, -0.25], horn: [1, 0.4, -0.12],
      stab: [1, 0.3, 0.05], drums: [1, 0.32, 0], fx: [1, 0.25, 0] };
    for (const [k, [lv, send, pan]] of Object.entries(BUS)) {
      const b = g(lv); let head = b;
      if (k === 'choirF') { this.tone = flt('lowpass', 3000, 0.5); this.tone.connect(b); head = this.tone; }
      let tail = b; if (pan) { const p = ac.createStereoPanner(); p.pan.value = pan; b.connect(p); tail = p; }
      tail.connect(this.master); const s = g(send); tail.connect(s); s.connect(this.hallIn);
      this.bus[k] = head;
    }
    this.bus.braam = this.bus.stab;
    this.held = []; this.themeQ = null;
    this.step = 0; this.bar = 0; this.nextTime = 0; this.cfg = STATES.title; this.sec = this.cfg.A; this.chord = null; this.fv = null;
    this.intensity = 0;
  }
  _buildIR() {
    const ac = this.ac, sr = ac.sampleRate, len = Math.floor(sr * 2.7), b = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: sr });
    const fill = (c) => {
      const d = b.getChannelData(c), r = mulberry32(91 + c * 7), pre = Math.floor(sr * 0.022);
      let y = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr, env = Math.exp(-6.9 * t / 2.5) * Math.min(1, t / 0.03 + 0.15);
        const a = 0.75 * Math.exp(-t / 0.9) + 0.08; y += a * ((r() * 2 - 1) - y); d[i] = y * env;
      }
      for (const [ms, gn] of [[11, 0.5], [19, -0.38], [29, 0.3], [41, -0.24], [57, 0.2]]) { const j = pre + Math.floor((ms + c * 3.3) * sr / 1000); if (j < len) d[j] += gn; }
    };
    const done = () => { try { this.hall.buffer = b; } catch {} };
    if (typeof OfflineAudioContext !== 'undefined' && ac instanceof OfflineAudioContext) { fill(0); fill(1); done(); }
    else { setTimeout(() => { fill(0); setTimeout(() => { fill(1); done(); }, 0); }, 0); }
  }

  get stepDur() { return 60 / this.cfg.bpm / 4; }
  nextBarTime() { return this.step === 0 ? this.nextTime : this.nextTime + (16 - this.step) * this.stepDur; }

  // ---------------------------------------------------------------- state machine
  setState(name, when = this.ac.currentTime, { immediate = false } = {}) {
    const cfg = STATES[name]; if (!cfg || name === this.target) return;
    this.target = name;
    if (name === this.state) { this.queued = null; return; }
    const now = Math.max(when, this.ac.currentTime), sd = this.stepDur;
    if (!this.state || immediate || this.nextTime < now - 0.5) { this.queued = null; this._apply(name, now + 0.05); return; }
    let at;
    if (name === 'death') at = this.nextTime + ((2 - (this.step % 2)) % 2) * sd; // next 8th
    else {
      at = this.nextBarTime();
      const beat = this.nextTime + ((4 - (this.step % 4)) % 4) * sd;
      if (at - now > (name === 'breach' ? 0.9 : 2.5)) at = beat;
    }
    if (at - now < 0.1) at += name === 'death' ? 2 * sd : 4 * sd;
    const up = (RANK[name] ?? 0) > (RANK[this.state] ?? 0);
    this.queued = { name, at, up };
    if ((up || name === 'victory') && name !== 'death' && at - now > 0.5) this._riser(at, Math.min(1, 0.5 + 0.1 * (RANK[name] ?? 0)));
  }
  _apply(name, t) {
    const prev = this.state, cfg = STATES[name];
    this.state = name; this.cfg = cfg; this.sec = cfg.I || cfg.A; this.bar = 0; this.step = 0; this.nextTime = t;
    const up = (RANK[name] ?? 0) > (RANK[prev] ?? -2);
    this._cut(t, name === 'death' ? 0.5 : up ? 0.12 : 0.9);
    this.chord = null;
    this.intensity = Math.max(0, (RANK[name] ?? 0) - 3) / 4;
    if (prev && ((up && RANK[name] >= RANK.breach) || name === 'victory')) this._land(t, name === 'breach' || name === 'boss3' || name === 'victory' ? 1 : 0.85);
    if (name === 'death') this._hit('gran', t, 0.6);
  }
  _land(t, k) {
    this._hit('impact', t, k, 'fx'); this._hit('crash', t, 0.9 * k, 'fx'); this._hit('gran', t, k); this._hit('odaiko', t, 0.8 * k);
    const c = this._chordInfo(0); this.braam(t, c, k);
  }
  _riser(at, k = 0.8) {
    const e = pick('swell', 60, this.r); if (!e) return;
    const D = e.buf.duration, now = this.ac.currentTime, start = Math.max(now + 0.02, at - D), off = D - (at - start);
    if (at - start < 0.4) return;
    this._voice(e, start, 60, 99, k * TRIM.swell * (e.buf._g || 1), this.bus.fx, { offset: off });
  }
  _cut(tc, fade) {
    const now = this.ac.currentTime;
    for (const h of this.held) {
      if (h.end <= tc) continue;
      try {
        if (h.t0 >= tc) h.s.stop(tc);
        else { const p = h.g.gain; if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(tc); else p.cancelScheduledValues(tc); p.setTargetAtTime(0, tc, fade / 4); h.s.stop(tc + fade * 1.7 + 0.05); }
      } catch {}
      h.end = tc;
    }
    this.held = this.held.filter((h) => h.end > now - 0.5);
  }

  // ---------------------------------------------------------------- voices
  _voice(e, t, midi, dur, lvl, dest, o = {}) {
    const ac = this.ac, s = ac.createBufferSource(), g = ac.createGain();
    s.buffer = e.buf; const rate = Math.pow(2, (midi - e.m) / 12) * (o.rate || 1); s.playbackRate.value = rate;
    g.gain.value = 0;
    const p = g.gain, a = o.attack || 0, rel = o.release ?? 0.25;
    t = Math.max(t, ac.currentTime);
    if (a > 0.004) { p.setValueAtTime(0, t); p.linearRampToValueAtTime(lvl, t + a); } else p.setValueAtTime(lvl, t);
    let end;
    if (e.buf._loop) { s.loop = true; s.loopStart = e.buf._loop[0]; s.loopEnd = e.buf._loop[1]; p.setTargetAtTime(0, t + dur, rel / 4); end = t + dur + rel * 1.7; }
    else { const nat = (e.buf.duration - (o.offset || 0)) / rate; if (dur < nat) { p.setTargetAtTime(0, t + dur, rel / 4); end = t + Math.min(nat, dur + rel * 1.7); } else end = t + nat; }
    s.connect(g); g.connect(dest);
    s.start(t, o.offset || 0); s.stop(end + 0.02);
    s.onended = () => { try { s.disconnect(); g.disconnect(); } catch {} };
    if (o.hold) this.held.push({ s, g, t0: t, end });
    return end;
  }
  _note(fam, midi, t, dur, vel, o = {}) {
    if (vel <= 0.002) return;
    const e = pick(fam, midi, this.r); if (!e) return;
    this._voice(e, t, midi, dur, vel * TRIM[fam] * (e.buf._g || 1), o.dest || this.bus[fam], o);
  }
  _hit(name, t, vel, bus = 'drums', o = {}) {
    if (vel <= 0.002) return;
    const e = pick(name, 60, this.r); if (!e) return;
    this._voice(e, t, 60, 99, vel * TRIM[name] * (e.buf._g || 1), this.bus[bus], { rate: 1 + (this.r() - 0.5) * 0.03, ...o });
  }
  _taiko(t, vel) { // two players, the second a hair late
    this._hit('taiko', t, vel);
    if (vel > 0.6) this._hit('taiko', t + 0.008 + this.r() * 0.012, vel * 0.55);
  }

  // ---------------------------------------------------------------- harmony
  _tonic() { return (2 + this.cfg.key) % 12; }
  _chordInfo(ci, P = this.sec?.prog || this.cfg.prog) {
    const [deg, q] = P[((ci % P.length) + P.length) % P.length];
    const root = (this._tonic() + deg) % 12, iv = QUAL[q] || QUAL.m;
    return { root, q, iv, pcs: iv.map((x) => (root + x) % 12), third: iv[1], r: up(root, 26) };
  }
  // closest 4-note female voicing (60..78) covering the triad, nearest to the previous one
  _voiceF(c) {
    const cand = []; for (let m = 59; m <= 79; m++) if (c.pcs.includes(m % 12)) cand.push(m);
    const prev = this.fv || [62, 65, 69, 74]; let best = null, bs = 1e9;
    const N = cand.length;
    for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) for (let d = b + 1; d < N; d++) for (let e = d + 1; e < N; e++) {
      const v = [cand[a], cand[b], cand[d], cand[e]];
      if (v[1] - v[0] > 7 || v[2] - v[1] > 7 || v[3] - v[2] > 7 || v[1] - v[0] < 2 || v[3] - v[2] < 2) continue;
      const pcs = new Set(v.map((x) => x % 12)); if (!c.pcs.slice(0, 3).every((p) => pcs.has(p))) continue;
      let s = 0; for (let i = 0; i < 4; i++) s += Math.abs(v[i] - prev[i]); s += Math.abs(v[0] - 62) * 0.3;
      if (s < bs) { bs = s; best = v; }
    }
    this.fv = best || prev; return this.fv;
  }

  // ---------------------------------------------------------------- scheduler
  schedule(until) {
    if (!this.state) return;
    const now = this.ac.currentTime;
    if (this.nextTime < now - 0.2) this.nextTime = now + 0.03; // hitch: skip ahead, never burst
    let guard = 0;
    while (this.nextTime < until && guard++ < 512) {
      const t = this.nextTime;
      if (this.queued && t >= this.queued.at - 1e-4) { const q = this.queued; this.queued = null; this._apply(q.name, q.at); continue; }
      this._tick(t, this.step);
      this.nextTime += this.stepDur;
      if (++this.step === 16) { this.step = 0; this.bar++; }
    }
  }
  _tick(t, s) {
    const cfg = this.cfg, sd = this.stepDur, ib = cfg.introBars || 0, intro = this.bar < ib, bar = intro ? this.bar : this.bar - ib;
    const ph = cfg.phrase, pb = bar % ph, half = ph >= 16 ? 8 : ph;
    const sec = this.sec = intro ? cfg.I : ph >= 16 && pb >= 8 && cfg.B ? cfg.B : cfg.A;
    const P = sec.prog || cfg.prog, c = this._chordInfo(bar, P);
    const kD = sec.nod ? null : DR[cfg.drums], dk = sec.dk ?? 1;
    if (s === 0) {
      const secStart = intro ? bar === 0 : pb % half === 0;
      if (secStart) this.tone.frequency.setTargetAtTime(sec.tone || 3000, t, 0.4);
      // pads: new chord (or new section) → hold until the chord changes
      if (this.padMiss && bankStats.done > 0) { this._cut(t, 0.4); this.chord = null; } // bank was still rendering: (re)enter the pads now
      if (secStart || !this.chord || this.chord.root !== c.root || this.chord.q !== c.q) {
        this.padMiss = !bankStats.ready;
        const left = intro ? ib - bar : half - (pb % half);
        let nb = 1; while (nb < left && P[(bar + nb) % P.length][0] === P[bar % P.length][0] && P[(bar + nb) % P.length][1] === P[bar % P.length][1]) nb++;
        this._pads(t, c, nb * 16 * sd, sec, cfg);
      }
      this.chord = c;
      if (!intro && cfg.crash && pb % half === 0 && this.bar > 0 && (sec.theme || cfg.phrase <= 4)) this._hit('crash', t, 0.65, 'fx');
      if (sec.br && pb % 4 === 0) this.braam(t, c, sec.br);
      this.themeQ = null;
      if (sec.theme) this._theme(t, pb % half, sec, cfg);
      if (!intro && cfg.riser && pb % cfg.riser === cfg.riser - 1 && !this.queued) this._riser(t + 16 * sd, 0.55 + 0.4 * this.intensity);
      if (intro && bar === ib - 1) this._riser(t + 16 * sd, 0.6);
    }
    if (this.themeQ) for (const n of this.themeQ.notes) if (n.st === s) this.themeQ.play(n);
    const hum = () => t + (this.r() - 0.5) * 0.006, light = dk < 0.9;
    if (kD) {
      for (const [st, v] of kD.kick || []) if (st === s && (!light || v > 0.7)) this._hit('kick', t, dk * v);
      for (const [st, v] of kD.snare || []) if (st === s && (!light || v > 0.5)) this._hit('snare', hum(), dk * v);
      for (const [st, v] of kD.hat || []) if (st === s && (!light || v > 0.3)) this._hit('hat', hum(), dk * v * (0.8 + this.r() * 0.4));
      for (const [st, v] of kD.taiko || []) if (st === s && (!light || v > 0.7)) this._taiko(hum(), dk * v * (0.9 + this.r() * 0.15));
      for (const [st, v, ev = 1] of kD.gran || []) if (st === s && bar % (light ? ev * 2 : ev) === 0) this._hit('gran', t, dk * v);
      for (const [st, v, ev = 1] of kD.odaiko || []) if (st === s && bar % ev === 0) this._hit('odaiko', t, v);
      for (const [st, v] of kD.shime || []) if (st === s) this._hit('shime', hum(), dk * v * (0.85 + this.r() * 0.3));
    }
    if (kD && sec.sn) for (const [st, v] of SNARE[sec.sn]) if (st === s) this._hit('snare', hum(), v);
    // phrase-end fill: snare + shime 16ths crescendo, taiko on the 8ths, into the next section
    if (kD && !intro && cfg.riser && pb % 8 === 7 && s >= 8) { const k = (s - 7) / 8; this._hit('snare', t, 0.25 + 0.6 * k); this._hit('shime', t, 0.3 + 0.5 * k); if (s >= 12 && s % 2 === 0) this._taiko(t, 0.6 + 0.4 * k); }
    // taiko + snare roll into a queued escalation over the last beat
    if (this.queued?.up) { const left = this.queued.at - t; if (left > 0 && left <= 4 * sd + 1e-3) { const k = 1 - left / (4 * sd); this._hit('snare', t, 0.4 + 0.5 * k); if (s % 2 === 0) this._taiko(t, 0.55 + 0.4 * k); } }
    // driving staccato low strings (celli) + basses on the accents
    if (sec.sp) {
      const o = OSTS[sec.ost || 'gallop'];
      for (const [st, kind, v] of o) if (st === s) {
        const R = up(c.root, 38), m = kind === 'R' ? R : kind === '8' ? R + 12 : kind === '5' ? R + 7 : R + c.third;
        this._note('spic', m, t, sd * 1.6, v * sec.sp, { release: 0.08 });
        if (v > 0.8) this._note('spic', R - 12, t, sd * 2.2, v * sec.sp * 0.7, { release: 0.1 });
      }
    }
    if (sec.arp) {
      const R = up(c.root, 69), tones = [R, R + c.third, R + c.iv[2], R + 12, R + 12 + c.third];
      this._note('spic', tones[ARP[s]], t, sd * 1.2, sec.arp * (ACC.has(s) ? 1 : 0.6), { release: 0.06, dest: this.bus.strH });
    }
    if (sec.st) for (const [st, v] of STAB[sec.st]) if (st === s && (sec.st !== 'sparse' || bar % 2 === 0)) this._stab(t, c, v * (0.75 + 0.25 * this.intensity), sd);
    if (sec.sh) for (const [st, w, v, ev] of SHOUT[sec.sh]) if (st === s && bar % ev === ev - 1) this._note(w, up(c.root, 47), t, 99, v, { dest: this.bus.choirM });
  }
  _pads(t, c, dur, sec, cfg) {
    const a = sec.att ?? 0.1, rel = cfg.rel ?? 0.4, o = { attack: a, release: rel, hold: true }, D = dur + 0.04;
    if (sec.cF) { const v = this._voiceF(c); v.forEach((m, i) => this._note('choirF', m, t, D, sec.cF * (i === 3 ? 0.55 : 0.48), o)); }
    if (sec.cM) { const R = up(c.root, 43); this._note('choirM', R, t, D, sec.cM * 0.6, o); this._note('choirM', R + 7, t, D, sec.cM * 0.5, o); this._note('choirM', R + 12, t, D, sec.cM * 0.42, o); }
    if (sec.sL) { const R = up(c.root, 28); this._note('strL', R, t, D, sec.sL * 0.7, o); this._note('strL', R + 12, t, D, sec.sL * 0.6, o); this._note('strL', up(c.pcs[2], R + 12), t, D, sec.sL * 0.4, o); }
    if (sec.sH) { const v = this.fv || this._voiceF(c); [v[2] + 12, v[3] + 12].forEach((m) => this._note('strH', m, t, D, sec.sH * 0.6, { ...o, attack: Math.max(a, 0.2) })); }
    if (sec.hp) { this._note('horn', up(c.pcs[1], 53), t, D, sec.hp * 0.6, { ...o, attack: Math.max(a, 0.3) }); this._note('horn', up(c.pcs[2], 55), t, D, sec.hp * 0.5, { ...o, attack: Math.max(a, 0.3) }); }
  }
  _stab(t, c, v, sd) {
    const R = up(c.root, 34), dur = Math.max(0.16, sd * 2.6);
    for (const [m, k] of [[R, 0.9], [R + 7, 0.75], [R + 12, 0.7], [up((c.root + c.third) % 12, 50), 0.5]]) this._note('stab', m, t, dur, v * k, { release: 0.1 });
  }
  // theme bar `tb` (0..7) on the given instruments. Live: each note is created on its own 16th (spreads the
  // main-thread work across the bar); `all` = schedule the whole bar now (motif()).
  _theme(t, tb, sec, cfg, all = false) {
    const beat = 60 / cfg.bpm, T = up(this._tonic(), 60), slow = cfg.bpm < 90, q = [];
    let off = 0;
    for (const [semi, b] of THEME[tb % 8]) { q.push({ st: Math.round(off * 4), t: t + off * beat, m: T + (cfg.major ? (TO_MAJ[semi] ?? semi) : semi), d: b * beat }); off += b; }
    const play = (n) => {
      const a = slow ? 0.07 : 0.025, d = n.d * 0.97;
      for (const inst of sec.theme) {
        if (inst === 'horn') { this._note('horn', n.m, n.t, d, sec.tv * 0.95, { attack: a, release: 0.18, hold: true }); this._note('horn', n.m - 12, n.t, d, sec.tv * 0.45, { attack: a, release: 0.18, hold: true }); }
        else if (inst === 'choirF') this._note('choirF', n.m, n.t, d, sec.tv * 0.6, { attack: 0.04, release: 0.2, hold: true });
        else if (inst === 'strH') this._note('strH', n.m + 12, n.t, d, sec.tv * 0.7, { attack: 0.04, release: 0.2, hold: true });
      }
    };
    if (all) q.forEach(play); else this.themeQ = { notes: q, play };
  }
  // ---------------------------------------------------------------- one-shots used by index.js
  _q(steps = 1, min = 0.03) { // next grid point (multiple of `steps` 16ths) on the running clock
    const now = this.ac.currentTime, sd = this.stepDur;
    if (!this.state) return now + min;
    let t = this.nextTime + ((steps - (this.step % steps)) % steps) * sd;
    while (t - sd * steps >= now + min) t -= sd * steps;
    while (t < now + min) t += sd * steps;
    return t;
  }
  brassNote(time, midi, dur, vel = 1, dest) { this._note(midi < 50 ? 'stab' : 'horn', midi, time, dur, vel, { release: 0.15, dest }); }
  // BRAAM: low brass cluster ripping open + sub, on the chord root / fifth / octave
  braam(time = this.ac.currentTime + 0.03, chord = null, vel = 1) {
    const root = Number.isFinite(chord?.root) ? chord.root : Number.isFinite(chord?.r) ? chord.r % 12 : (this.chord?.root ?? this._tonic());
    const R = up(root, 26);
    for (const [m, k] of [[R, 1], [R + 7, 0.7], [R + 12, 0.6]]) { const e = pick('braam', m, this.r); if (e) this._voice(e, time, m, 99, vel * k * TRIM.braam * (e.buf._g || 1), this.bus.braam); }
  }
  // kill stinger (streak raises it)
  stinger(streak = 1, when) {
    const t = when ?? this._q(1), c = this.chord || this._chordInfo(0), k = Math.min(1, 0.7 + 0.1 * streak);
    this._stab(t, c, k, this.stepDur);
    const T = up(this._tonic(), 60) + [7, 12, 14, 19][Math.min(3, Math.max(0, streak - 1))];
    this._note('horn', T, t, 0.45, 0.8 * k, { release: 0.2 });
    this._taiko(t, 0.95); this._hit('shime', t - 0.035, 0.5);
    if (streak >= 3) this._hit('crash', t, 0.45, 'fx');
  }
  // heroic horn call for a weak-point cut (n = cuts so far; climbs each time), on the next 8th
  heroic(n = 1) {
    const sd = this.stepDur, t = this._q(2), lift = [0, 3, 5, 7][Math.min(3, Math.max(0, n - 1))];
    const T = up(this._tonic(), 55) + lift, c = this.chord || this._chordInfo(0);
    const call = [[0, 2], [7, 2], [12, 8]];
    let tt = t;
    for (const [iv, st] of call) {
      const d = Math.max(0.12, st * sd);
      this._note('horn', T + iv, tt, d * 0.95, 1, { release: 0.25 }); this._note('horn', T + iv + 12, tt, d * 0.95, 0.55, { release: 0.25 });
      tt += st * sd;
    }
    const last = t + 4 * sd, ld = 8 * sd + 0.4;
    this._note('stab', T - 12, last, ld, 0.9, { release: 0.3 }); this._note('stab', T - 5, last, ld, 0.7, { release: 0.3 });
    this._note('choirF', T + 12, last, ld, 0.5, { attack: 0.05, release: 0.6 }); this._note('choirF', T + 19, last, ld, 0.4, { attack: 0.05, release: 0.6 });
    this._note('choirM', T, last, ld, 0.6, { attack: 0.05, release: 0.6 });
    this._taiko(t, 1); this._hit('kick', t, 1); this._hit('gran', last, 0.8); this._hit('kick', last, 1); this._hit('crash', last, 0.6, 'fx'); this._hit('impact', last, 0.45, 'fx');
    this._note('hey', up(c.root, 47), last, 99, 1, { dest: this.bus.choirM });
  }
  // the theme head (4 bars) on horns
  motif(when = this.ac.currentTime + 0.05, major = false) {
    const cfg = { ...this.cfg, bpm: Math.max(80, this.cfg.bpm || 80), major: major || this.cfg.major };
    const beat = 60 / cfg.bpm; let t = when;
    for (let b = 0; b < 4; b++) { this._theme(t, b, { theme: ['horn'], tv: 0.9 }, cfg, true); t += 4 * beat; }
  }
}
// lowest midi note >= lo with pitch class pc
function up(pc, lo) { const m = lo + ((((pc - lo) % 12) + 12) % 12); return m; }
