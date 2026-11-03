import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../dev/fixture-server.mjs';

test('a request path with ":" finds its "__" fixture file', async () => {
  const s = await startServer({ quiet: true });
  try {
    const r = await fetch(s.origin + '/__fx/torrentio.strem.fun/stream/series/tt11280740:1:4.json');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray((await r.json()).streams));
  } finally { await s.close(); }
});
