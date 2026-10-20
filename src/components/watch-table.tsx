import { useRef, type ReactNode } from "react";
import { CandlestickChart } from "@/lib/icons";
import type { MorningCatalog } from "@/lib/morning";
import { createMorningBook } from "@/lib/morning-book";
import { formatIndexValue, indexSummary } from "@/lib/morning-index";
import { lastTrade, type LiveMorningState } from "@/lib/morning-live";
import { bestQuotes, quoteSummary } from "@/lib/morning-quote";
import { formatPrice } from "@/lib/market/ticks";
import {
  deviceDashPattern,
  hairlineDevicePixels,
  jiangboPriceRange,
  snapColumn,
  snapEdge,
  snapStroke,
} from "@/lib/market/chart-data";
import { TickPrice } from "@/components/tick-price";
import { useDeviceCanvas } from "@/components/use-device-canvas";

type Candle = { t: number; o: number; h: number; l: number; c: number };
const arrow = (tone: "up" | "down" | "flat") => (tone === "up" ? "▲" : tone === "down" ? "▼" : "");
const dash = "—";
const toneOf = (value: number | null | undefined, previous: number) =>
  value == null || value === previous ? "flat" : value > previous ? "up" : "down";

/**
 * 自選報價 as a broker table: the TAIEX first, then the lesson's stocks, each with its 簡易 K 線. Prices move with
 * the replayed trades; bid/ask are the teaching book's (模擬). Volume columns would need verified volume.
 */
export function WatchTable({
  catalog,
  session,
  code,
  compact = false,
  indexSelected = false,
  onSelect,
  onIndex,
}: {
  catalog: MorningCatalog;
  session: LiveMorningState | null;
  code: string;
  compact?: boolean;
  indexSelected?: boolean;
  onSelect: (code: string) => void;
  /** Where the index can be shown (the desktop's 大盤 pane, the phone's 行情 page); without it the row is static. */
  onIndex?: () => void;
}) {
  const index = session?.index;
  const indexQuote = index ? indexSummary(index.bars, index.previousClose) : null;
  const endT = catalog.maxCursor * 60;
  const columns = compact
    ? ["商品", "成交", "漲跌%", "走勢"]
    : ["商品", "成交", "漲跌", "漲跌%", "買進", "賣出", "最高", "最低", "簡易K線"];
  return (
    <section className="td-watch-table" data-compact={compact} aria-label="自選報價">
      <div className="td-titlebar td-watch-head">
        <span>
          <CandlestickChart aria-hidden /> 自選報價
        </span>
        <span className="td-watch-note">分鐘內跳動為模擬逐筆 · 買進賣出為模擬五檔</span>
      </div>
      <div className="td-watch-cols" aria-hidden="true">
        {columns.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="td-watch-rows" role="group" aria-label="選擇商品">
        <IndexRow tone={indexQuote?.tone ?? "flat"} selected={indexSelected} onIndex={onIndex}>
          <span className="td-watch-name">
            <span>{index?.name ?? "加權指數"}</span>
            <small>TAIEX</small>
          </span>
          <TickPrice className="td-watch-price" value={indexQuote?.last ?? null} identity="TAIEX">
            {indexQuote?.last == null ? dash : formatIndexValue(indexQuote.last)}
          </TickPrice>
          {!compact && (
            <span className="td-watch-cell">
              {indexQuote?.last == null
                ? dash
                : `${arrow(indexQuote.tone)}${indexQuote.changeText}`}
            </span>
          )}
          <span className="td-watch-cell">{indexQuote?.percentText || dash}</span>
          {!compact && (
            <>
              <span className="td-watch-cell td-watch-muted">{dash}</span>
              <span className="td-watch-cell td-watch-muted">{dash}</span>
              <span
                className="td-watch-cell"
                data-tone={toneOf(indexQuote?.high, index?.previousClose ?? 0)}
              >
                {indexQuote?.high == null ? dash : formatIndexValue(indexQuote.high)}
              </span>
              <span
                className="td-watch-cell"
                data-tone={toneOf(indexQuote?.low, index?.previousClose ?? 0)}
              >
                {indexQuote?.low == null ? dash : formatIndexValue(indexQuote.low)}
              </span>
            </>
          )}
          <MiniCandles bars={index?.bars ?? []} previous={index?.previousClose ?? 0} endT={endT} />
        </IndexRow>
        {catalog.symbols.map((symbol) => {
          const bars = session?.bars[symbol.code] ?? [];
          const quote = quoteSummary(bars, symbol.previousClose);
          const trade = session ? lastTrade(session, symbol.code, catalog) : null;
          const best = bestQuotes(
            createMorningBook(
              symbol.code,
              session?.cursor ?? 0,
              quote.last ?? 0,
              symbol.previousClose,
              trade ? { index: trade.index, side: trade.side } : undefined,
            ),
          );
          return (
            <button
              type="button"
              key={symbol.code}
              className="td-watch-row"
              data-code={symbol.code}
              data-tone={quote.tone}
              aria-pressed={!indexSelected && code === symbol.code}
              onClick={() => onSelect(symbol.code)}
            >
              <span className="td-watch-name">
                <span>{symbol.name}</span>
                <small>{symbol.code}</small>
              </span>
              <TickPrice className="td-watch-price" value={quote.last} identity={symbol.code}>
                {quote.last === null ? dash : formatPrice(quote.last)}
              </TickPrice>
              {!compact && (
                <span className="td-watch-cell">
                  {quote.last === null ? dash : `${arrow(quote.tone)}${quote.changeText}`}
                </span>
              )}
              <span className="td-watch-cell">{quote.percentText || dash}</span>
              {!compact && (
                <>
                  <span
                    className="td-watch-cell"
                    data-tone={toneOf(best.bid, symbol.previousClose)}
                  >
                    {best.bid === null ? dash : formatPrice(best.bid)}
                  </span>
                  <span
                    className="td-watch-cell"
                    data-tone={toneOf(best.ask, symbol.previousClose)}
                  >
                    {best.ask === null ? dash : formatPrice(best.ask)}
                  </span>
                  <span
                    className="td-watch-cell"
                    data-tone={toneOf(quote.high, symbol.previousClose)}
                  >
                    {quote.high === null ? dash : formatPrice(quote.high)}
                  </span>
                  <span
                    className="td-watch-cell"
                    data-tone={toneOf(quote.low, symbol.previousClose)}
                  >
                    {quote.low === null ? dash : formatPrice(quote.low)}
                  </span>
                </>
              )}
              <MiniCandles bars={bars} previous={symbol.previousClose} endT={endT} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The TAIEX row: a button where the index can be opened, a plain row where it cannot (tablets). */
function IndexRow({
  tone,
  selected,
  onIndex,
  children,
}: {
  tone: "up" | "down" | "flat";
  selected: boolean;
  onIndex?: () => void;
  children: ReactNode;
}) {
  return onIndex ? (
    <button
      type="button"
      className="td-watch-row"
      data-code="TAIEX"
      data-tone={tone}
      aria-pressed={selected}
      onClick={onIndex}
    >
      {children}
    </button>
  ) : (
    <div className="td-watch-row" data-code="TAIEX" data-tone={tone} data-static="true">
      {children}
    </div>
  );
}

/** 簡易 K 線: five-minute candles of the revealed minutes against the previous close (dashed). */
export function MiniCandles({
  bars,
  previous,
  endT,
}: {
  bars: readonly Candle[];
  previous: number;
  endT: number;
}) {
  if (!bars.length) return <span className="td-mini td-mini-empty">等待開盤</span>;
  return <MiniCanvas bars={bars} previous={previous} endT={endT} />;
}

function MiniCanvas({
  bars,
  previous,
  endT,
}: {
  bars: readonly Candle[];
  previous: number;
  endT: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useDeviceCanvas(ref, (ctx, width, height) =>
    paintMiniCandles(ctx, width, height, bars, previous, endT),
  );
  return <canvas ref={ref} className="td-mini" aria-hidden="true" />;
}

const SLOT = 300;

function paintMiniCandles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bars: readonly Candle[],
  previous: number,
  endT: number,
) {
  const style = getComputedStyle(ctx.canvas);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const up = read("--color-up", "#ff5468");
  const down = read("--color-down", "#1cd78a");
  const flat = read("--color-fg", "#f3f6f9");
  const tape = read("--color-tape", "#e6c25a");
  // Device pixels per CSS pixel on each axis: a fractional CSS width makes them differ slightly, so y is
  // snapped with the vertical scale and x with the horizontal one.
  const transform = ctx.getTransform();
  const sx = transform.a > 0 ? transform.a : 1;
  const sy = transform.d > 0 ? transform.d : 1;
  const hairline = hairlineDevicePixels(Math.min(sx, sy));
  const candles = new Map<number, Candle>();
  for (const bar of bars) {
    const slot = Math.floor(bar.t / SLOT);
    const current = candles.get(slot);
    if (!current) candles.set(slot, { t: slot * SLOT, o: bar.o, h: bar.h, l: bar.l, c: bar.c });
    else {
      current.h = Math.max(current.h, bar.h);
      current.l = Math.min(current.l, bar.l);
      current.c = bar.c;
    }
  }
  const all = [...candles.values()];
  const range = jiangboPriceRange(
    previous,
    Math.max(...all.map((c) => c.h)),
    Math.min(...all.map((c) => c.l)),
    0.005,
  );
  const pad = 2;
  const span = Math.max(range.max - range.min, Number.EPSILON);
  const yOf = (value: number) => pad + ((range.max - value) / span) * (height - pad * 2);
  const slots = Math.max(1, Math.ceil(endT / SLOT));
  const slotWidth = (width - pad * 2) / slots;
  if (previous > 0) {
    ctx.save();
    ctx.strokeStyle = tape;
    ctx.lineWidth = hairline / sy;
    ctx.setLineDash(deviceDashPattern([2, 3], sx));
    const y = snapStroke(yOf(previous), sy, hairline);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.restore();
  }
  for (const candle of all) {
    const x = pad + (candle.t / SLOT) * slotWidth + slotWidth / 2;
    const color = candle.c > candle.o ? up : candle.c < candle.o ? down : flat;
    ctx.fillStyle = color;
    // Wick and body on whole device pixels, the body centred on its wick.
    const column = snapColumn(x, slotWidth * 0.6, sx, hairline);
    const high = snapEdge(yOf(candle.h), sy);
    const low = snapEdge(yOf(candle.l), sy);
    ctx.fillRect(
      column.center - hairline / sx / 2,
      high,
      hairline / sx,
      Math.max(1 / sy, low - high),
    );
    const top = snapEdge(yOf(Math.max(candle.o, candle.c)), sy);
    const bottom = snapEdge(yOf(Math.min(candle.o, candle.c)), sy);
    ctx.fillRect(column.left, top, column.width, Math.max(1 / sy, bottom - top));
  }
}
