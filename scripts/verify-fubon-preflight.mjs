// Read-only release/HTTP evidence. This script never logs in or sends orders.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve, relative, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const sha256 = data => createHash('sha256').update(data).digest('hex');
export const DEFAULT_BASELINE = 'artifacts/fubon-session-preflight-full-2026-10-24.json';
const ORIGIN = 'https://rich.yilutek.com';
const HASH = /^[a-f0-9]{64}$/;
const RELEASE = /^\d{8}T\d{9}Z$/;
const normalizePath = path => typeof path === 'string' ? path.replaceAll('\\', '/') : '';

export function parsePreflightArgs(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true,
    options: { baseline: { type: 'string', default: DEFAULT_BASELINE }, 'baseline-sha256': { type: 'string' } } });
  if (positionals.length > 1) throw new Error('Only one output filename may be supplied.');
  if (!values.baseline.trim()) throw new Error('A baseline filename is required.');
  if (values['baseline-sha256'] !== undefined && !HASH.test(values['baseline-sha256'])) throw new Error('Invalid baseline SHA-256.');
  return { output: resolve(positionals[0] ?? `artifacts/fubon-preflight-${new Date().toISOString().replaceAll(':', '-')}.json`),
    baselinePath: resolve(values.baseline), baselineSha256: values['baseline-sha256'] ?? null };
}

/** Validate an already-reviewed receipt. Never derive approval from the active
 * hosting configuration, or write a new baseline as part of the preflight. */
export function validatePreflightBaseline(baseline) {
  if (!baseline || baseline.passed !== true || baseline.productionOrigin !== ORIGIN) throw new Error('Baseline must be a passed receipt for the expected production origin.');
  const entry = normalizePath(baseline.appEntry);
  const entryMatch = /\/releases\/([^/]+)\/server\/index\.mjs$/.exec(entry);
  if (!entryMatch || !/^(?:[A-Za-z]:\/|\/)/.test(entry) || !RELEASE.test(entryMatch[1]) || entry.split('/').some(part => part === '..' || part === '.')) throw new Error('Invalid baseline release entry.');
  const expectedRelease = baseline.expectedRelease === undefined ? entryMatch[1] : baseline.expectedRelease;
  if (typeof expectedRelease !== 'string' || !RELEASE.test(expectedRelease) || expectedRelease !== entryMatch[1]) throw new Error('Baseline expectedRelease conflicts with appEntry.');
  if (!HASH.test(baseline.releaseTreeSha256) || !HASH.test(baseline.releaseEntrySha256) || !Array.isArray(baseline.releaseFiles) || !baseline.releaseFiles.length) throw new Error('Incomplete baseline release hashes.');
  let previous = '';
  for (const file of baseline.releaseFiles) {
    if (!file || typeof file.path !== 'string' || !file.path || /[\\:]/.test(file.path) ||
        file.path.split('/').some(part => !part || part === '..' || part === '.') || !HASH.test(file.sha256) ||
        Object.keys(file).length !== 2 || !(file.path > previous)) throw new Error('Baseline release files must be unique, sorted and canonical.');
    previous = file.path;
  }
  if (sha256(JSON.stringify(baseline.releaseFiles)) !== baseline.releaseTreeSha256) throw new Error('Baseline tree hash does not match its file list.');
  const files = new Map(baseline.releaseFiles.map(file => [file.path, file.sha256]));
  if (files.get('server/index.mjs') !== baseline.releaseEntrySha256 ||
      files.get('server/fubon-live/worker.py') !== baseline.formalWorker?.sha256 ||
      normalizePath(baseline.formalWorker?.path) !== entry.replace(/index\.mjs$/, 'fubon-live/worker.py')) throw new Error('Baseline entry or worker does not match its file list.');
  return { expectedRelease, releaseTreeSha256: baseline.releaseTreeSha256 };
}

export function readPreflightBaseline(path, expectedSha256 = null) {
  const bytes = readFileSync(path), observedSha256 = sha256(bytes);
  if (expectedSha256 !== null && (!HASH.test(expectedSha256) || expectedSha256 !== observedSha256)) throw new Error('Baseline SHA-256 does not match the supplied seal.');
  const baseline = JSON.parse(bytes.toString('utf8'));
  return { ...validatePreflightBaseline(baseline), baselineSha256: observedSha256 };
}

export async function runPreflight(args = process.argv.slice(2)) {
const { output, baselinePath, baselineSha256: expectedBaselineSha256 } = parsePreflightArgs(args);
if (existsSync(output)) throw new Error('Evidence exists; choose a new output filename.');
const baseline = readPreflightBaseline(baselinePath, expectedBaselineSha256);
const service = join(homedir(), 'YilutekServices/DayTradeTycoon');
const hosting = JSON.parse(readFileSync(join(service, 'hosting.json'), 'utf8'));
if (hosting.publicUrl !== ORIGIN) throw new Error('Unexpected production origin.');
const formalWorker = join(dirname(hosting.appEntry), 'fubon-live/worker.py');
const workspaceWorker = resolve('tools/fubon-live/worker.py');
const releaseRoot = dirname(dirname(hosting.appEntry));
const releaseFiles = [];
function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile()) releaseFiles.push({ path: relative(releaseRoot, file).replaceAll('\\', '/'), sha256: digest(file) });
    else throw new Error('Release contains an unexpected link or special file.');
  }
}
walk(releaseRoot);
releaseFiles.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const releaseTreeSha256 = createHash('sha256').update(JSON.stringify(releaseFiles)).digest('hex');
const normalize = text => text.replaceAll('\r\n', '\n').replace('channel=key[0], sourceEvent=event, data=project(data)', 'channel=key[0], data=project(data)');
const result = {
  checkedAt: new Date().toISOString(), scope: 'read-only production preflight',
  productionOrigin: hosting.publicUrl, appEntry: hosting.appEntry,
  releaseEntrySha256: digest(hosting.appEntry),
  expectedRelease: baseline.expectedRelease,
  expectedReleaseMatches: basename(releaseRoot) === baseline.expectedRelease,
  baselinePath, baselineSha256: baseline.baselineSha256, baselineSealProvided: expectedBaselineSha256 !== null,
  releaseTreeMatchesPreparation: releaseTreeSha256 === baseline.releaseTreeSha256,
  releaseFiles, releaseTreeSha256,
  formalWorker: { path: formalWorker, sha256: digest(formalWorker) },
  collectorWorker: { path: workspaceWorker, sha256: digest(workspaceWorker) },
  workerLogicEqualExceptSourceEvent: normalize(readFileSync(formalWorker, 'utf8')) === normalize(readFileSync(workspaceWorker, 'utf8')),
  orderRequestSent: false, brokerLoginStarted: false, authenticatedProductionUi: 'NOT_CHECKED',
  http: [],
};
for (const [path, expectedStatus] of [['/api/health', 200], ['/api/broker/quotes?access=1', 403], ['/fubon-live/worker.py', 404]]) {
  try {
    const response = await fetch(new URL(path, hosting.publicUrl), { redirect: 'manual', signal: AbortSignal.timeout(10000), cache: 'no-store' });
    result.http.push({ path, status: response.status, expectedStatus, ok: response.status === expectedStatus });
    await response.body?.cancel();
  } catch { result.http.push({ path, expectedStatus, ok: false, error: 'HTTP_UNAVAILABLE' }); }
}
result.passed = result.expectedReleaseMatches && result.releaseTreeMatchesPreparation && result.workerLogicEqualExceptSourceEvent && result.http.every(check => check.ok);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ passed: result.passed, output, http: result.http, workerLogicEqualExceptSourceEvent: result.workerLogicEqualExceptSourceEvent }));
if (!result.passed) process.exitCode = 1;
return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runPreflight();
