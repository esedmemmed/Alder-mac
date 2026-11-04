// Three test files build into the one dist-mac/ from separate processes (node --test runs files in parallel): each build empties it first,
// so a reader could find it half-written (T12.1.1.c2). This runs the build and the read of dist-mac/app.js under a cross-process lock.
import { mkdirSync, rmSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildMac } from '../../scripts/build.mjs';

const LOCK = fileURLToPath(new URL('../../.run/dist-mac.lock', import.meta.url));
const STALE_MS = 120000;

export async function buildMacAppJs() {
  mkdirSync(fileURLToPath(new URL('../../.run', import.meta.url)), { recursive: true });
  for (;;) {
    try { mkdirSync(LOCK); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(LOCK).mtimeMs > STALE_MS) rmSync(LOCK, { recursive: true, force: true }); } catch { /* released meanwhile */ }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  try {
    await buildMac({ log: () => {} });
    return readFileSync(fileURLToPath(new URL('../../dist-mac/app.js', import.meta.url)), 'utf8');
  } finally { rmSync(LOCK, { recursive: true, force: true }); }
}
