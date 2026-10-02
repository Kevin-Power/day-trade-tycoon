// Only used by the isolated hosting lifecycle test. Never a deployment entry.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

mkdirSync(process.env.PGLITE_DATA_DIR, { recursive: true });
writeFileSync(join(process.env.PGLITE_DATA_DIR, 'fixture-data'), 'persistent fixture data');
console.log(`Redaction probe ${process.env.BETTER_AUTH_SECRET}`);
const server = createServer((request, response) => {
  if (request.url === '/api/health') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ ok: true })); }
  else if (request.url === '/fixture-crash') { response.end('crashing test fixture'); setTimeout(() => process.exit(2), 50); }
  else { response.statusCode = 404; response.end(); }
});
server.listen(Number(process.env.PORT), process.env.HOST);
process.on('message', (message) => {
  if (message?.type !== 'shutdown') return;
  server.close(() => {
    writeFileSync(join(process.env.PGLITE_DATA_DIR, 'closed'), 'database close acknowledged');
    process.send?.({ type: 'shutdown-complete' });
  });
});
