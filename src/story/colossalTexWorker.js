// Generates the Colossal muscle texture off the main thread (~0.8 s of JS).
import { generateMuscleData } from './colossalTex.js';
self.onmessage = (e) => {
  const d = generateMuscleData(e.data.size);
  self.postMessage({ data: d }, [d.buffer]);
};
