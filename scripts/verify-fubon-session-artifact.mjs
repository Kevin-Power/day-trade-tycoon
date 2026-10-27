// Read saved metadata only. Integrity PASS is not market/session PASS.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const sha = value => createHash('sha256').update(value).digest('hex');
export function verifySessionArtifact(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
  const raw = readFileSync(join(directory, 'events.jsonl'), 'utf8');
  const records = raw.trimEnd().split('\n').map(line => JSON.parse(line));
  const errors = []; let previous = '0'.repeat(64);
  records.forEach((record, index) => {
    const { sha256, ...content } = record;
    if (content.sequence !== index + 1 || content.previousSha256 !== previous || sha(JSON.stringify(content)) !== sha256) errors.push(`CHAIN:${index + 1}`);
    previous = sha256;
  });
  if (!raw.endsWith('\n')) errors.push('INCOMPLETE_LAST_LINE');
  if (summary.events?.count !== records.length || summary.events?.finalSha256 !== previous) errors.push('SUMMARY_CHAIN_MISMATCH');
  if (manifest.runId !== summary.runId || manifest.date !== summary.date) errors.push('RUN_IDENTITY');
  if (!['PASS', 'INCOMPLETE', 'REVIEW_REQUIRED'].includes(summary.status) || typeof summary.passed !== 'boolean' || summary.passed !== (summary.status === 'PASS') || summary.readOnly !== true || summary.orderRequests !== 0) errors.push('INVALID_STATUS_OR_SCOPE');
  if (JSON.stringify(manifest.policy) !== JSON.stringify(summary.policy) || JSON.stringify(manifest.hashes) !== JSON.stringify(summary.provenance)) errors.push('MANIFEST_MISMATCH');
  if (records.filter(e => e.type === 'start').length !== 1 || records.filter(e => e.type === 'finish').length !== 1 || records.at(-1)?.type !== 'finish') errors.push('LIFECYCLE');
  if (records.at(-1)?.status !== summary.status || records.at(-1)?.at !== summary.finishedAt) errors.push('FINISH_MISMATCH');
  const minutes = records.filter(e => e.type === 'minute');
  const indices = new Set(minutes.map(m => m.index));
  if (indices.size !== minutes.length || summary.coverageMinutes !== minutes.length || summary.coveredSeconds !== minutes.reduce((n, m) => n + m.coveredSeconds, 0)) errors.push('COVERAGE_MISMATCH');
  if (summary.passed) {
    if (summary.status !== 'PASS' || summary.incomplete?.length || summary.review?.length || !summary.readOnly || summary.orderRequests !== 0) errors.push('INVALID_PASS');
    if (minutes.length !== 270 || minutes.some(m => !Number.isInteger(m.index) || m.index < 0 || m.index >= 270 || m.coveredSeconds !== 60 || m.at !== new Date(manifest.window.open + m.index * 60000).toISOString())) errors.push('PASS_WITH_MISSING_COVERAGE');
    const started = Date.parse(summary.startedAt), finished = Date.parse(summary.finishedAt);
    const expectedOpen = Date.parse(`${summary.date}T09:00:00+08:00`), expectedStop = Date.parse(`${summary.date}T13:35:00+08:00`);
    if (![started, finished, expectedOpen, expectedStop].every(Number.isFinite) || started >= finished || manifest.window.open !== expectedOpen || manifest.window.stop !== expectedStop || started > expectedOpen || finished < expectedStop || summary.reason !== 'scheduled_end') errors.push('PASS_WITH_INCOMPLETE_WINDOW');
    const provenance = records.filter(e => e.type === 'provenance');
    if (!provenance.some(e => e.stage === 'before_import') || !provenance.some(e => e.stage === 'finish') || provenance.some(e => !e.matching || JSON.stringify(e.hashes) !== JSON.stringify(manifest.hashes))) errors.push('PASS_WITHOUT_STABLE_SOURCE');
  }
  return { integrityVerified: errors.length === 0, errors, recordedSessionStatus: summary.status,
    recordedSessionPassed: summary.passed, productionUiVerified: false, runId: summary.runId,
    eventsFileSha256: sha(raw), manifestFileSha256: sha(readFileSync(join(directory, 'manifest.json'))),
    summaryFileSha256: sha(readFileSync(join(directory, 'summary.json'))) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error('Run directory required');
    const result = verifySessionArtifact(resolve(process.argv[2]));
    console.log(JSON.stringify(result, null, 2));
    if (!result.integrityVerified) process.exitCode = 1;
  } catch { console.error(JSON.stringify({ integrityVerified: false, errors: ['MISSING_OR_INVALID_ARTIFACT'] })); process.exitCode = 1; }
}
