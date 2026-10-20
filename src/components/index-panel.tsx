import { useRef } from "react";
import type { MorningIndexSeries } from "@/lib/morning";
import { formatIndexValue, indexSummary } from "@/lib/morning-index";
import {
  deviceDashPattern,
  hairlineDevicePixels,
  jiangboPriceRange,
  snapEdge,
  snapStroke,
  splitPriceLine,
} from "@/lib/market/chart-data";
import { useDeviceCanvas } from "@/components/use-device-canvas";

const arrow = (tone: "up" | "down" | "flat") => (tone === "up" ? "▲" : tone === "down" ? "▼" : "");
const SESSION_END = 4.5 * 3600; // 13:30

/**
 * 大盤指數: the lesson's real TAIEX (TWSE 5-second values) up to the revealed minute, replayed with its real
 * points while a minute plays. `placeholder` explains an empty panel (no run yet, or no index in the lesson).
 */
export function IndexPanel({
  series,
  clock,
  placeholder,
}: {
  series: MorningIndexSeries | undefined;
  clock: string;
  placeholder: string;
}) {
  const bars = series?.bars ?? [];
  const head = (
    <header className="td-titlebar td-index-head">
      <span>
        {series?.name ?? "加權指數"} <small>TAIEX</small>
      </span>
      <span className="td-chip" data-kind="real">
        證交所 每 5 秒
      </span>
    </header>
  );
  if (!series || !bars.length)
    return (
      <section className="td-index-panel" aria-label="大盤指數">
        {head}
        <p className="td-index-empty">{placeholder}</p>
      </section>
    );
  const quote = indexSummary(bars, series.previousClose);
  return (
    <section className="td-index-panel" data-tone={quote.tone} aria-label="大盤指數">
      {head}
      <div className="td-index-quote">
        <strong className="td-index-value td-num">
          {quote.last === null ? "—" : formatIndexValue(quote.last)}
        </strong>
        <span className="td-index-change td-num">
          {arrow(quote.tone)}
          {quote.changeText} {quote.percentText}
        </span>
        <time>{clock}</time>
      </div>
      <IndexChart series={series} />
      <dl className="td-index-stats">
        {(
          [
            ["開盤", quote.open],
            ["最高", quote.high],
            ["最低", quote.low],
            ["昨收", series.previousClose],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="td-num">{value === null ? "—" : formatIndexValue(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function IndexChart({ series }: { series: MorningIndexSeries }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const points = series.bars.flatMap((bar) =>
    bar.p.map((value, index) => ({ t: bar.t + (index + 1) * 5, p: value })),
  );
  useDeviceCanvas(ref, (ctx, width, height) =>
    paintIndex(ctx, width, height, points, series.previousClose),
  );
  const last = points.at(-1);
  return (
    <canvas
      ref={ref}
      className="td-index-chart"
      role="img"
      aria-label={`加權指數今日走勢，證交所每 5 秒資料，${last ? `最新 ${formatIndexValue(last.p)}` : "尚未揭露"}，虛線為昨收 ${formatIndexValue(series.previousClose)}`}
    />
  );
}

function paintIndex(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  points: { t: number; p: number }[],
  previous: number,
) {
  const style = getComputedStyle(ctx.canvas);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const up = read("--color-up", "#ff5468");
  const down = read("--color-down", "#1cd78a");
  const tape = read("--color-tape", "#e6c25a");
  const muted = read("--color-muted", "#9eacb9");
  const grid = read("--color-border", "#1a232e");
  // Device pixels per CSS pixel on each axis (they differ slightly when the CSS width is fractional): vertical
  // rules snap with the horizontal scale, horizontal rules with the vertical one.
  const transform = ctx.getTransform();
  const sx = transform.a > 0 ? transform.a : 1;
  const sy = transform.d > 0 ? transform.d : 1;
  const hairline = hairlineDevicePixels(Math.min(sx, sy));
  const left = 4;
  const right = width - 58;
  const top = 6;
  const bottom = height - 16;
  const range = jiangboPriceRange(
    previous,
    Math.max(...points.map((point) => point.p)),
    Math.min(...points.map((point) => point.p)),
    0.005,
  );
  const span = Math.max(range.max - range.min, Number.EPSILON);
  const yOf = (value: number) => top + ((range.max - value) / span) * (bottom - top);
  const xOf = (t: number) => left + (t / SESSION_END) * (right - left);
  ctx.font = `11px ${read("--font-mono", "monospace")}`;
  ctx.textBaseline = "middle";
  // Hour grid and labels.
  ctx.fillStyle = muted;
  ctx.strokeStyle = grid;
  ctx.lineWidth = hairline / sx;
  for (const [t, label] of [
    [0, "09"],
    [3600, "10"],
    [7200, "11"],
    [10800, "12"],
    [14400, "13"],
  ] as const) {
    const x = snapStroke(xOf(t), sx, hairline);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.textAlign = t === 0 ? "left" : "center";
    ctx.fillText(label, x, height - 7);
  }
  // Previous close (dashed) and the price labels on the right.
  ctx.save();
  ctx.strokeStyle = tape;
  ctx.lineWidth = hairline / sy;
  ctx.setLineDash(deviceDashPattern([3, 3], sx));
  const base = snapStroke(yOf(previous), sy, hairline);
  ctx.beginPath();
  // The dash starts on a whole device pixel, so every dash (whole device pixels long) has crisp ends.
  ctx.moveTo(snapEdge(left, sx), base);
  ctx.lineTo(snapEdge(right, sx), base);
  ctx.stroke();
  ctx.restore();
  ctx.textAlign = "left";
  for (const [value, color] of [
    [range.max, up],
    [previous, tape],
    [range.min, down],
  ] as const) {
    ctx.fillStyle = color;
    ctx.fillText(
      formatIndexValue(value).replace(/\.\d+$/, ""),
      right + 6,
      Math.min(bottom, Math.max(top + 5, yOf(value))),
    );
  }
  if (!points.length) return;
  const runs = splitPriceLine(points, previous, 30);
  ctx.save();
  ctx.globalAlpha = 0.16;
  for (const run of runs) {
    if (run.points.length < 2) continue;
    ctx.fillStyle = run.above ? up : down;
    ctx.beginPath();
    ctx.moveTo(xOf(run.points[0]!.t), yOf(previous));
    for (const point of run.points) ctx.lineTo(xOf(point.t), yOf(point.p));
    ctx.lineTo(xOf(run.points.at(-1)!.t), yOf(previous));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.lineWidth = 1.25;
  ctx.lineJoin = "round";
  for (const run of runs) {
    ctx.strokeStyle = run.above ? up : down;
    ctx.beginPath();
    run.points.forEach((point, index) => {
      if (index) ctx.lineTo(xOf(point.t), yOf(point.p));
      else ctx.moveTo(xOf(point.t), yOf(point.p));
    });
    ctx.stroke();
  }
  const last = points.at(-1)!;
  ctx.fillStyle = last.p >= previous ? up : down;
  ctx.beginPath();
  ctx.arc(xOf(last.t), yOf(last.p), 2.5, 0, Math.PI * 2);
  ctx.fill();
}
