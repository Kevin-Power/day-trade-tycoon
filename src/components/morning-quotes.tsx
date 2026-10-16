import { useRef, useState, type ReactNode } from "react";
import type { Bar } from "@/lib/game/types";
import type { MorningCatalog, MorningState } from "@/lib/morning";
import { formatPrice } from "@/lib/market/ticks";
import { useDeviceCanvas } from "@/components/use-device-canvas";
import {
  deviceDashPattern,
  hairlineDevicePixels,
  snapEdge,
  snapStroke,
  sparklineLayout,
} from "@/lib/market/chart-data";
import { formatTime } from "@/lib/utils";

/** Use only the completed bars already disclosed by the morning API. */
export function MorningSparkline({
  bars,
  previous,
  endT,
}: {
  bars: Bar[];
  previous: number;
  endT: number;
}) {
  if (!bars.length) return <span className="td-spark td-spark-empty">等待開盤</span>;
  return <SparkCanvas bars={bars} previous={previous} endT={endT} />;
}

/** A separate component so the canvas hook mounts with the canvas, not before it. */
function SparkCanvas({ bars, previous, endT }: { bars: Bar[]; previous: number; endT: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useDeviceCanvas(ref, (ctx, width, height) =>
    paintSparkline(ctx, width, height, { bars, previous, startT: 0, endT }),
  );
  return <canvas ref={ref} className="td-spark" aria-hidden="true" />;
}

function paintSparkline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: { bars: Bar[]; previous: number; startT: number; endT: number },
) {
  const style = getComputedStyle(ctx.canvas);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const up = read("--color-up", "#ff3b3b");
  const down = read("--color-down", "#17c964");
  const tape = read("--color-tape", "#e8c547");
  const transform = ctx.getTransform();
  const sx = transform.a > 0 ? transform.a : 1;
  const sy = transform.d > 0 ? transform.d : 1;
  const hairline = hairlineDevicePixels(Math.min(sx, sy));
  const layout = sparklineLayout({ ...input, width, height });
  const base = layout.previousY;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Shade between the line and the previous close, like the big intraday chart.
  if (Number.isFinite(base)) {
    ctx.save();
    ctx.globalAlpha = 0.16;
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
    // The previous close: whole device pixels, so it stays crisp at every screen scale.
    ctx.save();
    // Round caps (set for the price line) would blur both ends of every dash.
    ctx.lineCap = "butt";
    ctx.strokeStyle = tape;
    ctx.lineWidth = hairline / sy;
    ctx.setLineDash(deviceDashPattern([2, 3], sx));
    const y = snapStroke(base, sy, hairline);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(snapEdge(width, sx), y);
    ctx.stroke();
    ctx.restore();
  }
  ctx.lineWidth = 1.5;
  for (const run of layout.runs) {
    if (run.points.length < 2) continue;
    ctx.strokeStyle = run.above ? up : down;
    ctx.beginPath();
    run.points.forEach((point, index) => {
      if (index) ctx.lineTo(point.x, point.y);
      else ctx.moveTo(point.x, point.y);
    });
    ctx.stroke();
  }
  if (layout.last) {
    ctx.fillStyle = layout.last.above ? up : down;
    ctx.beginPath();
    ctx.arc(layout.last.x, layout.last.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function MorningQuoteDetail({
  catalog,
  session,
  code,
  book,
  onPaneChange,
  onSelect,
  selectionDisabled,
}: {
  catalog: MorningCatalog;
  session: MorningState | null;
  code: string;
  book?: ReactNode;
  onPaneChange?: () => void;
  onSelect?: (code: string) => void;
  selectionDisabled?: boolean;
}) {
  const [pane, setPane] = useState<"book" | "quote" | "minutes">(book ? "book" : "quote");
  const changePane = (next: typeof pane) => {
    onPaneChange?.();
    setPane(next);
  };
  const symbol = catalog.symbols.find((item) => item.code === code);
  if (!symbol) return null;
  const bars = session?.bars[code] ?? [];
  const last = bars.at(-1);
  const change = last ? last.c - symbol.previousClose : null;
  const tone = change === null || change === 0 ? "flat" : change > 0 ? "up" : "down";
  const high = bars.length ? Math.max(...bars.map((bar) => bar.h)) : null;
  const low = bars.length ? Math.min(...bars.map((bar) => bar.l)) : null;
  const location =
    last && high !== null && low !== null && high > low
      ? ((last.c - low) / (high - low)) * 100
      : 50;
  return (
    <section className="terminal-quote-detail" data-pane={pane} aria-label="下單行情明細">
      <header className="terminal-pane-bar td-titlebar">
        <nav aria-label="下單行情分類">
          {book && (
            <button type="button" aria-pressed={pane === "book"} onClick={() => changePane("book")}>
              五檔
            </button>
          )}
          <button type="button" aria-pressed={pane === "quote"} onClick={() => changePane("quote")}>
            行情
          </button>
          <button
            type="button"
            aria-pressed={pane === "minutes"}
            onClick={() => changePane("minutes")}
          >
            分鐘明細
          </button>
        </nav>
        {onSelect ? (
          <select
            aria-label="下單商品"
            value={code}
            disabled={selectionDisabled}
            onChange={(event) => onSelect(event.target.value)}
          >
            {catalog.symbols.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} {item.name}
              </option>
            ))}
          </select>
        ) : (
          <span>
            {code} {symbol.name}
          </span>
        )}
      </header>
      <div className="terminal-depth-content">
        {pane === "book" ? (
          book
        ) : pane === "quote" ? (
          <>
            <div className="terminal-detail-price" data-tone={tone}>
              <strong>{last ? formatPrice(last.c) : "—"}</strong>
              <span>
                {change === null
                  ? "待揭露"
                  : `${change > 0 ? "+" : ""}${change.toLocaleString("zh-TW", { maximumFractionDigits: 2 })} (${change > 0 ? "+" : ""}${((change / symbol.previousClose) * 100).toFixed(2)}%)`}
              </span>
            </div>
            <div className="terminal-detail-stamp">
              <span>最新完整分鐘收價</span>
              <time>{last ? formatTime(last.t + 60).slice(0, 5) : "09:00"}</time>
            </div>
            <dl className="terminal-detail-stats">
              {(
                [
                  ["開盤", bars[0]?.o],
                  ["昨收", symbol.previousClose],
                  ["最高", high],
                  ["最低", low],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value == null ? "—" : formatPrice(value)}</dd>
                </div>
              ))}
            </dl>
            <div className="terminal-price-range" aria-label="已揭露區間中的收價位置">
              <span>低 {low === null ? "—" : formatPrice(low)}</span>
              <span>高 {high === null ? "—" : formatPrice(high)}</span>
              <div>
                <i style={{ left: `${location}%` }} />
              </div>
            </div>
          </>
        ) : (
          <div
            className="terminal-minute-tape"
            tabIndex={0}
            role="region"
            aria-label="最近已完成分鐘明細"
          >
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
                {bars
                  .slice(-10)
                  .reverse()
                  .map((bar) => (
                    <tr key={bar.t}>
                      <th scope="row">{formatTime(bar.t).slice(0, 5)}</th>
                      {[bar.o, bar.h, bar.l, bar.c].map((price, index) => (
                        <td key={index}>{formatPrice(price)}</td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
            {!last && <p className="terminal-tape-empty">前進一分鐘後顯示行情明細</p>}
          </div>
        )}
      </div>
      <p className="terminal-data-status">
        <i aria-hidden />
        歷史 1 分 K <span>{book ? "五檔為教學模擬" : "五檔未串接"}</span>
      </p>
    </section>
  );
}
