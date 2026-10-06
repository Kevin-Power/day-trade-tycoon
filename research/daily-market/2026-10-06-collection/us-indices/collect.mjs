import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Public, unauthenticated official downloads only. No application or runtime imports.
const root = path.dirname(fileURLToPath(import.meta.url));
const start = '2026-07-01';
const end = '2026-10-05';
const lessonCutoff = '2026-10-06T09:00:00+08:00';
const normalizeOnly = process.argv.includes('--normalize-only');
const priorManifest = normalizeOnly ? JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')) : null;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const series = [
  { symbol: 'DJIA', name: 'Dow Jones Industrial Average', publisher: 'S&P Dow Jones Indices LLC', frequency: 'Daily, Close', kind: 'daily-close', updatedLabel: 'Oct 5, 2026 5:02 PM CDT' },
  { symbol: 'NASDAQCOM', name: 'NASDAQ Composite', publisher: 'Nasdaq, Inc.', frequency: 'Daily, Close', kind: 'daily-close', updatedLabel: 'Oct 5, 2026 10:38 PM CDT' },
  { symbol: 'SP500', name: 'S&P 500', publisher: 'S&P Dow Jones Indices LLC', frequency: 'Daily, Close', kind: 'daily-close', updatedLabel: 'Oct 5, 2026 7:01 PM CDT' },
  { symbol: 'NASDAQSOX', name: 'PHLX Semiconductor', publisher: 'Nasdaq, Inc.', frequency: 'Daily', kind: 'daily-index-value', publisherSymbol: 'SOX', updatedLabel: 'Oct 5, 2026 10:44 PM CDT' },
];
await mkdir(path.join(root, 'raw'), { recursive: true });
const downloads = [];
async function download(relativePath, url) {
  if (normalizeOnly) {
    const metadata = priorManifest.downloads.find(item => item.path === relativePath && item.requestedUrl === url);
    if (!metadata || metadata.status !== 200) throw new Error(`Missing successful original download for ${relativePath}`);
    const bytes = await readFile(path.join(root, relativePath));
    if (hash(bytes) !== metadata.sha256) throw new Error(`Raw hash mismatch for ${relativePath}`);
    downloads.push(metadata);
    return { bytes, metadata };
  }
  const startedAt = new Date().toISOString();
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'DayTradeTycoon-Research/1.0 public educational source collection' } });
  const bytes = Buffer.from(await response.arrayBuffer());
  const result = { path: relativePath, requestedUrl: url, finalUrl: response.url, startedAt, fetchedAt: new Date().toISOString(), status: response.status,
    contentType: response.headers.get('content-type'), responseDate: response.headers.get('date'), lastModified: response.headers.get('last-modified'), bytes: bytes.length, sha256: hash(bytes) };
  await writeFile(path.join(root, relativePath), bytes);
  downloads.push(result);
  if (!response.ok) throw new Error(`${relativePath}: HTTP ${response.status}`);
  return { bytes, metadata: result };
}
const observations = [];
const summaries = await Promise.all(series.map(async definition => {
  const { symbol } = definition;
  const sourceUrl = `https://fred.stlouisfed.org/series/${symbol}`;
  const downloadUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${symbol}&cosd=${start}&coed=${end}`;
  const [csv, page] = await Promise.all([
    download(`raw/fred-${symbol}.csv`, downloadUrl),
    download(`raw/fred-${symbol}.html`, sourceUrl),
  ]);
  const lines = csv.bytes.toString('utf8').trimEnd().split(/\r?\n/);
  const sourceUpdatedAt = page.bytes.toString('utf8').match(/"dateModified"\s*:\s*"([^"]+)"/)?.[1] ?? null;
  if (!sourceUpdatedAt || !Number.isFinite(Date.parse(sourceUpdatedAt))) throw new Error(`Missing source update timestamp for ${symbol}`);
  const sourceUpdatedAtTaipei = new Date(Date.parse(sourceUpdatedAt) + 8 * 60 * 60 * 1000).toISOString().replace('Z', '+08:00');
  if (lines.shift() !== `observation_date,${symbol}`) throw new Error(`Unexpected CSV schema for ${symbol}`);
  const seen = new Set();
  const rows = lines.map(line => {
    const fields = line.split(',');
    if (fields.length !== 2) throw new Error(`Unexpected CSV row shape for ${symbol}`);
    const [date, sourceValue] = fields;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < start || date > end || seen.has(date)) throw new Error(`Invalid or duplicate date for ${symbol}`);
    seen.add(date);
    const missing = sourceValue === '' || sourceValue === '.';
    if (!missing && !/^-?\d+(\.\d+)?$/.test(sourceValue)) throw new Error(`Unexpected numeric format for ${symbol}`);
    const value = missing ? null : Number(sourceValue);
    if (value !== null && !Number.isFinite(value)) throw new Error(`Non-finite value for ${symbol}`);
    return { symbol, symbolNamespace: 'FRED', publisherSymbol: definition.publisherSymbol ?? null, date, value, valueText: missing ? null : sourceValue,
      observationKind: definition.kind, sourceFrequency: definition.frequency, status: missing ? 'missing-in-source' : 'observed',
      sourceUrl, downloadUrl, fetchedAt: csv.metadata.fetchedAt, availableAt: null,
      availabilityStatus: 'original-per-observation-publication-time-not-provided', rawPath: csv.metadata.path, rawSha256: csv.metadata.sha256 };
  });
  observations.push(...rows);
  const present = rows.filter(row => row.value !== null).sort((a, b) => a.date.localeCompare(b.date));
  if (present.length < 30) throw new Error(`Insufficient observations for ${symbol}`);
  return { ...definition, sourceUrl, downloadUrl, symbolNamespace: 'FRED', rowCount: rows.length, validCount: present.length,
    missingDates: rows.filter(row => row.value === null).map(row => row.date), firstDate: present[0].date,
    lastDate: present.at(-1).date, lastValue: present.at(-1).value, lastValueText: present.at(-1).valueText,
    zeroValueDates: rows.filter(row => row.value === 0).map(row => row.date),
    sourceUpdatedAt, sourceUpdatedAtTaipei, lessonCutoff, latestSeriesUpdateBeforeLessonCutoff: Date.parse(sourceUpdatedAt) <= Date.parse(lessonCutoff),
    strictLessonCutoffEligibility: 'not-verified',
    strictLessonCutoffReason: Date.parse(sourceUpdatedAt) > Date.parse(lessonCutoff)
      ? 'The captured source page was updated after the lesson cutoff; this snapshot is historical-reference only and cannot pass the premarket cutoff.'
      : 'The series update label predates the cutoff, but per-observation first availability and historical vintage were not captured; strict point-in-time eligibility remains unverified.',
    updatedLabelStatus: 'observed-on-source-page-during-collection-not-individual-release-history',
    csvSha256: csv.metadata.sha256, metadataPageSha256: page.metadata.sha256, fetchedAt: csv.metadata.fetchedAt };
}));
const extraSources = [
  ['raw/nasdaq-SOX-overview.html', 'https://indexes.nasdaq.com/Index/Overview/SOX'],
  ['raw/nasdaq-SOX-history.html', 'https://indexes.nasdaq.com/Index/History/SOX'],
  ['raw/nasdaq-SOX-versions.pdf', 'https://indexes.nasdaq.com/docs/Index_Versions_SOX.pdf'],
  ['raw/nasdaq-SOX-methodology.pdf', 'https://indexes.nasdaq.com/docs/methodology_SOX.pdf'],
];
const extraResults = await Promise.allSettled(extraSources.map(([file, url]) => download(file, url)));
const extraErrors = extraResults.flatMap((result, index) => result.status === 'rejected' ? [{ sourceUrl: extraSources[index][1], error: String(result.reason) }] : []);
observations.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
const fetchedAt = downloads.map(item => item.fetchedAt).sort().at(-1);
const metadata = {
  collectionDate: '2026-10-06', collectedAt: fetchedAt, normalizedAt: new Date().toISOString(), requestedObservationWindow: { from: start, to: end }, lessonCutoff,
  usage: 'historical-reference-only; not approved for strict premarket-blind exercise', series: summaries,
  limitations: [
    'No 2026-10-06 US daily close is claimed; the saved observations end at 2026-10-05.',
    'FRED DJIA, NASDAQCOM and SP500 explicitly identify Daily, Close. NASDAQSOX identifies Daily only; its values remain labelled daily-index-value, with SOX price-return and closing-methodology references retained. No OHLC or exact close time is inferred.',
    'Dates are US index observation dates, not Asia/Taipei calendar timestamps. No timezone conversion or invented intraday timestamp is applied.',
    'Per-observation first-publication/availability timestamps and historical vintages are not supplied by these CSVs. availableAt remains null; fetchedAt is collection time, not historical availability. Current FRED series updated labels do not prove availability of every historical row at that time.',
    'For the 2026-10-06 09:00 Asia/Taipei lesson cutoff, NASDAQCOM and NASDAQSOX series update labels are 11:38 and 11:44 Asia/Taipei, respectively. They must not be counted as verified premarket-available data. Earlier DJIA/SP500 series labels alone also do not establish per-row point-in-time availability.',
    'This is an as-fetched snapshot subject to later source revisions, not point-in-time data. Do not use it as proof of what was knowable before a historical trade.',
    'Source blanks or dots are null with missing-in-source status; numeric zero remains numeric zero. No forward fill, interpolation or ETF substitution is used.',
    'No EMA11, price input definition, seed convention, trading signal, Xiaoma classification or profitability claim is calculated.',
    'FRED marks these series copyrighted with pre-approval required. Public download access does not establish permission for commercial redistribution of full datasets. This folder is a local research evidence collection, not a licensed public course data feed.',
  ],
  supportingSources: extraSources.map(([file, url]) => ({ file, url })), supportingSourceErrors: extraErrors,
};
await writeFile(path.join(root, 'observations.json'), JSON.stringify({ metadata, observations }, null, 2) + '\n');
const columns = ['symbol', 'symbolNamespace', 'date', 'valueText', 'observationKind', 'sourceFrequency', 'status', 'sourceUrl', 'downloadUrl', 'fetchedAt', 'availableAt', 'availabilityStatus', 'rawPath', 'rawSha256'];
const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
await writeFile(path.join(root, 'observations.csv'), [columns.join(','), ...observations.map(row => columns.map(column => quote(row[column])).join(','))].join('\n') + '\n');
await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...metadata, downloads: downloads.sort((a, b) => a.path.localeCompare(b.path)) }, null, 2) + '\n');
await writeFile(path.join(root, 'README.md'), `# 美股四指數公開資料快照\n\n採集日期：2026-10-06。完成時間（UTC）：${fetchedAt}。資料窗：${start}～${end}，未補入尚未取得的 2026-10-06 美股日收。\n\n| FRED symbol | 指數 | 有效筆數 | 日期範圍 | 最後值 | 原始頻率標示 |\n|---|---|---:|---|---:|---|\n${summaries.map(item => `| ${item.symbol} | ${item.name} | ${item.validCount} | ${item.firstDate}～${item.lastDate} | ${item.lastValueText} | ${item.frequency} |`).join('\n')}\n\n- 原始 CSV、來源 HTML 與 SOX 官方定義檔置於 raw/；manifest.json 保存請求 URL、抓取時間、HTTP 狀態、位元組數、SHA-256 與來源限制。observations.json / observations.csv 是逐筆整理結果。\n- symbol 使用 FRED 命名空間；NASDAQSOX 對應 Nasdaq 發布的 SOX 價格報酬指數，不是 ETF，也不是含股息的 XSOX。\n- SOX 的 FRED 頻率只有 Daily，因此保留 daily-index-value 標籤。Nasdaq 方法文件說明收盤值可因成分價格修訂而更新至美東 17:15；本快照沒有逐筆發布時間，也沒有 OHLC，不能宣稱每筆在美東 16:00 已固定。\n- 日期保留來源交易日期。availableAt 全為 null；fetchedAt 只代表本次取得時間。最新系列頁的 Updated 標籤不是逐筆歷史可得時間，資料可能事後修訂。\n- 原始缺值日：${[...new Set(summaries.flatMap(item => item.missingDates))].join('、')}。空白或點號保留為缺值，不視為零、不補前值；數值零若出現會保留為零。\n- 尚未計算 EMA11、小馬判斷或交易訊號，日 K 價格設定與初始化方式待課程契約確認。\n- 所有系列頁標示版權及預先許可要求；此資料夾為本機研究佐證，公開下載不等於取得整批資料商用再散佈權利。尚未发布為課程下載或網站資料源。\n\n## 官方來源\n\n${summaries.map(item => `- [${item.name}](${item.sourceUrl}) — ${item.publisher}，FRED 官方轉載。`).join('\n')}\n- [SOX price-return 版本定義](https://indexes.nasdaq.com/docs/Index_Versions_SOX.pdf)\n- [SOX 計算與收盤修訂時段](https://indexes.nasdaq.com/docs/methodology_SOX.pdf)\n- [Nasdaq SOX 歷史頁](https://indexes.nasdaq.com/Index/History/SOX)\n\n## 重跑\n\n以 Node 執行此資料夾 collect.mjs 會重新擷取同日期窗並覆寫快照，fetchedAt 與 SHA 可能改變；若要保存新的 vintage，先複製到新的採集目錄。腳本不讀取金鑰、不呼叫應用程式或正式 runtime。checksums.sha256 包含其自身以外所有成果的 SHA-256。\n`);
await appendFile(path.join(root, 'README.md'), `\n## 10 月 6 日盤前盲練的時間限制\n\n課程 cutoff：${lessonCutoff}。本包僅作歷史參考，尚未納入嚴格盤前可用名單。\n\n| 系列 | 原頁 sourceUpdatedAt | 換算台北時間 | 原頁更新早於 cutoff | 嚴格可用性 |\n|---|---|---|---|---|\n${summaries.map(item => `| ${item.symbol} | ${item.sourceUpdatedAt} | ${item.sourceUpdatedAtTaipei} | ${item.latestSeriesUpdateBeforeLessonCutoff ? '是' : '否'} | 未驗證 |`).join('\n')}\n\nNASDAQCOM 與 NASDAQSOX 原頁更新已晚於 09:00，因此不得因前一美股交易日收盤就推定它們盤前已在 FRED 可得。另兩系列原頁更新較早，仍沒有逐筆 first-publication/vintage 佐證。NASDAQCOM 的 2026-09-07 整列未出現在原始 CSV，另三系列同日有空值列；整理保留原貌，不自行增加或補齊。\n\n再次整理既有原始檔可加 --normalize-only，會核對原始 SHA、保留原 fetchedAt，不重新請求來源。\n`);
async function pathsIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? pathsIn(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return nested.flat();
}
const paths = (await pathsIn(root)).filter(file => path.basename(file) !== 'checksums.sha256').sort();
await writeFile(path.join(root, 'checksums.sha256'), (await Promise.all(paths.map(async file => `${hash(await readFile(file))}  ${path.relative(root, file).replaceAll('\\', '/')}`))).join('\n') + '\n');
console.log(JSON.stringify({ collectedAt: fetchedAt, series: summaries.map(({ symbol, firstDate, lastDate, validCount, missingDates, lastValueText }) => ({ symbol, firstDate, lastDate, validCount, missingDates, lastValueText })), supportingSourceErrors: extraErrors }, null, 2));
