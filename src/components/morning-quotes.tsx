import { useId, useState, type ReactNode } from "react";
import type { Bar } from "@/lib/game/types";
import type { MorningCatalog, MorningState } from "@/lib/morning";
import { formatPrice } from "@/lib/market/ticks";
import { formatTime } from "@/lib/utils";

/** Use only the completed bars already disclosed by the morning API. */
export function MorningSparkline({ bars, previous }: { bars: Bar[]; previous: number }) {
  const gradient = useId();
  if (!bars.length) return <span className="terminal-spark-empty">等待開盤</span>;
  const low = Math.min(previous, ...bars.map((bar) => bar.c));
  const high = Math.max(previous, ...bars.map((bar) => bar.c));
  const spread = high - low || previous * 0.002 || 1;
  const start = bars[0].t;
  const span = Math.max(60, bars.at(-1)!.t - start);
  const x = (bar: Bar) => 3 + ((bar.t - start) / span) * 114;
  const y = (price: number) => 7 + ((high - price) / spread) * 42;
  const segments: Bar[][] = [];
  for (const bar of bars) {
    const segment = segments.at(-1);
    if (!segment || bar.t - segment.at(-1)!.t > 60) segments.push([bar]);
    else segment.push(bar);
  }
  const last = bars.at(-1)!;
  return (
    <svg className="terminal-spark" viewBox="0 0 120 58" aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <path
        d={`M0 ${y(previous)}H120`}
        stroke="#607189"
        strokeDasharray="2 3"
        opacity="0.55"
        vectorEffect="non-scaling-stroke"
      />
      {segments.map((segment) => {
        const path = segment
          .map((bar, index) => `${index ? "L" : "M"}${x(bar)} ${y(bar.c)}`)
          .join(" ");
        return (
          <g key={segment[0].t}>
            <path
              d={`${path} L${x(segment.at(-1)!)} 57 L${x(segment[0])} 57 Z`}
              fill={`url(#${gradient})`}
            />
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
      <circle cx={x(last)} cy={y(last.c)} r="2" fill="currentColor" />
    </svg>
  );
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
      <header className="terminal-pane-bar">
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
