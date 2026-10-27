import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_BASELINE, parsePreflightArgs, readPreflightBaseline, validatePreflightBaseline } from './verify-fubon-preflight.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
function receipt(release = '20261024T020000000Z') {
  const appEntry = `C:\\Users\\fixture\\service\\releases\\${release}\\server\\index.mjs`;
  const releaseFiles = [{ path: 'server/fubon-live/worker.py', sha256: sha('readonly worker') },
    { path: 'server/index.mjs', sha256: sha('compiled entry') }];
  return { passed: true, productionOrigin: 'https://rich.yilutek.com', appEntry,
    releaseEntrySha256: releaseFiles[1].sha256, releaseFiles,
    releaseTreeSha256: sha(JSON.stringify(releaseFiles)),
    formalWorker: { path: appEntry.replace('index.mjs', 'fubon-live\\worker.py'), sha256: releaseFiles[0].sha256 } };
}

test('existing positional output and historical default baseline remain unchanged', () => {
  const parsed = parsePreflightArgs(['artifacts/new-receipt.json']);
  assert.equal(parsed.output, resolve('artifacts/new-receipt.json'));
  assert.equal(parsed.baselinePath, resolve(DEFAULT_BASELINE)); assert.equal(parsed.baselineSha256, null);
  const historical = validatePreflightBaseline(receipt('20261022T230320858Z'));
  assert.equal(historical.expectedRelease, '20261022T230320858Z');
});

test('explicit baseline and optional seal work before or after the output argument', () => {
  for (const args of [['artifacts/new.json', '--baseline', 'artifacts/new-baseline.json'],
    ['--baseline', 'artifacts/new-baseline.json', 'artifacts/new.json']]) {
    const result = parsePreflightArgs([...args, '--baseline-sha256', 'a'.repeat(64)]);
    assert.equal(result.baselinePath, resolve('artifacts/new-baseline.json')); assert.equal(result.baselineSha256, 'a'.repeat(64));
  }
  assert.throws(() => parsePreflightArgs(['one', 'two']));
  assert.throws(() => parsePreflightArgs(['--baseline-sha256', 'not-a-hash']));
  assert.throws(() => parsePreflightArgs(['--unexpected-flag']));
});

test('release comes from baseline appEntry and explicit expectedRelease must agree', () => {
  const data = receipt();
  assert.equal(validatePreflightBaseline(data).expectedRelease, '20261024T020000000Z');
  data.expectedRelease = '20261024T020000000Z'; assert.equal(validatePreflightBaseline(data).expectedRelease, data.expectedRelease);
  data.expectedRelease = '20261022T230320858Z'; assert.throws(() => validatePreflightBaseline(data), /conflicts/);
  data.expectedRelease = null; assert.throws(() => validatePreflightBaseline(data), /conflicts/);
});

test('wrong origin, unpassed receipts and incomplete entry/worker evidence are rejected', () => {
  for (const change of [d => { d.passed = false; }, d => { d.productionOrigin = 'https://untrusted.invalid'; },
    d => { d.releaseEntrySha256 = 'a'.repeat(64); }, d => { d.formalWorker.sha256 = 'b'.repeat(64); },
    d => { d.formalWorker.path = 'C:\\wrong\\worker.py'; }, d => { d.appEntry = 'server/index.mjs'; },
    d => { d.appEntry = d.appEntry.replace('releases', 'releases\\..\\releases'); }]) {
    const data = receipt(); change(data); assert.throws(() => validatePreflightBaseline(data));
  }
});

test('file-list tampering, duplicate, unsorted and path traversal baselines fail closed', () => {
  for (const change of [d => { d.releaseFiles[0].sha256 = 'a'.repeat(64); },
    d => { d.releaseFiles.push(d.releaseFiles[0]); }, d => { d.releaseFiles.reverse(); },
    d => { d.releaseFiles[0].path = '../worker.py'; }, d => { d.releaseFiles[0].extra = true; }]) {
    const data = receipt(); change(data); assert.throws(() => validatePreflightBaseline(data));
  }
});

test('explicit seal rejects changed baseline bytes without modifying the original', () => {
  const folder = mkdtempSync(join(tmpdir(), 'fubon-preflight-test-'));
  try {
    const file = join(folder, 'sealed.json'), contents = JSON.stringify(receipt());
    writeFileSync(file, contents, { flag: 'wx' });
    const result = readPreflightBaseline(file, sha(contents)); assert.equal(result.baselineSha256, sha(contents));
    assert.throws(() => readPreflightBaseline(file, 'a'.repeat(64)), /seal/);
    assert.equal(readPreflightBaseline(file).expectedRelease, '20261024T020000000Z');
  } finally {
    const cleanupPath = resolve(folder);
    assert.equal(dirname(cleanupPath), resolve(tmpdir()));
    assert.ok(basename(cleanupPath).startsWith('fubon-preflight-test-'));
    rmSync(cleanupPath, { recursive: true, force: true });
  }
});
