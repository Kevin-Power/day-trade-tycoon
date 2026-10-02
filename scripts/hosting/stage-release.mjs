import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHostingRuntime } from './runtime-path.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = resolveHostingRuntime('DayTradeTycoon');
const id = new Date().toISOString().replace(/[-:.]/g, '');
const release = join(runtime, 'releases', id);
const source = join(repo, '.output');
if (!existsSync(join(source, 'server/index.mjs'))) throw new Error('Production build missing');
if (!existsSync(join(source, 'server/_libs/pglite.wasm'))) throw new Error('Database runtime missing');
if (existsSync(release)) throw new Error('Release ID exists; never overwrite a release');
mkdirSync(release, { recursive: true });
cpSync(source, release, { recursive: true, errorOnExist: true, force: false });
const files = [];
function scan(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Unexpected symbolic link in release');
    if (entry.isDirectory()) scan(full);
    else files.push({ path: relative(release, full).replaceAll('\\', '/'), sha256: createHash('sha256').update(readFileSync(full)).digest('hex') });
  }
}
scan(release);
writeFileSync(join(release, 'release-manifest.json'), JSON.stringify({ id, builtAt: new Date().toISOString(), files }, null, 2));
console.log(JSON.stringify({ staged: true, release, appEntry: join(release, 'server/index.mjs'), files: files.length, activated: false }));
