// A disconnected supervisor must not leave a database writer running forever.
import { pathToFileURL } from 'node:url';

process.on('disconnect', () => {
  process.emit('message', { type: 'shutdown' });
  setTimeout(() => process.exit(1), 30_000).unref();
});

await import(pathToFileURL(process.argv[2]).href);
