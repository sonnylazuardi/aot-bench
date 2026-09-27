// Performance instrumentation (owned by core / integrator).
//   ?perf=1                 on-screen overlay (fps, frame/JS/GPU ms, per-system JS, draw calls, tris, programs…)
//   window.__game.perf()    rolling report object (averages over the last ~1 s of frames)
//   window.__game.perf({breakdown:true})  also renders one frame with every draw call attributed to its
//                           top-level scene object (bucketed per pass: main / shadow / post)
//
// Budgets: 60 fps @1080p on an RTX 3060 laptop (the real target machine).
export const BUDGET = {
  calls: 1500,          // all passes incl. shadow + post
  shadowCalls: 600,
  triangles: 4e6,       // all passes
  jsMs: 4,              // sum of all systems' update() per frame
  sysMs: 1.5,           // any single system's update()
  gpuMs: 12,            // leave headroom under 16.6
  programs: 90,         // linked shader programs (compile-time / hitch risk)
  textures: 120,
  geometries: 1500,
};

export function createPerf(renderer, scene, { overlay = false } = {}) {
  const info = renderer.info;
  info.autoReset = false;                     // multi-pass post: accumulate the whole frame, reset in beginFrame()
  const sys = {};                             // name -> {acc, n, max}
  const win = { frames: 0, steps: 0, t0: performance.now(), frameAcc: 0, frameMax: 0, calls: 0, tris: 0, points: 0, lines: 0, renderMs: 0, stepMs: 0, gpu: 0, gpuN: 0 };
  let last = null;                            // last published report
  let lastFrameT = performance.now();

  // ---- GPU timer (EXT_disjoint_timer_query_webgl2; desktop Chrome has it, SwiftShader usually not) ----
  const gl = renderer.getContext();
  const tq = gl.getExtension?.('EXT_disjoint_timer_query_webgl2');
  const pending = [];
  let activeQ = null;
  function gpuBegin() {
    if (!tq || activeQ || pending.length > 4) return;
    activeQ = gl.createQuery();
    gl.beginQuery(tq.TIME_ELAPSED_EXT, activeQ);
  }
  function gpuEnd() {
    if (!activeQ) return;
    gl.endQuery(tq.TIME_ELAPSED_EXT);
    pending.push(activeQ); activeQ = null;
  }
  function gpuPoll() {
    if (!tq) return;
    const disjoint = gl.getParameter(tq.GPU_DISJOINT_EXT);
    while (pending.length) {
      const q = pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      pending.shift(); gl.deleteQuery(q);
      if (!disjoint) { win.gpu += ns / 1e6; win.gpuN++; }
    }
  }

  // ---- GPU uploads per frame (texture + buffer bytes): repeated big uploads = stutter on real GPUs ----
  const up = { tex: 0, texBytes: 0, buf: 0, bufBytes: 0 };
  let hooked = false;
  // installed lazily (overlay on / first report) so normal play has no wrapper overhead
  function hookUploads() {
  if (hooked) return; hooked = true;
  const srcBytes = (v) => (v && ArrayBuffer.isView(v) ? v.byteLength : v && v.width ? (v.width * v.height * 4) || 0 : 0);
  const wrap = (fn, count) => { const o = gl[fn]; if (typeof o !== 'function') return; gl[fn] = function (...a) { try { count(a); } catch {} return o.apply(gl, a); }; };
  for (const fn of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D']) {
    wrap(fn, (a) => {
      up.tex++;
      const last = a[a.length - 1];
      let b = srcBytes(last);
      if (!b && typeof a[4] === 'number' && typeof a[3] === 'number') b = (fn === 'texSubImage2D' ? a[4] * a[5] : a[3] * a[4]) * 4 || 0;
      up.texBytes += b;
    });
  }
  wrap('bufferData', (a) => { up.buf++; up.bufBytes += typeof a[1] === 'number' ? a[1] : srcBytes(a[1]); });
  // bufferSubData(target, dstOffset, src, srcOffset?, length?) — three uploads only the update ranges via srcOffset/length
  wrap('bufferSubData', (a) => { up.buf++; const v = a[2]; up.bufBytes += a.length >= 5 && v ? a[4] * (v.BYTES_PER_ELEMENT || 1) : a.length === 4 && v ? v.byteLength - a[3] * (v.BYTES_PER_ELEMENT || 1) : srcBytes(v); });
  }
  const upWin = { texBytes: 0, bufBytes: 0, tex: 0, maxBytes: 0 };

  // ---- overlay (?perf=1, or toggle with F3) ----
  let box = null;
  function setOverlay(on) {
    if (on && !box) {
      box = document.createElement('pre');
      box.id = 'aot-perf';
      box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2000;margin:0;padding:6px 8px;background:rgba(0,0,0,.62);color:#d8f0d8;'
        + 'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;pointer-events:none;white-space:pre;border-radius:3px;max-width:calc(100vw - 32px);overflow:hidden';
      box.textContent = 'perf: measuring…';
      document.body.appendChild(box);
    } else if (!on && box) { box.remove(); box = null; }
    if (on) hookUploads();
  }
  setOverlay(overlay);
  let lastSys = {};
  const red = (s, bad) => (bad ? `<span style="color:#ff7a6a">${s}</span>` : s);

  function publish() {
    const n = Math.max(1, win.frames), ns = Math.max(1, win.steps);
    const now = performance.now();
    const sysMs = {};
    let jsMs = 0;
    for (const [k, v] of Object.entries(sys)) {
      if (!v.n) continue;
      sysMs[k] = { avg: +(v.acc / ns).toFixed(3), max: +v.max.toFixed(2) };
      jsMs += v.acc / ns;
      v.acc = 0; v.n = 0; v.max = 0;
    }
    // a window with no simulation steps (held / frozen) keeps the last measured per-system numbers
    if (win.steps) lastSys = { sysMs, jsMs }; else if (lastSys.sysMs) { Object.assign(sysMs, lastSys.sysMs); jsMs = lastSys.jsMs; }
    const mem = info.memory, prog = info.programs?.length ?? 0;
    last = {
      fps: +((win.frames * 1000) / Math.max(1, now - win.t0)).toFixed(1),
      frameMs: +(win.frameAcc / n).toFixed(2), frameMaxMs: +win.frameMax.toFixed(1),
      jsMs: +jsMs.toFixed(2), stepMs: +(win.stepMs / ns).toFixed(2), steps: win.steps, frames: win.frames, renderCpuMs: +(win.renderMs / n).toFixed(2),
      gpuMs: win.gpuN ? +(win.gpu / win.gpuN).toFixed(2) : null,
      calls: Math.round(win.calls / n), triangles: Math.round(win.tris / n), points: Math.round(win.points / n), lines: Math.round(win.lines / n),
      programs: prog, textures: mem.textures, geometries: mem.geometries,
      uploads: { texPerFrame: +(upWin.tex / n).toFixed(1), texMBPerFrame: +(upWin.texBytes / n / 1048576).toFixed(2),
        bufMBPerFrame: +(upWin.bufBytes / n / 1048576).toFixed(2), maxMBFrame: +(upWin.maxBytes / 1048576).toFixed(2) },
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      pixelRatio: renderer.getPixelRatio(), size: [renderer.domElement.width, renderer.domElement.height],
      systems: sysMs,
    };
    last.over = overBudget(last);
    win.frames = 0; win.steps = 0; win.t0 = now; win.frameAcc = 0; win.frameMax = 0; win.calls = 0; win.tris = 0; win.points = 0; win.lines = 0;
    win.renderMs = 0; win.stepMs = 0; win.gpu = 0; win.gpuN = 0;
    upWin.tex = upWin.texBytes = upWin.bufBytes = upWin.maxBytes = 0;
    if (box) {
      const r = last, B = BUDGET;
      const top = Object.entries(r.systems).sort((a, b) => b[1].avg - a[1].avg).slice(0, 8)
        .map(([k, v]) => `  ${k.padEnd(9)}${red(v.avg.toFixed(2).padStart(6), v.avg > B.sysMs)} ms  max ${v.max.toFixed(1)}`).join('\n');
      box.innerHTML = [
        `${red(r.fps.toFixed(0) + ' fps', r.fps < 55)}  frame ${r.frameMs.toFixed(1)} ms (max ${r.frameMaxMs})`,
        `JS ${red(r.jsMs.toFixed(2), r.jsMs > B.jsMs)} ms  render-cpu ${r.renderCpuMs.toFixed(2)} ms  gpu ${r.gpuMs == null ? 'n/a' : red(r.gpuMs.toFixed(2), r.gpuMs > B.gpuMs)} ms`,
        `calls ${red(r.calls, r.calls > B.calls)}  tris ${red((r.triangles / 1e6).toFixed(2) + 'M', r.triangles > B.triangles)}  pts ${r.points}  lines ${r.lines}`,
        `programs ${red(r.programs, r.programs > B.programs)}  tex ${red(r.textures, r.textures > B.textures)}  geo ${red(r.geometries, r.geometries > B.geometries)}  heap ${r.heapMB ?? '?'} MB`,
        `upload/frame tex ${r.uploads.texPerFrame} (${red(r.uploads.texMBPerFrame + ' MB', r.uploads.texMBPerFrame > 1)}) buf ${red(r.uploads.bufMBPerFrame + ' MB', r.uploads.bufMBPerFrame > 2)} max ${r.uploads.maxMBFrame} MB`,
        `${r.size[0]}x${r.size[1]} @${r.pixelRatio.toFixed(2)}`,
        top,
      ].join('\n');
    }
  }

  function overBudget(r) {
    const o = [];
    if (r.calls > BUDGET.calls) o.push(`calls ${r.calls} > ${BUDGET.calls}`);
    if (r.triangles > BUDGET.triangles) o.push(`triangles ${r.triangles} > ${BUDGET.triangles}`);
    if (r.jsMs > BUDGET.jsMs) o.push(`jsMs ${r.jsMs} > ${BUDGET.jsMs}`);
    for (const [k, v] of Object.entries(r.systems)) if (v.avg > BUDGET.sysMs) o.push(`${k} ${v.avg} ms > ${BUDGET.sysMs}`);
    if (r.gpuMs != null && r.gpuMs > BUDGET.gpuMs) o.push(`gpuMs ${r.gpuMs} > ${BUDGET.gpuMs}`);
    if (r.programs > BUDGET.programs) o.push(`programs ${r.programs} > ${BUDGET.programs}`);
    if (r.textures > BUDGET.textures) o.push(`textures ${r.textures} > ${BUDGET.textures}`);
    if (r.geometries > BUDGET.geometries) o.push(`geometries ${r.geometries} > ${BUDGET.geometries}`);
    return o;
  }

  // ---- per-draw-call attribution (one frame) ----
  function topName(o) {
    let top = o;
    while (top.parent && top.parent !== scene && top.parent.parent) top = top.parent;
    if (top.parent !== scene) return null;
    return top.name || top.type;
  }
  function breakdown(renderFn) {
    const orig = renderer.renderBufferDirect;
    const buckets = {};
    const cache = new WeakMap();
    renderer.renderBufferDirect = function (camera, sc, geometry, material, object, group) {
      let name = cache.get(object);
      if (name === undefined) { name = topName(object); cache.set(object, name); }
      const pass = sc === null ? 'shadow' : sc === scene ? 'main' : 'post';
      const key = name ? `${pass}:${name}` : `${pass}:${object.name || object.type}`;
      const b = buckets[key] || (buckets[key] = { calls: 0, tris: 0, materials: new Set() });
      b.calls++;
      const idx = geometry.index, pos = geometry.attributes.position;
      let cnt = idx ? idx.count : pos ? pos.count : 0;
      if (group) cnt = Math.min(cnt, group.count);
      else if (geometry.drawRange.count !== Infinity) cnt = Math.min(cnt, geometry.drawRange.count);
      const inst = object.isInstancedMesh ? object.count : geometry.isInstancedBufferGeometry ? geometry.instanceCount : 1;
      if (object.isMesh || object.isSkinnedMesh) b.tris += (cnt / 3) * (inst === Infinity ? 1 : inst);
      b.materials.add(material.type + (material.name ? `(${material.name})` : ''));
      return orig.apply(this, arguments);
    };
    try { renderFn(); } finally { renderer.renderBufferDirect = orig; }
    const rows = Object.entries(buckets).map(([k, v]) => ({ key: k, calls: v.calls, tris: Math.round(v.tris), materials: [...v.materials].slice(0, 6).join(',') }))
      .sort((a, b) => b.calls - a.calls);
    const sum = (p) => rows.filter((r) => r.key.startsWith(p + ':')).reduce((a, r) => ({ calls: a.calls + r.calls, tris: a.tris + r.tris }), { calls: 0, tris: 0 });
    return { totals: { main: sum('main'), shadow: sum('shadow'), post: sum('post') }, rows };
  }

  // scene census: what's in the scene per top-level object (independent of culling)
  function census() {
    const out = {};
    for (const c of scene.children) {
      const r = { meshes: 0, visibleMeshes: 0, shadowCasters: 0, instanced: 0, tris: 0, skinned: 0, lights: 0 };
      c.traverse((o) => {
        if (o.isLight) r.lights++;
        if (!o.isMesh && !o.isPoints && !o.isLine) return;
        r.meshes++;
        let vis = o.visible; for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
        if (vis) r.visibleMeshes++;
        if (o.castShadow && vis) r.shadowCasters++;
        if (o.isInstancedMesh) r.instanced++;
        if (o.isSkinnedMesh) r.skinned++;
        const g = o.geometry; if (!g) return;
        const n = g.index ? g.index.count : g.attributes.position?.count || 0;
        if (o.isMesh && vis) r.tris += (n / 3) * (o.isInstancedMesh ? o.count : 1);
      });
      r.tris = Math.round(r.tris);
      const k = c.name || c.type;
      if (out[k]) { for (const f in r) out[k][f] += r[f]; } else out[k] = r;
    }
    return out;
  }

  return {
    // wrap a system update: const t = perf.t(); ...; perf.sys(name, t)
    t: () => performance.now(),
    sys(name, t0) {
      const d = performance.now() - t0;
      const s = sys[name] || (sys[name] = { acc: 0, n: 0, max: 0 });
      s.acc += d; s.n++; if (d > s.max) s.max = d;
    },
    step(ms) { win.stepMs += ms; win.steps++; },
    beginRender() { info.reset(); gpuBegin(); up.tex = up.texBytes = up.buf = up.bufBytes = 0; return performance.now(); },
    endRender(t0) {
      win.renderMs += performance.now() - t0;
      gpuEnd();
      const r = info.render;
      win.calls += r.calls; win.tris += r.triangles; win.points += r.points; win.lines += r.lines;
      upWin.tex += up.tex; upWin.texBytes += up.texBytes; upWin.bufBytes += up.bufBytes;
      upWin.maxBytes = Math.max(upWin.maxBytes, up.texBytes + up.bufBytes);
      const now = performance.now();
      const fd = now - lastFrameT; lastFrameT = now;
      win.frameAcc += fd; if (fd > win.frameMax) win.frameMax = fd;
      win.frames++;
      gpuPoll();
      if (now - win.t0 > 1000) publish();
    },
    report({ breakdown: bd = false, render } = {}) {
      hookUploads();
      if (!last || win.frames > 0) publish();
      const r = { ...last, budget: BUDGET };
      if (bd && render) { r.breakdown = breakdown(render); r.census = census(); }
      return r;
    },
    breakdown, census, setOverlay, get overlay() { return !!box; },
  };
}
