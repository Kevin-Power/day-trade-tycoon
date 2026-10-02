import { join, resolve } from 'node:path';

export function resolveHostingRuntime(serviceName, argv = process.argv, env = process.env) {
  const option = argv.indexOf('--runtime');
  if (option >= 0) {
    const explicit = argv[option + 1];
    if (!explicit?.trim() || explicit.startsWith('--')) throw new Error('--runtime requires a directory path.');
    return resolve(explicit);
  }
  if (!env.USERPROFILE?.trim()) throw new Error('USERPROFILE is unavailable; provide an explicit --runtime directory.');
  // MSIX LocalAppData views differ between Codex child processes and Task Scheduler.
  return resolve(join(env.USERPROFILE, 'YilutekServices', serviceName));
}
