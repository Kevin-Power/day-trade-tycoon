import { Fragment, useMemo, type ReactNode, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "@/lib/icons";
import type { MorningBookCell, MorningCatalog } from "@/lib/morning";
import { lastTrade, shownBook, withoutNewestMinute, type LiveMorningState } from "@/lib/morning-live";
import { bestQuotes, quoteSummary } from "@/lib/morning-quote";
import { holdingText } from "@/lib/morning-notices";
import { breakoutsOf, freshBreakout } from "@/lib/morning-alerts";
import { exitStampParts } from "@/lib/morning-exit";
import { deriveSwingHighs } from "@/lib/market/swing-highs";
import { formatPrice } from "@/lib/market/ticks";
import type { DeskScale } from "@/lib/market/chart-data";
import { formatTime } from "@/lib/utils";
import { useTickFlash } from "@/components/use-tick-flash";

const arrow = (tone: "up" | "down" | "flat") => (tone === "up" ? "▲" : tone === "down" ? "▼" : "");
const price = (value: number | null) => (value === null ? "—" : formatPrice(value));

/**
 * The selected stock's quote: the latest trade (the minute's close at rest), change, the best bid and ask
 * (the recorded book's, otherwise the last trade's), and the day's revealed open/high/low. Display only; every
 * value comes from the session.
 */
export function QuoteHero({
  catalog,
  session,
  book,
  code,
  titleRef,
  onSelect,
  clock,
  compactBook = false,
}: {
  catalog: MorningCatalog;
  session: LiveMorningState | null;
  /** The recorded book of the newest minute the server sent (one stock's), when the day has books. */
  book?: MorningBookCell;
  code: string;
  titleRef?: RefObject<HTMLHeadingElement | null>;
  /** Phones: ◀ ▶ on both sides of the name step through the lesson's stocks. */
  onSelect?: (code: string) => void;
  /** Phones: the replay clock (HH:MM:SS) for the code-and-time line under the quote. */
  clock?: string;
  /**
   * Phones: the best bid and ask as two short lines (買價／賣價) beside the price; 買進 and 賣出 are the trade bar's
   * (2026-11-04).
   */
  compactBook?: boolean;
}) {
  const symbol = catalog.symbols.find((item) => item.code === code) ?? catalog.symbols[0];
  const tick = useTickFlash(
    symbol ? session?.bars[symbol.code]?.at(-1)?.c : null,
    symbol?.code ?? "",
  );
  // 過前高 beside the price for five minutes after the breakout's minute completes (N 字攻擊's entry, where the thumb
  // is; the 快訊 above names other stocks too). Completed minutes only, as the chart's marks: the replay's source
  // minus the minute playing. Memoised on that source, which only changes when a minute is revealed, not per tick.
  const source = session?.replay?.source ?? session ?? null;
  const replaying = Boolean(session?.replay);
  const flagCode = symbol?.code ?? "";
  const maxCursor = catalog.maxCursor;
  const breakout = useMemo(() => {
    if (!source || !flagCode) return null;
    const settled = replaying ? withoutNewestMinute(source) : source;
    const settledBars = settled.bars[flagCode] ?? [];
    const settledNow = settled.cursor * 60;
    return freshBreakout(
      breakoutsOf(settledBars, deriveSwingHighs(settledBars, settledNow, 0, maxCursor * 60).confirmed),
      settledNow,
    );
  }, [source, replaying, flagCode, maxCursor]);
  if (!symbol) return null;
  const bars = session?.bars[symbol.code] ?? [];
  const quote = quoteSummary(bars, symbol.previousClose);
  const trade = session ? lastTrade(session, symbol.code, catalog) : null;
  const best = bestQuotes(shownBook(session, catalog, book, symbol.code));
  // Held: the stamp says the holding instead of the time (the clock above has it), so it is seen while trading.
  const position = session?.positions.find((item) => item.code === symbol.code && item.shares > 0);
  const holding = position ? holdingText(position, quote.last ?? undefined, session?.fills ?? []) : null;
  // Under the holding (2026-11-08): where the system sells — the waiting 觸價單, or the one firing.
  const firing =
    session?.orders.find((order) => order.status === "pending" && order.auto && order.code === symbol.code)?.auto ?? null;
  const exitParts = position ? exitStampParts(position.exit, firing) : [];
  const toneOf = (value: number | null) =>
    value === null || value === symbol.previousClose
      ? "flat"
      : value > symbol.previousClose
        ? "up"
        : "down";
  const at = catalog.symbols.indexOf(symbol);
  const step = (by: number) =>
    onSelect?.(catalog.symbols[(at + by + catalog.symbols.length) % catalog.symbols.length].code);
  const title = (
    <h1 ref={titleRef} tabIndex={-1} id="morning-practice-title">
      {symbol.name}
      <small>{symbol.code}</small>
    </h1>
  );
  return (
    <header
      className="td-hero"
      data-tone={quote.tone}
      data-stepper={Boolean(onSelect)}
      data-compact={compactBook || undefined}
      data-breakout={breakout ? formatPrice(breakout.high) : undefined}
    >
      <div className="td-hero-id">
        {onSelect ? (
          <div className="td-hero-step">
            <button type="button" aria-label="上一檔股票" onClick={() => step(-1)}>
              <ChevronLeft aria-hidden />
            </button>
            {title}
            <button type="button" aria-label="下一檔股票" onClick={() => step(1)}>
              <ChevronRight aria-hidden />
            </button>
          </div>
        ) : (
          title
        )}
        <p className="td-hero-stamp" data-holding={holding ? "true" : undefined}>
          {holding ? (
            <>
              <span>{holding.lots}</span> <span>{holding.average}</span>
              {holding.result && (
                <>
                  {" "}
                  <b data-tone={holding.result.tone}>{holding.result.text}</b>
                </>
              )}
              {exitParts.length > 0 && (
                <>
                  {" "}
                  <span className="td-hero-exit" data-firing={firing ?? undefined} aria-label="觸價單">
                    {exitParts.map((part, index) => (
                      <Fragment key={part.kind}>
                        {index > 0 && "／"}
                        <span data-tone={part.kind === "takeProfit" ? "up" : "down"}>{part.text}</span>
                      </Fragment>
                    ))}
                  </span>
                </>
              )}
            </>
          ) : quote.last === null ? (
            "待揭露第一分鐘"
          ) : session?.replay && trade ? (
            <>
              <time>{formatTime(trade.second)}</time> 成交 · 歷史重播
            </>
          ) : (
            <>
              <time>{formatTime(bars.at(-1)!.t + 60).slice(0, 5)}</time> 收價 · 歷史重播
            </>
          )}
        </p>
      </div>
      <p
        className="td-hero-price"
        title={session?.replay ? "這分鐘已重播到的最新成交價，播完時是這分鐘的收盤價" : "最新完整分鐘收價"}
      >
        <strong key={tick.key} data-flash={tick.flash}>
          {price(quote.last)}
        </strong>
        {quote.last !== null && (
          <span className="td-hero-change">
            <span>
              {arrow(quote.tone)}
              {quote.changeText}
            </span>
            <span>{quote.percentText}</span>
            {breakout && <span className="td-hero-flag-break" aria-hidden />}
            {breakout && (
              <span
                className="td-hero-flag"
                title={`剛過前高 ${formatPrice(breakout.high)}：完成的分鐘收在已確認的前高之上（只描述價格，不是進場訊號）`}
              >
                過前高<span className="td-hero-flag-price"> {formatPrice(breakout.high)}</span>
              </span>
            )}
          </span>
        )}
      </p>
      <dl className="td-hero-book" data-compact={compactBook || undefined} aria-label="最佳買價與賣價">
        <div data-side="bid" data-tone={toneOf(best.bid)}>
          <dt>{compactBook ? "買價" : "買進"}</dt>
          <dd>{price(best.bid)}</dd>
        </div>
        <div data-side="ask" data-tone={toneOf(best.ask)}>
          <dt>{compactBook ? "賣價" : "賣出"}</dt>
          <dd>{price(best.ask)}</dd>
        </div>
      </dl>
      {clock && (
        <p className="td-hero-line">
          <span>{symbol.code}</span>
          <time>
            {catalog.date.slice(5).replace("-", "/")} {clock}
          </time>
        </p>
      )}
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
  session: LiveMorningState | null;
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

/** The chart's views: 江波 at ±10%, 江波 放大, K線. */
const CHART_VIEWS = [
  ["quote", "fixed", "江波", "江波圖：固定昨收上下 10%"],
  ["quote", "zoom", "放大", "江波圖放大：依當天漲跌放大，昨收在中間"],
  ["chart", null, "K線", "一分鐘 K 線"],
] as const;

/**
 * Chart toolbar: stock stepper, 江波／放大／K線 and the lesson's data source (富邦逐筆／證交所大盤) with its date.
 */
export function ChartToolbar({
  catalog,
  code,
  mode,
  scale,
  source,
  onMode,
  onScale,
  onSelect,
  stepper = true,
}: {
  catalog: MorningCatalog;
  code: string;
  mode: "quote" | "chart";
  /** The 江波圖's scale: 放大 or ±10% (2026-11-04). */
  scale: DeskScale;
  /** The data source named in the chip (dataSourceLabel): 證交所大盤 only when the run has the index. */
  source: string;
  onMode: (mode: "quote" | "chart") => void;
  onScale: (scale: DeskScale) => void;
  onSelect: (code: string) => void;
  /** Phones step from the quote block's ◀ ▶ instead. */
  stepper?: boolean;
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
    <div className="td-chartbar" data-stepper={stepper}>
      {stepper && (
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
      )}
      <nav aria-label="看盤分頁" className="td-segment">
        {CHART_VIEWS.map(([value, view, label, hint]) => (
          <button
            key={label}
            type="button"
            title={hint}
            aria-pressed={mode === value && (view === null || scale === view)}
            data-coach={view === "zoom" ? "mode-zoom" : `mode-${value}`}
            onClick={() => {
              onMode(value);
              if (view) onScale(view);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <p className="td-chartbar-source">
        <span className="td-chip" data-kind="real">
          {/* The narrowest phones break 「富邦逐筆／證交所大盤」 after the 「／」, so the chart bar stays one row. */}
          <span>
            {source.split("／").map((part, index) => (
              <Fragment key={index}>
                {index > 0 && (
                  <>
                    ／<wbr />
                  </>
                )}
                {part}
              </Fragment>
            ))}
          </span>
        </span>
        <span className="td-chartbar-date">
          {catalog.date}
          <span className="td-chartbar-tz"> 台北時間</span>
        </span>
      </p>
    </div>
  );
}
