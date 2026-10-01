// Oct 1 rebuild — the COLOSSAL TITAN and the core feel sounds (ODM gear, blades, footfalls).
// Overrides same-named entries in sfx_*.js. `sat` = drive of a native tanh saturation pass applied after
// level-normalising (sounds.js) — glues layers and adds harmonic density instead of raw oscillator tones.
export const V2 = {
  // ---- THE COLOSSAL TITAN (60 m, skinless; lungs the size of houses, steam everywhere)
  // idle: an enormous slow breath — air roaring in over the teeth, a steaming exhale with a groan under it
  giant_breath: { dur: 9.5, ch: 1, variants: 1, loop: 0.8, sat: 1.4, build(k) {
    const O = k.out;
    k.chain(k.noise(0.2, 3.8, 'pink'), k.sweep(k.bp(200, 0.7), [[0, 160], [3.4, 650]], 0.2), k.env([[0, 0], [2.9, 0.9], [3.6, 0]], 0.2), O);
    k.chain(k.noise(0.2, 3.8), k.bp(2600, 1.4), k.env([[0, 0], [3.0, 0.22], [3.6, 0]], 0.2), O);
    k.human(4.2, 4.6, { f0: 31, contour: [[0, 1.05], [0.4, 1], [1, 0.8]], vowels: [[0, 'o'], [0.6, 'u']], scale: 0.38, breath: 1.4, breathLead: 0.15, rough: 0.7, jitter: 0.06, vib: 0, wave: 'soft', sub: 0.5, amp: 0.8, attack: 0.5, release: 2.2, drive: 2.5 });
    k.chain(k.flutter(k.chain(k.noise(4.2, 4.8), k.hp(900), k.peak(3200, 0.8, 5)), 9, 0.5, 1), k.env([[0, 0], [0.4, 0.45], [2.5, 0.3], [4.6, 0]], 4.2), O); // steam on the breath
    k.chain(k.noise(4.2, 4.8, 'pink'), k.bp(320, 0.8), k.env([[0, 0], [0.5, 0.6], [4.5, 0]], 4.2), O);
  } },
  // wind-up / pain: a cavernous, saturated groan
  giant_groan: { dur: 4.2, ch: 1, variants: 2, sat: 2.2, build(k, v) {
    const O = k.out, f0 = v ? 34 : 40;
    k.human(0.05, 3.8, { f0, contour: [[0, 0.85], [0.25, 1.1], [0.7, 1.02], [1, 0.75]], vowels: [[0, 'u'], [0.3, 'o'], [0.8, 'u']], scale: 0.4, breath: 0.6, rough: 0.8, jitter: 0.06, vib: 3, vibDepth: 0.03, wave: 'pressed', sub: 0.8, amp: 1, attack: 0.35, release: 1.2, drive: 4 });
    k.chain(k.flutter(k.chain(k.noise(0.05, 3.9, 'pink'), k.bp(900, 0.9)), 22, 0.8, 1), k.env([[0, 0], [0.4, 0.35], [3, 0.25], [3.9, 0]], 0.05), O); // throat rasp
    k.chain(k.noise(0, 4.1), k.hp(2500), k.env([[0, 0], [0.5, 0.12], [3.9, 0]]), O);
  } },
  giant_hurt: { dur: 3.6, ch: 1, variants: 2, sat: 2.4, build(k, v) {
    const O = k.out, f0 = v ? 52 : 60;
    k.human(0.02, 3.0, { f0, contour: [[0, 0.8], [0.1, 1.4], [0.45, 1.2], [1, 0.6]], vowels: [[0, 'a'], [0.5, 'o'], [0.85, 'u']], scale: 0.45, breath: 0.5, rough: 0.8, jitter: 0.07, vib: 5, vibDepth: 0.035, wave: 'pressed', sub: 0.7, amp: 1, attack: 0.04, release: 1.1, drive: 5 });
    k.chain(k.flutter(k.chain(k.noise(0, 3), k.bp(1400, 0.8)), 25, 0.8, 1), k.env([[0, 0], [0.08, 0.5], [2.8, 0]]), O);
    k.thump(0.02, { f0: 90, f1: 35, drop: 0.3, d: 1, amp: 0.6, drive: 2.5, dest: O });
  } },
  // the ground-shaking roar: inhale, a saturated bellow with a rasping snarl band, steam hiss, sub swell, vast tail
  giant_roar: { dur: 10, ch: 1, variants: 2, sat: 1.8, build(k, v) {
    const O = k.out, T0 = 0.7, L = 6.3;
    const bus = k.gain(1);
    const cv = k.oc.createConvolver(); cv.buffer = bigIR(k); const wg = k.gain(0.45); bus.connect(cv); cv.connect(wg); wg.connect(O);
    k.chain(bus, O);
    k.chain(k.noise(0, T0 + 0.1, 'pink'), k.sweep(k.bp(300, 0.8), [[0, 220], [T0, 1000]]), k.env([[0, 0], [T0 - 0.1, 0.6], [T0 + 0.05, 0]]), bus);
    const f0 = v ? 36 : 42;
    k.human(T0, L, { f0, contour: [[0, 0.75], [0.1, 1.3], [0.4, 1.22], [0.75, 1.08], [1, 0.62]], vowels: [[0, 'a'], [0.45, 'o'], [0.8, 'u']], scale: 0.42, breath: 0.6, rough: 0.9, jitter: 0.08, vib: 3.5, vibDepth: 0.035, wave: 'pressed', sub: 0.9, amp: 1, attack: 0.25, release: 1.5, drive: 6, dest: bus });
    k.thump(T0, { f0: 70, f1: 24, drop: 0.8, a: 0.01, d: 2.5, amp: 0.9, drive: 3, dest: k.via(k.lp(260), bus) }); // thunderous onset
    k.chain(k.noise(T0, 0.4), k.hp(700), k.perc(T0, 0.002, 0.15, 0.6), bus);
    if (0) k.human(T0 + 0.3, L - 0.4, { f0: f0 * 4.6, contour: [[0, 0.65], [0.15, 1.2], [0.5, 1.3], [1, 0.7]], vowels: [[0, 'a'], [0.6, 'o']], scale: 0.85, breath: 0.3, rough: 0.5, vib: 5, vibDepth: 0.03, wave: 'pressed', amp: 0.4, attack: 0.6, release: 1.4, drive: 3, dest: bus });
    k.chain(k.flutter(k.chain(k.noise(T0, L), k.bp(1100, 0.7)), 30, 0.85, 1), k.env([[0, 0], [0.4, 0.5], [4.5, 0.4], [L, 0]], T0), k.peak(1200, 1, 4), bus); // snarl
    k.chain(k.noise(T0, L), k.hp(3000), k.env([[0, 0], [0.5, 0.18], [L, 0]], T0), bus); // steam from the jaw
    k.chain(k.osc('sine', 29, T0, T0 + L), k.env([[0, 0], [0.8, 0.6], [4.6, 0.5], [L, 0]], T0), bus);
    k.thump(T0 + 0.05, { f0: 85, f1: 30, drop: 0.5, d: 1.4, amp: 0.8, drive: 2.5, dest: bus });
  } },
  // SCREAMING high-pressure steam blast: valve burst, roaring jet, whistling resonances gliding up, sizzle
  steam_blast: { dur: 4.2, ch: 1, variants: 2, sat: 1.4, build(k, v) { buildSteam(k, v, false); } },
  steam_jet: { dur: 3.6, ch: 1, variants: 2, loopDur: 5.5, sat: 1.3, build(k, v) { buildSteam(k, v, k.dur > 4.5); } },
  // colossal footfall: shattering stone transient, a mid "thud" of 30 tons of meat, sub, debris rain, dust
  giant_step: { dur: 4.2, ch: 1, variants: 3, sat: 1.9, build(k, v) {
    const O = k.out, t = 0.004;
    k.chain(k.noise(t, 0.12), k.hp(900), k.perc(t, 0.0006, 0.05, 1), O);
    k.chain(k.noise(t, 0.3, 'pink'), k.bp(1500 + v * 200, 0.9), k.perc(t, 0.001, 0.12, 0.8), O);
    k.chain(k.noise(t, 0.6, 'pink'), k.bp(260 + v * 30, 0.9), k.perc(t, 0.003, 0.35, 1.2), O);
    k.thump(t, { f0: 105, f1: 42, drop: 0.1, a: 0.002, d: 0.5, amp: 1.3, drive: 3, dest: O }); // punch
    k.thump(t, { f0: 50, f1: 22, drop: 0.5, a: 0.01, d: 1.6, amp: 0.7, drive: 2, dest: k.via(k.lp(150), O) });
    k.crackle(t + 0.003, 0.35, 50, { fLo: 700, fHi: 4500, amp: 0.55, dLo: 0.004, dHi: 0.03 });
    for (let i = 0; i < 40; i++) { const tt = t + 0.25 + Math.pow(k.r(), 1.4) * 1.8, big = k.r() < 0.3; k.hit(tt, { f: big ? k.rand(250, 800) : k.rand(1000, 4500), Q: k.rand(1, 3), d: big ? k.rand(0.06, 0.18) : k.rand(0.01, 0.04), amp: k.rand(0.15, 0.45) * (1 - (tt - t) / 2.4), color: big ? 'pink' : 'white' }); }
    k.chain(k.noise(0.05, 3, 'pink'), k.bp(700, 0.5), k.env([[0, 0], [0.15, 0.25], [2.8, 0]], 0.05), O); // dust & grit
  } },
  // weak-point cut confirm: bright metallic impact + clap + a bass drop
  hit_confirm: { dur: 1.6, ch: 2, variants: 2, sat: 1.5, build(k, v) {
    const O = k.out;
    k.chain(k.noise(0, 0.1, 'white', 2), k.hp(2500), k.perc(0, 0.0005, 0.03, 1), O);
    k.chain(k.noise(0, 0.2, 'pink', 2), k.bp(1200, 0.9), k.perc(0, 0.001, 0.06, 0.9), O);
    k.ring(0.002, [[1568 * (v ? 1.122 : 1), 0.7, 1], [2349 * (v ? 1.122 : 1), 0.5, 0.8], [3136 * (v ? 1.122 : 1), 0.35, 0.6], [4699, 0.2, 0.4]], { d: 0.9, amp: 0.3, detune: 3 });
    const o = k.osc('sine', 130, 0.01, 1.2); k.sweep(o, [[0, 130], [0.5, 38]], 0.01); k.chain(o, k.shaper(2), k.env([[0, 0], [0.01, 1], [0.6, 0.5], [1.1, 0]], 0.01), O); // bass drop
    k.thump(0, { f0: 90, f1: 45, drop: 0.08, d: 0.3, amp: 0.8, drive: 2.5, dest: O });
  } },
  // soldier battle shout (2–4 men, pressed 'HAA!' / 'OHH!' / 'RAAH')
  shout: { dur: 1.6, ch: 1, variants: 5, sat: 1.6, build(k, v) {
    const n = 2 + (v % 3), vow = [['a'], ['o'], ['a', 'er'], ['ae'], ['o', 'a']][v];
    for (let i = 0; i < n; i++) {
      const t = k.rand(0, 0.08), L = k.rand(0.6, 1.1), f0 = k.rand(140, 200);
      k.human(t, L, { f0, contour: [[0, 0.9], [0.15, 1.15], [0.7, 1.08], [1, 0.85]], vowels: vow.map((x, j) => [j * 0.5, x]), gender: 'm', rough: 0.45, breath: 0.25, breathLead: 0.03, wave: 'pressed', vib: 5, vibDepth: 0.02, jitter: 0.03, amp: k.rand(0.6, 1), attack: 0.03, release: 0.25, drive: 2.5 });
    }
  } },
  // the garrison rallying: a bed of men shouting battle cries, horses, armour, distant drums of feet (replaces the panicking crowd)
  crowd: { dur: 12, ch: 2, variants: 1, loop: 1.2, build(k) {
    const bus = k.gain(0.9); k.chain(bus, k.hp(150), k.lp(4500), k.out);
    for (let i = 0; i < 26; i++) {
      const t = k.rand(0, 11), L = k.rand(0.5, 1.2), p = k.pan(k.rand(-0.95, 0.95)); p.connect(bus);
      k.human(t, Math.min(L, 11.9 - t), { f0: k.rand(130, 210), contour: [[0, 0.9], [0.15, 1.15], [1, 0.85]], vowels: [[0, k.pick(['a', 'o', 'ae', 'er'])]], gender: 'm', rough: 0.4, breath: 0.25, wave: 'pressed', vib: 5, vibDepth: 0.02, amp: k.rand(0.25, 0.6), release: 0.2, drive: 2.2, dest: p });
    }
    for (let i = 0; i < 70; i++) k.hit(k.rand(0, 11.95), { f: k.rand(2500, 6000), Q: 5, d: 0.02, amp: k.rand(0.03, 0.08), pan: k.rand(-0.9, 0.9), dest: bus }); // armour / buckles
    for (let i = 0; i < 90; i++) k.hit(k.rand(0, 11.95), { f: k.rand(500, 1300), Q: 1.4, d: 0.03, amp: k.rand(0.04, 0.1), color: 'pink', pan: k.rand(-0.9, 0.9), dest: bus }); // boots
  } },
  // ---- ODM gear
  // doppler-ish pass-by: air compressing against a wall / the titan's body as you skim past it
  passby: { dur: 1.0, ch: 1, variants: 3, sat: 1.3, build(k, v) {
    const O = k.out, pk = 0.28 + v * 0.04;
    k.chain(k.noise(0, 0.95, 'pink'), k.sweep(k.bp(700, 1.3), [[0, 500], [pk, 2600 + v * 300], [0.9, 380]]), k.env([[0, 0], [pk, 1], [pk + 0.12, 0.55], [0.9, 0]]), O);
    k.chain(k.noise(0, 0.9, 'pink'), k.sweep(k.bp(160, 1), [[0, 110], [pk, 320], [0.85, 90]]), k.env([[0, 0], [pk, 0.8], [0.85, 0]]), O);
    k.chain(k.flutter(k.chain(k.noise(0.1, 0.6), k.hp(4000)), 40, 0.8, 1), k.env([[0, 0], [pk - 0.1, 0.35], [0.7, 0]], 0.1), O);
  } },
  hook_fire: { dur: 1.0, ch: 2, variants: 3, sat: 1.6, build(k, v) {
    const O = k.out;
    k.hit(0, { f: 4200, Q: 3, a: 0.0003, d: 0.005, amp: 1 });                               // trigger
    k.chain(k.noise(0.002, 0.08), k.hp(1500), k.perc(0.002, 0.0005, 0.025, 1), O);          // pneumatic crack
    k.chain(k.noise(0.002, 0.15, 'pink'), k.bp(900 + v * 100, 1.2), k.perc(0.002, 0.001, 0.05, 0.9), O); // launcher thock
    k.thump(0.002, { f0: 170, f1: 65, drop: 0.04, d: 0.07, amp: 0.8, dest: O });
    k.chain(k.noise(0.003, 0.3, 'white', 2), k.bp(2600, 0.8), k.perc(0.003, 0.003, 0.14, 0.6), O); // gas vent
    // cable zip: steel line ripping off the spool (toothed AM on a falling band) + the wire singing
    const zf = k.sweep(k.bp(5500, 6), [[0, 6000], [0.55, 2100]], 0.02), am = k.gain(0.5);
    const lfo = k.osc('square', 340, 0.02, 0.7); k.sweep(lfo, [[0, 360 + v * 30], [0.55, 110]], 0.02); k.chain(lfo, k.gain(0.5), am.gain);
    k.chain(k.noise(0.02, 0.7, 'white', 2), zf, am, k.env([[0, 0], [0.02, 0.9], [0.3, 0.55], [0.62, 0]], 0.02), O);
    k.ring(0.015, [[3100 + v * 120, 0.6, 1], [4650, 0.4, 0.8], [6200, 0.25, 0.6]], { d: 0.5, amp: 0.25, sweep: 0.6, detune: 5, dest: k.via(k.pan(0.2), O) });
  } },
  gas: { dur: 0.7, ch: 2, variants: 3, sat: 1.4, build(k, v) {
    const O = k.out;
    k.chain(k.noise(0, 0.15, 'pink'), k.lp(900), k.perc(0, 0.002, 0.07, 1), O);           // "pff"
    k.chain(k.noise(0, 0.7, 'white', 2), k.hp(1100), k.peak(3800 + v * 400, 0.9, 7), k.env([[0, 0], [0.005, 1], [0.08, 0.6], [0.35, 0.25], [0.68, 0]]), O);
    k.chain(k.noise(0, 0.5, 'pink', 2), k.bp(600, 0.8), k.env([[0, 0], [0.01, 0.5], [0.3, 0]]), O);
  } },
  slash: { dur: 0.75, ch: 2, variants: 3, sat: 1.5, build(k, v) {
    const O = k.out, dir = v === 1 ? -1 : 1;
    const pn = k.pan(-0.5 * dir); pn.pan.setValueAtTime(-0.5 * dir, 0); pn.pan.linearRampToValueAtTime(0.5 * dir, 0.2);
    k.chain(k.noise(0, 0.3, 'pink'), k.sweep(k.bp(500, 1.4), [[0, 450], [0.07, 3400], [0.22, 1100]]), k.env([[0, 0], [0.06, 1], [0.24, 0]]), pn, O); // air cut
    k.chain(k.noise(0, 0.25, 'pink'), k.sweep(k.bp(180, 1), [[0, 140], [0.07, 520], [0.2, 180]]), k.env([[0, 0], [0.06, 0.8], [0.22, 0]]), O);         // body swish
    k.chain(k.noise(0.05, 0.05, 'white', 2), k.hp(5000), k.perc(0.05, 0.0005, 0.012, 1), O);                                                        // edge bite
    const b = 2900 + v * 260;
    k.ring(0.05, [[b, 0.8, 1], [b * 1.41, 0.6, 0.8], [b * 1.97, 0.45, 0.6], [b * 2.63, 0.3, 0.45]], { d: 0.45, amp: 0.4, detune: 7, dest: k.via(k.pan(0.25 * dir), O) });
    k.chain(k.noise(0.05, 0.25, 'white', 2), k.bp(7000, 1.5), k.env([[0, 0], [0.01, 0.35], [0.2, 0]], 0.05), O);                                    // steel shimmer
  } },
};

function bigIR(k) {
  const sr = k.oc.sampleRate, n = Math.floor(sr * 5), b = k.oc.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let lp = 0; for (let i = 0; i < n; i++) { const t = i / sr; lp += (0.06 + 0.5 * Math.exp(-t)) * ((k.r() * 2 - 1) - lp); d[i] = lp * Math.exp(-t * 1.1) * Math.min(1, t / 0.06) * 0.5; } }
  return b;
}
function buildSteam(k, v, looping) {
  const O = k.out, D = k.dur;
  const E = (lv, pts) => (looping ? k.gain(lv) : k.env(pts));
  if (!looping) {
    k.thump(0, { f0: 80, f1: 30, drop: 0.15, d: 0.5, amp: 1, drive: 3, dest: O });
    k.chain(k.noise(0, 0.25), k.hp(400), k.perc(0, 0.001, 0.08, 1), O);
  }
  // jet roar
  k.chain(k.flutter(k.chain(k.noise(0, D), k.hp(350), k.peak(2600, 0.8, 7)), 26, 0.3, 1), E(0.8, [[0, 0], [0.015, 1], [0.5, 0.9], [2.6, 0.6], [D - 0.05, 0]]), O);
  k.chain(k.flutter(k.chain(k.noise(0, D, 'pink'), k.bp(140, 0.6)), 7, 0.5, 1), E(0.7, [[0, 0], [0.03, 1], [2.6, 0.5], [D - 0.05, 0]]), O);
  k.chain(k.noise(0, D), k.hp(7500), E(0.3, [[0, 0], [0.02, 0.45], [D - 0.05, 0]]), O);
  // the scream: narrow resonances excited by the jet, gliding up as pressure peaks, wobbling
  for (const [f, g] of [[1650, 1], [2480, 0.7], [3900, 0.45]]) {
    const ff = f * (v ? 0.86 : 1), b = k.bp(ff, 38);
    if (!looping) k.sweep(b, [[0, ff * 0.82], [0.45, ff * 1.06], [D - 0.1, ff * 0.95]]);
    else k.chain(k.smooth(1.3), k.gain(ff * 0.03), b.frequency);
    k.chain(k.noise(0, D), b, k.gain(3.2 * g), E(0.8, [[0, 0], [0.1, 0.4], [0.5, 1], [2.4, 0.7], [D - 0.05, 0]]), O);
  }
  k.crackle(0.05, D - 0.2, 60, { fLo: 3000, fHi: 9000, amp: 0.14, pow: 1 });
}
