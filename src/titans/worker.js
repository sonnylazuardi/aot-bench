// Builds titan templates off the main thread.
import { buildTemplate } from './body.js';

self.onmessage = (e) => {
  const { id, name, opts } = e.data;
  try {
    const r = buildTemplate(name, opts);
    const transfer = [r.position.buffer, r.normal.buffer, r.skinIndex.buffer, r.skinWeight.buffer, r.aMat.buffer, r.aInfo.buffer, r.index.buffer];
    self.postMessage({ id, ok: true, r }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.stack || err) });
  }
};
