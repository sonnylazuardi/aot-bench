import { bakePlugin } from './tools/bake/plugin.mjs';

export default {
  plugins: [bakePlugin()],   // /__bake/* : cached results of the SDF builders (see src/core/bake.js)
  build: { target: 'esnext', chunkSizeWarningLimit: 4000 },
  // workers are created with { type: 'module' } (titans/worker.js, story/colossalWorker.js)
  worker: { format: 'es' },
  server: { watch: { ignored: ['**/shots/**', '**/NOTES.md', '**/PROGRESS.json', '**/ref/**'] } },
};
