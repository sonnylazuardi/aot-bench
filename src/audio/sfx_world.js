// World: the wall, the burning town, its people, the storm.
const SCREAMS = [ // gender, f0, length, contour, vowels, rough
  ['f', 600, 1.6, [[0, 0.8], [0.12, 1.12], [0.7, 1.05], [1, 0.8]], [[0, 'a'], [0.75, 'ae']], 0.14],
  ['m', 300, 1.4, [[0, 0.75], [0.15, 1.1], [0.6, 1.04], [1, 0.72]], [[0, 'a'], [0.7, 'o']], 0.35],
  ['f', 520, 1.2, [[0, 0.9], [0.2, 1.08], [0.5, 1.12], [1, 0.75]], [[0, 'o'], [0.5, 'u']], 0.1],   // "noooo"
  ['c', 760, 1.3, [[0, 0.85], [0.1, 1.1], [0.8, 1.05], [1, 0.85]], [[0, 'ae']], 0.08],
  ['m', 260, 0.9, [[0, 0.9], [0.2, 1.15], [1, 0.8]], [[0, 'e'], [0.6, 'er']], 0.3],              // "heeelp"
  ['f', 640, 1.8, [[0, 0.8], [0.08, 1.15], [0.3, 1.0], [0.36, 0.9], [0.45, 1.12], [1, 0.72]], [[0, 'a'], [0.4, 'a'], [0.8, 'ae']], 0.18],
];

export const WORLD = {
  // the 50 m wall giving way: fracture volley, colossal boom, grinding mass, blocks falling 50 m, a long rumble
  wall_break: { dur: 12, ch: 1, variants: 1, build(k) {
    const O = k.out;
    for (let i = 0; i < 6; i++) { const t = i * k.rand(0.02, 0.07); k.chain(k.noise(t, 0.5), k.hp(k.rand(500, 900)), k.perc(t, 0.001, k.rand(0.12, 0.3), 1 - i * 0.1), O); }
    k.crackle(0, 0.5, 60, { fLo: 1200, fHi: 6000, amp: 0.55 });
    k.thump(0.02, { f0: 58, f1: 20, drop: 1.4, a: 0.012, d: 4, amp: 1.0, drive: 3, dest: k.via(k.lp(300), O) });
    k.thump(0.02, { f0: 120, f1: 45, drop: 0.5, a: 0.006, d: 1.3, amp: 0.65, drive: 2, dest: O });
    k.chain(k.noise(0, 4, 'brown'), k.lp(420), k.perc(0.01, 0.01, 2.8, 1.3), O);
    k.chain(k.flutter(k.chain(k.noise(0, 9, 'pink'), k.bp(520, 0.6), k.env([[0, 0.1], [0.4, 0.9], [2.5, 0.6], [7.5, 0]])), 9, 0.6), O); // crumbling mass
    k.grind(0.3, 6, { f: 150, amp: 1.1, rate: 11 });
    k.chain(k.noise(0, 12, 'brown'), k.lp(80), k.env([[0, 0], [0.2, 1.1], [5, 0.9], [11.9, 0]]), O);
    for (let i = 0; i < 130; i++) {
      const t = 0.12 + Math.pow(k.r(), 1.6) * 8.5, big = k.r() < 0.35;
      k.hit(t, { f: big ? k.rand(110, 500) : k.rand(600, 3800), Q: k.rand(0.8, 3), d: big ? k.rand(0.12, 0.4) : k.rand(0.02, 0.12), amp: k.rand(0.2, 0.7) * (1 - t / 10.5) * (big ? 1.2 : 0.6), color: big ? 'pink' : 'white' });
      if (big && k.r() < 0.45) k.thump(t, { f0: k.rand(80, 140), f1: 42, drop: 0.08, d: 0.3, amp: 0.4 * (1 - t / 10), dest: O });
    }
    // the first slabs reach the ground (~3.2 s for 50 m): a second, heavier wave
    for (let i = 0; i < 5; i++) { const t = 3.0 + i * k.rand(0.12, 0.3); k.thump(t, { f0: k.rand(60, 85), f1: 25, drop: 0.4, d: 1.4, amp: 0.75 - i * 0.08, drive: 2.5, dest: k.via(k.lp(250), O) }); k.chain(k.noise(t, 0.8, 'pink'), k.lp(1200), k.perc(t, 0.003, 0.4, 0.6), O); }
    k.chain(k.noise(1, 9, 'white'), k.hp(2600), k.env([[0, 0], [2.5, 0.08], [8, 0]], 1), O); // dust hiss
  } },

  boom: { dur: 4.5, ch: 1, variants: 2, build(k, v) {
    const O = k.out;
    k.chain(k.noise(0, 0.3), k.hp(900), k.perc(0, 0.001, 0.08, 0.9), O);
    k.thump(0.005, { f0: 90 - v * 12, f1: 24, drop: 0.7, a: 0.004, d: 2.2, amp: 1, drive: 3, dest: O });
    k.chain(k.noise(0, 3.5, 'brown'), k.lp(700), k.perc(0.003, 0.006, 1.8, 1.4), O);
    k.chain(k.noise(0, 4.5, 'brown'), k.lp(90), k.env([[0, 0], [0.1, 0.9], [1.2, 0.6], [4.4, 0]]), O);
    k.crackle(0.08, 2.2, 30, { fLo: 900, fHi: 5000, amp: 0.3, pow: 2, dLo: 0.01, dHi: 0.05 });
  } },

  // garrison cannon on the wall: sharp report + thump, the ball's whistle
  cannon: { dur: 3.5, ch: 1, variants: 2, build(k, v) {
    const O = k.out;
    k.chain(k.noise(0, 0.2), k.hp(600), k.perc(0, 0.0005, 0.05, 1), O);
    k.thump(0, { f0: 140, f1: 38, drop: 0.12, a: 0.001, d: 0.9, amp: 1, drive: 4, dest: O });
    k.chain(k.noise(0, 2, 'brown'), k.lp(500), k.perc(0, 0.003, 1.2, 1.2), O);
    k.chain(k.noise(0.03, 1.2, 'pink'), k.sweep(k.bp(1800, 6), [[0, 1900 - v * 300], [1.1, 900]], 0.03), k.env([[0, 0], [0.1, 0.12], [1.1, 0]], 0.03), O);
  } },

  // a house collapsing: timber cracks and groans, tiles sliding and shattering, the mass landing
  rubble: { dur: 4.8, ch: 1, variants: 2, build(k, v) {
    const O = k.out;
    k.grind(0, 0.6, { f: 260 + v * 60, amp: 0.5, rate: 22 }); // beams groan under load
    for (let i = 0; i < 8; i++) { const t = k.rand(0, 0.55); k.hit(t, { f: k.rand(900, 2600), Q: k.rand(3, 7), d: k.rand(0.02, 0.05), amp: k.rand(0.5, 1) }); k.ring(t, [[k.rand(500, 900), 0.4], [k.rand(1200, 1700), 0.25]], { d: 0.05, amp: 0.3 }); }
    const tl = 0.45 + v * 0.1;
    k.thump(tl, { f0: 95, f1: 38, drop: 0.2, d: 1, amp: 0.95, drive: 2.2, dest: O });
    k.chain(k.noise(tl, 2.5, 'pink'), k.bp(480, 0.6), k.perc(tl, 0.03, 1.4, 1.1), O);
    for (let i = 0; i < 80; i++) { // tiles slide (bright, dense) then shatter; timbers & stones thud
      const t = tl + Math.pow(k.r(), 1.5) * 3.4, tile = k.r() < 0.5;
      k.hit(t, { f: tile ? k.rand(2600, 6500) : k.rand(220, 1500), Q: tile ? k.rand(4, 9) : 1.5, d: tile ? k.rand(0.01, 0.04) : k.rand(0.05, 0.2), amp: k.rand(0.15, 0.55) * (1 - (t - tl) / 4.2) });
    }
    k.crackle(tl + 0.1, 1.4, 50, { fLo: 3000, fHi: 7000, amp: 0.3, Qlo: 5, Qhi: 10 }); // tile slide
    k.chain(k.noise(tl, 3.9, 'brown'), k.lp(160), k.env([[0, 0], [0.2, 1], [1.5, 0.6], [3.8, 0]], tl), O);
  } },

  fire: { dur: 8, ch: 1, variants: 1, loop: 1.0, build(k) {
    const O = k.out;
    k.chain(k.flutter(k.chain(k.noise(0, 8, 'brown'), k.lp(420)), 2.2, 0.55, 1.1), O);
    k.chain(k.flutter(k.chain(k.noise(0, 8, 'pink'), k.bp(900, 0.7)), 4, 0.6, 0.25), O);
    k.chain(k.noise(0, 8), k.hp(4500), k.gain(0.05), O);
    for (let i = 0; i < 260; i++) k.hit(k.rand(0, 7.95), { f: k.rand(1800, 7000), Q: k.rand(1, 3), a: 0.0005, d: k.rand(0.002, 0.012), amp: k.rand(0.1, 0.9) * (k.r() < 0.9 ? 0.5 : 1) });
    for (let i = 0; i < 16; i++) k.hit(k.rand(0, 7.9), { f: k.rand(500, 1400), Q: 1.5, d: k.rand(0.02, 0.05), amp: k.rand(0.4, 0.9) }); // pops
    for (let i = 0; i < 3; i++) { const t = k.rand(0.5, 7); k.hit(t, { f: 1600, Q: 4, d: 0.04, amp: 1 }); k.crackle(t, 0.3, 10, { fLo: 900, fHi: 3000, amp: 0.5 }); } // timber snap
  } },

  // church alarm bell (v0 = D, v1 = A a fourth below): hum / prime / minor-third tierce / quint / nominal ...
  bell: { dur: 7.5, ch: 1, variants: 2, build(k, v) {
    const N = v ? 220 : 293.66, O = k.out;
    const P = [[0.25, 0.55, 2.4], [0.5, 0.6, 1.6], [0.6, 0.5, 1.2], [0.75, 0.22, 0.8], [1, 0.85, 1], [1.5, 0.28, 0.45], [2, 0.3, 0.4], [2.5, 0.2, 0.3], [2.66, 0.14, 0.25], [3.01, 0.1, 0.18], [4.2, 0.07, 0.12]];
    k.ring(0.004, P.map(([r, l, d]) => [N * r, l, d]), { d: 6, amp: 0.55, detune: 0.35, dest: O });
    k.hit(0, { f: 2600, Q: 1.2, d: 0.04, amp: 0.9 }); k.hit(0, { f: 700, Q: 1, d: 0.03, amp: 0.6, color: 'pink' });
    k.thump(0, { f0: 180, f1: 120, drop: 0.02, d: 0.05, amp: 0.4, dest: O }); // clapper
  } },

  // human screams: glottal source through a 4-formant tract, pitch contours, fry, breath
  scream: { dur: 2.2, ch: 1, variants: 6, build(k, v) {
    const [g, f, L, contour, vowels, rough] = SCREAMS[v];
    const f0 = f * k.rand(0.94, 1.06);
    k.human(0.02, L, { f0, contour, vowels, gender: g, rough, breath: 0.22, breathLead: 0.03, wave: 'pressed', vib: k.rand(5.5, 7), vibDepth: 0.025, jitter: 0.025, amp: 1, attack: 0.06, release: L * 0.3, drive: 2.2 });
    k.chain(k.noise(L * 0.9, 0.5), k.bp(1500 * (g === 'm' ? 1 : 1.2), 1.2), k.env([[0, 0], [0.08, 0.12], [0.45, 0]], L * 0.9), k.out); // gasping breath after
  } },

  // a panicking crowd a street away: talkers (voiced syllables with formant jumps), shouts, screams, running feet
  crowd: { dur: 12, ch: 2, variants: 1, loop: 1.2, build(k) {
    const bus = k.gain(0.9); k.chain(bus, k.lp(3400), k.hp(170), k.out);
    for (let i = 0; i < 14; i++) { // babble: continuous shouted talk
      const g = k.pick(['m', 'm', 'f', 'f', 'c']), f0 = g === 'm' ? k.rand(120, 190) : g === 'f' ? k.rand(220, 320) : k.rand(300, 380);
      let t = k.rand(0, 1.5);
      const p = k.pan(k.rand(-0.95, 0.95)); p.connect(bus);
      while (t < 11.6) {
        const L = k.rand(0.6, 1.8), vs = []; for (let x = 0; x < 1; x += k.rand(0.12, 0.22)) vs.push([x, k.pick(['a', 'e', 'o', 'ae', 'er', 'i', 'u'])]);
        k.human(t, Math.min(L, 11.9 - t), { f0, contour: [[0, 1.05], [0.5, 1.15], [1, 0.9]], vowels: vs, gender: g, rough: 0.12, breath: 0.25, vib: 0, jitter: 0.05, wave: 'glottal', amp: k.rand(0.18, 0.4), attack: 0.03, release: 0.12, drive: 1.3, dest: p });
        t += L + k.rand(0.15, 1.4);
      }
    }
    for (let i = 0; i < 16; i++) { // screams & shouts
      const [g, f, L, contour, vowels, rough] = k.pick([
        ['f', 600, 1.2, [[0, 0.8], [0.12, 1.12], [1, 0.8]], [[0, 'a']], 0.12], ['m', 300, 0.9, [[0, 0.8], [0.2, 1.1], [1, 0.75]], [[0, 'a'], [0.6, 'o']], 0.3],
        ['f', 520, 0.9, [[0, 0.9], [0.3, 1.1], [1, 0.8]], [[0, 'o'], [0.5, 'u']], 0.1], ['c', 740, 1.0, [[0, 0.85], [0.1, 1.1], [1, 0.85]], [[0, 'ae']], 0.08],
      ]);
      const t = k.rand(0, 11.9 - L), p = k.pan(k.rand(-1, 1)); p.connect(bus);
      k.human(t, L * k.rand(0.7, 1.1), { f0: f * k.rand(0.9, 1.1), contour, vowels, gender: g, rough, breath: 0.2, wave: 'pressed', vib: 6, vibDepth: 0.025, amp: k.rand(0.3, 0.6), release: 0.3, drive: 2, dest: p });
    }
    for (let i = 0; i < 90; i++) k.hit(k.rand(0, 11.95), { f: k.rand(500, 1400), Q: 1.4, d: k.rand(0.015, 0.04), amp: k.rand(0.05, 0.14), color: 'pink', pan: k.rand(-0.9, 0.9), dest: bus }); // running feet
  } },

  thunder: { dur: 8, ch: 1, variants: 2, build(k, v) {
    const O = k.out;
    if (v === 0) { // close: a tearing crack
      for (let i = 0; i < 6; i++) { const t = i * k.rand(0.015, 0.05); k.chain(k.noise(t, 0.4), k.hp(k.rand(400, 800)), k.perc(t, 0.0008, k.rand(0.08, 0.25), 1 - i * 0.12), O); }
      k.crackle(0, 0.35, 50, { fLo: 1500, fHi: 7000, amp: 0.5 });
      k.thump(0.03, { f0: 70, f1: 26, drop: 0.8, d: 2.8, amp: 0.85, drive: 2.5, dest: O });
    }
    const roll = k.flutter(k.chain(k.noise(0, 8, 'brown'), k.lp(v ? 220 : 320)), 1.6, 0.85, 1.6);
    k.chain(roll, k.env(v ? [[0, 0], [0.8, 0.8], [2.5, 1], [4.5, 0.6], [7.9, 0]] : [[0, 0], [0.2, 1], [3, 0.8], [7.9, 0]]), O);
    for (let i = 0; i < 4; i++) { const t = k.rand(0.6, 4.5); k.thump(t, { f0: k.rand(45, 70), f1: 25, drop: 0.5, d: 1.4, amp: k.rand(0.3, 0.55), dest: k.via(k.lp(200), O) }); }
  } },

  // lightning strikes and a titan forms: charge sizzle, crack, a colossal boom, shockwave, steam roar
  transform: { dur: 12, ch: 1, variants: 1, build(k) {
    const O = k.out;
    k.chain(k.noise(0, 0.35, 'white', 2), k.bp(4000, 1.5), k.env([[0, 0], [0.3, 0.35], [0.36, 0]]), O); // pre-charge
    k.crackle(0, 0.35, 40, { fLo: 3000, fHi: 9000, amp: 0.35, pow: 0.5, pan: 0.6 });
    const T = 0.36;
    for (let i = 0; i < 5; i++) { const t = T + i * 0.035; k.chain(k.noise(t, 0.3, 'white', 2), k.hp(1500), k.perc(t, 0.0005, 0.1, 1 - i * 0.12), O); }
    const buzz = k.chain(k.noise(T, 0.8, 'white', 2), k.bp(5200, 2)); const am = k.gain(0.3); k.chain(k.osc('square', 118, T, T + 0.8), k.gain(0.7), am.gain);
    k.chain(buzz, am, k.env([[0, 0.9], [0.6, 0]], T), O);
    k.thump(T + 0.05, { f0: 52, f1: 17, drop: 2.2, a: 0.02, d: 5.5, amp: 1, drive: 4, dest: k.via(k.lp(260), O) });
    k.thump(T + 0.05, { f0: 110, f1: 35, drop: 0.8, a: 0.008, d: 2.2, amp: 0.7, drive: 3, dest: O });
    k.chain(k.noise(T, 5, 'brown', 2), k.lp(300), k.perc(T + 0.05, 0.02, 4, 1.5), O);
    k.chain(k.noise(T + 0.1, 1.8, 'pink', 2), k.sweep(k.bp(2400, 0.8), [[0, 2400], [1.5, 160]], T + 0.1), k.env([[0, 0], [0.15, 0.9], [1.7, 0]], T + 0.1), O);
    k.chain(k.flutter(k.chain(k.noise(T + 1, 10.5, 'brown', 2), k.lp(240)), 1.3, 0.75, 1.5), k.env([[0, 0], [1.2, 1], [5, 0.7], [10.5, 0]], T + 1), O);
    k.chain(k.noise(T + 1.5, 9, 'white', 2), k.hp(700), k.lp(5000), k.env([[0, 0], [2.5, 0.25], [6, 0.18], [9.4, 0]], T + 1.5), O);
  } },

  // ---- ambient pure titans (3–15 m)
  titan_step: { dur: 2.6, ch: 1, variants: 3, build(k, v) {
    const O = k.out, t = 0.005;
    k.thump(t, { f0: 78 + v * 6, f1: 30, drop: 0.3, a: 0.006, d: 1.1, amp: 1.0, drive: 2.2, dest: k.via(k.lp(220), O) });
    k.thump(t, { f0: 150, f1: 62, drop: 0.12, a: 0.003, d: 0.28, amp: 0.55, dest: O });
    k.chain(k.noise(t, 1.2, 'brown'), k.lp(260, 0.9), k.perc(t, 0.005, 0.5, 1.2), O);
    k.crackle(t + 0.01, 0.32, 16, { fLo: 700, fHi: 3200, amp: 0.4, dLo: 0.01, dHi: 0.05, pow: 1.8 });
    k.chain(k.noise(t, 0.4, 'pink'), k.bp(900, 0.7), k.perc(t, 0.003, 0.14, 0.5), O);
    k.chain(k.noise(0, 2.6, 'brown'), k.lp(95, 0.8), k.env([[0, 0], [0.05, 0.7], [0.6, 0.45], [2.5, 0]]), O);
    for (let i = 0; i < 7; i++) k.hit(k.rand(0.25, 1.4), { f: k.rand(2000, 5000), Q: 3, d: 0.02, amp: k.rand(0.03, 0.09) });
  } },
  titan_roar: { dur: 4.2, ch: 1, variants: 2, build(k, v) {
    const f0 = v ? 62 : 78, bus = k.gain(1); k.chain(bus, k.filter('lowshelf', 180, 0.7, 6), k.lp(3800), k.out);
    k.human(0.02, 3.9, { f0, contour: [[0, 0.8], [0.15, 1.25], [0.45, 1.15], [0.75, 1.05], [1, 0.62]], vowels: [[0, 'u'], [0.08, 'a'], [0.55, 'o'], [0.85, 'u']], scale: 0.72, breath: 0.45, rough: 0.6, jitter: 0.05, sub: 0.7, wave: 'pressed', vib: 4.5, vibDepth: 0.025, amp: 1, attack: 0.3, release: 1.2, drive: 3.5, dest: bus });
    k.chain(k.osc('sine', f0 * 0.5, 0, 4), k.env([[0, 0], [0.5, 0.4], [2.8, 0.3], [3.9, 0]]), bus);
  } },
  titan_groan: { dur: 3.4, ch: 1, variants: 2, build(k, v) {
    const f0 = v ? 48 : 58, bus = k.gain(1); k.chain(bus, k.filter('lowshelf', 150, 0.7, 6), k.lp(2400), k.out);
    k.human(0.02, 3.3, { f0, contour: [[0, 1], [0.27, 1.15], [0.5, 0.92], [0.77, 1.05], [1, 0.7]], vowels: [[0, 'u'], [0.3, 'o'], [0.7, 'u']], scale: 0.7, breath: 0.6, rough: 0.4, jitter: 0.03, sub: 0.5, wave: 'glottal', vib: 1.6, vibDepth: 0.04, amp: 1, attack: 0.6, release: 0.9, drive: 1.8, dest: bus });
  } },
  // steam off a dying titan's body (hot flesh evaporating)
  steam: { dur: 3.2, ch: 1, variants: 1, loopDur: 4.5, build(k) {
    const looping = k.dur > 4;
    k.chain(k.flutter(k.chain(k.noise(0, k.dur), k.hp(1400), k.peak(3600, 0.8, 5)), 3, 0.35), looping ? k.gain(0.8) : k.env([[0, 0], [0.25, 1], [1.2, 0.7], [3.15, 0]]), k.out);
    k.chain(k.noise(0, k.dur, 'pink'), k.bp(700, 0.6), looping ? k.gain(0.25) : k.env([[0, 0], [0.3, 0.35], [3.1, 0]]), k.out);
    k.crackle(0.05, k.dur - 0.2, 40, { fLo: 3000, fHi: 8000, amp: 0.12, pow: 1 });
  } },

  // ---- ambience beds
  // before the breach: a living town (murmur, distant hooves & carts, birds, a dog)
  town_calm: { dur: 14, ch: 2, variants: 1, loop: 1.5, build(k) {
    const bus = k.gain(1); k.chain(bus, k.lp(5000), k.out);
    k.chain(k.flutter(k.chain(k.noise(0, 14, 'pink', 2), k.bp(420, 0.5)), 0.6, 0.5, 0.35), bus); // air + far murmur
    for (let i = 0; i < 8; i++) {
      const g = k.pick(['m', 'f']), f0 = g === 'm' ? k.rand(110, 150) : k.rand(190, 240), p = k.pan(k.rand(-0.8, 0.8)); p.connect(bus);
      let t = k.rand(0, 3); while (t < 13) { const L = k.rand(0.5, 1.4), vs = []; for (let x = 0; x < 1; x += k.rand(0.15, 0.3)) vs.push([x, k.pick(['a', 'e', 'o', 'er', 'i'])]); k.human(t, Math.min(L, 13.8 - t), { f0, contour: [[0, 1], [0.5, 1.08], [1, 0.92]], vowels: vs, gender: g, rough: 0.05, breath: 0.2, vib: 0, wave: 'soft', amp: 0.08, attack: 0.05, release: 0.15, drive: 1, dest: p }); t += L + k.rand(0.5, 3); }
    }
    for (let i = 0; i < 26; i++) { // birds: FM chirps
      const t = k.rand(0, 13.6), f = k.rand(2600, 4800), n = 1 + Math.floor(k.r() * 4), p = k.pan(k.rand(-1, 1)); p.connect(bus);
      for (let j = 0; j < n; j++) { const tt = t + j * k.rand(0.08, 0.14), o = k.osc('sine', f, tt, tt + 0.1); k.sweep(o, [[0, f], [0.05, f * k.rand(1.2, 1.5)], [0.09, f * 0.9]], tt); k.chain(o, k.perc(tt, 0.005, 0.07, k.rand(0.03, 0.07)), p); }
    }
    for (let i = 0; i < 2; i++) { let t = k.rand(0, 6); const p = k.pan(k.rand(-0.7, 0.7)); p.connect(bus); for (let j = 0; j < 12 && t < 13.8; j++, t += k.rand(0.22, 0.32)) k.hit(t, { f: k.rand(900, 1500), Q: 4, d: 0.03, amp: 0.1, dest: p }); } // hooves on cobbles
  } },
  // after the breach: the whole town burning and collapsing somewhere out there (distant, low, swelling)
  war_bed: { dur: 12, ch: 2, variants: 1, loop: 1.5, build(k) {
    const O = k.out;
    k.chain(k.flutter(k.chain(k.noise(0, 12, 'brown', 2), k.lp(140)), 0.5, 0.8, 1), O);
    k.chain(k.flutter(k.chain(k.noise(0, 12, 'pink', 2), k.bp(600, 0.5)), 1.2, 0.6, 0.18), O);
    for (let i = 0; i < 7; i++) { const t = k.rand(0, 11), p = k.pan(k.rand(-1, 1)); p.connect(O); k.thump(t, { f0: k.rand(50, 80), f1: 28, drop: 0.5, d: 1.5, amp: k.rand(0.15, 0.35), dest: k.via(k.lp(180), p) }); k.crackle(t + 0.1, 1.5, 12, { fLo: 400, fHi: 1500, amp: 0.05, dest: p }); }
  } },
};
