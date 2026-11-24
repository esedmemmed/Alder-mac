// The Web Worker entry of the subtitle alignment (scripts/build.mjs bundles it into the string __ALDER_ALIGN_WORKER__, started from a Blob URL).
// Message in: { ref, cands }; out: { results } or { error }. Bundled together with core/subtitle-align.js only: no DOM.
import { analyse } from './subtitle-sync.js';

self.onmessage = (e) => {
  try { self.postMessage({ results: analyse(e.data.ref, e.data.cands, e.data.opts || undefined) }); }
  catch (err) { self.postMessage({ error: String(err && err.message ? err.message : err) }); }
};
