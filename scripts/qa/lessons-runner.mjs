// A built classroom server as a child process for the daily-lesson QA scripts (real-day-check, perf-lessons): the
// release's own entry, plus a `memory` message so the parent can read the server's RSS and heap while it runs.
// Like scripts/hosting/app-runner.mjs, a disconnected parent must not leave a database writer running.
import { getHeapStatistics } from 'node:v8';
import { pathToFileURL } from 'node:url';

process.on('disconnect', () => {
  process.emit('message', { type: 'shutdown' });
  setTimeout(() => process.exit(1), 30_000).unref();
});
process.on('message', message => {
  if (message?.type !== 'memory' || !process.connected) return;
  const usage = process.memoryUsage();
  const heap = getHeapStatistics();
  process.send({
    type: 'memory', at: Date.now(), rss: usage.rss, heapUsed: usage.heapUsed, heapTotal: usage.heapTotal,
    external: usage.external, arrayBuffers: usage.arrayBuffers, heapLimit: heap.heap_size_limit,
    cpuMicros: process.cpuUsage().user + process.cpuUsage().system,
  });
});

await import(pathToFileURL(process.argv[2]).href);
