import { copyFileSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { resolveHostingRuntime } from './runtime-path.mjs';

function regularPath(path, directory = false) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error('Unexpected hosting path type');
  }
}

export function repairOwnerEntry(runtime, { check = false } = {}) {
  regularPath(runtime, true);
  regularPath(join(runtime, 'secrets'), true);
  const envPath = join(runtime, 'secrets', 'app.env');
  regularPath(envPath);
  const env = parseEnv(readFileSync(envPath, 'utf8').replace(/^\uFEFF/, ''));
  const origin = new URL(env.BETTER_AUTH_URL);
  const token = env.ADMIN_SETUP_TOKEN?.trim();
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Invalid public origin');
  }
  if (!token || token.length < 32 || token.length > 256) throw new Error('Invalid owner setup token');
  const url = new URL('/setup', origin);
  url.hash = new URLSearchParams({ token }).toString();
  if (new URLSearchParams(url.hash.slice(1)).get('token') !== token) throw new Error('Invalid token encoding');
  const content = Buffer.from(`[InternetShortcut]\r\nURL=${url.href}\r\n`, 'utf8');
  const path = join(runtime, '講師首次設定.url');
  let old;
  if (existsSync(path)) {
    regularPath(path);
    old = readFileSync(path);
  }
  if (old?.equals(content)) return { verified: true, changed: false, path };
  if (check) return { verified: false, changed: false, path };

  // All secret-bearing files remain within the runtime's existing restricted ACL.
  let backup;
  if (old) {
    const backups = join(runtime, 'backups');
    if (!existsSync(backups)) mkdirSync(backups);
    regularPath(backups, true);
    backup = join(backups, `owner-entry-${randomUUID()}.url`);
    copyFileSync(path, backup, constants.COPYFILE_EXCL);
    if (!readFileSync(backup).equals(old)) throw new Error('Owner entry backup verification failed');
  }
  const staged = join(runtime, `.owner-entry-${randomUUID()}.tmp`);
  writeFileSync(staged, content, { flag: 'wx', mode: 0o600 });
  if (!readFileSync(staged).equals(content)) throw new Error('Owner entry staging verification failed');
  renameSync(staged, path);
  if (!readFileSync(path).equals(content)) throw new Error('Owner entry verification failed');
  return { verified: true, changed: true, path, backup };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = repairOwnerEntry(resolveHostingRuntime('DayTradeTycoon'), { check: process.argv.includes('--check') });
    console.log(JSON.stringify(result));
    if (!result.verified) process.exitCode = 1;
  } catch {
    // URL/parser errors may include credentials; never print the underlying error.
    console.error(JSON.stringify({ verified: false, error: 'Owner entry could not be verified or written; inspect the private runtime configuration.' }));
    process.exitCode = 1;
  }
}
