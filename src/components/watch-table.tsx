import { useEffect, useRef, useState, type ReactNode } from "react";
import { CandlestickChart } from "@/lib/icons";
import type { MorningCatalog } from "@/lib/morning";
import { createMorningBook } from "@/lib/morning-book";
import { formatIndexValue, indexAvailability, indexSummary } from "@/lib/morning-index";
import { lastTrade, type LiveMorningState } from "@/lib/morning-live";
import { bestQuotes, quoteSummary } from "@/lib/morning-quote";
import { formatPrice } from "@/lib/market/ticks";
import {
  JIANGBO_BAND,
  hairlineDevicePixels,
  miniScaleLabel,
  miniZoomBand,
  parseMiniScale,
  snapStroke,
  sparklineLayout,
  sparkStrokePx,
  type MiniScale,
} from "@/lib/market/chart-data";
import { browserStorage, readDeviceValue, writeDeviceValue } from "@/lib/device-storage";
import { TickPrice } from "@/components/tick-price";
import { useDeviceCanvas } from "@/components/use-device-canvas";

type Candle = { t: number; o: number; h: number; l: number; c: number };
const arrow = (tone: "up" | "down" | "flat") => (tone === "up" ? "▲" : tone === "down" ? "▼" : "");
const dash = "—";
/** Each device remembers its own 江波圖 scale (2026-10-27: 放大 by default). */
const MINI_SCALE_KEY = "day-tycoon-watch-mini-scale-v1";
const MINI_SCALES = [
  ["zoom", "放大", "每列依當天漲跌放大，昨收在中間"],
  ["fixed", "±10%", "固定昨收上下 10%，各列可直接比強弱"],
] as const;
const toneOf = (value: number | null | undefined, previous: number) =>
  value == null || value === previous ? "flat" : value > previous ? "up" : "down";

/**
 * 自選報價 as a broker table: the TAIEX first, then the lesson's stocks, each with its 江波圖. Prices move with
 * the replayed trades; bid/ask are the teaching book's (模擬). Volume columns would need verified volume.
 */
export function WatchTable({
  catalog,
  session,
  code,
  compact = false,
  indexSelected,
  onSelect,
  onIndex,
}: {
  catalog: MorningCatalog;
  session: LiveMorningState | null;
  code: string;
  compact?: boolean;
  /** Phones: whether 行情 shows the index (a toggle); desktops leave it out (the row only points at the pane). */
  indexSelected?: boolean;
  onSelect: (code: string) => void;
  /** Where the index can be shown (the desktop's 大盤 pane, the phone's 行情 page); without it the row is static. */
  onIndex?: () => void;
}) {
  const index = session?.index;
  const indexQuote = index ? indexSummary(index.bars, index.previousClose) : null;
  const endT = catalog.maxCursor * 60;
  const columns = compact
    ? ["商品", "成交", "漲跌%", "江波"]
    : ["商品", "成交", "漲跌", "漲跌%", "買進", "賣出", "最高", "最低", "江波圖"];
  // The server renders 放大; the device's own choice is read once mounted.
  const [scale, setScale] = useState<MiniScale>("zoom");
  useEffect(() => setScale(parseMiniScale(readDeviceValue(browserStorage(), MINI_SCALE_KEY))), []);
  const chooseScale = (next: MiniScale) => {
    setScale(next);
    writeDeviceValue(browserStorage(), MINI_SCALE_KEY, next);
  };
  return (
    <section className="td-watch-table" data-compact={compact} aria-label="自選報價">
      <div className="td-titlebar td-watch-head">
        <span>
          <CandlestickChart aria-hidden /> 自選報價
        </span>
        <span className="td-watch-note">分鐘內跳動為模擬逐筆 · 買進賣出為模擬五檔</span>
        <span className="td-segment td-mini-scale" role="group" aria-label="江波圖刻度">
          {MINI_SCALES.map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              aria-pressed={scale === value}
              title={hint}
              onClick={() => chooseScale(value)}
            >
              {label}
            </button>
          ))}
        </span>
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
            {indexQuote?.last == null ? dash : <IndexPoints value={indexQuote.last} />}
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
          <MiniJiangbo
            bars={index?.bars ?? []}
            previous={index?.previousClose ?? 0}
            endT={endT}
            scale={scale}
            empty={
              indexAvailability({ hasRun: Boolean(session), series: index }) === "none"
                ? "無大盤資料"
                : undefined
            }
          />
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
              aria-pressed={indexSelected !== true && code === symbol.code}
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
              <MiniJiangbo bars={bars} previous={symbol.previousClose} endT={endT} scale={scale} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Index points with the decimals in their own span, which phones hide in the compact list. */
function IndexPoints({ value }: { value: number }) {
  const [whole, decimals] = formatIndexValue(value).split(".");
  return (
    <>
      {whole}
      {decimals && <span className="td-watch-decimals">.{decimals}</span>}
    </>
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
  /** Phones only (a real toggle); left out, the row is a plain button. */
  selected?: boolean;
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
      {selected === undefined && <span className="sr-only">，前往右上大盤區</span>}
    </button>
  ) : (
    <div className="td-watch-row" data-code="TAIEX" data-tone={tone} data-static="true">
      {children}
    </div>
  );
}

/**
 * 江波圖 (mini): the revealed minute closes against the previous close, centred, with the whole lesson as its
 * time axis. 放大 zooms each row to its own moves so far (±1/2/3/5/10%); ±10% is the big 江波 view's scale.
 */
export function MiniJiangbo({
  bars,
  previous,
  endT,
  scale,
  empty = "等待開盤",
}: {
  bars: readonly Candle[];
  previous: number;
  endT: number;
  scale: MiniScale;
  /** What an empty row says: waiting for 09:00 by default, or that the lesson has no such data. */
  empty?: string;
}) {
  if (!bars.length) return <span className="td-mini td-mini-empty">{empty}</span>;
  const band = scale === "zoom" ? miniZoomBand(previous, bars) : JIANGBO_BAND;
  return <MiniCanvas bars={bars} previous={previous} endT={endT} band={band} />;
}

function MiniCanvas({
  bars,
  previous,
  endT,
  band,
}: {
  bars: readonly Candle[];
  previous: number;
  endT: number;
  band: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useDeviceCanvas(ref, (ctx, width, height) =>
    paintMiniJiangbo(ctx, width, height, bars, previous, endT, band),
  );
  return (
    <canvas ref={ref} className="td-mini" data-band={band} title={miniScaleLabel(band)} aria-hidden="true" />
  );
}

function paintMiniJiangbo(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bars: readonly Candle[],
  previous: number,
  endT: number,
  band: number,
) {
  const style = getComputedStyle(ctx.canvas);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const up = read("--color-up", "#ff5468");
  const down = read("--color-down", "#1cd78a");
  const tape = read("--color-tape", "#e6c25a");
  // Device pixels per CSS pixel on each axis: a fractional CSS width makes them differ slightly, so y is
  // snapped with the vertical scale and x with the horizontal one.
  const transform = ctx.getTransform();
  const sx = transform.a > 0 ? transform.a : 1;
  const sy = transform.d > 0 ? transform.d : 1;
  const hairline = hairlineDevicePixels(Math.min(sx, sy));
  const strokePx = sparkStrokePx(Math.min(sx, sy));
  const layout = sparklineLayout({
    bars,
    previous,
    startT: 0,
    endT,
    width,
    height,
    band,
    // Every pixel of height counts: 1px above and below, the line on whole device pixels.
    pad: { x: 2, y: 1 },
    device: { scale: sy, strokePx },
  });
  const base = layout.previousY;
  if (Number.isFinite(base)) {
    // The previous close: a faint solid hairline under everything. Dashes broke up the price line hugging it.
    ctx.save();
    ctx.strokeStyle = tape;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = hairline / sy;
    const y = snapStroke(base, sy, hairline);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.restore();
    // Shade between each run and the previous close, as the big 江波 view does.
    ctx.save();
    ctx.globalAlpha = 0.18;
    for (const run of layout.runs) {
      if (run.points.length < 2) continue;
      ctx.fillStyle = run.above ? up : down;
      ctx.beginPath();
      ctx.moveTo(run.points[0]!.x, base);
      for (const point of run.points) ctx.lineTo(point.x, point.y);
      ctx.lineTo(run.points.at(-1)!.x, base);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.save();
  ctx.lineWidth = strokePx / sy;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const run of layout.runs) {
    ctx.strokeStyle = run.above ? up : down;
    ctx.beginPath();
    run.points.forEach((point, index) =>
      index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y),
    );
    ctx.stroke();
  }
  ctx.restore();
  if (layout.last) {
    ctx.fillStyle = layout.last.above ? up : down;
    ctx.beginPath();
    ctx.arc(layout.last.x, layout.last.y, 1.75, 0, Math.PI * 2);
    ctx.fill();
  }
}
