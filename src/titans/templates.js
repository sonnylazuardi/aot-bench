// Titan templates (LOD0 + LOD1 per variant): IndexedDB cache first, otherwise built in a small worker pool
// (falls back to the main thread). Wrapped as shared BufferGeometries.
import * as THREE from 'three';
import { buildTemplate, VARIANTS, TEMPLATE_VERSION } from './body.js';
import { fetchBaked } from '../core/bake.js';

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
const KEY = TEMPLATE_VERSION + '-' + hashStr(JSON.stringify(VARIANTS));

function toGeometry(r) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(r.normal, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(r.skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(r.skinWeight, 4, r.skinWeight instanceof Uint8Array));
  g.setAttribute('aMat', new THREE.BufferAttribute(r.aMat, 4, true));
  g.setAttribute('aInfo', new THREE.BufferAttribute(r.aInfo, 4, true));
  g.setIndex(new THREE.BufferAttribute(r.index, 1));
  const H = r.meta.H;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H * 0.5, 0), H * 0.75);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-H * 0.6, 0, -H * 0.3), new THREE.Vector3(H * 0.6, H * 1.05, H * 0.3));
  return g;
}

// ---- tiny IndexedDB wrapper ----
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      const rq = indexedDB.open('aot-titans', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('tpl');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
  return dbp;
}
async function cacheGet(k) {
  const d = await db(); if (!d) return null;
  return new Promise((res) => { try { const r = d.transaction('tpl').objectStore('tpl').get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); } catch (e) { res(null); } });
}
async function cachePut(k, v) {
  const d = await db(); if (!d) return;
  try { d.transaction('tpl', 'readwrite').objectStore('tpl').put(v, k); } catch (e) { /* quota etc. */ }
}

function runPool(jobs) {
  const results = new Array(jobs.length);
  let pool = [];
  try {
    const nWorkers = Math.max(1, Math.min(jobs.length, (navigator.hardwareConcurrency || 4) - 1, 8));
    for (let i = 0; i < nWorkers; i++) pool.push(new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }));
  } catch (e) { pool = []; }
  if (!pool.length) { for (let i = 0; i < jobs.length; i++) results[i] = buildTemplate(jobs[i].name, jobs[i].opts); return Promise.resolve(results); }
  let next = 0;
  return Promise.all(pool.map((w) => new Promise((resolve) => {
    const run = () => {
      if (next >= jobs.length) { w.terminate(); resolve(); return; }
      const id = next++;
      w.onmessage = (e) => {
        if (e.data.ok) results[id] = e.data.r;
        else { console.warn('[titans] worker build failed', e.data.error); results[id] = buildTemplate(jobs[id].name, jobs[id].opts); }
        run();
      };
      w.onerror = (err) => { console.warn('[titans] worker error', err.message); results[id] = buildTemplate(jobs[id].name, jobs[id].opts); run(); };
      w.postMessage({ id, name: jobs[id].name, opts: jobs[id].opts });
    };
    run();
  }))).then(() => results);
}

// returns { name: template } for every name. Order: dev-server bake cache (keyed by body.js+sdf.js hash) ->
// optional IndexedDB cache -> worker pool.
export async function buildAllTemplates(names = Object.keys(VARIANTS), { useCache = false } = {}) {
  const jobs = [];
  for (const n of names) { jobs.push({ name: n, opts: {} }); jobs.push({ name: n, opts: { lod1: true } }); }
  const results = new Array(jobs.length);
  await Promise.all(jobs.map(async (j, i) => {
    let r = null;
    try { r = await fetchBaked('titans', [j.name, j.opts]); } catch (e) { r = null; }
    if (!r && useCache) { const hit = await cacheGet(KEY + ':' + j.name + (j.opts.lod1 ? ':1' : ':0')); if (hit) r = hit; }
    results[i] = r;
  }));
  const missIdx = [];
  for (let i = 0; i < jobs.length; i++) if (!results[i]) missIdx.push(i);
  if (missIdx.length) {
    const res = await runPool(missIdx.map((i) => jobs[i]));
    missIdx.forEach((i, k) => {
      results[i] = res[k];
      if (useCache) cachePut(KEY + ':' + jobs[i].name + (jobs[i].opts.lod1 ? ':1' : ':0'), res[k]);
    });
  }
  const out = {};
  for (let i = 0; i < names.length; i++) out[names[i]] = wrap(names[i], results[i * 2], results[i * 2 + 1]);
  return out;
}
function wrap(name, r0, r1) {
  return { name, meta: r0.meta, geo0: toGeometry(r0), geo1: toGeometry(r1), tris0: r0.tris, tris1: r1.tris };
}
