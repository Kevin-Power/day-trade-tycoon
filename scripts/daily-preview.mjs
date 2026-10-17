// Read-only preview of the daily question for one data day: the pick and the top 10 candidates.
// Usage: node --experimental-strip-types scripts/daily-preview.mjs <market-data dir> <YYYY-MM-DD>
import { listPublishedDays, readDaySymbols, readSymbolBars } from "../src/lib/market-days.server.ts";
import { densifyBars } from "../src/lib/daily/bars.ts";
import { buildQuestion, intradayCandidate, poolSymbols, previousHighCandidate, rankCandidates } from "../src/lib/daily/pick.ts";
import { dataDateText, priceText, revealCopy, timeText } from "../src/lib/daily/reveal.ts";

const [dir, date] = process.argv.slice(2);
if (!dir || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error("Usage: daily-preview.mjs <market-data dir> <YYYY-MM-DD>");
const days = await listPublishedDays(dir);
const symbols = await readDaySymbols(dir, date);
if (!symbols) throw new Error(`No data for ${date}`);
const previousDay = days.filter((day) => day.coverage === "full-market" && day.date < date).at(-1)?.date;
const previousSymbols = previousDay ? await readDaySymbols(dir, previousDay) : null;
const pool = poolSymbols(symbols);
const bars = new Map();
const previous = new Map();
for (const symbol of pool) {
  const rows = await readSymbolBars(dir, date, symbol.code);
  if (rows?.length) bars.set(symbol.code, densifyBars(rows));
  const before = previousSymbols?.find((item) => item.code === symbol.code);
  if (previousDay && before) {
    const earlier = await readSymbolBars(dir, previousDay, symbol.code);
    if (earlier?.length) previous.set(symbol.code, { high: Math.max(...earlier.map((row) => row[2])), close: before.close });
  }
}
const candidates = pool.flatMap((symbol) => {
  const day = bars.get(symbol.code);
  if (!day) return [];
  return [intradayCandidate(symbol, day, 0.003), previousHighCandidate(symbol, day, previous.get(symbol.code) ?? null, 0.003)]
    .filter(Boolean)
    .sort((a, b) => a.questionT - b.questionT)
    .slice(0, 1);
});
const question = buildQuestion({ dataDate: date, symbols: pool, barsOf: (code) => bars.get(code) ?? null, previousOf: (code) => previous.get(code) ?? null });
console.log(`資料日 ${dataDateText(date)}：股票池 ${pool.length} 檔，候選 ${candidates.length} 檔，其中做出後高 ${candidates.filter((item) => item.outcome.higherHigh).length} 檔；前一個全市場日：${previousDay ?? "無"}`);
console.log("前 10 名候選：");
for (const item of rankCandidates(candidates))
  console.log(`  ${item.name}（${item.code}） ${item.kind === "intraday-high" ? "前高" : "昨高"} ${priceText(item.level)}，題目時間 ${timeText(item.questionT)}，回檔 ${(item.pullbackPct * 100).toFixed(2)}%，${item.outcome.higherHigh ? "做出後高" : "沒有後高"}`);
if (!question) {
  console.log("這一天出不了題。");
} else {
  const copy = revealCopy({ kind: question.kind, level: question.level, outcome: question.outcome, choice: "watch", entry: null });
  console.log(`挑中：${question.name}（${question.code}），${question.kind === "intraday-high" ? "回到前高" : "漲到昨高"} ${priceText(question.level)}，題目時間 ${timeText(question.questionT)}`);
  console.log(`停損建議：回檔低點 ${priceText(question.stops.pullback)}、下方 1% ${priceText(question.stops.belowLevel)}`);
  console.log(`揭曉：${copy.headline}｜${copy.facts.join("｜")}`);
}
