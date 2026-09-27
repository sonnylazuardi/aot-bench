// Loading overlay (owned by core / integrator). Plain DOM, no dependencies.
//   const ui = createLoaderUI(names, { hidden })
//   ui.set(name, state, ms)   state: 'wait' | 'run' | 'ok' | 'stub' | 'late'
//   ui.step(label, frac)      explicit progress (e.g. shader compile)
//   ui.done()                 fade out and remove
export function createLoaderUI(names, { hidden = false, weights = {} } = {}) {
  const el = document.createElement('div');
  el.id = 'aot-loader';
  el.innerHTML = `
    <style>
      #aot-loader{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;
        background:radial-gradient(ellipse at 50% 60%,#2a1a12 0%,#0c0806 70%);color:#e9dcc6;
        font:500 13px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;transition:opacity .6s ease}
      #aot-loader.out{opacity:0;pointer-events:none}
      #aot-loader .box{width:min(420px,calc(100vw - 32px))}
      #aot-loader h1{margin:0 0 4px;font:700 22px/1.1 Georgia,"Times New Roman",serif;letter-spacing:.18em;text-transform:uppercase;color:#f3e6cf}
      #aot-loader .sub{margin:0 0 18px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#a58f73}
      #aot-loader .bar{height:3px;background:#3a2a20;overflow:hidden}
      #aot-loader .fill{height:100%;width:0;background:linear-gradient(90deg,#b8742e,#f0b060);transition:width .25s ease}
      #aot-loader .label{margin-top:10px;min-height:1.4em;font-variant-numeric:tabular-nums;color:#c9b597}
      #aot-loader .err{margin-top:6px;color:#e07a5f;font-size:12px}
    </style>
    <div class="box">
      <h1>Attack on Titan</h1>
      <p class="sub">The Fall of Shiganshina</p>
      <div class="bar"><div class="fill"></div></div>
      <div class="label">Loading…</div>
      <div class="err"></div>
    </div>`;
  if (hidden) el.style.display = 'none';
  document.body.appendChild(el);
  const fill = el.querySelector('.fill'), label = el.querySelector('.label'), err = el.querySelector('.err');
  const state = Object.fromEntries(names.map((n) => [n, 'wait']));
  const W = (n) => weights[n] ?? 1;
  const total = names.reduce((a, n) => a + W(n), 0) + (weights.shaders ?? 0);
  let extra = 0;
  const LABELS = {
    sky: 'Painting the sky', post: 'Grading the lens', fx: 'Mixing smoke and steam', world: 'Raising Shiganshina',
    audio: 'Tuning the bells', titans: 'Sculpting titans', colossal: 'Sculpting the Smiling Titan', player: 'Fitting ODM gear',
    cam: 'Rigging the camera', hud: 'Inking the HUD', intro: 'Staging the breach', director: 'Final call',
  };
  function refresh() {
    let done = extra;
    for (const n of names) if (state[n] === 'ok' || state[n] === 'stub' || state[n] === 'late') done += W(n);
    fill.style.width = `${Math.min(100, (done / total) * 100).toFixed(1)}%`;
    const running = names.filter((n) => state[n] === 'run');
    if (running.length) label.textContent = running.map((n) => LABELS[n] || n).join(' · ') + '…';
  }
  return {
    el,
    set(name, s) {
      state[name] = s;
      if (s === 'stub') err.textContent = `${err.textContent ? err.textContent + ' · ' : ''}${name} unavailable (fallback)`;
      refresh();
    },
    step(text, frac = 0) { extra = (weights.shaders ?? 0) * frac; label.textContent = text; refresh(); },
    done(instant = false) {
      fill.style.width = '100%';
      if (instant) { el.remove(); return; }
      el.classList.add('out');
      setTimeout(() => el.remove(), 700);
    },
  };
}
