import { useState, type ReactNode } from "react";
import type { MorningCatalog } from "@/lib/morning";
import { replayClock, settledSession, type LiveMorningState } from "@/lib/morning-live";
import { quoteSummary } from "@/lib/morning-quote";
import { formatPrice } from "@/lib/market/ticks";
import { formatTime } from "@/lib/utils";

const arrow = (tone: "up" | "down" | "flat") => (tone === "up" ? "▲" : tone === "down" ? "▼" : "");
const price = (value: number | null) => (value === null ? "—" : formatPrice(value));

/**
 * The selected stock's quote in broker order: trade, change, open/high/low, previous close, amplitude and time.
 * 均價 appears only when every revealed minute carries the source's average; volume fields wait for verified
 * volume. Display only; every value comes from the session.
 */
export function QuoteDetailGrid({
  catalog,
  session,
  code,
}: {
  catalog: MorningCatalog;
  session: LiveMorningState | null;
  code: string;
}) {
  const symbol = catalog.symbols.find((item) => item.code === code);
  if (!symbol) return null;
  const bars = session?.bars[code] ?? [];
  const quote = quoteSummary(bars, symbol.previousClose);
  const toneOf = (value: number | null) =>
    value === null || value === symbol.previousClose ? "flat" : value > symbol.previousClose ? "up" : "down";
  const average = bars.length && bars.every((bar) => typeof bar.a === "number") ? bars.at(-1)!.a! : null;
  const amplitude =
    quote.high !== null && quote.low !== null && symbol.previousClose > 0
      ? `${(((quote.high - quote.low) / symbol.previousClose) * 100).toFixed(2)}%`
      : "—";
  const time =
    session && bars.length
      ? session.replay
        ? formatTime(replayClock(session))
        : formatTime(bars.at(-1)!.t + 60).slice(0, 5)
      : "—";
  const rows: [string, string, "up" | "down" | "flat"][] = [
    ["成交", price(quote.last), quote.tone],
    ["漲跌", quote.last === null ? "—" : `${arrow(quote.tone)}${quote.changeText}`, quote.tone],
    ["漲跌幅", quote.percentText || "—", quote.tone],
    ["開盤", price(quote.open), toneOf(quote.open)],
    ["最高", price(quote.high), toneOf(quote.high)],
    ["最低", price(quote.low), toneOf(quote.low)],
    ["昨收", formatPrice(symbol.previousClose), "flat"],
    ...(average === null ? [] : [["均價", formatPrice(average), toneOf(average)] as [string, string, "up" | "down" | "flat"]]),
    ["振幅", amplitude, "flat"],
    ["時間", time, "flat"],
  ];
  return (
    <dl className="td-quote-grid" aria-label={`${symbol.name}報價明細`}>
      {rows.map(([label, value, tone]) => (
        <div key={label} data-tone={tone}>
          <dt>{label}</dt>
          <dd className="td-num">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type StockTab = { id: "book" | "tape" | "minutes" | "detail"; label: string; content: ReactNode };

/** The stock's information pages: 五檔, 明細 (simulated trades), 分鐘 (completed minutes), 詳細. */
export function StockTabs({
  tabs,
  initial,
  onChange,
}: {
  tabs: StockTab[];
  initial?: StockTab["id"];
  onChange?: (id: StockTab["id"]) => void;
}) {
  const [active, setActive] = useState<StockTab["id"] | undefined>(initial);
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  if (!current) return null;
  return (
    <section className="td-stock-tabs" data-tab={current.id}>
      <nav aria-label="個股資訊分頁" className="td-stock-tabs-nav">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={tab.id === current.id}
            onClick={() => {
              setActive(tab.id);
              onChange?.(tab.id);
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="td-stock-tabs-body">{current.content}</div>
    </section>
  );
}

/** The last ten completed minutes, newest first; never the minute being replayed. */
export function MinuteTable({ session, code }: { session: LiveMorningState | null; code: string }) {
  const minuteBars = session ? (settledSession(session).bars[code] ?? []) : [];
  return (
    <div className="terminal-minute-tape" tabIndex={0} role="region" aria-label="最近已完成分鐘明細">
      <table>
        <caption className="sr-only">最近 10 根已揭露分鐘 K，時間為分鐘起點</caption>
        <thead>
          <tr>
            <th scope="col">分鐘</th>
            <th scope="col">開</th>
            <th scope="col">高</th>
            <th scope="col">低</th>
            <th scope="col">收</th>
          </tr>
        </thead>
        <tbody>
          {minuteBars
            .slice(-10)
            .reverse()
            .map((bar) => (
              <tr key={bar.t}>
                <th scope="row">{formatTime(bar.t).slice(0, 5)}</th>
                {[bar.o, bar.h, bar.l, bar.c].map((value, index) => (
                  <td key={index}>{formatPrice(value)}</td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
      {!minuteBars.length && <p className="terminal-tape-empty">前進一分鐘後顯示分鐘明細</p>}
    </div>
  );
}
