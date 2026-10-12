import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filesIn, verifyPackage } from './onprem/launcher.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const id = new Date().toISOString().replace(/[-:.]/g, '');
const work = join(root, 'artifacts', 'onprem-build-' + id);
const stage = join(work, 'DayTradeTycoon-OnPrem');
await mkdir(stage, { recursive: true });
for (const name of ['server', 'public', 'downloads']) {
  const source = join(root, '.output', name);
  for (const path of await filesIn(source)) {
    if (/(^|\/)(\.env[^/]*|data|secrets)(\/|$)/i.test(path)) throw new Error('Build includes unexpected private runtime files.');
  }
  await cp(source, join(stage, name), { recursive: true, errorOnExist: true, force: false });
}
for (const name of ['launcher.mjs', 'protect-data.ps1', 'START.bat', 'BACKUP.bat', 'START.sh', '使用說明.txt']) {
  const source = await readFile(join(root, 'scripts', 'onprem', name), 'utf8');
  const text = name.endsWith('.bat') ? source.replace(/\r?\n/g, '\r\n') : name.endsWith('.txt') ? '\uFEFF' + source : source;
  await writeFile(join(stage, name), text, { flag: 'wx' });
}
await cp(join(root, 'scripts', 'hosting', 'app-runner.mjs'), join(stage, 'app-runner.mjs'), { errorOnExist: true, force: false });
const files = [];
for (const path of await filesIn(stage)) files.push({ path, sha256: createHash('sha256').update(await readFile(join(stage, path))).digest('hex') });
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
await writeFile(join(stage, 'package-manifest.json'), JSON.stringify({ format: 1, id, builtAt: new Date().toISOString(),
  sourceCommit: git(['rev-parse', 'HEAD']), sourceHasChanges: Boolean(git(['status', '--porcelain'])), nodeMajor: 24,
  deployment: 'local-only', files }, null, 2) + '\n');
await verifyPackage(stage);
await mkdir(join(root, 'downloads'), { recursive: true });
const output = join(root, 'downloads', `day-trade-tycoon-onprem-${id}.zip`);
if (process.platform === 'win32') {
  const script = join(work, 'package.ps1');
  await writeFile(script, "param([string]$Source,[string]$Destination)\n$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n[IO.Compression.ZipFile]::CreateFromDirectory($Source,$Destination,[IO.Compression.CompressionLevel]::Optimal,$true)\n");
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Source', stage, '-Destination', output], { windowsHide: true, stdio: 'inherit' });
} else {
  const script = 'import os, sys, zipfile\nsource, target = sys.argv[1:]\nwith zipfile.ZipFile(target, "x", zipfile.ZIP_DEFLATED) as archive:\n for parent, _, files in os.walk(source):\n  for name in files:\n   path = os.path.join(parent, name)\n   archive.write(path, os.path.relpath(path, os.path.dirname(source)))\n';
  execFileSync('python3', ['-c', script, stage, output], { stdio: 'inherit' });
}
const result = { package: output, stage, files: files.length, bytes: (await stat(output)).size,
  sha256: createHash('sha256').update(await readFile(output)).digest('hex'), activated: false };
await writeFile(join(work, 'build-result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
