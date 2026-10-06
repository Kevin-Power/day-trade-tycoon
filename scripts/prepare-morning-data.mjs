// One reproducible, server-only lesson. The original research evidence stays unchanged.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const supplement = "research/daily-market/2026-10-06-strategy-supplement/";
const collection = "research/daily-market/2026-10-06-collection/";
const read = path => readFileSync(resolve(root, path));
const json = path => JSON.parse(read(path).toString("utf8"));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const sourcePath = supplement + "bars-2026-10-06-0900-1030.json";
const manifest = json(supplement + "replay-manifest.json");
assert.equal(digest(read(sourcePath)), manifest.sha256, "Minute source must match retained evidence");
const sourceBars = json(sourcePath);
const dailyPath = supplement + "daily-prices/daily-prices-through-2026-10-05.json";
assert.equal(digest(read(dailyPath)), "7917bf280925d12a268f098e4ee8c4840c284e61e0b4c681f19d7ab480f8881a");
const daily = json(dailyPath);
const codes = { "2330": "台積電", "2317": "鴻海", "2454": "聯發科", "2382": "廣達", "2308": "台達電" };
const orderedCodes = ["2330", "2317", "2454", "2382", "2308"];
const start = Date.parse("2026-10-06T09:00:00+08:00");
const bars = {};
const symbols = orderedCodes.map(code => {
  const rows = sourceBars.filter(row => row.symbol === code).sort((a, b) => a.timestampUnixSeconds - b.timestampUnixSeconds);
  assert.equal(rows.length, 90);
  bars[code] = rows.map((row, index) => {
    assert.equal(row.timestampUnixSeconds * 1000, start + index * 60000);
    assert.equal(Date.parse(row.replayAvailableAt), start + (index + 1) * 60000);
    assert.ok([row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite));
    assert.ok(row.low > 0 && row.volume >= 0 && row.low <= Math.min(row.open, row.close) && row.high >= Math.max(row.open, row.close));
    return { t: index * 60, o: row.open, h: row.high, l: row.low, c: row.close, v: row.volume };
  });
  const previous = daily.filter(row => row.symbol === code).sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(previous.map(row => row.date), ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05"]);
  return { code, name: codes[code], previousClose: previous.at(-1).close,
    previous5CloseMean: previous.reduce((sum, row) => sum + row.close, 0) / 5 };
});
assert.equal(sourceBars.length, 450);
const us = json(collection + "us-indices/observations.json");
const taiwan = json(collection + "taiwan/normalized/preopen-reference-2026-10-06.json");
const names = { DJIA: "道瓊", NASDAQCOM: "那斯達克", SP500: "S&P 500", NASDAQSOX: "費城半導體" };
const context = us.metadata.series.map(series => {
  assert.equal(series.lastDate, "2026-10-05");
  return { label: names[series.symbol], value: Number(series.lastValue).toLocaleString("en-US", { minimumFractionDigits: 2 }), asOf: "美國 10/05 日資料・FRED" };
});
context.push(
  { label: "加權指數", value: taiwan.taiexPreviousSession.close.toLocaleString("en-US", { minimumFractionDigits: 2 }), asOf: "10/05 收盤・TWSE" },
  { label: "台指期夜盤", value: taiwan.txNightSession.last.toLocaleString("en-US") + "（+" + taiwan.txNightSession.changeVsPriorSettlement + "）", asOf: "TX 202610・至 10/06 05:00・相較前日結算・TAIFEX" },
  { label: "外資現貨買賣超", value: "+" + (taiwan.institutionalCash.foreignExcludingForeignDealers.net / 1e8).toFixed(2) + " 億元", asOf: "10/05 上市・不含外資自營商・TWSE" },
  { label: "外資台指期淨部位", value: taiwan.foreignTxFutures.netOpenInterest.toLocaleString("en-US") + " 口", asOf: "10/05 未平倉・所有月份・TAIFEX" },
  { label: "外資淨部位變化", value: "+" + taiwan.foreignTxFutures.netOpenInterestChange.toLocaleString("en-US") + " 口", asOf: "相較 10/02・非當日買賣口數" },
  { label: "融資金額增減", value: (taiwan.margin.rows.find(row => row.unit === "TWD_thousands").balanceChange / 1e5).toFixed(2) + " 億元", asOf: "10/05 上市・TWSE" },
  { label: "融券餘額增減", value: taiwan.margin.rows.find(row => row.name.startsWith("融券")).balanceChange.toLocaleString("en-US") + " 交易單位", asOf: "10/05 上市・TWSE 原始單位" },
);
const catalog = {
  lessonId: "morning-20261006-v1-" + manifest.sha256.slice(0, 12), title: "先讀背景，再等自己的出手機會", date: "2026-10-06",
  start: "09:00", end: "10:30", maxCursor: 90, symbols, context,
  strategy: [
    "先寫作戰藍圖：觀察標的、進場條件與停損條件。沒有符合計畫的機會，也可以選擇不交易。",
    "主要練習 09:00–10:00；可延伸觀察至 10:30。這是教材時段，結束時不會自動平倉。",
    "N 字攻擊：過前高才下單，是必要條件，不等於一突破就該買。先觀察前高後高、底底高／頭頭高，並對照底底低／頭頭低。",
    "成交量與成交值排行是教材重點。本批分鐘量尚未完成核對，暫不顯示量柱、VWAP 或量能訊號；五檔名單也不是全市場排行。",
    "快樂小馬已確認是 EMA11；使用週期與計算口徑仍待講師確認。SMA5 指五日均線；頁面只提供前五個完整交易日收盤均值參考。",
  ],
  notices: [
    "價格來源：Yahoo Finance 歷史 1 分鐘 OHLC，2026/10/06。每分鐘完成後才顯示整根 K，沒有合成逐筆或五檔。",
    "市場背景是事後蒐集的歷史參考，未驗證每筆在當日 09:00 前已可取得；不可視為嚴格盤前快照。",
    "尚未取得當日盤前影片；目前以文字教材練習，不會把其他日期或晚間影片當作當日盤前分析。",
    "委託採下一分鐘開盤價的教學撮合模型，沒有真實排隊、滑價或深度；費用是固定教材估算，與券商實際帳單可能不同。",
    "本課為單日歷史資料試行；後續每日更新、授權行情與富邦串接仍在準備中。目前只提供模擬下單。",
  ], videoUrl: null,
};
const result = { catalog, bars, provenance: {
  minuteSourceSha256: manifest.sha256,
  dailySourceSha256: digest(read(dailyPath)),
  minuteSource: "Yahoo Finance", dailySource: "TWSE STOCK_DAY", volumeVerified: false,
  sourcePaths: [sourcePath, dailyPath],
  sourceUrls: manifest.reports.map(row => row.sourceUrl),
} };
const serialized = JSON.stringify(result, null, 2) + "\n";
const destination = resolve(root, "server/data/morning-2026-10-06.json");
if (process.argv.includes("--check")) {
  assert.equal(readFileSync(destination, "utf8"), serialized, "Regenerate the server lesson from verified research evidence");
  console.log("Server lesson matches retained source hashes, minute grid and previous-session reference data.");
} else {
  mkdirSync(resolve(root, "server/data"), { recursive: true });
  writeFileSync(destination, serialized);
  console.log("Prepared server-only lesson: 5 stocks × 90 completed-minute bars; prior-session context only.");
}
