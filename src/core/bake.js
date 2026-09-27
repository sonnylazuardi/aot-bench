// Baked build results served by the dev server (tools/bake/plugin.mjs) or shipped in dist/ by `npm run build`.
//
//   import { fetchBaked } from '../core/bake.js';
//   const r = await fetchBaked('colossal', [name, q]);   // -> the exact object buildPartArrays(name, q) returns, or null
//   if (!r) { ...build in a worker as before... }
//
// The server keys results by a hash of the builder's source files (its relative-import closure), so an edit to
// sculpt.js / body.js / sdf.js etc. invalidates automatically. On a miss the server answers 204 at once and bakes
// in the background at low priority, so the NEXT load is instant; the caller just falls back to its own workers.
// Registered builders live in tools/bake/plugin.mjs (BAKERS). `?nobake=1` disables fetching.
import { bakeKey, decodeBaked } from './bakeCodec.js';

const disabled = (() => { try { return new URLSearchParams(location.search).has('nobake'); } catch { return true; } })();
export const bakeStats = { hits: 0, misses: 0, ms: 0 };

export async function fetchBaked(system, args, { timeout = 8000 } = {}) {
  if (disabled) return null;
  const t0 = performance.now();
  const key = bakeKey(args);
  const url = `${import.meta.env.BASE_URL}__bake/${system}/${key}.bin?a=${encodeURIComponent(JSON.stringify(args))}`;
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const to = setTimeout(() => ac?.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ac?.signal, cache: 'no-store' });
    if (res.status !== 200) { bakeStats.misses++; return null; }
    const out = decodeBaked(await res.arrayBuffer());      // null if the SPA fallback answered with index.html
    if (out) { bakeStats.hits++; bakeStats.ms += performance.now() - t0; } else bakeStats.misses++;
    return out;
  } catch {
    bakeStats.misses++;
    return null;
  } finally { clearTimeout(to); }
}
