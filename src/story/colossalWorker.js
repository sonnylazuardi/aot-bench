import { buildPartArrays } from './colossalBuild.js';
self.onmessage = (e) => {
  const { name, q } = e.data;
  try {
    const t0 = performance.now();
    const out = buildPartArrays(name, q);
    out.ms = performance.now() - t0;
    const transfer = Object.values(out).filter((v) => v && v.buffer instanceof ArrayBuffer).map((v) => v.buffer);
    self.postMessage(out, transfer);
  } catch (err) {
    self.postMessage({ name, error: String(err && err.stack || err) });
  }
};
