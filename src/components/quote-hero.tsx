import type { ReactNode, RefObject } from "react";
import { ChevronLeft, ChevronRight } from "@/lib/icons";
import type { MorningCatalog, MorningState } from "@/lib/morning";
import { createMorningBook } from "@/lib/morning-book";
import { bestQuotes, quoteSummary } from "@/lib/morning-quote";
import { formatPrice } from "@/lib/market/ticks";
import { formatTime } from "@/lib/utils";

const arrow = (tone: "up" | "down" | "flat") => (tone === "up" ? "▲" : tone === "down" ? "▼" : "");
const price = (value: number | null) => (value === null ? "—" : formatPrice(value));

/**
 * The selected stock's quote: last completed-minute close, change, the teaching book's best bid and
 * ask, and the day's revealed open/high/low. Display only; every value comes from the session.
 */
export function QuoteHero({
  catalog,
  session,
  code,
  titleRef,
}: {
  catalog: MorningCatalog;
  session: MorningState | null;
  code: string;
  titleRef?: RefObject<HTMLHeadingElement | null>;
}) {
  const symbol = catalog.symbols.find((item) => item.code === code) ?? catalog.symbols[0];
  if (!symbol) return null;
  const bars = session?.bars[symbol.code] ?? [];
  const quote = quoteSummary(bars, symbol.previousClose);
  const best = bestQuotes(
    createMorningBook(symbol.code, session?.cursor ?? 0, quote.last ?? 0, symbol.previousClose),
  );
  const toneOf = (value: number | null) =>
    value === null || value === symbol.previousClose
      ? "flat"
      : value > symbol.previousClose
        ? "up"
        : "down";
  return (
    <header className="td-hero" data-tone={quote.tone}>
      <div className="td-hero-id">
        <h1 ref={titleRef} tabIndex={-1} id="morning-practice-title">
          {symbol.name}
          <small>{symbol.code}</small>
        </h1>
        <p className="td-hero-stamp">
          {quote.last === null ? (
            "待揭露第一分鐘"
          ) : (
            <>
              <time>{formatTime(bars.at(-1)!.t + 60).slice(0, 5)}</time> 收價 · 歷史重播
            </>
          )}
        </p>
      </div>
      <p className="td-hero-price" title="最新完整分鐘收價">
        <strong>{price(quote.last)}</strong>
        {quote.last !== null && (
          <span className="td-hero-change">
            <span>
              {arrow(quote.tone)}
              {quote.changeText}
            </span>
            <span>{quote.percentText}</span>
          </span>
        )}
      </p>
      <dl className="td-hero-stats" aria-label="已揭露行情摘要">
        {(
          [
            ["昨收", symbol.previousClose],
            ["開盤", quote.open],
            ["最高", quote.high],
            ["最低", quote.low],
          ] as const
        ).map(([label, value]) => (
          <div key={label} data-tone={label === "昨收" ? "flat" : toneOf(value)}>
            <dt>{label}</dt>
            <dd>{price(value)}</dd>
          </div>
        ))}
      </dl>
      <dl className="td-hero-book" aria-label="教學模擬五檔的最佳買價與賣價">
        <div data-side="bid" data-tone={toneOf(best.bid)}>
          <dt>
            買價<span className="td-sim-tag">模擬</span>
          </dt>
          <dd>{price(best.bid)}</dd>
        </div>
        <div data-side="ask" data-tone={toneOf(best.ask)}>
          <dt>
            賣價<span className="td-sim-tag">模擬</span>
          </dt>
          <dd>{price(best.ask)}</dd>
        </div>
      </dl>
    </header>
  );
}

/** One-line quote above the order ticket on phones, so the trade pane keeps its context. */
export function QuoteLine({
  catalog,
  session,
  code,
}: {
  catalog: MorningCatalog;
  session: MorningState | null;
  code: string;
}) {
  const symbol = catalog.symbols.find((item) => item.code === code);
  if (!symbol) return null;
  const quote = quoteSummary(session?.bars[symbol.code] ?? [], symbol.previousClose);
  return (
    <p className="td-quote-line" data-tone={quote.tone}>
      <span className="td-quote-line-name">
        {symbol.name}
        <small>{symbol.code}</small>
      </span>
      <strong>{price(quote.last)}</strong>
      {quote.last !== null && (
        <span>
          {arrow(quote.tone)}
          {quote.changeText} {quote.percentText}
        </span>
      )}
    </p>
  );
}

/** Chart toolbar: stock stepper, 分時／K線 and the data label of the active chart. */
export function ChartToolbar({
  catalog,
  code,
  mode,
  onMode,
  onSelect,
}: {
  catalog: MorningCatalog;
  code: string;
  mode: "quote" | "chart";
  onMode: (mode: "quote" | "chart") => void;
  onSelect: (code: string) => void;
}): ReactNode {
  const index = Math.max(
    0,
    catalog.symbols.findIndex((item) => item.code === code),
  );
  const move = (step: number) =>
    onSelect(
      catalog.symbols[(index + step + catalog.symbols.length) % catalog.symbols.length].code,
    );
  return (
    <div className="td-chartbar">
      <div className="td-stepper" role="group" aria-label="切換股票">
        <button type="button" onClick={() => move(-1)} aria-label="上一檔股票">
          <ChevronLeft aria-hidden />
        </button>
        <select
          aria-label="選擇股票"
          value={code}
          onChange={(event) => onSelect(event.target.value)}
        >
          {catalog.symbols.map((item) => (
            <option key={item.code} value={item.code}>
              {item.code} {item.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => move(1)} aria-label="下一檔股票">
          <ChevronRight aria-hidden />
        </button>
      </div>
      <nav aria-label="看盤分頁" className="td-segment">
        {(
          [
            ["quote", "分時"],
            ["chart", "K線"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            data-coach={`mode-${value}`}
            onClick={() => onMode(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      <p className="td-chartbar-source">
        <span className="td-chip" data-kind="real">
          {mode === "quote" ? "真實歷史・分鐘收價" : "真實歷史 1 分 K"}
        </span>
        <span>{catalog.date} 台北時間</span>
      </p>
    </div>
  );
}
