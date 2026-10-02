import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repairOwnerEntry } from './owner-entry.mjs';

function fixture(env) {
  const runtime = mkdtempSync(join(tmpdir(), 'owner-entry-test-'));
  mkdirSync(join(runtime, 'secrets'));
  writeFileSync(join(runtime, 'secrets/app.env'), env);
  return runtime;
}

test('dotenv quoting and special characters round-trip without changing the configured credential', () => {
  const token = 'fixture-only-token-0123456789abcdef+&%/#';
  for (const quote of ['"', "'"]) {
    const env = `\uFEFFBETTER_AUTH_URL="https://classroom.example"\r\nADMIN_SETUP_TOKEN=${quote}${token}${quote}\r\n`;
    const runtime = fixture(env);
    const path = join(runtime, '講師首次設定.url');
    const old = Buffer.from('[InternetShortcut]\r\nURL=https://classroom.example/setup#token="incorrect-old-value"\r\n');
    writeFileSync(path, old);
    assert.equal(repairOwnerEntry(runtime, { check: true }).verified, false);
    assert.deepEqual(readFileSync(path), old);
    const result = repairOwnerEntry(runtime);
    const link = new URL(readFileSync(path, 'utf8').match(/^URL=(.+)$/m)[1].trim());
    assert.equal(link.origin, 'https://classroom.example');
    assert.equal(link.pathname, '/setup');
    assert.equal(new URLSearchParams(link.hash.slice(1)).get('token'), token);
    assert.deepEqual(readFileSync(result.backup), old);
    assert.equal(readFileSync(join(runtime, 'secrets/app.env'), 'utf8'), env);
    assert.equal(JSON.stringify(result).includes(token), false);
    assert.equal(repairOwnerEntry(runtime).changed, false);
    assert.equal(repairOwnerEntry(runtime, { check: true }).verified, true);
    assert.equal(readdirSync(join(runtime, 'backups')).length, 1);
  }
});

test('invalid configuration leaves the existing private shortcut untouched and does not print secrets', () => {
  for (const env of [
    'BETTER_AUTH_URL=https://classroom.example\nADMIN_SETUP_TOKEN=short',
    'BETTER_AUTH_URL=https://classroom.example',
    'BETTER_AUTH_URL=https://user:secret@classroom.example\nADMIN_SETUP_TOKEN=fixture-only-token-0123456789abcdef',
    'BETTER_AUTH_URL=https://classroom.example/wrong\nADMIN_SETUP_TOKEN=fixture-only-token-0123456789abcdef',
    'BETTER_AUTH_URL=secret-invalid-url\nADMIN_SETUP_TOKEN=fixture-only-token-0123456789abcdef',
  ]) {
    const runtime = fixture(env);
    const path = join(runtime, '講師首次設定.url');
    writeFileSync(path, 'existing-private-shortcut');
    const result = spawnSync(process.execPath, ['scripts/hosting/owner-entry.mjs', '--runtime', runtime], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1);
    assert.equal(readFileSync(path, 'utf8'), 'existing-private-shortcut');
    assert.doesNotMatch(result.stdout + result.stderr, /secret|fixture-only-token|classroom\.example/);
    assert.deepEqual(readdirSync(runtime).sort(), ['secrets', '講師首次設定.url'].sort());
  }
});
