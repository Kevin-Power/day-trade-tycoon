// Answer-key data for the instructor book, computed from the lesson files with the classroom's own
// functions (quote summary, teaching order book, alerts, fees). Nothing here is typed in by hand.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const minuteLabel = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  return `${String(9 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
};

export async function buildReference(project) {
  const load = (file) => import(pathToFileURL(join(project, file)).href);
  const { quoteSummary, bestQuotes } = await load("src/lib/morning-quote.ts");
  const { createMorningBook } = await load("src/lib/morning-book.ts");
  const { deriveMorningAlerts } = await load("src/lib/morning-alerts.ts");
  const { estimateRoundTripCost, tickSize, formatPrice } = await load("src/lib/market/ticks.ts");
  const days = [];
  for (const file of ["morning-2026-10-05.json", "morning-2026-10-06.json"]) {
    const { catalog, bars } = JSON.parse(readFileSync(join(project, "server", "data", file), "utf8"));
    const clocks = [1, 3, 5, 7, 10, 15, 20, 30, 37, 45, 60, 75, 90];
    const quotes = catalog.symbols.map((symbol) => ({
      code: symbol.code,
      name: symbol.name,
      previousClose: symbol.previousClose,
      lot: symbol.previousClose * 1000,
      roundTrip: estimateRoundTripCost(symbol.previousClose * 1000),
      tick: tickSize(symbol.previousClose),
      perShare: Math.round((estimateRoundTripCost(symbol.previousClose * 1000) / 1000) * 100) / 100,
      ticksToBreakEven: Math.ceil(estimateRoundTripCost(symbol.previousClose * 1000) / 1000 / tickSize(symbol.previousClose)),
      at: clocks.map((cursor) => {
        const shown = bars[symbol.code].slice(0, cursor);
        const quote = quoteSummary(shown, symbol.previousClose);
        const best = bestQuotes(createMorningBook(symbol.code, cursor, quote.last ?? 0, symbol.previousClose));
        return {
          clock: minuteLabel(cursor * 60),
          last: quote.last,
          change: quote.change,
          percent: quote.percentText,
          open: quote.open,
          high: quote.high,
          low: quote.low,
          bid1: best.bid,
          ask1: best.ask,
        };
      }),
    }));
    const timeline = [];
    let previous = "";
    for (let cursor = 1; cursor <= catalog.maxCursor; cursor++) {
      const visible = Object.fromEntries(Object.entries(bars).map(([code, list]) => [code, list.slice(0, cursor)]));
      const latest = deriveMorningAlerts(catalog, { cursor, bars: visible, fills: [] }).at(-1);
      const text = latest ? latest.text : "";
      if (text && text !== previous) timeline.push({ clock: minuteLabel(cursor * 60), text });
      previous = text;
    }
    days.push({ date: catalog.date, lessonId: catalog.lessonId, title: catalog.title, quotes, timeline, formatPrice: null });
  }
  return { days };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reference = await buildReference(process.argv[2]);
  console.log(JSON.stringify(reference, null, 1));
}
