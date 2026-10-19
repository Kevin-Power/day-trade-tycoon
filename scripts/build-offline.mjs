#!/usr/bin/env node
/** Static classroom ZIP for authenticated delivery; no online identity/secrets. */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, renameSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist-offline');
const packRoot = join(root, 'dist-offline-pack');
const stage = join(packRoot, 'DayTradeTycoon');
const zipOut = join(root, 'downloads', 'daytrade-tycoon-offline.zip');
const zipTemporary = join(root, 'downloads', 'daytrade-tycoon-offline.building.zip');
function assertBuildPath(path) {
  const rel = relative(root, resolve(path));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Build target escaped workspace.');
}
function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', windowsHide: true, env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Offline build command failed (exit ${result.status}).`);
}
// Invoke Vite via Node, not npm.cmd/bare vite (Windows spawn EINVAL).
run(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
  'build', '--config', 'vite.offline.config.ts']);
if (!existsSync(join(dist, 'index.html'))) throw new Error('Missing dist-offline/index.html.');
assertBuildPath(packRoot);
rmSync(packRoot, { recursive: true, force: true });
mkdirSync(join(stage, 'app'), { recursive: true });
cpSync(dist, join(stage, 'app'), { recursive: true });
for (const file of ['favicon.svg', 'daytrade-tycoon-manual.pdf', 'third-party-notices.txt']) {
  const source = join(root, 'public', file);
  if (!existsSync(source)) throw new Error(`Offline package is missing required public/${file}.`);
  cpSync(source, join(stage, 'app', file));
}
for (const file of ['serve.ps1', 'START.bat', 'START.command', 'README.txt']) {
  const text = readFileSync(join(root, 'src', 'offline', file), 'utf8');
  writeFileSync(join(stage, file), file === 'README.txt' ? '\uFEFF' + text : text, 'utf8');
}
cpSync(join(stage, 'START.command'), join(stage, 'START.sh'));
mkdirSync(join(root, 'downloads'), { recursive: true });
assertBuildPath(zipTemporary);
if (existsSync(zipTemporary)) rmSync(zipTemporary);
if (process.platform === 'win32') {
  const zipScriptPath = join(packRoot, 'package.ps1');
  writeFileSync(zipScriptPath, '\uFEFF' + `param([string]$Source, [string]$Destination)\n$ErrorActionPreference='Stop'\nCompress-Archive -LiteralPath $Source -DestinationPath $Destination -CompressionLevel Optimal -Force\n`, 'utf8');
  run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', zipScriptPath, '-Source', stage, '-Destination', zipTemporary]);
} else {
  const pyCode = `import zipfile, os, sys\nsource, output = sys.argv[1:]\nwith zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:\n for directory, _, files in os.walk(source):\n  for name in files:\n   full = os.path.join(directory, name)\n   archive.write(full, os.path.relpath(full, os.path.dirname(source)))\n`;
  run('python3', ['-c', pyCode, stage, zipTemporary]);
}
if (statSync(zipTemporary).size < 1024) throw new Error('ZIP output is unexpectedly empty.');
renameSync(zipTemporary, zipOut);
console.log(JSON.stringify({ offlineZip: zipOut, bytes: statSync(zipOut).size, sha256: createHash('sha256').update(readFileSync(zipOut)).digest('hex') }, null, 2));
