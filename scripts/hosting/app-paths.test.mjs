import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join, resolve } from 'node:path';
import { hostedAppPaths } from './app-paths.mjs';

test('hosted app paths put market data next to, not inside, the backed-up data folder', () => {
  const runtime = resolve('C:/runtime');
  const entry = join(runtime, 'releases', 'r1', 'server', 'index.mjs');
  assert.deepEqual(hostedAppPaths(runtime, entry), {
    PGLITE_DATA_DIR: join(runtime, 'data', 'pglite'),
    CLASSROOM_DOWNLOADS_DIR: join(runtime, 'releases', 'r1', 'downloads'),
    MARKET_DATA_DIR: join(runtime, 'market-data'),
  });
});
