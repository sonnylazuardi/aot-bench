// Binary container for baked build results (plain objects holding typed arrays + JSON-able values).
// Shared by the browser (src/core/bake.js) and the Node baker (tools/bake/*). No dependencies.
//   layout: 'AOTB' | u32 version | u32 headerBytes | header JSON (utf8) | pad to 8 | raw array bytes (8-aligned)
const MAGIC = 0x42544f41; // 'AOTB' little-endian
export const BAKE_FORMAT = 1;
const TYPES = { Float32Array, Float64Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array };

// stable short key for an args array: readable prefix + FNV-1a hash
export function bakeKey(args) {
  const s = JSON.stringify(args);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  const readable = s.replace(/[^A-Za-z0-9.]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return `${readable}-${h.toString(16).padStart(8, '0')}`;
}

export function encodeBaked(obj) {
  const chunks = [];
  let off = 0;
  const walk = (v) => {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const type = v.constructor.name;
      if (!TYPES[type]) throw new Error(`bake: unsupported array ${type}`);
      off = (off + 7) & ~7;
      const ref = { $ta: type, o: off, n: v.length };
      chunks.push({ off, bytes: new Uint8Array(v.buffer, v.byteOffset, v.byteLength) });
      off += v.byteLength;
      return ref;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = walk(v[k]); return o; }
    if (typeof v === 'function') return undefined;
    return v;
  };
  const header = new TextEncoder().encode(JSON.stringify(walk(obj)));
  const dataStart = (12 + header.length + 7) & ~7;
  const out = new Uint8Array(dataStart + ((off + 7) & ~7));
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, BAKE_FORMAT, true); dv.setUint32(8, header.length, true);
  out.set(header, 12);
  for (const c of chunks) out.set(c.bytes, dataStart + c.off);
  return out;
}

export function decodeBaked(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength < 12 || dv.getUint32(0, true) !== MAGIC || dv.getUint32(4, true) !== BAKE_FORMAT) return null;
  const hl = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hl)));
  const dataStart = (12 + hl + 7) & ~7;
  const walk = (v) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && v.$ta) return new TYPES[v.$ta](buf, dataStart + v.o, v.n);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = walk(v[k]); return o; }
    return v;
  };
  return walk(header);
}
