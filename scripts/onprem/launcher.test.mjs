import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialize, applicationEnvironment, validateConfig, acquireLock, backup, verifyPackage, filesIn } from './launcher.mjs';

const here = dirname(fileURLToPath(import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'daytrade-onprem-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(join(here, 'protect-data.ps1'), join(root, 'protect-data.ps1'));
  return root;
}

test('portable settings remain stable and cannot inherit an online database or disabled authentication', async t => {
  const root = await fixture(t);
  const config = await initialize(root, { ownerEmail: 'Owner@example.invalid' });
  assert.equal(config.ownerEmail, 'owner@example.invalid');
  assert.equal(config.port, 18787);
  const saved = await readFile(join(root, 'data/config.json'), 'utf8');
  await assert.rejects(initialize(root, { ownerEmail: 'other@example.invalid' }), { code: 'EEXIST' });
  assert.equal(await readFile(join(root, 'data/config.json'), 'utf8'), saved);
  const env = applicationEnvironment(root, config, {
    Path: 'system-path', NODE_OPTIONS: '--require=untrusted', DATABASE_URL: 'postgres://remote', HOST: '0.0.0.0',
    BETTER_AUTH_SECRET: 'wrong', CLASSROOM_AUTH_ENABLED: 'false', CLASSROOM_TEACHER_IDS: 'remote', GROK_AUTH_CLIENT_SECRET: 'remote',
  });
  assert.equal(env.Path, 'system-path');
  assert.equal(env.DATABASE_URL, ''); assert.equal(env.HOST, '127.0.0.1'); assert.equal(env.NITRO_HOST, '127.0.0.1');
  assert.equal(env.NODE_ENV, 'production'); assert.equal(env.CLASSROOM_AUTH_ENABLED, 'true');
  assert.equal(env.BETTER_AUTH_SECRET, config.authSecret); assert.equal(env.CLASSROOM_LOCAL_ONLY, 'true');
  assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.GROK_AUTH_CLIENT_SECRET, undefined); assert.equal(env.CLASSROOM_TEACHER_IDS, undefined);
  assert.equal(env.PGLITE_DATA_DIR, join(root, 'data/pglite'));
  assert.throws(() => validateConfig({ ...config, port: 8790 }));
  assert.throws(() => validateConfig({ ...config, authSecret: '' }));
  assert.throws(() => validateConfig({ ...config, ownerEmail: '\ninvalid' }));
});

test('launcher and backup exclusion uses a live OS lock; completed backup matches every data file', async t => {
  const root = await fixture(t);
  await initialize(root, { ownerEmail: 'owner@example.invalid' });
  const release = await acquireLock(root);
  try { await assert.rejects(acquireLock(root), /正在執行或備份/); } finally { await release(); }
  const releaseAgain = await acquireLock(root);
  try {
    await writeFile(join(root, 'data/pglite.lock'), '{"pid":1}');
    await assert.rejects(backup(root), /資料庫鎖/);
    await rm(join(root, 'data/pglite.lock'));
    await mkdir(join(root, 'data/pglite'));
    await writeFile(join(root, 'data/pglite/fixture'), 'preserve learner data');
    const result = await backup(root);
    const manifest = JSON.parse(await readFile(join(result.target, 'backup-manifest.json'), 'utf8'));
    assert.equal(manifest.complete, true); assert.equal(manifest.files.length, 3);
    for (const file of manifest.files) {
      const expected = await readFile(join(root, file.path));
      const actual = await readFile(join(result.target, file.path));
      assert.deepEqual(actual, expected);
      assert.equal(createHash('sha256').update(actual).digest('hex'), file.sha256);
    }
  } finally { await releaseAgain(); }
});

test('portable manifest rejects missing, changed and extra executable files', async t => {
  const root = await fixture(t);
  for (const name of ['server/index.mjs', 'server/_libs/pglite.wasm', 'launcher.mjs', 'app-runner.mjs']) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), 'fixture');
  }
  const files = [];
  for (const path of await filesIn(root)) files.push({ path, sha256: createHash('sha256').update(await readFile(join(root, path))).digest('hex') });
  await writeFile(join(root, 'package-manifest.json'), JSON.stringify({ format: 1, files }));
  await verifyPackage(root);
  await writeFile(join(root, 'server/extra.mjs'), 'extra');
  await assert.rejects(verifyPackage(root), /未列入清單/);
  await rm(join(root, 'server/extra.mjs'));
  await writeFile(join(root, 'server/index.mjs'), 'changed');
  await assert.rejects(verifyPackage(root), /核對失敗/);
  await rm(join(root, 'server/index.mjs'));
  await assert.rejects(verifyPackage(root));
});
