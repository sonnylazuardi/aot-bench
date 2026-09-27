// Procedural synthesis kit. Every sound is rendered ONCE at load in its own OfflineAudioContext
// (native oscillators, biquads, waveshapers, convolvers and automation) — nothing is downloaded.
// Kit = a tiny graph DSL bound to one OfflineAudioContext.
export const SR = 44100;

export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function fillNoise(d, color, r) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = r() * 2 - 1;
    if (color === 'white') d[i] = w;
    else if (color === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } // brown
  }
}

// Shared seamless noise pool (AudioBuffers are context-independent): each layer reads it at a random
// offset, so hundreds of grains don't each allocate + fill their own buffer. The pools are generated in a
// Worker (initPools) and transferred back, so the main thread only pays a memcpy; poolBuf() falls back to
// generating on the main thread if the worker is unavailable.
const POOL = new Map(), POOL_SEC = 6;
function poolBuf(color, ch) {
  const key = color + ch; let b = POOL.get(key); if (b) return b;
  const r = mulberry32(color.length * 7919 + ch * 104729 + 17);
  const n = POOL_SEC * SR, f = Math.floor(0.06 * SR);
  b = new AudioBuffer({ length: n, numberOfChannels: ch, sampleRate: SR });
  const tmp = new Float32Array(n + f);
  for (let c = 0; c < ch; c++) {
    fillNoise(tmp, color, r);
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = tmp[i];
    for (let i = 0; i < f; i++) { const x = i / f; d[i] = tmp[i] * Math.sqrt(x) + tmp[n + i] * Math.sqrt(1 - x); } // loop seam
  }
  POOL.set(key, b); return b;
}
const WORKER_SRC = `
function mulberry32(a){return function(){a|=0;a=(a+0x6d2b79f5)|0;var t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
function fill(d,color,r){var b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0,last=0;for(var i=0;i<d.length;i++){var w=r()*2-1;
 if(color==='white')d[i]=w;else if(color==='pink'){b0=0.99886*b0+w*0.0555179;b1=0.99332*b1+w*0.0750759;b2=0.969*b2+w*0.153852;
 b3=0.8665*b3+w*0.3104856;b4=0.55*b4+w*0.5329522;b5=-0.7616*b5-w*0.016898;d[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11;b6=w*0.115926;}
 else{last=(last+0.02*w)/1.02;d[i]=last*3.5;}}}
self.onmessage=function(e){var SR=e.data.SR,SEC=e.data.SEC,out=[],tr=[],specs=[['white',1],['pink',1],['brown',1],['white',2],['pink',2],['brown',2]];
 for(var s=0;s<specs.length;s++){var color=specs[s][0],ch=specs[s][1],r=mulberry32(color.length*7919+ch*104729+17),n=SEC*SR,f=Math.floor(0.06*SR),tmp=new Float32Array(n+f),chans=[];
  for(var c=0;c<ch;c++){fill(tmp,color,r);var d=new Float32Array(n);d.set(tmp.subarray(0,n));for(var i=0;i<f;i++){var x=i/f;d[i]=tmp[i]*Math.sqrt(x)+tmp[n+i]*Math.sqrt(1-x);}chans.push(d);tr.push(d.buffer);}
  out.push([color+ch,chans]);}
 self.postMessage(out,tr);};`;
let POOLS_P = null;
export function initPools() {
  if (POOLS_P) return POOLS_P;
  POOLS_P = new Promise((resolve) => {
    let w = null, fin = false;
    const done = () => { if (fin) return; fin = true; try { w?.terminate(); } catch {} resolve(); };
    try {
      w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
      w.onmessage = (e) => {
        try { for (const [key, chans] of e.data) { if (POOL.has(key)) continue; const b = new AudioBuffer({ length: chans[0].length, numberOfChannels: chans.length, sampleRate: SR }); chans.forEach((d, c) => b.copyToChannel(d, c)); POOL.set(key, b); } } catch (err) { console.warn('[audio] pool', err); }
        done();
      };
      w.onerror = done; setTimeout(done, 20000);
      w.postMessage({ SR, SEC: POOL_SEC });
    } catch { done(); }
  });
  return POOLS_P;
}

// Shared periodic smooth-random control buffer (4 targets/s, 32 s, seamless). Stored at 3 kHz: it's a
// control signal, the source resamples it (and plays it faster for higher rates).
const SM_RATE = 4, SM_SEC = 32, SM_SR = 3000; let SMOOTH = null;
function smoothPool() {
  if (SMOOTH) return SMOOTH;
  const r = mulberry32(31337), n = SM_SEC * SM_SR, K = SM_SEC * SM_RATE, step = SM_SR / SM_RATE, pts = [];
  for (let i = 0; i < K; i++) pts.push(r() * 2 - 1);
  SMOOTH = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: SM_SR });
  const d = SMOOTH.getChannelData(0);
  for (let i = 0; i < n; i++) { const x = i / step, i0 = Math.floor(x) % K, f = x - Math.floor(x); d[i] = pts[i0] + (pts[(i0 + 1) % K] - pts[i0]) * (0.5 - 0.5 * Math.cos(Math.PI * f)); }
  return SMOOTH;
}

// formant tables (adult male F1..F4, Hz) — scaled x1.16 female, x1.32 child, x0.5 for a 60 m giant's throat
export const VOW = {
  a: [850, 1250, 2600, 3500], ae: [760, 1720, 2500, 3500], o: [600, 950, 2500, 3400], u: [380, 900, 2300, 3300],
  e: [550, 1850, 2550, 3500], i: [320, 2250, 2950, 3600], er: [640, 1190, 2390, 3300], m: [260, 1100, 2300, 3200],
};
const BW = [90, 110, 170, 250];
const FG = [1, 0.55, 0.3, 0.14];

export class Kit {
  constructor(oc, seed) { this.oc = oc; this.r = mulberry32(seed * 7919 + 13); this.out = oc.destination; this.dur = oc.length / oc.sampleRate; this._pw = {}; }
  rand(a = 0, b = 1) { return a + (b - a) * this.r(); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  // noise source [t0, t0+dur) read from the shared pool at a random offset
  noise(t0 = 0, dur = this.dur - t0, color = 'white', ch = 1) {
    const s = this.oc.createBufferSource(); s.buffer = poolBuf(color, ch); s.loop = true;
    s.start(Math.max(0, t0), this.rand(0, POOL_SEC - 0.01)); s.stop(Math.min(this.dur, Math.max(0, t0) + Math.max(0.005, dur))); return s;
  }
  osc(type, f, t0 = 0, t1 = this.dur) {
    const o = this.oc.createOscillator();
    if (type === 'glottal' || type === 'pressed' || type === 'soft') o.setPeriodicWave(this.wave(type)); else o.type = type;
    o.frequency.value = f; o.start(Math.max(0, t0)); o.stop(Math.max(Math.max(0, t0) + 0.001, Math.min(t1, this.dur))); return o;
  }
  // voice-source periodic waves: harmonic rolloff between a saw (-6 dB/oct) and a soft glottal pulse (-12 dB/oct)
  wave(type) {
    if (this._pw[type]) return this._pw[type];
    const p = type === 'pressed' ? 1.25 : type === 'soft' ? 2.0 : 1.55, N = 96;
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) { im[n] = Math.pow(n, -p) * (n % 2 ? 1 : -1); re[n] = Math.pow(n, -p) * 0.3 * Math.sin(n * 1.7); }
    return (this._pw[type] = this.oc.createPeriodicWave(re, im));
  }
  gain(v = 1) { const g = this.oc.createGain(); g.gain.value = v; return g; }
  // envelope: pts = [[t, v], ...] relative to t0; exp=true uses exponential ramps (v floored)
  env(pts, t0 = 0, exp = false) {
    const g = this.oc.createGain(); const p = g.gain;
    p.value = pts[0][1]; p.setValueAtTime(pts[0][1], Math.max(0, t0 + pts[0][0]));
    for (let i = 1; i < pts.length; i++) {
      const [t, v] = pts[i];
      if (exp) p.exponentialRampToValueAtTime(Math.max(v, 1e-4), t0 + t); else p.linearRampToValueAtTime(v, t0 + t);
    }
    return g;
  }
  // attack / exp-decay percussive envelope
  perc(t0, a, d, peak = 1) {
    const g = this.oc.createGain(); const p = g.gain;
    p.setValueAtTime(0, 0); p.setValueAtTime(0, Math.max(0, t0)); p.linearRampToValueAtTime(peak, t0 + a);
    p.setTargetAtTime(0, t0 + a, Math.max(1e-4, d / 4.6)); return g;
  }
  filter(type, f, Q = 0.707, gainDb = 0) { const b = this.oc.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; b.gain.value = gainDb; return b; }
  lp(f, Q) { return this.filter('lowpass', f, Q); }
  hp(f, Q) { return this.filter('highpass', f, Q); }
  bp(f, Q = 1) { return this.filter('bandpass', f, Q); }
  peak(f, Q, db) { return this.filter('peaking', f, Q, db); }
  sweep(node, pts, t0 = 0) { const p = node.frequency; p.setValueAtTime(pts[0][1], Math.max(0, t0 + pts[0][0])); for (let i = 1; i < pts.length; i++) p.exponentialRampToValueAtTime(pts[i][1], t0 + pts[i][0]); return node; }
  shaper(k = 2) {
    const w = this.oc.createWaveShaper(), n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    w.curve = c; w.oversample = '2x'; return w;
  }
  curve(fn, n = 1024) { const w = this.oc.createWaveShaper(), c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = fn((i / (n - 1)) * 2 - 1); w.curve = c; return w; }
  pan(p) { const s = this.oc.createStereoPanner(); s.pan.value = p; return s; }
  chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
  via(...nodes) { this.chain(...nodes); return nodes[0]; }
  delay(t, max = 1) { const d = this.oc.createDelay(max); d.delayTime.value = t; return d; }
  // smooth random control signal in [-1,1], `rate` new targets per second (cosine-interpolated).
  // Reads the shared pool at playbackRate = rate / 4 Hz from a random offset: zero JS per call.
  smooth(rate, t0 = 0, dur = this.dur - t0) {
    const s = this.oc.createBufferSource(); s.buffer = smoothPool(); s.loop = true; s.playbackRate.value = rate / SM_RATE;
    s.start(Math.max(0, t0), this.rand(0, SM_SEC - 0.01)); s.stop(Math.min(this.dur, Math.max(0, t0) + Math.max(0.01, dur) + 0.01)); return s;
  }
  // random-walk amplitude modulation (gusts, turbulence, tearing)
  flutter(node, rate = 6, depth = 0.5, base = 1) {
    const g = this.gain(base * (1 - depth / 2));
    this.chain(this.smooth(rate), this.gain(base * depth / 2), g.gain);
    node.connect(g); return g;
  }
  // one grain of filtered noise (debris, crackle, click)
  hit(t, { f = 1000, Q = 1.5, a = 0.002, d = 0.08, amp = 1, color = 'white', pan = null, type = 'bandpass', dest = this.out } = {}) {
    if (t >= this.dur || amp <= 0) return;
    const len = Math.min(a + d * 1.6 + 0.01, this.dur - t);
    const nodes = [this.noise(t, len, color), this.filter(type, f, Q), this.perc(t, a, d, amp)];
    if (pan != null && this.oc.numberOfChannels > 1) nodes.push(this.pan(pan));
    nodes.push(dest); this.chain(...nodes);
  }
  // n grains scattered over [t0, t0+dur], front-loaded (bone crunch, stone fracture, crackling)
  crackle(t0, dur, n, { fLo = 1000, fHi = 5000, amp = 0.6, Qlo = 1.5, Qhi = 5, dLo = 0.004, dHi = 0.02, pow = 1.4, pan = null, dest = this.out } = {}) {
    for (let i = 0; i < n; i++) {
      const x = Math.pow(this.r(), pow), t = t0 + x * dur;
      this.hit(t, { f: this.rand(fLo, fHi), Q: this.rand(Qlo, Qhi), a: 0.0006, d: this.rand(dLo, dHi), amp: amp * this.rand(0.35, 1) * (1 - x * 0.5), pan: pan == null ? null : this.rand(-pan, pan), dest });
    }
  }
  // pitch-dropping sine thump (kicks, footfalls, booms)
  thump(t, { f0 = 120, f1 = 45, drop = 0.15, a = 0.004, d = 0.6, amp = 1, type = 'sine', drive = 0, dest = this.out } = {}) {
    if (t >= this.dur) return;
    const o = this.osc(type, f0, t, Math.min(this.dur, t + d * 1.8 + 0.05));
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + drop);
    const nodes = [o]; if (drive) nodes.push(this.shaper(drive));
    nodes.push(this.perc(t, a, d, amp), dest); this.chain(...nodes);
  }
  // inharmonic ring (sines, detuned pairs)
  ring(t, partials, { d = 0.4, amp = 1, a = 0.002, sweep = 1, detune = 0, dest = this.out } = {}) {
    for (const [ratio, lvl, dd = 1] of partials) {
      const dt = detune * this.rand(0.5, 1.5);
      for (const [off, w] of detune ? [[-dt, 0.64], [dt, 0.36]] : [[0, 1]]) {
        const f = ratio + off;
        const o = this.osc('sine', f, t, Math.min(this.dur, t + d * dd * 1.8 + 0.05));
        if (sweep !== 1) { o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * sweep, t + d * dd); }
        this.chain(o, this.perc(t, a, d * dd, amp * lvl * w), dest);
      }
    }
  }
  // wet bubble / saliva pop: rising sine blip (the core of every "wet" sound)
  bubble(t, f = 400, amp = 0.3, dest = this.out) {
    if (t >= this.dur) return;
    const L = this.rand(0.012, 0.03), o = this.osc('sine', f, t, t + L * 2.5);
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * this.rand(1.5, 2.3), t + L);
    this.chain(o, this.perc(t, 0.001, L, amp), dest);
  }
  // lips parting / smacking (scaled by `s`: 1 = human, 0.5 = giant)
  smack(t, amp = 1, s = 0.5, dest = this.out) {
    if (t >= this.dur) return;
    this.thump(t, { f0: 260 * s, f1: 120 * s, drop: 0.03, a: 0.001, d: 0.05, amp: 0.8 * amp, dest });
    this.hit(t, { f: 1400 * s, Q: 2, d: 0.018, amp: 0.7 * amp, color: 'pink', dest });
    this.hit(t + 0.004, { f: 3200 * s + 600, Q: 3, d: 0.01, amp: 0.4 * amp, dest });
    for (let i = 0; i < 5; i++) this.bubble(t + this.rand(0, 0.09), this.rand(500, 1300) * s, this.rand(0.1, 0.3) * amp, dest);
  }
  // stone grinding: noise chopped by a spiky stick-slip pulse train through stone resonances
  grind(t0, dur, { f = 200, amp = 1, rate = 16, dest = this.out } = {}) {
    const src = this.noise(t0, dur, 'white');
    const chop = this.gain(0.12);
    this.chain(this.smooth(rate, t0, dur), this.curve((x) => Math.pow(Math.max(0, x - 0.15) / 0.85, 2) * 1.6), chop.gain);
    src.connect(chop);
    const sum = this.gain(1);
    for (const [m, Q, g] of [[1, 7, 1], [1.73, 9, 0.7], [2.9, 11, 0.45], [4.7, 12, 0.25]]) this.chain(chop, this.bp(f * m * this.rand(0.93, 1.07), Q), this.gain(g * 2.2), sum);
    this.chain(chop, this.lp(f * 0.8), this.gain(0.8), sum);
    this.chain(sum, this.env([[0, 0], [dur * 0.15, amp], [dur * 0.7, amp * 0.8], [dur, 0]], t0), dest);
  }
  // glottal voice source with pitch contour, vibrato, jitter, optional sub-octave and roughness (fry)
  voice(t0, t1, f0, pitchPts, { vib = 5.5, vibDepth = 0.02, jitter = 0.015, sub = 0, rough = 0, wave = 'sawtooth' } = {}) {
    const sum = this.gain(1);
    const o = this.osc(wave, f0, t0, t1);
    o.frequency.setValueAtTime(pitchPts[0][1], t0 + pitchPts[0][0]);
    for (let i = 1; i < pitchPts.length; i++) o.frequency.exponentialRampToValueAtTime(pitchPts[i][1], t0 + pitchPts[i][0]);
    const lg = this.gain(vibDepth * 1731);
    if (vib > 0 && vibDepth > 0) this.chain(this.osc('sine', vib, t0, t1), lg, o.detune);
    const jg = this.gain(jitter * 1731); this.chain(this.smooth(18, t0, t1 - t0), jg, o.detune);
    o.connect(sum);
    if (sub) {
      const s2 = this.osc(wave, f0 / 2, t0, t1);
      s2.frequency.setValueAtTime(pitchPts[0][1] / 2, t0 + pitchPts[0][0]);
      for (let i = 1; i < pitchPts.length; i++) s2.frequency.exponentialRampToValueAtTime(pitchPts[i][1] / 2, t0 + pitchPts[i][0]);
      lg.connect(s2.detune); jg.connect(s2.detune); this.chain(s2, this.gain(sub), sum);
    }
    if (rough) { // vocal fry / roughness: amplitude chopped by fast random modulation
      const g = this.gain(1 - rough / 2); this.chain(this.smooth(55, t0, t1 - t0), this.gain(rough / 2), g.gain); sum.connect(g); return g;
    }
    return sum;
  }
  // parallel formant bank; formants = [[f, Q, gain], ...]
  formants(input, formants, dest) {
    const out = this.gain(1); const bank = [];
    for (const [f, Q, g] of formants) { const b = this.bp(f, Q); const gg = this.gain(g); input.connect(b); b.connect(gg); gg.connect(out); bank.push(b); }
    out.connect(dest); return { out, bank };
  }
  // A human (or giant, scale≈0.5) vocalisation: glottal source + aspiration through a 4-formant tract.
  //   contour [[x 0..1, pitch mult]], vowels [[x, 'a'|'o'|...]], cutAt = hard gate time (bitten off mid-scream)
  human(t0, L, { f0 = 200, contour = [[0, 1], [1, 1]], vowels = [[0, 'a']], gender = 'm', scale = null, rough = 0.1, breath = 0.2, breathLead = 0, vib = 6, vibDepth = 0.02, jitter = 0.02, wave = 'glottal', sub = 0, amp = 1, attack = 0.05, release = 0.25, drive = 1.4, cutAt = null, dest = this.out } = {}) {
    if (t0 >= this.dur) return;
    L = Math.min(L, this.dur - t0 - 0.01);
    const s = scale ?? (gender === 'f' ? 1.16 : gender === 'c' ? 1.32 : 1);
    const tv = t0 + breathLead, t1 = t0 + L;
    const pp = contour.map(([x, m]) => [x * (t1 - tv), f0 * m]);
    const src = this.voice(tv, t1 + 0.05, f0, pp, { vib, vibDepth, jitter, rough, sub, wave });
    const tract = this.gain(1); src.connect(tract);
    const asp = this.chain(this.noise(t0, L + 0.05, 'white'), this.hp(700 * s + 200), this.gain(breath)); asp.connect(tract);
    const pre = this.gain(1);
    const v0 = VOW[vowels[0][1]];
    const bank = [];
    for (let i = 0; i < 4; i++) { const f = v0[i] * s, b = this.bp(f, f / (BW[i] * Math.max(0.6, s))); const g = this.gain(FG[i] * 2.4); this.chain(tract, b, g, pre); bank.push(b); }
    this.chain(tract, this.lp(v0[0] * s * 0.9, 0.7), this.gain(0.25), pre); // body / chest
    for (const [x, name] of vowels.slice(1)) { const vv = VOW[name]; bank.forEach((b, i) => b.frequency.setTargetAtTime(vv[i] * s, t0 + x * L, 0.05)); }
    const e = this.gain(0); const p = e.gain;
    p.setValueAtTime(0, t0); p.linearRampToValueAtTime(amp, t0 + attack); p.setValueAtTime(amp, Math.max(t0 + attack, t1 - release));
    if (cutAt != null && cutAt < t1) { p.cancelScheduledValues(cutAt); p.setValueAtTime(amp, cutAt); p.linearRampToValueAtTime(0, cutAt + 0.006); }
    else p.linearRampToValueAtTime(0, t1);
    const nodes = [pre]; if (drive > 1) nodes.push(this.shaper(drive)); nodes.push(e, dest); this.chain(...nodes);
    return e;
  }
}

// ---------------------------------------------------------------- rendering helpers
// loop crossfade done IN PLACE: blend the tail into the head, play with loopEnd = (n - fade) (no copy)
export function makeLoop(buf, fade) {
  const f = Math.floor(fade * buf.sampleRate), L = buf.length - f;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < f; i++) { const x = i / f; d[i] = d[i] * Math.sqrt(x) + d[L + i] * Math.sqrt(1 - x); }
  }
  buf._loopEnd = L / buf.sampleRate;
  return buf;
}
// Level: one strided peak scan (no rescale pass). The gain is stored on the buffer (_gain) and applied at
// play time by the mixer. Non-finite samples (never expected) trigger a full clean pass.
export function normalise(buf, target = 0.89) {
  let pk = 0, bad = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i += 2) { const x = d[i], a = x < 0 ? -x : x; if (a > pk) pk = a; else if (a !== a) bad++; }
  }
  if (bad || !Number.isFinite(pk)) {
    pk = 0; bad = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { if (!Number.isFinite(d[i])) { d[i] = 0; bad++; } else if (Math.abs(d[i]) > pk) pk = Math.abs(d[i]); } }
  }
  const fe = Math.min(buf.length, Math.floor(0.004 * buf.sampleRate)); // 4 ms de-click at the end
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < fe; i++) d[buf.length - 1 - i] *= i / fe; }
  buf._gain = pk > 1e-6 ? target / pk : 1;
  return { pk, bad };
}

// Impulse responses. Stereo, decorrelated, darkening tail + discrete early reflections / slaps.
//   town: stone streets (2.6 s, facade flutter);  big: the 50 m ring wall / open valley (6.5 s, slow build, slapbacks)
export function makeImpulse(sr = SR, kind = 'town') {
  const P = kind === 'big'
    ? { len: 6.5, decay: 0.95, att: 0.09, bright: 0.55, dark: 0.9, amp: 0.5, er: [[0.021, 0.25], [0.047, -0.2], [0.083, 0.18]], slaps: [[0.37, 0.34], [0.74, 0.17], [1.12, 0.08], [1.5, 0.04]], slapLen: 2600 }
    : { len: 2.8, decay: 2.3, att: 0.01, bright: 0.85, dark: 1.7, amp: 0.55, er: [[0.009, 0.6], [0.017, -0.45], [0.023, 0.4], [0.031, -0.35], [0.043, 0.3], [0.058, -0.28], [0.071, 0.22], [0.089, 0.18], [0.12, 0.12], [0.16, -0.09]], slaps: [[0.19, 0.16], [0.38, 0.07]], slapLen: 700 };
  const n = Math.floor(sr * P.len), buf = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr });
  const r = mulberry32(kind === 'big' ? 4242 : 99);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c); let lp = 0, lp2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const decay = Math.exp(-t * P.decay) * (t < P.att ? t / P.att : 1);
      const k = 0.08 + P.bright * Math.exp(-t * P.dark); // tail darkens (air absorption)
      lp += k * ((r() * 2 - 1) - lp); lp2 += 0.5 * (lp - lp2);
      d[i] = (kind === 'big' ? lp2 : lp) * decay * P.amp;
    }
    for (const [t, a] of P.er) { const i = Math.floor((t + (c ? 0.0031 : 0)) * sr); for (let j = 0; j < 60 && i + j < n; j++) d[i + j] += a * (r() * 2 - 1) * Math.exp(-j / 14); }
    for (const [t, a] of P.slaps) {
      const i = Math.floor((t + c * 0.017) * sr); let l = 0;
      for (let j = 0; j < P.slapLen && i + j < n; j++) { l += 0.22 * ((r() * 2 - 1) - l); d[i + j] += a * l * Math.exp(-j / (P.slapLen / 3.5)) * 2.2; }
    }
  }
  return buf;
}
