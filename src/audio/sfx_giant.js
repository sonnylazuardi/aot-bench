// THE SMILING TITAN — signature sounds. A 60 m throat: formants at ~0.5x a man's, f0 40–90 Hz.
// It grins through clenched flat teeth, so every exhale hisses through them; it's wet, slow and wrong.
import { makeImpulse } from './kit.js';
const GS = 0.5; // giant formant scale

export const GIANT = {
  // low, slow, uncanny huffing laughter through the grin, ending in lip smacks
  giant_giggle: { dur: 4.8, ch: 1, variants: 3, build(k, v) {
    const O = k.out;
    const n = [4, 6, 3][v], gap = [0.5, 0.4, 0.62][v], f0 = [64, 72, 56][v];
    let t = 0.1;
    if (v === 2) { // opens with a long wet inhale through the teeth
      k.chain(k.noise(0, 1.1, 'pink'), k.bp(620, 1.1), k.env([[0, 0], [0.8, 0.45], [1.05, 0]]), O);
      k.chain(k.noise(0, 1.1), k.bp(2100, 2.2), k.env([[0, 0], [0.85, 0.2], [1.05, 0]]), O);
      for (let i = 0; i < 6; i++) k.bubble(k.rand(0.1, 1), k.rand(250, 600), 0.18);
      t = 1.15;
    }
    for (let i = 0; i < n; i++) {
      const last = i === n - 1, L = k.rand(0.2, 0.3) * (last ? 1.7 : 1), amp = (0.7 + 0.3 * Math.sin((i + 0.5) / n * Math.PI)) * k.rand(0.85, 1.05);
      const fi = f0 * (1.1 - i * 0.03) * k.rand(0.95, 1.05);
      // "hhuh": aspiration leads, then a breathy voiced burst falling in pitch
      k.human(t, L, { f0: fi, contour: [[0, 1.1], [0.35, 1], [1, 0.72]], vowels: [[0, 'er'], [0.6, 'o']], scale: GS, breath: 0.75, breathLead: 0.045, rough: 0.45, jitter: 0.04, vib: 0, wave: 'soft', sub: 0.4, amp, attack: 0.03, release: L * 0.6, drive: 1.8, dest: O });
      // air forced through the teeth of the grin
      k.chain(k.noise(t, L + 0.12), k.bp(k.rand(1900, 2500), 1.8), k.perc(t, 0.015, L * 0.9, 0.3 * amp), O);
      k.chain(k.noise(t, L + 0.1), k.hp(4200), k.perc(t, 0.01, L * 0.6, 0.06 * amp), O);
      // diaphragm pulse (felt more than heard)
      k.thump(t + 0.03, { f0: 46, f1: 32, drop: 0.12, a: 0.03, d: L * 1.2, amp: 0.5 * amp, dest: O });
      // saliva
      for (let j = 0; j < 5; j++) k.bubble(t + k.rand(0, L + 0.1), k.rand(260, 720), k.rand(0.06, 0.18) * amp);
      t += L + gap * k.rand(0.8, 1.15);
    }
    k.smack(t + 0.05, 0.9, GS); if (v !== 1) k.smack(t + 0.38, 0.5, GS);
    k.chain(k.noise(t + 0.4, 0.8), k.bp(2000, 2), k.env([[0, 0], [0.1, 0.12], [0.7, 0]], t + 0.4), O); // hiss back in through the teeth
  } },

  // idle breathing: slow inhale over the teeth, a huffing, faintly voiced exhale. Looped at the head.
  giant_breath: { dur: 8.6, ch: 1, variants: 1, loop: 0.6, build(k) {
    const O = k.out;
    // inhale (0.2 .. 3.4)
    const inh = k.sweep(k.bp(500, 0.9), [[0, 380], [3.1, 900]], 0.2);
    k.chain(k.noise(0.2, 3.3, 'pink'), inh, k.env([[0, 0], [2.6, 0.5], [3.2, 0]], 0.2), O);
    k.chain(k.noise(0.2, 3.3), k.bp(2200, 2), k.env([[0, 0], [2.7, 0.14], [3.2, 0]], 0.2), O);
    // exhale (3.9 .. 7.6): huff with a hum under it
    k.human(3.9, 3.4, { f0: 44, contour: [[0, 1.05], [0.5, 1], [1, 0.82]], vowels: [[0, 'er'], [0.7, 'u']], scale: GS, breath: 1.3, breathLead: 0.1, rough: 0.5, jitter: 0.05, vib: 0, wave: 'soft', amp: 0.55, attack: 0.25, release: 1.6, drive: 1.5, dest: O });
    k.chain(k.noise(3.9, 3.5), k.bp(2300, 1.6), k.env([[0, 0], [0.3, 0.2], [2, 0.12], [3.4, 0]], 3.9), O);
    k.chain(k.noise(3.9, 3.5, 'brown'), k.lp(160), k.env([[0, 0], [0.3, 0.6], [3.3, 0]], 3.9), O);
    for (let i = 0; i < 14; i++) k.bubble(k.rand(0.3, 8.2), k.rand(240, 700), k.rand(0.05, 0.14));
    k.smack(7.95, 0.35, GS);
  } },

  // attack wind-up: closed-grin hum "hmmmmm" that opens into a huff
  giant_groan: { dur: 3.8, ch: 1, variants: 2, build(k, v) {
    const O = k.out, f0 = v ? 50 : 58;
    k.human(0.05, 2.5, { f0, contour: [[0, 0.9], [0.4, 1.08], [1, 1.02]], vowels: [[0, 'm'], [0.8, 'er']], scale: GS, breath: 0.25, rough: 0.35, jitter: 0.03, vib: 3, vibDepth: 0.025, wave: 'glottal', sub: 0.6, amp: 1, attack: 0.4, release: 0.5, drive: 2, dest: O });
    k.human(2.45, 0.9, { f0: f0 * 1.2, contour: [[0, 1], [1, 0.7]], vowels: [[0, 'er']], scale: GS, breath: 0.9, breathLead: 0.05, rough: 0.5, vib: 0, wave: 'soft', amp: 0.8, attack: 0.03, release: 0.5, drive: 1.6, dest: O });
    k.chain(k.noise(2.45, 1), k.bp(2200, 1.8), k.perc(2.45, 0.02, 0.7, 0.3), O);
    k.chain(k.osc('sine', f0 / 2, 0, 3), k.env([[0, 0], [0.6, 0.35], [2.4, 0.3], [2.9, 0]]), O);
    for (let i = 0; i < 6; i++) k.bubble(k.rand(0.2, 3.3), k.rand(250, 650), 0.12);
    k.smack(3.35, 0.5, GS);
  } },

  // pained bellow when a tendon is cut
  giant_hurt: { dur: 3.4, ch: 1, variants: 2, build(k, v) {
    const O = k.out, f0 = v ? 78 : 92, bus = k.gain(1); k.chain(bus, k.filter('lowshelf', 160, 0.7, 5), O);
    k.human(0.02, 2.6, { f0, contour: [[0, 0.8], [0.12, 1.35], [0.5, 1.2], [1, 0.62]], vowels: [[0, 'a'], [0.55, 'o'], [0.85, 'u']], scale: 0.56, breath: 0.4, rough: 0.7, jitter: 0.06, vib: 5, vibDepth: 0.03, wave: 'pressed', sub: 0.8, amp: 1, attack: 0.06, release: 1.0, drive: 4, dest: bus });
    k.human(0.12, 2.2, { f0: f0 * 3.1, contour: [[0, 0.8], [0.2, 1.25], [1, 0.7]], vowels: [[0, 'a'], [0.6, 'o']], scale: 0.9, breath: 0.2, rough: 0.3, vib: 6, vibDepth: 0.03, wave: 'pressed', amp: 0.35, attack: 0.1, release: 1, drive: 2.5, dest: bus });
    k.chain(k.noise(0, 2.8), k.bp(2100, 1.2), k.env([[0, 0], [0.1, 0.35], [2.6, 0]]), bus);
    k.thump(0.02, { f0: 80, f1: 35, drop: 0.3, d: 1, amp: 0.6, drive: 2, dest: bus });
  } },

  // the boss's signature ROAR: inhale, growl + howl + teeth-hiss blast + sub, with its own vast tail
  giant_roar: { dur: 10.5, ch: 1, variants: 2, build(k, v) {
    const O = k.out, T0 = 0.75, T = T0 + 6.2;
    const bus = k.gain(1);
    const cv = k.oc.createConvolver(); cv.buffer = makeImpulse(k.oc.sampleRate, 'big'); const wg = k.gain(0.5); bus.connect(cv); cv.connect(wg); wg.connect(O);
    k.chain(bus, k.gain(0.9), O);
    // pre-roar inhale: a huge gasp over the teeth
    k.chain(k.noise(0, T0 + 0.1, 'pink'), k.sweep(k.bp(400, 0.8), [[0, 300], [T0, 1200]]), k.env([[0, 0], [T0 - 0.1, 0.55], [T0 + 0.05, 0]]), bus);
    k.chain(k.noise(0, T0 + 0.1), k.bp(2400, 2), k.env([[0, 0], [T0 - 0.1, 0.2], [T0 + 0.05, 0]]), bus);
    const f0 = v ? 41 : 47;
    const g1 = k.voice(T0, T, f0, [[0, f0 * 0.75], [0.55, f0 * 1.3], [2.4, f0 * 1.22], [4.6, f0 * 1.08], [6.2, f0 * 0.66]], { vib: 3.4, vibDepth: 0.035, jitter: 0.07, sub: 0.9, rough: 0.85, wave: 'pressed' });
    const g1m = k.gain(1); g1.connect(g1m); k.chain(k.noise(T0, 6.2, 'pink'), k.gain(0.45), g1m);
    const d1 = k.shaper(5.5);
    const f1b = k.formants(g1m, [[850 * 0.55, 5, 1], [1250 * 0.55, 6, 0.85], [2600 * 0.55, 7, 0.4], [2100, 4, 0.22]], d1).bank;
    k.chain(d1, k.filter('lowshelf', 150, 0.7, 9), k.lp(3600), k.env([[0, 0], [0.35, 0.8], [0.95, 1], [4.7, 0.9], [6.3, 0]], T0), bus);
    f1b.forEach((b, i) => { if (i < 3) { b.frequency.setTargetAtTime([600, 950, 2500][i] * 0.55, T0 + 2.6, 0.6); b.frequency.setTargetAtTime([380, 900, 2300][i] * 0.55, T0 + 4.8, 0.5); } });
    // howl: the blood-curdling upper layer
    const hf = v ? 205 : 238;
    const h = k.voice(T0 + 0.3, T, hf, [[0, hf * 0.62], [0.8, hf * 1.25], [2.1, hf * 1.42], [3.9, hf * 1.3], [5.8, hf * 0.72]], { vib: 5.2, vibDepth: 0.035, jitter: 0.04, rough: 0.35, wave: 'pressed' });
    const d2 = k.shaper(3.2);
    const f2b = k.formants(h, [[850 * 1.05, 8, 1], [1250 * 1.05, 9, 0.7], [2600 * 1.05, 10, 0.45], [3600, 8, 0.25]], d2).bank;
    k.chain(d2, k.hp(280), k.env([[0, 0], [0.9, 0.3], [1.9, 0.6], [4.4, 0.5], [6.0, 0]], T0 + 0.3), bus);
    f2b.forEach((b, i) => { if (i < 3) b.frequency.setTargetAtTime([600, 950, 2500][i] * 1.05, T0 + 3.6, 0.6); });
    // breath blast through bared teeth + sub + chest thump
    const bf = k.flutter(k.chain(k.noise(T0, 6.2), k.bp(1300, 0.5)), 13, 0.6, 1);
    k.chain(bf, k.env([[0, 0], [0.45, 0.45], [1.2, 0.6], [4.6, 0.42], [6.1, 0]], T0), bus);
    k.chain(k.noise(T0, 6.2), k.bp(2600, 2.2), k.env([[0, 0], [0.5, 0.22], [4.6, 0.18], [6.1, 0]], T0), bus);
    k.chain(k.osc('sine', 31, T0, T), k.env([[0, 0], [0.8, 0.75], [4.6, 0.6], [6.2, 0]], T0), bus);
    k.thump(T0 + 0.04, { f0: 95, f1: 34, drop: 0.45, d: 1.3, amp: 0.8, drive: 2.2, dest: bus });
  } },

  // jaws closing on a person: their scream is bitten off, teeth slam, bones crunch, wet tearing, a gulp
  giant_bite: { dur: 2.8, ch: 1, variants: 3, build(k, v) {
    const O = k.out, tb = 0.36 + v * 0.05, g = ['f', 'm', 'c'][v];
    k.human(0, tb + 0.1, { f0: g === 'm' ? 330 : g === 'f' ? 560 : 720, contour: [[0, 0.85], [0.2, 1.12], [1, 1.2]], vowels: [[0, 'a']], gender: g, rough: 0.25, breath: 0.15, wave: 'pressed', vib: 7, vibDepth: 0.03, amp: 0.6, attack: 0.04, cutAt: tb + 0.01, drive: 2, dest: O });
    // teeth slam: two rows of flat teeth, hard and woody at giant scale
    k.thump(tb, { f0: 170, f1: 55, drop: 0.06, a: 0.001, d: 0.3, amp: 1, drive: 3, dest: O });
    k.hit(tb, { f: 720, Q: 2.5, d: 0.07, amp: 1.1, color: 'pink' });
    k.hit(tb + 0.003, { f: 2600, Q: 3, d: 0.03, amp: 0.8 });
    k.ring(tb, [[410, 0.6], [930, 0.35], [1560, 0.2]], { d: 0.08, amp: 0.35 });
    // bone crunch in three chews
    for (let c = 0; c < 3; c++) {
      const tc = tb + 0.02 + c * (0.34 + k.rand(-0.03, 0.04));
      k.crackle(tc, 0.2, c ? 16 : 30, { fLo: 900, fHi: 5000, amp: c ? 0.6 : 0.95, dLo: 0.003, dHi: 0.016 });
      k.thump(tc + 0.01, { f0: 120, f1: 50, drop: 0.05, d: 0.18, amp: c ? 0.5 : 0.3, drive: 2, dest: O });
    }
    // wet tearing squelch + bubbles
    const sq = k.flutter(k.chain(k.noise(tb, 1.5, 'pink'), k.bp(520, 2.5)), 28, 0.9, 1.7);
    k.chain(sq, k.env([[0, 0], [0.03, 1], [0.35, 0.55], [0.9, 0.35], [1.5, 0]], tb), O);
    for (let i = 0; i < 18; i++) k.bubble(tb + k.rand(0.02, 1.35), k.rand(170, 520), k.rand(0.15, 0.4));
    k.chain(k.noise(tb + 0.05, 0.8, 'pink'), k.sweep(k.bp(300, 1.5), [[0, 250], [0.6, 700]], tb + 0.05), k.env([[0, 0], [0.05, 0.5], [0.7, 0]], tb + 0.05), O);
    // gulp
    const gt = tb + 1.55, gl = k.osc('sine', 150, gt, gt + 0.4);
    gl.frequency.setValueAtTime(150, gt); gl.frequency.exponentialRampToValueAtTime(68, gt + 0.26);
    k.chain(gl, k.perc(gt, 0.02, 0.24, 0.65), O);
    k.chain(k.noise(gt, 0.3, 'pink'), k.bp(260, 3), k.perc(gt, 0.02, 0.2, 0.5), O);
  } },

  // colossal footfall: felt sub, a 20-ton heel, the street splitting, rubble raining back down
  giant_step: { dur: 4.8, ch: 1, variants: 3, build(k, v) {
    const O = k.out, t = 0.005;
    k.thump(t, { f0: 52 + v * 4, f1: 18, drop: 0.6, a: 0.012, d: 2.6, amp: 1, drive: 2.6, dest: k.via(k.lp(170), O) });
    k.thump(t, { f0: 108, f1: 44, drop: 0.18, a: 0.004, d: 0.8, amp: 0.7, drive: 2.2, dest: O });
    k.chain(k.noise(t, 1.6, 'brown'), k.lp(380), k.perc(t, 0.008, 1.0, 1.3), O);
    // ground crack: a tearing burst sweeping down
    k.chain(k.noise(t, 0.4), k.hp(1100), k.perc(t, 0.001, 0.08, 0.55), O);
    k.chain(k.noise(t, 0.6), k.sweep(k.bp(2600, 1.1), [[0, 2800], [0.4, 480]], t), k.perc(t, 0.002, 0.3, 0.55), O);
    k.crackle(t + 0.004, 0.4, 42, { fLo: 600, fHi: 3800, amp: 0.5, dLo: 0.006, dHi: 0.04 });
    // rubble thrown up, landing 0.3–2.2 s later
    for (let i = 0; i < 44; i++) {
      const tt = t + 0.28 + Math.pow(k.r(), 1.4) * 1.9, big = k.r() < 0.3;
      k.hit(tt, { f: big ? k.rand(160, 620) : k.rand(900, 3800), Q: k.rand(0.8, 2.5), d: big ? k.rand(0.08, 0.25) : k.rand(0.01, 0.05), amp: k.rand(0.15, 0.5) * (1 - (tt - t) / 2.6), color: big ? 'pink' : 'white' });
    }
    k.chain(k.noise(0, 4.8, 'brown'), k.lp(70), k.env([[0, 0], [0.08, 1], [1.5, 0.6], [4.7, 0]]), O);
    k.chain(k.noise(0.1, 3, 'pink'), k.hp(2500), k.env([[0, 0], [0.4, 0.07], [2.9, 0]], 0.1), O); // dust hiss
  } },

  // a colossal hand closing on something: air whump, skin slap, fingers squeezing
  giant_grab: { dur: 1.8, ch: 1, variants: 2, build(k, v) {
    const O = k.out;
    k.chain(k.noise(0, 0.5, 'pink'), k.sweep(k.bp(300, 1), [[0, 180], [0.3, 700], [0.45, 250]]), k.env([[0, 0], [0.3, 0.9], [0.45, 0]]), O);
    const ts = 0.34 + v * 0.03;
    k.thump(ts, { f0: 110, f1: 42, drop: 0.08, d: 0.35, amp: 1, drive: 2.5, dest: O });
    k.hit(ts, { f: 900, Q: 1.2, d: 0.05, amp: 1, color: 'pink' }); k.hit(ts + 0.002, { f: 2400, Q: 1.5, d: 0.02, amp: 0.5 });
    const sq = k.flutter(k.chain(k.noise(ts, 1.2, 'pink'), k.bp(360, 3)), 20, 0.85, 1.4);
    k.chain(sq, k.env([[0, 0], [0.05, 0.7], [1.1, 0]], ts), O);
    for (let i = 0; i < 8; i++) k.bubble(ts + k.rand(0.05, 1.1), k.rand(200, 500), 0.15);
    k.crackle(ts + 0.1, 0.9, 12, { fLo: 800, fHi: 2400, amp: 0.25, dLo: 0.01, dHi: 0.03 }); // creaking knuckles
  } },

  // a hand crushing the wall top: stone grinding, fracture cracks, a debris cascade down 50 m
  wall_crush: { dur: 6.5, ch: 1, variants: 2, build(k, v) {
    const O = k.out;
    k.thump(0, { f0: 90, f1: 40, drop: 0.1, d: 0.5, amp: 0.8, drive: 2, dest: O });
    k.hit(0, { f: 420, Q: 1, d: 0.1, amp: 0.8, color: 'pink' });
    k.grind(0.08, 2.7, { f: 170 + v * 45, amp: 1.2, rate: 15 });
    for (let i = 0; i < 7; i++) {
      const tc = i === 0 ? 0.05 : k.rand(0.2, 2.3);
      k.chain(k.noise(tc, 0.3), k.hp(k.rand(500, 1200)), k.perc(tc, 0.0008, k.rand(0.04, 0.12), k.rand(0.6, 1)), O);
      k.thump(tc, { f0: k.rand(90, 140), f1: 45, drop: 0.08, d: 0.35, amp: k.rand(0.4, 0.8), drive: 2, dest: O });
      k.crackle(tc, 0.12, 8, { fLo: 1500, fHi: 5000, amp: 0.4 });
    }
    for (let i = 0; i < 70; i++) {
      const tr = k.rand(0.2, 2.6), big = k.r() < 0.3;
      k.hit(tr + k.rand(0.05, 0.4), { f: big ? k.rand(300, 900) : k.rand(1200, 4500), Q: k.rand(1, 3), d: big ? 0.08 : 0.025, amp: k.rand(0.1, 0.3) });
      const tg = tr + 3.0 + k.rand(-0.2, 0.3); // lands at the foot of the wall
      k.hit(tg, { f: big ? k.rand(120, 420) : k.rand(700, 3000), Q: k.rand(0.8, 2), d: big ? k.rand(0.15, 0.35) : 0.05, amp: k.rand(0.2, 0.55) * (big ? 1.3 : 0.6), color: big ? 'pink' : 'white' });
      if (big && k.r() < 0.5) k.thump(tg, { f0: k.rand(70, 110), f1: 38, drop: 0.1, d: 0.4, amp: 0.45, dest: O });
    }
    k.chain(k.noise(0.2, 3.2, 'pink'), k.bp(1400, 0.7), k.env([[0, 0], [0.8, 0.35], [2.4, 0.25], [3.2, 0]], 0.2), O); // scree rush
    k.chain(k.noise(0, 6.5, 'brown'), k.lp(85), k.env([[0, 0], [0.3, 0.9], [3.1, 0.8], [3.5, 1], [6.4, 0]]), O);
  } },

  // pressurised steam vent: valve blast, jet roar, turbulence, whistle, boiling-flesh sizzle
  steam_jet: { dur: 3.8, ch: 1, variants: 2, loopDur: 5.5, build(k, v) {
    const O = k.out, D = k.dur, looping = D > 4.5;
    const E = (lv, pts) => (looping ? k.gain(lv) : k.env(pts));
    if (!looping) { k.thump(0, { f0: 75, f1: 32, drop: 0.2, d: 0.6, amp: 0.8, drive: 2, dest: O }); k.chain(k.noise(0, 0.4), k.hp(300), k.perc(0, 0.002, 0.15, 0.8), O); }
    k.chain(k.flutter(k.chain(k.noise(0, D), k.hp(520), k.peak(2800, 0.8, 6)), 18, 0.28, 1), E(0.85, [[0, 0], [0.03, 1], [0.6, 0.85], [2.8, 0.6], [3.75, 0]]), O);
    k.chain(k.flutter(k.chain(k.noise(0, D, 'pink'), k.bp(340, 0.6)), 6, 0.4, 1), E(0.75, [[0, 0], [0.05, 0.9], [2.8, 0.5], [3.75, 0]]), O);
    k.chain(k.noise(0, D), k.hp(7000), E(0.22, [[0, 0], [0.02, 0.35], [3.7, 0]]), O);
    const wh = k.bp(v ? 860 : 1150, 28); k.chain(k.smooth(0.8), k.gain(40), wh.frequency);
    k.chain(k.noise(0, D), wh, E(0.9, [[0, 0], [0.2, 1], [2.8, 0.7], [3.7, 0]]), O);
    k.chain(k.noise(0, D, 'brown'), k.lp(95), E(0.5, [[0, 0], [0.05, 0.6], [3.7, 0]]), O);
    k.crackle(0.05, D - 0.2, looping ? 60 : 40, { fLo: 3000, fHi: 8000, amp: 0.12, pow: 1 });
  } },

  // limb / hair swing: tons of flesh displacing air (approach up-sweep, recede down-sweep)
  whoosh: { dur: 2.2, ch: 1, variants: 3, build(k, v) {
    const O = k.out, pk = [0.6, 0.35, 0.55][v], L = [2.0, 1.3, 1.9][v];
    k.chain(k.noise(0, L, 'brown'), k.sweep(k.bp(100, 1.2), [[0, 70], [pk, 280], [L, 80]]), k.env([[0, 0], [pk, 1], [pk + 0.25, 0.7], [L, 0]]), O);
    k.chain(k.noise(0, L, 'pink'), k.sweep(k.bp(400, 1.1), [[0, 220], [pk, 1300], [L, 300]]), k.env([[0, 0], [pk, 0.8], [pk + 0.2, 0.5], [L, 0]]), O);
    const hair = [0.25, 0.3, 1][v];
    const hs = k.flutter(k.chain(k.noise(0.05, L, 'white'), k.bp(3400, 0.8)), 42, 0.9, 0.7);
    k.chain(hs, k.env([[0, 0], [pk, hair * 0.6], [pk + 0.35, hair * 0.3], [L, 0]], 0.05), O);
    k.chain(k.osc('sine', 28, 0, L), k.env([[0, 0], [pk, 0.45], [L, 0]]), O);
  } },

  // the dead titan crashing face-first into the town
  giant_fall: { dur: 9, ch: 1, variants: 1, build(k) {
    const O = k.out;
    for (const [t, a] of [[0, 0.8], [0.55, 1], [1.1, 0.7]]) {
      k.thump(t, { f0: 60, f1: 20, drop: 0.7, a: 0.01, d: 2.4, amp: a, drive: 3, dest: k.via(k.lp(220), O) });
      k.thump(t, { f0: 120, f1: 45, drop: 0.2, d: 0.6, amp: a * 0.7, drive: 2, dest: O });
      k.chain(k.noise(t, 1.2, 'pink'), k.lp(900), k.perc(t, 0.004, 0.5, a), O);
    }
    for (let i = 0; i < 110; i++) { const t = 0.1 + Math.pow(k.r(), 1.6) * 5, big = k.r() < 0.35; k.hit(t, { f: big ? k.rand(120, 600) : k.rand(900, 4500), Q: k.rand(0.8, 3), d: big ? k.rand(0.1, 0.35) : k.rand(0.02, 0.1), amp: k.rand(0.2, 0.6) * (1 - t / 6) }); }
    k.crackle(0.05, 1.8, 40, { fLo: 600, fHi: 2200, amp: 0.4, dLo: 0.01, dHi: 0.04 }); // timber
    k.chain(k.noise(0, 9, 'brown'), k.lp(80), k.env([[0, 0], [0.2, 1], [4, 0.7], [8.9, 0]]), O);
    k.chain(k.noise(0.5, 8, 'white'), k.hp(1800), k.env([[0, 0], [1.5, 0.12], [5, 0.08], [8.4, 0]], 0.5), O); // evaporating steam
  } },
};
