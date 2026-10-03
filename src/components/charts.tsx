import { useEffect, useId, useRef, useState } from "react";
import type { Bar, TickPt } from "@/lib/game/types";
import {
  canvasResolution,
  chartLinePoints,
  chartWindow,
  inChartWindow,
  minuteColumnWidth,
  nearestTimePoint,
  splitPriceLine,
  timeAxisTicks,
  type ChartRange,
} from "@/lib/market/chart-data";
import { formatPrice } from "@/lib/market/ticks";
import { formatIndex } from "@/lib/market/week";
import { formatTime } from "@/lib/utils";
import type { SwingHighResult } from "@/lib/market/swing-highs";

export type TapeChartProps = {
  bars: Bar[];
  ticks: TickPt[];
  prev: number;
  high: number;
  low: number;
  last: number;
  open?: number;
  cost?: number;
  poc?: number;
  fills?: { t: number; p: number; side: "buy" | "sell" }[];
  newsAt?: number[];
  showVolume?: boolean;
  startT: number;
  endT: number;
  now: number;
  variant?: "index" | "stock" | "jiangbo" | "candles";
  /** Optional visible interval, always bounded by the lesson and current time. */
  range?: ChartRange;
  interactive?: boolean;
  ariaLabel?: string;
  swingHighs?: SwingHighResult["confirmed"];
};

function tokens(canvas: HTMLCanvasElement) {
  const style = getComputedStyle(canvas);
  const senior = document.documentElement.dataset.readingMode === "senior";
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    bg: read("--color-bg", "#080d14"),
    grid: read("--color-border", "#243040"),
    muted: read("--color-muted", "#8b9bb0"),
    up: read("--color-up", "#ff3b3b"),
    down: read("--color-down", "#17c964"),
    fg: read("--color-fg", "#e6edf5"),
    tape: read("--color-tape", "#e8c547"),
    vol: read("--color-vol", "#c084fc"),
    vwap: read("--color-vwap", "#9eb6d4"),
    warn: read("--color-warn", "#e7b549"),
    font: read("--font-mono", "ui-monospace, monospace"),
    fontSize: Math.max(senior ? 16 : 12, (parseFloat(style.fontSize) || 16) * 0.75),
  };
}

type Cursor = { x: number; keyboard?: boolean } | null;

export function TapeChart(props: TapeChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  const cursor = useRef<Cursor>(null);
  const redraw = useRef<() => void>(() => {});
  const readoutId = useId();
  const [readout, setReadout] = useState("");

  // Keep observers stable even when the simulator supplies new arrays each tick.
  useEffect(() => {
    latest.current = props;
    redraw.current();
  });
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let frame = 0;
    let disposed = false;
    const draw = () => {
      frame = 0;
      if (disposed) return;
      const { width, height } = canvas.getBoundingClientRect();
      if (width < 8 || height < 8) return;
      const size = canvasResolution(width, height, window.devicePixelRatio);
      if (canvas.width !== size.width) canvas.width = size.width;
      if (canvas.height !== size.height) canvas.height = size.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(size.scaleX, 0, 0, size.scaleY, 0, 0);
      const description = paint(
        ctx,
        width,
        height,
        latest.current,
        tokens(canvas),
        latest.current.interactive === false ? null : cursor.current,
      );
      setReadout(description ?? "");
    };
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(draw);
    };
    redraw.current = schedule;
    const resize = new ResizeObserver(schedule);
    resize.observe(canvas);
    const changes = new MutationObserver(schedule);
    for (let element: HTMLElement | null = canvas; element; element = element.parentElement) {
      changes.observe(element, {
        attributes: true,
        attributeFilter: ["class", "style", "data-market-theme", "data-reading-mode"],
      });
    }
    const palette = window.matchMedia("(prefers-color-scheme: dark)");
    palette.addEventListener("change", schedule);
    let resolution: MediaQueryList | undefined;
    const watchResolution = () => {
      resolution?.removeEventListener("change", watchResolution);
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      resolution.addEventListener("change", watchResolution);
      schedule();
    };
    watchResolution();
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    document.fonts?.addEventListener("loadingdone", schedule);
    void document.fonts?.ready.then(schedule);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
      palette.removeEventListener("change", schedule);
      resolution?.removeEventListener("change", watchResolution);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      document.fonts?.removeEventListener("loadingdone", schedule);
      redraw.current = () => {};
    };
  }, []);

  const clear = () => {
    cursor.current = null;
    redraw.current();
  };
  const interact = props.interactive !== false;
  const label = props.ariaLabel ??
    `${props.variant === "candles" ? "K 線" : "價格走勢"}與${props.showVolume ? "成交量，" : ""}最新報價 ${props.variant === "index" ? formatIndex(props.last) : formatPrice(props.last)}`;
  return (
    <div className="relative h-full w-full">
      <canvas
        ref={ref}
        className="block h-full w-full"
        style={{ touchAction: "pan-y pinch-zoom" }}
        role="img"
        aria-describedby={interact ? readoutId : undefined}
        tabIndex={interact ? 0 : undefined}
        aria-label={
          `${label}。${interact ? "點按或移動游標查看資料，方向鍵移動，Escape 關閉。" : ""}`
        }
        onPointerDown={(event) => {
          if (interact) {
            event.currentTarget.focus({ preventScroll: true });
            cursor.current = { x: event.clientX - event.currentTarget.getBoundingClientRect().left };
            redraw.current();
          }
        }}
        onPointerMove={(event) => {
          if (interact && (event.pointerType === "mouse" || event.buttons > 0)) {
            cursor.current = { x: event.clientX - event.currentTarget.getBoundingClientRect().left };
            redraw.current();
          }
        }}
        onPointerLeave={(event) => { if (event.pointerType === "mouse") clear(); }}
        onPointerCancel={clear}
        onBlur={clear}
        onKeyDown={(event) => {
          if (event.key === "Escape") clear();
          if (!interact || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
          event.preventDefault();
          const width = event.currentTarget.getBoundingClientRect().width;
          cursor.current = {
            x: Math.min(
              width - 12,
              Math.max(
                12,
                (cursor.current?.x ?? width / 2) +
                  (event.key === "ArrowRight" ? 1 : -1) * Math.max(8, width / 30),
              ),
            ),
            keyboard: true,
          };
          redraw.current();
        }}
      />
      {interact && <output id={readoutId} className="sr-only" aria-live="polite" aria-atomic="true">{readout || "點按圖表或按左右方向鍵，查看所選時間的行情。"}</output>}
    </div>
  );
}

function paint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opt: TapeChartProps,
  c: ReturnType<typeof tokens>,
  cursor: Cursor,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);
  const isIndex = opt.variant === "index";
  const isCandles = opt.variant === "candles";
  const window = chartWindow({ ...opt, wave: opt.variant === "jiangbo" });
  const bars = inChartWindow(opt.bars, window).filter((bar) =>
    [bar.o, bar.h, bar.l, bar.c, bar.v].every(Number.isFinite),
  );
  const ticks = inChartWindow(opt.ticks, window).filter((point) => Number.isFinite(point.p));
  const points = chartLinePoints({
    bars,
    ticks,
    variant: opt.variant,
    current:
      window.dataEnd >= opt.now && opt.now >= window.start
        ? { t: opt.now, p: opt.last }
        : undefined,
  });
  const current =
    window.dataEnd >= opt.now ? opt.last : (points.at(-1)?.p ?? bars.at(-1)?.c ?? opt.prev);
  const label = (price: number) => (isIndex ? formatIndex(price) : formatPrice(price));
  const font = `${c.fontSize}px ${c.font}`;
  ctx.font = font;
  const axisWidth = Math.max(
    ...[opt.prev, current, ...bars.flatMap((bar) => [bar.h, bar.l])].map(
      (price) => ctx.measureText(label(price)).width,
    ),
    30,
  );
  const padL = Math.ceil(axisWidth + 12);
  const padR = Math.ceil(axisWidth + 14);
  const padT = c.fontSize;
  const axisH = c.fontSize + 12;
  const volH = opt.showVolume ? Math.max(32, h * 0.21) : 0;
  const plotW = w - padL - padR;
  const plotH = h - padT - axisH - volH - 4;
  if (plotW < 15 || plotH < 20) return;
  const values = [
    opt.prev,
    current,
    opt.open ?? opt.prev,
    opt.cost,
    opt.poc,
    ...(opt.variant === "jiangbo" && !opt.range ? [opt.high, opt.low] : []),
    ...bars.flatMap((bar) => [bar.h, bar.l]),
    ...points.map((point) => point.p),
  ].filter((price): price is number => price !== undefined && Number.isFinite(price) && price > 0);
  const high = Math.max(...values);
  const low = Math.min(...values);
  const span = Math.max((high - low) * 1.16, Math.abs(opt.prev) * 0.003, isIndex ? 40 : 0.05);
  const max = (high + low + span) / 2;
  const yOf = (price: number) => padT + ((max - price) / span) * plotH;
  const timeSpan = Math.max(window.end - window.start, 1);
  const xOf = (time: number) => padL + ((time - window.start) / timeSpan) * plotW;
  const plotBottom = padT + plotH;
  ctx.font = font;
  ctx.lineWidth = 0.75;
  ctx.strokeStyle = c.grid;
  ctx.fillStyle = c.muted;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  const rows = Math.max(2, Math.min(5, Math.floor(plotH / (c.fontSize * 2.6))));
  for (let i = 0; i <= rows; i++) {
    const price = max - (span * i) / rows;
    const y = yOf(price);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(label(price), padL - 7, y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labelWidth = ctx.measureText("09:00").width;
  for (const time of timeAxisTicks(window.start, window.end, plotW, labelWidth)) {
    const x = xOf(time);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, h - axisH);
    ctx.stroke();
    ctx.fillText(formatTime(time).slice(0, 5), x, h - axisH + 4);
  }

  // Every time-based layer is clipped, including volume, indicators and events.
  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, plotW, plotH);
  ctx.clip();
  const reference = (price: number | undefined, color: string, dash: number[]) => {
    if (price === undefined || !Number.isFinite(price) || price <= 0) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(padL, yOf(price));
    ctx.lineTo(w - padR, yOf(price));
    ctx.stroke();
    ctx.restore();
  };
  reference(opt.prev, c.tape, [4, 4]);
  let vwapNow = current;
  if (!isIndex) {
    reference(opt.open, c.muted, [2, 4]);
    reference(opt.cost, c.warn, [6, 3]);
    reference(opt.poc, c.vol, [1, 4]);
    // Accumulate existing session bars before the window to retain the same VWAP definition.
    let weighted = 0;
    let volume = 0;
    let begun = false;
    ctx.beginPath();
    ctx.strokeStyle = c.vwap;
    ctx.lineWidth = 1.25;
    for (const bar of opt.bars) {
      if (bar.t > window.dataEnd || ![bar.t, bar.c, bar.v].every(Number.isFinite)) continue;
      weighted += bar.c * bar.v;
      volume += bar.v;
      vwapNow = volume > 0 ? weighted / volume : bar.c;
      if (bar.t < window.start) continue;
      const x = xOf(bar.t);
      const y = yOf(vwapNow);
      if (!begun) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      begun = true;
    }
    ctx.stroke();
  }
  ctx.save();
  ctx.setLineDash([2, 4]);
  ctx.strokeStyle = c.grid;
  ctx.lineWidth = 1;
  for (const time of opt.newsAt ?? []) {
    if (time < window.start || time > window.dataEnd) continue;
    const x = xOf(time);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, plotBottom);
    ctx.stroke();
  }
  ctx.restore();
  const barWidth = minuteColumnWidth(plotW, timeSpan);
  if (isCandles) {
    for (const bar of bars) {
      const x = xOf(bar.t);
      ctx.strokeStyle = ctx.fillStyle = bar.c >= bar.o ? c.up : c.down;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(x, yOf(bar.h));
      ctx.lineTo(x, yOf(bar.l));
      ctx.stroke();
      const top = Math.min(yOf(bar.o), yOf(bar.c));
      ctx.fillRect(
        x - barWidth / 2,
        top,
        barWidth,
        Math.max(1.5, Math.abs(yOf(bar.o) - yOf(bar.c))),
      );
    }
  } else {
    const runs = isIndex ? [{ above: true, points }] : splitPriceLine(points, opt.prev);
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const run of runs) {
      ctx.strokeStyle = isIndex ? c.tape : run.above ? c.up : c.down;
      ctx.beginPath();
      run.points.forEach((point, i) => {
        if (i) ctx.lineTo(xOf(point.t), yOf(point.p));
        else ctx.moveTo(xOf(point.t), yOf(point.p));
      });
      ctx.stroke();
    }
    const point = points.at(-1);
    if (point) {
      ctx.fillStyle = isIndex ? c.tape : point.p >= opt.prev ? c.up : c.down;
      ctx.beginPath();
      ctx.arc(xOf(point.t), yOf(point.p), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const fill of inChartWindow(opt.fills ?? [], window).slice(0, 48)) {
    if (isIndex) break;
    const x = xOf(fill.t);
    const y = yOf(fill.p);
    const dir = fill.side === "buy" ? 1 : -1;
    ctx.fillStyle = fill.side === "buy" ? c.up : c.down;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 4, y + dir * 7);
    ctx.lineTo(x + 4, y + dir * 7);
    ctx.closePath();
    ctx.fill();
  }
  // These are minute-high intervals; the exact trade second is not in a Bar.
  for (const [index, highPoint] of (opt.swingHighs ?? []).entries()) {
    if (highPoint.confirmedAt > window.dataEnd || highPoint.t < window.start || highPoint.t > window.dataEnd) continue;
    const x = xOf(highPoint.t);
    const y = yOf(highPoint.p);
    const endX = xOf(Math.min(highPoint.t + 60, window.dataEnd));
    const color = index === 0 && opt.swingHighs?.length === 2 ? c.vwap : c.warn;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
    const radius = c.fontSize * 0.7 + 3;
    const badgeX = Math.min(w - padR - radius, Math.max(padL + radius, (x + endX) / 2));
    const badgeY = Math.max(padT + radius, y - radius - 5 - index * radius * 2);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(badgeX, badgeY + radius);
    ctx.lineTo((x + endX) / 2, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, radius, 0, Math.PI * 2);
    ctx.fillStyle = c.bg;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(opt.swingHighs?.length === 2 ? String(index + 1) : "高", badgeX, badgeY);
    ctx.restore();
  }
  ctx.restore();

  if (opt.showVolume) {
    const maxVolume = Math.max(1, ...bars.map((bar) => bar.v));
    const base = h - axisH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, plotBottom + 4, plotW, volH - 4);
    ctx.clip();
    for (const bar of bars) {
      const height = (Math.max(0, bar.v) / maxVolume) * (volH - 8);
      ctx.fillStyle = isIndex
        ? c.vol
        : (isCandles ? bar.c >= bar.o : bar.c >= opt.prev)
          ? c.up
          : c.down;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(xOf(bar.t) - barWidth / 2, base - height, barWidth, height);
    }
    ctx.restore();
  }
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const tagHeight = c.fontSize + 8;
  const tagY = Math.min(plotBottom - tagHeight / 2, Math.max(padT + tagHeight / 2, yOf(current)));
  ctx.fillStyle = current >= opt.prev ? c.up : c.down;
  ctx.fillRect(w - padR + 3, tagY - tagHeight / 2, padR - 5, tagHeight);
  ctx.fillStyle = c.bg;
  ctx.fillText(label(current), w - padR / 2 + 1, tagY);
  const marks = [{ text: "昨", price: opt.prev, color: c.tape }];
  if (!isIndex) {
    if (opt.open) marks.push({ text: "開", price: opt.open, color: c.muted });
    if (bars.length) marks.push({ text: "均", price: vwapNow, color: c.vwap });
    if (opt.cost) marks.push({ text: "成", price: opt.cost, color: c.warn });
    if (opt.poc) marks.push({ text: "堆", price: opt.poc, color: c.vol });
    if (opt.variant === "jiangbo" && !opt.range && opt.high > opt.low) {
      marks.push(
        { text: "壓", price: opt.high, color: c.up },
        { text: "撐", price: opt.low, color: c.down },
      );
    }
  }
  const visibleMarks = marks
    .map((mark) => ({ ...mark, y: yOf(mark.price) }))
    .sort((a, b) => a.y - b.y);
  const markGap = c.fontSize + 3;
  let lastMarkY = padT - markGap / 2;
  ctx.textAlign = "left";
  for (const mark of visibleMarks) {
    const y = Math.max(lastMarkY + markGap, mark.y - c.fontSize / 2);
    if (y > plotBottom - c.fontSize / 2) continue;
    ctx.fillStyle = mark.color;
    ctx.fillText(mark.text, padL + 4, y);
    lastMarkY = y;
  }
  if (!points.length && !bars.length) {
    ctx.fillStyle = c.muted;
    ctx.textAlign = "center";
    ctx.fillText("此區間尚無資料", padL + plotW / 2, padT + plotH / 2);
  }

  if (cursor && (cursor.keyboard || (cursor.x >= padL && cursor.x <= w - padR))) {
    const time = window.start + Math.min(1, Math.max(0, (cursor.x - padL) / plotW)) * timeSpan;
    const point = isCandles ? nearestTimePoint(bars, time) : nearestTimePoint(points, time);
    if (!point) return;
    const candle = "c" in point ? point : undefined;
    const price = candle ? candle.c : (point as TickPt).p;
    const x = xOf(point.t);
    const y = yOf(price);
    ctx.save();
    ctx.strokeStyle = c.fg;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, h - axisH);
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.restore();
    const fields = candle
      ? [formatTime(point.t).slice(0, 5), `開 ${label(candle.o)}`, `收 ${label(candle.c)}`, `高 ${label(candle.h)}`, `低 ${label(candle.l)}`, `量 ${candle.v} 張`]
      : [formatTime(point.t), `價格 ${label(price)}`];
    ctx.font = font;
    const lines: string[] = [];
    let line = "";
    for (const field of fields) {
      const next = line ? `${line}  ${field}` : field;
      if (line && ctx.measureText(next).width > w - 32) {
        lines.push(line);
        line = field;
      } else line = next;
    }
    if (line) lines.push(line);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const boxWidth = Math.min(
      w - 16,
      Math.max(...lines.map((line) => ctx.measureText(line).width)) + 16,
    );
    const boxHeight = lines.length * (c.fontSize + 7) + 9;
    const boxX = Math.max(8, Math.min(w - boxWidth - 8, x - boxWidth / 2));
    ctx.fillStyle = c.bg;
    ctx.fillRect(boxX, 3, boxWidth, boxHeight);
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, 3, boxWidth, boxHeight);
    ctx.fillStyle = c.fg;
    lines.forEach((line, i) =>
      ctx.fillText(line, boxX + 8, 8 + i * (c.fontSize + 7), boxWidth - 16),
    );
    return fields.join("，");
  }
  return "";
}
