#!/usr/bin/env node
/** Read-only check: private minute bars must not enter public assets or offline ZIPs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync, inflateRawSync } from 'node:zlib';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const datasetPath = 'server/data/morning-2026-10-06.json';
const maxEntryBytes = 128 * 1024 * 1024;
const maxArchiveBytes = 512 * 1024 * 1024;
const numberSource = '-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';

function normalizedText(value) {
  return value.replace(/\\u002[fF]/g, '/').replace(/\\u005[cC]/g, '/')
    .replace(/\\["']/g, '"').replace(/\\\//g, '/').replace(/\\+/g, '/');
}

function forbiddenPath(path) {
  let text = normalizedText(path);
  try { text = decodeURIComponent(text); } catch { /* Literal file names may contain %. */ }
  return /(?:^|\/)(?:research|raw|sourcephotos|morning[-_]?data)(?:\/|$)/i.test(text)
    || /(?:^|\/)morning-\d{4}-\d{2}-\d{2}\.json(?:$|[?#])/i.test(text)
    || /(?:^|\/)server\/data(?:\/|$)/i.test(text);
}

export function tailFingerprints(dataset) {
  const symbols = dataset.catalog?.symbols;
  assert.ok(Array.isArray(symbols) && symbols.length > 0, 'Missing catalog symbols.');
  const seen = new Set();
  return symbols.map(({ code }) => {
    assert.ok(typeof code === 'string' && !seen.has(code), 'Invalid/duplicate symbol.');
    seen.add(code);
    const bars = dataset.bars?.[code];
    assert.ok(Array.isArray(bars) && bars.length >= 2, `Missing minute bars for ${code}.`);
    const tail = bars.slice(-2);
    assert.ok(tail.every(bar => ['t', 'o', 'h', 'l', 'c', 'v'].every(key => Number.isFinite(bar[key]))), `Invalid tail for ${code}.`);
    assert.equal(tail[1].t - tail[0].t, 60, `Last bars are not consecutive minutes for ${code}.`);
    return { code, bars: tail, key: tail.map(bar => [bar.o, bar.h, bar.l, bar.c].join(',')).join('|') };
  });
}

function objectBarKeys(text) {
  const result = [];
  for (const match of text.matchAll(/\{[^{}]{1,2048}\}/g)) {
    const values = {};
    const properties = new RegExp(`(?:^|[,\\s{])["']?(o|h|l|c|open|high|low|close)["']?\\s*:\\s*(${numberSource})(?=\\s*[,}])`, 'gi');
    for (const property of match[0].matchAll(properties)) {
      values[property[1].toLowerCase()[0]] = Number(property[2]);
    }
    if (['o', 'h', 'l', 'c'].every(key => Number.isFinite(values[key]))) {
      result.push({ key: [values.o, values.h, values.l, values.c].join(','), end: match.index + match[0].length, start: match.index });
    }
  }
  return result;
}

function arrayBarKeys(text) {
  const result = [];
  const row = new RegExp(`\\[\\s*(${numberSource}(?:\\s*,\\s*${numberSource}){3,5})\\s*\\]`, 'gi');
  for (const match of text.matchAll(row)) {
    const numbers = match[1].split(',').map(Number);
    // Accept OHLC, OHLCV, and timestamp + OHLC(V) serializations.
    const candidates = numbers.length === 4 ? [numbers] : numbers.length === 5
      ? [numbers.slice(0, 4), numbers.slice(1, 5)] : [numbers.slice(1, 5)];
    result.push({ keys: candidates.map(values => values.join(',')), end: match.index + match[0].length, start: match.index });
  }
  return result;
}

export function inspectContent(bytes, fingerprints, markers) {
  const text = normalizedText(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes));
  const lower = text.toLowerCase();
  const findings = markers.filter(marker => lower.includes(marker.toLowerCase())).map(() => 'private source path');
  const targets = new Map(fingerprints.map(item => [item.key, item.code]));
  const hits = new Set();
  for (const records of [objectBarKeys(text), arrayBarKeys(text)]) {
    for (let index = 1; index < records.length; index++) {
      const previous = records[index - 1];
      const current = records[index];
      // The two source bars must be adjacent, not numbers scattered through a bundle.
      if (current.start - previous.end > 256) continue;
      for (const first of previous.keys ?? [previous.key]) {
        for (const second of current.keys ?? [current.key]) {
          const code = targets.get(`${first}|${second}`);
          if (code) hits.add(code);
        }
      }
    }
  }
  return [...new Set(findings), ...[...hits].map(code => `future-minute OHLC fingerprint (${code})`)];
}

/** Read central-directory entries in memory; never extract files onto the host. */
export function zipEntries(bytes) {
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) {
      end = offset;
      break;
    }
  }
  assert.ok(end >= 0, 'ZIP has no valid end record.');
  assert.equal(bytes.readUInt16LE(end + 4), 0, 'Multi-disk ZIP is unsupported.');
  assert.equal(bytes.readUInt16LE(end + 6), 0, 'Multi-disk ZIP is unsupported.');
  const count = bytes.readUInt16LE(end + 10);
  assert.equal(bytes.readUInt16LE(end + 8), count, 'ZIP entry count mismatch.');
  const centralSize = bytes.readUInt32LE(end + 12);
  let offset = bytes.readUInt32LE(end + 16);
  assert.ok(count !== 0xffff && centralSize !== 0xffffffff && offset !== 0xffffffff, 'ZIP64 requires a separate verifier.');
  const centralEnd = offset + centralSize;
  assert.ok(count > 0 && centralEnd <= end, 'ZIP central directory is empty or out of bounds.');
  let totalBytes = 0;
  const entries = [];
  for (let index = 0; index < count; index++) {
    assert.ok(offset + 46 <= centralEnd && bytes.readUInt32LE(offset) === 0x02014b50, 'Invalid ZIP directory entry.');
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    assert.ok(next <= centralEnd, 'Truncated ZIP entry name.');
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    assert.equal(flags & 1, 0, `Encrypted ZIP entry: ${name}`);
    assert.ok(method === 0 || method === 8, `Unsupported ZIP compression: ${name}`);
    assert.ok(local + 30 <= bytes.length && bytes.readUInt32LE(local) === 0x04034b50, `Missing local ZIP header: ${name}`);
    assert.ok(size <= maxEntryBytes && totalBytes + size <= maxArchiveBytes, `ZIP content exceeds verification limit: ${name}`);
    totalBytes += size;
    const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    assert.ok(dataStart + compressedSize <= bytes.length, `Truncated ZIP content: ${name}`);
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const content = method === 8 ? inflateRawSync(compressed, { maxOutputLength: maxEntryBytes }) : compressed;
    assert.equal(content.length, size, `ZIP content size mismatch: ${name}`);
    entries.push({ name, content });
    offset = next;
  }
  assert.equal(offset, centralEnd, 'ZIP directory size mismatch.');
  return entries;
}

function positiveControls(fingerprints, markers) {
  for (const item of fingerprints) {
    const expected = `future-minute OHLC fingerprint (${item.code})`;
    const json = JSON.stringify(item.bars);
    const minified = json.replace(/"([tohlcv])":/g, '$1:');
    const reordered = JSON.stringify(item.bars.map(bar => ({ c: bar.c, l: bar.l, h: bar.h, o: bar.o, t: bar.t })));
    const rows = JSON.stringify(item.bars.map(bar => [bar.t, bar.o, bar.h, bar.l, bar.c, bar.v]));
    for (const sample of [json, minified, reordered, JSON.stringify(json), rows]) {
      assert.ok(inspectContent(sample, fingerprints, markers).includes(expected), `Fingerprint positive control failed for ${item.code}.`);
    }
  }
  assert.ok(inspectContent(JSON.stringify(markers[0]), fingerprints, markers).includes('private source path'));
  assert.deepEqual(inspectContent('route="/morning";title="真實早盤練習";lesson="morning-20261006-v1"', fingerprints, markers), []);
  for (const path of ['research/raw.json', 'assets/sourcephotos/photo.jpg', 'raw', 'morningdata/private.json']) {
    assert.ok(forbiddenPath(path), `Path positive control failed: ${path}`);
  }
  assert.equal(forbiddenPath('assets/morning-page-client.js'), false);
}

function privateDatasets(root) {
  const files = readdirSync(join(root, 'server/data')).filter(name => /^morning-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
  assert.ok(files.includes(basename(datasetPath)), 'The original lesson must remain available.');
  return files.map(name => {
    const path = `server/data/${name}`;
    const bytes = readFileSync(join(root, path));
    return { path, bytes, dataset: JSON.parse(bytes.toString('utf8')) };
  });
}

export function verifyMorningBuild(root = workspace) {
  const datasets = privateDatasets(root);
  const fingerprints = datasets.flatMap(item => tailFingerprints(item.dataset));
  const markers = ['server/data/', ...datasets.flatMap(item => [item.path, basename(item.path), ...(item.dataset.provenance?.sourcePaths ?? [])])];
  assert.ok(markers.every(marker => typeof marker === 'string' && marker.length > 0), 'Invalid private source markers.');
  positiveControls(fingerprints, markers);
  const failures = [];
  const stats = { publicFiles: 0, builtFiles: 0, frontendJsFiles: 0, zipEntries: 0, compressedFiles: 0 };
  const archiveHashes = [];
  const missingOfflineArchives = [];
  const inspect = (name, bytes, depth = 0) => {
    if (forbiddenPath(name)) failures.push(`${name}: forbidden private-data path`);
    if (depth > 3) throw new Error(`Nested archive limit exceeded: ${name}`);
    if (/\.gz$/i.test(name)) {
      stats.compressedFiles++;
      inspect(name.slice(0, -3), gunzipSync(bytes, { maxOutputLength: maxEntryBytes }), depth + 1);
    } else if (/\.br$/i.test(name)) {
      stats.compressedFiles++;
      inspect(name.slice(0, -3), brotliDecompressSync(bytes, { maxOutputLength: maxEntryBytes }), depth + 1);
    } else if (/\.zip$/i.test(name) || (bytes.length > 4 && bytes.readUInt32LE(0) === 0x04034b50)) {
      for (const entry of zipEntries(bytes)) {
        stats.zipEntries++;
        inspect(`${name}!/${entry.name}`, entry.content, depth + 1);
      }
    } else {
      for (const finding of inspectContent(bytes, fingerprints, markers)) failures.push(`${name}: ${finding}`);
    }
  };
  const walk = (directory, kind) => {
    assert.ok(existsSync(directory), `Missing required ${kind} directory: ${relative(root, directory)}`);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const label = relative(root, path).replaceAll('\\', '/');
      assert.ok(!lstatSync(path).isSymbolicLink(), `Public symlink cannot be verified: ${label}`);
      if (entry.isDirectory()) {
        if (forbiddenPath(label)) failures.push(`${label}: forbidden private-data directory`);
        walk(path, kind);
      } else {
        stats[kind]++;
        if (kind === 'builtFiles' && /\.m?js$/i.test(label)) stats.frontendJsFiles++;
        inspect(label, readFileSync(path));
      }
    }
  };
  walk(join(root, 'public'), 'publicFiles');
  walk(join(root, '.output/public'), 'builtFiles');
  assert.ok(stats.frontendJsFiles > 0, 'No frontend JavaScript assets found; build verification is incomplete.');
  for (const archive of ['downloads/daytrade-tycoon-offline.zip', '.output/downloads/daytrade-tycoon-offline.zip']) {
    const path = join(root, archive);
    if (!existsSync(path)) {
      missingOfflineArchives.push(archive);
      continue;
    }
    const bytes = readFileSync(path);
    assert.ok(bytes.length > 0, `Empty offline ZIP: ${archive}`);
    inspect(archive, bytes);
    archiveHashes.push({ path: archive, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  if (failures.length) throw new Error(`Private morning data leaked into distributable files:\n${[...new Set(failures)].join('\n')}`);
  return {
    ok: true,
    datasets: datasets.map(item => ({ path: item.path, sha256: createHash('sha256').update(item.bytes).digest('hex') })),
    symbols: [...new Set(fingerprints.map(item => item.code))],
    fingerprint: 'last two consecutive minute OHLC bars per symbol; object/array/string/minified forms',
    ...stats,
    offlineArchives: archiveHashes,
    missingOfflineArchives,
    offlineVerified: archiveHashes.length > 0,
    scope: 'Artifact contents only; API time-gating and live deployment require separate checks.',
  };
}

function fixtureZip(content) {
  const name = Buffer.from('DayTradeTycoon/app/assets/morning-page.js');
  const bytes = Buffer.from(content);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(bytes.length, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(bytes.length, 20);
  central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + bytes.length, 16);
  return Buffer.concat([local, name, bytes, central, name, end]);
}

/** Reproducible end-to-end negative controls; production build files are never written. */
export function mutationSelfTest(root = workspace) {
  const fixture = mkdtempSync(join(tmpdir(), 'verify-morning-build-'));
  const datasets = privateDatasets(root);
  const dataset = datasets.find(item => item.path === datasetPath).dataset;
  const fingerprints = datasets.flatMap(item => tailFingerprints(item.dataset));
  const safeUi = 'export const route = "/morning"; export const label = "真實早盤練習";';
  const baselineZip = fixtureZip(safeUi);
  const checks = [];
  const put = (path, bytes) => {
    const target = join(fixture, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  };
  const mutation = (label, path, bytes, expected) => {
    const original = readFileSync(join(fixture, path));
    put(path, bytes);
    try {
      assert.throws(() => verifyMorningBuild(fixture), expected, label);
      checks.push(label);
    } finally {
      put(path, original);
    }
  };
  try {
    for (const item of datasets) put(item.path, item.bytes);
    put('public/client.js', safeUi);
    put('.output/public/assets/morning-page.js', safeUi);
    put('downloads/daytrade-tycoon-offline.zip', baselineZip);
    put('.output/downloads/daytrade-tycoon-offline.zip', baselineZip);
    assert.equal(verifyMorningBuild(fixture).ok, true);
    checks.push('baseline UI containing morning is accepted');
    for (const item of fingerprints) {
      mutation(`built public rejects ${item.code} future OHLC`, '.output/public/assets/morning-page.js',
        `const bars=${JSON.stringify(item.bars).replace(/"([tohlcv])":/g, '$1:')};`, /future-minute OHLC fingerprint/);
    }
    mutation('source public rejects private server path', 'public/client.js',
      `const source=${JSON.stringify(datasetPath)};`, /private source path/);
    mutation('offline download rejects future OHLC', 'downloads/daytrade-tycoon-offline.zip',
      fixtureZip(JSON.stringify(fingerprints[0].bars)), /future-minute OHLC fingerprint/);
    mutation('copied offline ZIP rejects private source path', '.output/downloads/daytrade-tycoon-offline.zip',
      fixtureZip(JSON.stringify(dataset.provenance.sourcePaths[0])), /private source path/);
    put('public/research/raw/minutes.json', '{}');
    assert.throws(() => verifyMorningBuild(fixture), /forbidden private-data/);
    checks.push('private research/raw path rejected even without numeric fingerprints');
    return { ok: true, mutationChecks: checks, productionArtifactsTouched: false };
  } finally {
    // Only remove the exact task-owned mkdtemp directory, never a computed parent.
    const rel = relative(resolve(tmpdir()), resolve(fixture));
    assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel) && basename(fixture).startsWith('verify-morning-build-'), 'Unsafe fixture cleanup target.');
    rmSync(fixture, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--self-test'), 'Usage: node scripts/verify-morning-build.mjs [--self-test]');
    console.log(JSON.stringify(process.argv[2] === '--self-test' ? mutationSelfTest() : verifyMorningBuild(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
