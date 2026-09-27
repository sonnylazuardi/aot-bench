// Player (ODM gear, blades, body), UI, and the score's percussion.
export const PLAYER = {
  // anchor launcher: mechanism clack, pneumatic crack, gas vent, steel cable zinging off the spool
  hook_fire: { dur: 1.0, ch: 2, variants: 3, build(k, v) {
    const O = k.out;
    k.hit(0, { f: 2400 + v * 200, Q: 5, d: 0.015, amp: 0.8 });
    k.thump(0, { f0: 200, f1: 70, drop: 0.05, d: 0.08, amp: 0.75, dest: O });
    k.chain(k.noise(0, 0.12), k.hp(1800), k.perc(0, 0.0008, 0.035, 1), O);
    k.chain(k.noise(0, 0.3, 'white', 2), k.bp(3200, 0.9), k.perc(0.002, 0.004, 0.12, 0.6), O);
    k.ring(0.01, [[2600, 0.6, 1], [3870, 0.45, 0.8], [5230, 0.35, 0.6], [7100, 0.2, 0.5]], { d: 0.55, amp: 0.33, sweep: 0.52, detune: 4, dest: k.via(k.pan(0.15), O) });
    const whirr = k.sweep(k.bp(4200, 5), [[0, 4600], [0.6, 2300]], 0.01);
    const am = k.gain(0.5); k.chain(k.osc('square', 90 + v * 8, 0, 1), k.gain(0.5), am.gain);
    k.chain(k.noise(0.01, 0.8), whirr, am, k.perc(0.01, 0.01, 0.55, 0.5), k.pan(-0.1), O);
    const w = k.osc('sine', 2300, 0.05, 0.6); k.sweep(w, [[0, 2300], [0.5, 1500]], 0.05); k.chain(w, k.env([[0, 0], [0.05, 0.05], [0.5, 0]], 0.05), O); // anchor whistling away
  } },
  // anchor biting: stone (crack + chips), wood (hollow tock + splinters), flesh (wet thud + squelch)
  hook_hit_stone: { dur: 0.8, ch: 1, variants: 2, build(k) {
    const O = k.out;
    k.thump(0, { f0: 240, f1: 110, drop: 0.04, d: 0.08, amp: 0.9, dest: O });
    k.chain(k.noise(0, 0.2), k.hp(1200), k.perc(0, 0.0005, 0.03, 1), O);
    k.hit(0, { f: 1300, Q: 1.4, d: 0.05, amp: 0.9, color: 'pink' });
    k.ring(0.002, [[4700, 0.5], [6300, 0.35], [8200, 0.2]], { d: 0.12, amp: 0.45 });
    k.crackle(0.005, 0.45, 12, { fLo: 1500, fHi: 5500, amp: 0.3, pow: 2 });
    k.chain(k.noise(0.02, 0.6, 'pink'), k.hp(2000), k.env([[0, 0], [0.05, 0.08], [0.55, 0]], 0.02), O); // grit trickle
  } },
  hook_hit_wood: { dur: 0.7, ch: 1, variants: 2, build(k, v) {
    const O = k.out;
    k.thump(0, { f0: 190, f1: 125, drop: 0.03, d: 0.1, amp: 0.9, dest: O });
    k.hit(0, { f: 720 + v * 90, Q: 4, d: 0.07, amp: 1, color: 'pink' });
    k.ring(0.001, [[520 + v * 40, 0.5], [1340, 0.3], [2210, 0.15]], { d: 0.09, amp: 0.45 });
    k.crackle(0.004, 0.25, 14, { fLo: 1400, fHi: 4200, amp: 0.4, dLo: 0.005, dHi: 0.02 });
    k.ring(0.002, [[4700, 0.4], [6300, 0.25]], { d: 0.08, amp: 0.3 });
  } },
  hook_hit_flesh: { dur: 0.9, ch: 1, variants: 2, build(k) {
    const O = k.out;
    k.thump(0, { f0: 120, f1: 55, drop: 0.06, d: 0.2, amp: 1, drive: 2.5, dest: O });
    k.hit(0, { f: 420, Q: 1.2, d: 0.08, amp: 1, color: 'pink' });
    k.hit(0.001, { f: 2600, Q: 2, d: 0.012, amp: 0.4 }); // barbs
    k.chain(k.flutter(k.chain(k.noise(0.01, 0.5, 'pink'), k.bp(620, 2.5)), 30, 0.9, 1.4), k.env([[0, 0], [0.02, 0.8], [0.4, 0]], 0.01), O);
    for (let i = 0; i < 7; i++) k.bubble(k.rand(0.01, 0.35), k.rand(250, 650), k.rand(0.15, 0.35));
  } },
  // winch: motor whine rising with the spool, gear ratchet, cable hiss
  reel: { dur: 1.3, ch: 2, variants: 1, loopDur: 2.4, build(k) {
    const O = k.out, looping = k.dur > 2;
    const o = k.osc('sawtooth', 150, 0, k.dur), o2 = k.osc('square', 301, 0, k.dur);
    if (!looping) { k.sweep(o, [[0, 95], [0.35, 230], [1.2, 215]]); k.sweep(o2, [[0, 191], [0.35, 462], [1.2, 431]]); } else { o.frequency.value = 212; o2.frequency.value = 426; }
    const m = k.gain(1); o.connect(m); k.chain(o2, k.gain(0.25), m);
    k.chain(m, k.bp(1300, 1.4), k.shaper(1.6), looping ? k.gain(0.8) : k.env([[0, 0], [0.05, 0.8], [0.9, 0.7], [1.28, 0]]), O);
    const tg = k.gain(0.4); k.chain(k.osc('square', looping ? 48 : 40, 0, k.dur), k.hp(2500), k.bp(3400, 4), tg);
    k.chain(tg, looping ? k.gain(0.5) : k.env([[0, 0], [0.04, 0.5], [1.0, 0.4], [1.28, 0]]), O);
    k.chain(k.noise(0, k.dur, 'white', 2), k.bp(6000, 1), looping ? k.gain(0.12) : k.env([[0, 0], [0.1, 0.14], [1.28, 0]]), O);
  } },
  gas: { dur: 0.8, ch: 2, variants: 3, build(k) {
    const O = k.out;
    k.chain(k.noise(0, 0.8, 'white', 2), k.hp(1600), k.peak(4800, 1, 6), k.env([[0, 0], [0.006, 1], [0.12, 0.45], [0.75, 0]]), O);
    k.chain(k.noise(0, 0.4, 'pink'), k.lp(600), k.perc(0, 0.008, 0.18, 0.8), O);
    k.chain(k.noise(0, 0.6, 'white', 2), k.bp(1100, 1.2), k.perc(0.01, 0.02, 0.3, 0.45), O);
  } },
  gas_empty: { dur: 1.2, ch: 2, variants: 1, build(k) {
    const O = k.out; let t = 0;
    for (const a of [0.9, 0.6, 0.75, 0.4, 0.3, 0.18]) { const d = k.rand(0.03, 0.09); k.chain(k.noise(t, d * 2, 'white', 2), k.hp(1500), k.perc(t, 0.003, d, a), O); k.hit(t, { f: 2400, Q: 7, d: 0.012, amp: a * 0.6 }); t += k.rand(0.07, 0.19); }
    k.chain(k.noise(t, 0.4), k.bp(2200, 3), k.env([[0, 0], [0.05, 0.12], [0.4, 0]], t), O);
    k.hit(t + 0.1, { f: 1800, Q: 6, d: 0.02, amp: 0.5 }); // dry click of an empty valve
  } },
  // blade: air cut + thin steel shing + edge scrape
  slash: { dur: 0.8, ch: 2, variants: 3, build(k, v) {
    const O = k.out, dir = v === 1 ? -1 : 1;
    const pn = k.pan(-0.6 * dir); pn.pan.setValueAtTime(-0.6 * dir, 0); pn.pan.linearRampToValueAtTime(0.6 * dir, 0.25);
    k.chain(k.noise(0, 0.35, 'pink'), k.sweep(k.bp(600, 1.6), [[0, 500], [0.1, 3600], [0.28, 1400]]), k.env([[0, 0], [0.07, 1], [0.28, 0]]), pn, O);
    k.chain(k.noise(0, 0.3, 'pink'), k.sweep(k.bp(200, 1), [[0, 160], [0.09, 600], [0.25, 200]]), k.env([[0, 0], [0.08, 0.7], [0.25, 0]]), O);
    const base = 2800 + v * 230;
    k.ring(0.055, [[base, 0.8, 1], [base * 1.43, 0.6, 0.8], [base * 1.93, 0.45, 0.6], [base * 2.52, 0.3, 0.45], [base * 3.1, 0.15, 0.3]], { d: 0.5, amp: 0.4, detune: 6, dest: k.via(k.pan(0.3 * dir), O) });
    k.chain(k.noise(0.05, 0.2, 'white', 2), k.hp(4500), k.perc(0.05, 0.003, 0.09, 0.7), O);
  } },
  // the killing cut: meaty impact, tearing flesh, spray, shing, steam bursting from the wound, a heavy sub accent
  nape_kill: { dur: 2.8, ch: 2, variants: 2, build(k, v) {
    const O = k.out;
    k.thump(0, { f0: 62, f1: 26, drop: 0.35, a: 0.004, d: 1.2, amp: 1, drive: 3, dest: k.via(k.lp(200), O) }); // heavy accent
    k.thump(0, { f0: 115, f1: 48, drop: 0.12, d: 0.3, amp: 1, drive: 2.5, dest: O });
    k.chain(k.noise(0, 0.4, 'brown'), k.lp(900), k.perc(0, 0.002, 0.22, 1.2), O);
    k.chain(k.flutter(k.chain(k.noise(0.01, 0.5, 'pink'), k.bp(750, 2.2)), 35, 0.9, 1.6), k.env([[0, 0], [0.02, 1], [0.35, 0]], 0.01), O);
    k.chain(k.noise(0.03, 0.25), k.sweep(k.bp(400, 5), [[0, 380], [0.17, 1500]], 0.03), k.perc(0.03, 0.01, 0.15, 0.8), O);
    k.chain(k.noise(0.02, 0.6, 'white', 2), k.bp(2600, 0.8), k.perc(0.02, 0.01, 0.35, 0.35), O);
    for (let i = 0; i < 10; i++) k.bubble(k.rand(0.02, 0.5), k.rand(250, 700), k.rand(0.1, 0.3));
    k.ring(0.0, [[3100 + v * 150, 0.7], [4430, 0.5], [5980, 0.35], [7700, 0.2]], { d: 0.45, amp: 0.25, detune: 5 });
    k.thump(0.15, { f0: 70, f1: 34, drop: 0.2, d: 0.5, amp: 0.4, dest: O }); // steam valve
    k.chain(k.noise(0.15, 2.6, 'white', 2), k.hp(1800), k.peak(4500, 1, 4), k.env([[0, 0], [0.12, 0.7], [1.2, 0.35], [2.5, 0]], 0.15), O);
    k.chain(k.noise(0.15, 2.4, 'pink', 2), k.bp(500, 0.7), k.env([[0, 0], [0.15, 0.35], [2.3, 0]], 0.15), O);
  } },
  blade_break: { dur: 1.0, ch: 2, variants: 1, build(k) {
    k.chain(k.noise(0, 0.05), k.hp(3000), k.perc(0, 0.0005, 0.02, 1), k.out);
    k.ring(0.001, [[3300, 0.8], [4720, 0.6], [6900, 0.45], [8840, 0.3]], { d: 0.3, amp: 0.55, detune: 9 });
    for (let i = 0; i < 6; i++) { const t = k.rand(0.15, 0.8); k.ring(t, [[k.rand(5000, 8000), 0.5], [k.rand(8000, 10500), 0.3]], { d: 0.06, amp: 0.2 * (1 - t) }); }
  } },
  blade_swap: { dur: 0.75, ch: 2, variants: 1, build(k) {
    const O = k.out;
    k.hit(0, { f: 3000, Q: 8, d: 0.015, amp: 0.8 });
    k.chain(k.noise(0.04, 0.3, 'white', 2), k.sweep(k.bp(1800, 3), [[0, 1500], [0.24, 4200]], 0.04), k.env([[0, 0], [0.03, 0.5], [0.24, 0.3], [0.27, 0]], 0.04), O);
    k.hit(0.3, { f: 1200, Q: 3, d: 0.03, amp: 0.9, color: 'pink' }); k.hit(0.31, { f: 4200, Q: 6, d: 0.02, amp: 0.7 });
    k.ring(0.3, [[2210, 0.5], [3140, 0.4], [4480, 0.25]], { d: 0.2, amp: 0.3 });
  } },
  // caught in a titan's fist
  grab: { dur: 1.0, ch: 2, variants: 1, build(k) {
    const O = k.out;
    k.chain(k.noise(0, 0.25, 'pink', 2), k.sweep(k.bp(1600, 1.2), [[0, 1800], [0.2, 400]]), k.env([[0, 0], [0.08, 0.8], [0.22, 0]]), O);
    k.thump(0.18, { f0: 120, f1: 55, drop: 0.1, d: 0.25, amp: 1, drive: 2, dest: O });
    k.chain(k.flutter(k.chain(k.noise(0.18, 0.7, 'pink'), k.bp(380, 3)), 22, 0.8, 1.5), k.env([[0, 0], [0.03, 1], [0.7, 0]], 0.18), O);
    for (let i = 0; i < 4; i++) k.hit(0.2 + k.rand(0, 0.5), { f: k.rand(1500, 3000), Q: 4, d: 0.03, amp: 0.25 });
  } },
  crunch: { dur: 1.3, ch: 2, variants: 2, build(k) {
    const O = k.out;
    k.crackle(0, 0.4, 12, { fLo: 1200, fHi: 4200, amp: 0.9, dLo: 0.006, dHi: 0.02, pan: 0.3 });
    k.thump(0, { f0: 90, f1: 45, drop: 0.08, d: 0.3, amp: 0.9, drive: 3, dest: O });
    k.chain(k.flutter(k.chain(k.noise(0, 0.8, 'pink'), k.bp(620, 3)), 25, 0.85, 1.6), k.env([[0, 0], [0.02, 1], [0.7, 0]]), O);
    for (let i = 0; i < 6; i++) k.bubble(k.rand(0.02, 0.6), k.rand(300, 800), 0.2);
  } },
  // the soldier taking a hit: body thud, gear rattle, a grunt
  body_hit: { dur: 0.8, ch: 1, variants: 3, build(k, v) {
    const O = k.out;
    k.thump(0, { f0: 105, f1: 45, drop: 0.07, d: 0.22, amp: 1, drive: 2.5, dest: O });
    k.hit(0, { f: 500, Q: 1, d: 0.06, amp: 0.8, color: 'pink' });
    k.crackle(0.005, 0.2, 8, { fLo: 2500, fHi: 6000, amp: 0.25 }); // buckles / gear
    k.human(0.03, 0.26 + v * 0.05, { f0: 118 + v * 14, contour: [[0, 1.25], [0.3, 1.1], [1, 0.8]], vowels: [[0, v === 1 ? 'a' : 'er'], [0.6, 'u']], gender: 'm', rough: 0.5, breath: 0.5, wave: 'pressed', vib: 0, amp: 0.55, attack: 0.012, release: 0.15, drive: 2.5, dest: O });
  } },
  heartbeat: { dur: 0.9, ch: 1, variants: 1, build(k) {
    const O = k.out;
    k.thump(0.0, { f0: 62, f1: 38, drop: 0.08, a: 0.01, d: 0.16, amp: 1, drive: 1.5, dest: O });
    k.chain(k.noise(0, 0.2, 'brown'), k.lp(140), k.perc(0, 0.01, 0.1, 0.6), O);
    k.thump(0.27, { f0: 72, f1: 44, drop: 0.07, a: 0.01, d: 0.13, amp: 0.75, drive: 1.5, dest: O });
  } },
  // raw rushing-air material, shaped live by speed (index.js wind engine)
  wind: { dur: 8, ch: 2, variants: 1, loop: 1.2, build(k) {
    k.chain(k.flutter(k.noise(0, 8, 'pink', 2), 0.9, 0.5), k.out);
    k.chain(k.flutter(k.noise(0, 8, 'white', 2), 2.5, 0.6, 0.35), k.out);
  } },

  ui_tick: { dur: 0.12, ch: 2, variants: 1, build(k) { k.ring(0, [[2400, 0.6], [3600, 0.3]], { d: 0.06, amp: 0.5 }); k.hit(0, { f: 5000, Q: 3, d: 0.01, amp: 0.3 }); } },
  ui_confirm: { dur: 3.5, ch: 2, variants: 1, build(k) {
    const O = k.out;
    k.thump(0, { f0: 70, f1: 32, drop: 0.5, a: 0.01, d: 2.2, amp: 1, drive: 2.5, dest: O });
    k.chain(k.noise(0, 3, 'brown', 2), k.lp(200), k.perc(0, 0.02, 2.0, 1), O);
    k.ring(0, [[146.8, 0.6, 1], [293.7, 0.4, 0.8], [440.4, 0.3, 0.6], [587.3, 0.15, 0.4]], { d: 2.6, amp: 0.35, detune: 0.4 });
    k.chain(k.noise(0, 1.4, 'pink', 2), k.sweep(k.bp(300, 1), [[0, 3000], [1.2, 200]]), k.env([[0, 0.6], [1.3, 0]]), O);
  } },

  // ---- score percussion
  taiko: { dur: 1.6, ch: 1, variants: 3, build(k, v) {
    const f = [52, 64, 58][v];
    k.thump(0, { f0: f * 2.3, f1: f, drop: 0.07, a: 0.002, d: 1.1, amp: 1, drive: 1.8 });
    k.thump(0, { f0: f * 3.6, f1: f * 2.6, drop: 0.05, a: 0.001, d: 0.3, amp: 0.35 });
    k.chain(k.noise(0, 0.2, 'pink'), k.bp(380, 1.1), k.perc(0, 0.001, 0.06, 0.9), k.out);
    k.chain(k.noise(0, 1.5, 'brown'), k.lp(160), k.perc(0, 0.003, 0.7, 0.5), k.out);
  } },
  odaiko: { dur: 3.2, ch: 1, variants: 1, build(k) { // the giant festival drum
    k.thump(0, { f0: 88, f1: 36, drop: 0.12, a: 0.003, d: 2.4, amp: 1, drive: 2 });
    k.chain(k.noise(0, 0.25, 'pink'), k.bp(260, 1), k.perc(0, 0.001, 0.08, 0.9), k.out);
    k.chain(k.noise(0, 3, 'brown'), k.lp(120), k.perc(0, 0.004, 1.6, 0.6), k.out);
  } },
  taiko_hi: { dur: 0.6, ch: 1, variants: 2, build(k, v) {
    const f = v ? 210 : 185;
    k.thump(0, { f0: f * 1.6, f1: f, drop: 0.03, a: 0.001, d: 0.28, amp: 0.8 });
    k.chain(k.noise(0, 0.1), k.bp(1800, 1.5), k.perc(0, 0.0008, 0.03, 0.9), k.out);
  } },
  rim: { dur: 0.25, ch: 1, variants: 2, build(k) {
    k.hit(0, { f: 2400, Q: 5, a: 0.0005, d: 0.035, amp: 1 }); k.ring(0, [[1150, 0.4], [1690, 0.2]], { d: 0.05, amp: 0.4 });
  } },
  gran: { dur: 4.5, ch: 1, variants: 1, build(k) {
    k.thump(0, { f0: 60, f1: 34, drop: 0.3, a: 0.004, d: 3.2, amp: 1, drive: 1.5 });
    k.chain(k.noise(0, 4, 'brown'), k.lp(220), k.perc(0, 0.004, 1.8, 0.8), k.out);
    k.chain(k.noise(0, 0.3, 'pink'), k.bp(600, 0.8), k.perc(0, 0.001, 0.08, 0.5), k.out);
  } },
  // trailer "impact": sub drop + crack + metallic shimmer + air
  impact: { dur: 5, ch: 2, variants: 1, build(k) {
    const O = k.out;
    k.thump(0, { f0: 70, f1: 24, drop: 0.9, a: 0.003, d: 3.5, amp: 1, drive: 3, dest: k.via(k.lp(240), O) });
    k.chain(k.noise(0, 0.4, 'white', 2), k.hp(700), k.perc(0, 0.001, 0.12, 0.9), O);
    k.ring(0.002, [[523, 0.4, 1], [1047, 0.3, 0.8], [1661, 0.2, 0.6], [2489, 0.15, 0.4]], { d: 2.5, amp: 0.2, detune: 2 });
    k.chain(k.noise(0, 4.5, 'brown', 2), k.lp(300), k.perc(0, 0.01, 2.5, 1), O);
  } },
  swell: { dur: 3.2, ch: 2, variants: 1, build(k) { // reversed-cymbal riser
    const n = k.chain(k.noise(0, 3.2, 'white', 2), k.hp(2500), k.peak(7000, 0.8, 4));
    const e = k.gain(0); e.gain.setValueAtTime(0.0001, 0); e.gain.exponentialRampToValueAtTime(1, 3.0); e.gain.linearRampToValueAtTime(0, 3.15);
    k.chain(n, e, k.out);
  } },
};
