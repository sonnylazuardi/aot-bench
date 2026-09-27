// Child process: node tools/bake/worker.mjs <entryAbsPath> <exportName> <argsJson> <outFile>
// Imports the builder module, runs it, writes the encoded result atomically.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { encodeBaked } from '../../src/core/bakeCodec.js';

const [entry, fnName, argsJson, outFile] = process.argv.slice(2);
try {
  const t0 = performance.now();
  const mod = await import(pathToFileURL(entry).href);
  const fn = mod[fnName];
  if (typeof fn !== 'function') throw new Error(`${entry} has no export ${fnName}`);
  const result = await fn(...JSON.parse(argsJson));
  const bytes = encodeBaked(result);
  const tmp = `${outFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, outFile);
  process.stdout.write(JSON.stringify({ ok: true, ms: Math.round(performance.now() - t0), bytes: bytes.length }) + '\n');
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(e?.stack || e) }) + '\n');
  process.exitCode = 1;
}
