import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => readFile(path.join(root, file));
const manifest = JSON.parse(await read('manifest.json'));
const data = JSON.parse(await read('observations.json'));
for (const line of (await read('checksums.sha256')).toString().trim().split(/\r?\n/)) {
  const [, expected, file] = line.match(/^([a-f0-9]{64})  (.+)$/) ?? [];
  assert.ok(file && !file.includes('..') && !path.isAbsolute(file));
  assert.equal(hash(await read(file)), expected, `checksum ${file}`);
}
for (const resource of manifest.downloads) {
  const bytes = await read(resource.path);
  assert.equal(bytes.length, resource.bytes);
  assert.equal(hash(bytes), resource.sha256);
  assert.equal(resource.status, 200);
  assert.ok(Number.isFinite(Date.parse(resource.fetchedAt)));
}
const result = [];
const observedSets = [];
for (const definition of manifest.series) {
  const rows = data.observations.filter(row => row.symbol === definition.symbol);
  const rawRows = (await read(`raw/fred-${definition.symbol}.csv`)).toString().trimEnd().split(/\r?\n/).slice(1);
  assert.equal(rows.length, rawRows.length);
  const byDate = new Map(rows.map(row => [row.date, row]));
  assert.equal(byDate.size, rows.length);
  for (const line of rawRows) {
    const [date, value] = line.split(',');
    const row = byDate.get(date);
    const missing = value === '' || value === '.';
    assert.equal(row.valueText, missing ? null : value);
    assert.equal(row.value, missing ? null : Number(value));
    assert.equal(row.status, missing ? 'missing-in-source' : 'observed');
    assert.equal(row.availableAt, null);
    assert.ok(row.date <= '2026-10-05');
  }
  const valid = rows.filter(row => row.value !== null);
  assert.equal(valid.length, 67);
  assert.equal(definition.validCount, valid.length);
  const source = (await read(`raw/fred-${definition.symbol}.html`)).toString();
  const displayedValue = source.match(/class="series-meta-observation-value">([^<]+)<\/span>/)?.[1];
  assert.equal(Number(displayedValue.replaceAll(',', '')), definition.lastValue, 'CSV latest value matches official source HTML');
  assert.ok(source.includes(definition.sourceUpdatedAt));
  assert.equal(definition.strictLessonCutoffEligibility, 'not-verified');
  observedSets.push(new Set(valid.map(row => row.date)));
  result.push({ symbol: definition.symbol, rawRows: rawRows.length, validObservations: valid.length, rawBlankRows: rows.length - valid.length,
    firstDate: valid[0].date, lastDate: valid.at(-1).date, sourcePageLatestValueMatchesCsv: true,
    sourceUpdatedAt: definition.sourceUpdatedAt, sourceUpdatedAtTaipei: definition.sourceUpdatedAtTaipei,
    strictLessonCutoffEligibility: definition.strictLessonCutoffEligibility });
}
assert.equal(manifest.series.find(row => row.symbol === 'NASDAQSOX').kind, 'daily-index-value');
assert.equal(manifest.series.find(row => row.symbol === 'NASDAQCOM').latestSeriesUpdateBeforeLessonCutoff, false);
assert.equal(manifest.series.find(row => row.symbol === 'NASDAQSOX').latestSeriesUpdateBeforeLessonCutoff, false);
const nasdaq = (await read('raw/nasdaq-SOX-overview.html')).toString();
const nasdaqValue = Number(nasdaq.match(/data-current-value="([^"]+)"/)?.[1]?.replaceAll(',', ''));
assert.equal(nasdaqValue, manifest.series.find(row => row.symbol === 'NASDAQSOX').lastValue);
assert.match(nasdaq, /DATA AS OF 10\/5\/2026/);
const commonDates = [...observedSets[0]].filter(date => observedSets.every(dates => dates.has(date)));
assert.equal(commonDates.length, 67);
const report = { validatedAt: new Date().toISOString(), passed: true, sha256Checks: manifest.downloads.length,
  records: data.observations.length, validNumericRecords: data.observations.filter(row => row.value !== null).length,
  missingRecords: data.observations.filter(row => row.value === null).length,
  zeroValueRecords: data.observations.filter(row => row.value === 0).length,
  commonObservedDates: commonDates.length, latestSoxOfficialPublisherValueMatchesFred: true, series: result,
  strictPremarketApproval: false, emaOrXiaomaCalculationPerformed: false };
await writeFile(path.join(root, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
async function pathsIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? pathsIn(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))).flat();
}
const paths = (await pathsIn(root)).filter(file => path.basename(file) !== 'checksums.sha256').sort();
await writeFile(path.join(root, 'checksums.sha256'), (await Promise.all(paths.map(async file => `${hash(await readFile(file))}  ${path.relative(root, file).replaceAll('\\', '/')}`))).join('\n') + '\n');
console.log(JSON.stringify(report, null, 2));
