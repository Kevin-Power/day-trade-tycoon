import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
function discover(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const file = join(path, entry.name);
    if (entry.isDirectory()) return discover(file);
    return /\.test\.(mjs|ts)$/.test(file) && !file.endsWith('auth-integration.test.mjs') ? [file] : [];
  });
}
const files = [...discover(join(root, 'scripts')), ...discover(join(root, 'src/lib'))];
if (!files.length) throw new Error('No tests discovered');
console.log(`Running ${files.length} test files`);
const child = spawn(process.execPath, ['--experimental-strip-types', '--test', '--test-concurrency=4', ...files], {
  stdio: 'inherit', cwd: root, windowsHide: true,
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
