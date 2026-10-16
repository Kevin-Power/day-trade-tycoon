import { dirname, join, resolve } from 'node:path';

/** Paths the hosted app reads. Market data lives beside data/, so service backups never copy it. */
export function hostedAppPaths(runtime, entry) {
  return {
    PGLITE_DATA_DIR: join(runtime, 'data', 'pglite'),
    CLASSROOM_DOWNLOADS_DIR: resolve(dirname(entry), '../downloads'),
    MARKET_DATA_DIR: join(runtime, 'market-data'),
  };
}
