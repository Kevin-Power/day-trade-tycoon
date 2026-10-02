import { readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../.output/server/', import.meta.url));
function filesAt(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? filesAt(join(path, entry.name)) : /\.m?js$/.test(entry.name) ? [join(path, entry.name)] : []);
}
const files = filesAt(root);
for (let offset = 0; offset < files.length; offset += 8) {
  await Promise.all(files.slice(offset, offset + 8).map(path => exec(process.execPath, ['--check', path], { windowsHide: true })));
}
console.log(`Server module syntax verified: ${files.length} files. HTTP readiness must also pass before deployment.`);
