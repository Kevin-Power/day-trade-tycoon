import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { Bar, TickPt } from "@/lib/game/types";
import { formatPrice } from "@/lib/market/ticks";
import { formatIndex } from "@/lib/market/week";
import { formatTime } from "@/lib/utils";

function readToken(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** "#rrggbb" → "rgba(r, g, b, a)"; anything else passes through untouched. */
function withAlpha(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function tokens() {
  return {
    bg: readToken("--color-bg", "#000000"),
    grid: readToken("--color-border", "#243040"),
    muted: readToken("--color-muted", "#8b9bb0"),
    up: readToken("--color-up", "#ff3b3b"),
    down: readToken("--color-down", "#17c964"),
    fg: readToken("--color-fg", "#e6edf5"),
    tape: readToken("--color-tape", "#e8c547"),
    vol: readToken("--color-vol", "#c084fc"),
    vwap: readToken("--color-vwap", "#9eb6d4"),
    warn: readToken("--color-warn", "#e7b549"),
  };
}

type LineChartProps = {
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
  variant?: "index" | "stock" | "jiangbo";
};

/** Plot geometry `paint` used, so the crosshair overlay can map pixels back to time/price. */
type Scale = {
  padL: number;
  padR: number;
  padT: number;
  plotW: number;
  plotH: number;
  yMin: number;
  yMax: number;
  startT: number;
  xSpan: number;
  viewEnd: number;
  isIndex: boolean;
};

type Hover = { x: number; y: number };

type Variant = "index" | "stock" | "jiangbo";

export function TapeChart({
  bars,
  ticks,
  prev,
  high,
  low,
  last,
  open,
  cost,
  poc,
  fills,
  newsAt,
  showVolume,
  startT,
  endT,
  now,
  variant = "stock",
}: LineChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const scaleRef = useRef<Scale | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  // Latest series for the crosshair read-out, without re-binding pointer handlers every frame.
  const dataRef = useRef({ bars, ticks, prev, variant });
  dataRef.current = { bars, ticks, prev, variant };

  const drawCross = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = overlay.width / dpr;
    const h = overlay.height / dpr;
    ctx.clearRect(0, 0, w, h);
    const hv = hoverRef.current;
    const scale = scaleRef.current;
    if (!hv || !scale) return;
    paintCrosshair(ctx, w, h, scale, hv, dataRef.current);
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    const overlay = overlayRef.current;
    const parent = wrapRef.current;
    if (!canvas || !overlay || !parent) return;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w < 8 || h < 8) return;
      for (const el of [canvas, overlay]) {
        if (el.width !== Math.floor(w * dpr) || el.height !== Math.floor(h * dpr)) {
          el.width = Math.floor(w * dpr);
          el.height = Math.floor(h * dpr);
          el.style.width = `${w}px`;
          el.style.height = `${h}px`;
        }
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scaleRef.current = paint(ctx, w, h, {
        bars,
        ticks,
        prev,
        high,
        low,
        last,
        open: open ?? last,
        cost,
        poc,
        fills: fills ?? [],
        newsAt: newsAt ?? [],
        showVolume: !!showVolume,
        startT,
        endT,
        now,
        variant,
      });
      drawCross();
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [
    bars,
    ticks,
    prev,
    high,
    low,
    last,
    open,
    cost,
    poc,
    fills,
    newsAt,
    showVolume,
    startT,
    endT,
    now,
    variant,
    drawCross,
  ]);

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    hoverRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    drawCross();
  };
  const onLeave = () => {
    hoverRef.current = null;
    drawCross();
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full cursor-crosshair touch-none"
      onPointerMove={onMove}
      onPointerDown={onMove}
      onPointerLeave={onLeave}
    >
      <canvas ref={ref} className="block h-full w-full" />
      <canvas
        ref={overlayRef}
        className="pointer-events-none absolute inset-0 block h-full w-full"
        aria-hidden
      />
    </div>
  );
}

/** Closest sample to `t` in a series sorted by time. */
function nearest<T extends { t: number }>(arr: T[], t: number): T | null {
  if (!arr.length) return null;
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = arr[lo]!;
  const b = arr[lo - 1];
  return b && Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a;
}

/** Dashed crosshair, axis tags and a read-out of the sample under the cursor. */
function paintCrosshair(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: Scale,
  hv: Hover,
  data: { bars: Bar[]; ticks: TickPt[]; prev: number; variant: Variant },
) {
  void h;
  const { padL, padT, plotW, plotH } = s;
  if (hv.x < padL || hv.x > padL + plotW || hv.y < padT || hv.y > padT + plotH) return;
  const c = tokens();
  const tOfX = (x: number) => s.startT + ((x - padL) / plotW) * s.xSpan;
  const xOfT = (t: number) => padL + ((t - s.startT) / s.xSpan) * plotW;
  const yOf = (p: number) => padT + ((s.yMax - p) / (s.yMax - s.yMin)) * plotH;
  const pOfY = (y: number) => s.yMax - ((y - padT) / plotH) * (s.yMax - s.yMin);
  const label = (p: number) => (s.isIndex ? formatIndex(p) : formatPrice(p));

  const t = tOfX(hv.x);
  let pt: { t: number; p: number; v?: number } | null = null;
  if (data.variant === "jiangbo" && data.ticks.length) {
    const tk = nearest(data.ticks, t);
    if (tk) pt = { t: tk.t, p: tk.p };
  } else {
    const b = nearest(data.bars, t);
    if (b) pt = { t: b.t, p: b.c, v: b.v };
  }
  const snapX = pt ? xOfT(pt.t) : hv.x;
  const font = "10px IBM Plex Mono, ui-monospace, monospace";

  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = withAlpha(c.fg, 0.45);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(snapX, padT);
  ctx.lineTo(snapX, padT + plotH);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(padL, hv.y);
  ctx.lineTo(padL + plotW, hv.y);
  ctx.stroke();
  ctx.restore();

  ctx.font = font;
  ctx.textBaseline = "middle";

  const ptxt = label(pOfY(hv.y));
  const pw = ctx.measureText(ptxt).width + 8;
  ctx.fillStyle = c.fg;
  ctx.fillRect(padL - pw - 2, hv.y - 8, pw, 16);
  ctx.fillStyle = c.bg;
  ctx.textAlign = "right";
  ctx.fillText(ptxt, padL - 6, hv.y);

  const ttxt = formatTime(pt ? pt.t : t);
  const tw = ctx.measureText(ttxt).width + 10;
  const tx = Math.min(Math.max(snapX - tw / 2, padL), padL + plotW - tw);
  ctx.fillStyle = c.fg;
  ctx.fillRect(tx, padT + plotH + 1, tw, 14);
  ctx.fillStyle = c.bg;
  ctx.textAlign = "center";
  ctx.fillText(ttxt, tx + tw / 2, padT + plotH + 8);

  if (!pt) return;
  const chg = data.prev > 0 ? ((pt.p - data.prev) / data.prev) * 100 : 0;
  const tone = chg >= 0 ? c.up : c.down;
  const lines: { text: string; color: string }[] = [
    { text: `${label(pt.p)}  ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`, color: tone },
  ];
  if (!s.isIndex && pt.v !== undefined) {
    lines.push({ text: `量 ${Math.round(pt.v)} 張`, color: c.muted });
  }
  const boxW = Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + 14;
  const boxH = lines.length * 14 + 8;
  let bx = snapX + 12;
  if (bx + boxW > padL + plotW) bx = snapX - 12 - boxW;
  const by = Math.min(Math.max(hv.y - boxH - 10, padT + 2), padT + plotH - boxH - 2);
  ctx.fillStyle = withAlpha(c.bg, 0.92);
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.strokeStyle = c.grid;
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);
  ctx.textAlign = "left";
  lines.forEach((l, i) => {
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, bx + 7, by + 11 + i * 14);
  });

  ctx.beginPath();
  ctx.arc(snapX, yOf(pt.p), 3, 0, Math.PI * 2);
  ctx.fillStyle = tone;
  ctx.fill();
  ctx.strokeStyle = c.bg;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function paint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opt: {
    bars: Bar[];
    ticks: TickPt[];
    prev: number;
    high: number;
    low: number;
    last: number;
    open: number;
    cost?: number;
    poc?: number;
    fills: { t: number; p: number; side: "buy" | "sell" }[];
    newsAt: number[];
    showVolume: boolean;
    startT: number;
    endT: number;
    now: number;
    variant: Variant;
  },
): Scale | null {
  const c = tokens();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);

  const isIndex = opt.variant === "index";
  const isWave = opt.variant === "jiangbo";
  const padL = isIndex ? 62 : 52;
  const padR = isIndex ? 72 : 58;
  const padT = 8;
  const volH = opt.showVolume ? Math.max(28, h * 0.17) : 0;
  const padB = 18 + volH;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  if (plotW < 10 || plotH < 10) return null;

  const highs = opt.bars.map((b) => b.h);
  const lows = opt.bars.map((b) => b.l);
  const tickPx = opt.ticks.map((tk) => tk.p);
  const hi = Math.max(
    opt.prev,
    opt.last,
    opt.open,
    opt.high,
    opt.cost ?? opt.last,
    opt.poc ?? opt.last,
    ...highs,
    ...tickPx,
  );
  const lo = Math.min(
    opt.prev,
    opt.last,
    opt.open,
    opt.low,
    opt.cost ?? opt.last,
    opt.poc ?? opt.last,
    ...lows,
    ...tickPx,
  );
  const span = Math.max((hi - lo) * 1.18, Math.abs(opt.prev) * 0.003, isIndex ? 40 : 0.05);
  const mid = (hi + lo) / 2;
  const yMax = mid + span / 2;
  const yMin = mid - span / 2;
  const yOf = (p: number) => padT + ((yMax - p) / (yMax - yMin)) * plotH;
  const spanT = Math.max(opt.endT - opt.startT, 60);
  const minView = isWave ? Math.min(spanT, 20 * 60) : spanT;
  const viewEnd = isWave
    ? Math.min(opt.endT, Math.max(opt.now + 90, opt.startT + minView))
    : opt.endT;
  const xSpan = Math.max(viewEnd - opt.startT, 60);
  const xOfT = (t: number) => padL + ((t - opt.startT) / xSpan) * plotW;
  const label = (p: number) => (isIndex ? formatIndex(p) : formatPrice(p));

  ctx.strokeStyle = "#1c2a38";
  ctx.lineWidth = 1;
  ctx.font = "10px IBM Plex Mono, ui-monospace, monospace";
  ctx.fillStyle = c.muted;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const rows = plotH < 90 ? 2 : plotH < 150 ? 3 : plotH < 240 ? 4 : 5;
  for (let i = 0; i <= rows; i++) {
    const p = yMax - ((yMax - yMin) * i) / rows;
    const y = yOf(p);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(label(p), padL - 6, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const step = xSpan <= 2400 ? 300 : xSpan <= 7200 ? 900 : 3600;
  const t0 = Math.ceil(opt.startT / step) * step;
  for (let t = t0; t <= viewEnd + 1; t += step) {
    const x = xOfT(Math.min(viewEnd, Math.max(opt.startT, t)));
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.fillText(formatTime(t).slice(0, 5), x, padT + plotH + 4);
  }

  const prevY = yOf(opt.prev);
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = c.tape;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, prevY);
  ctx.lineTo(w - padR, prevY);
  ctx.stroke();
  ctx.restore();

  if (!isIndex) {
    const openY = yOf(opt.open);
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = c.muted;
    ctx.beginPath();
    ctx.moveTo(padL, openY);
    ctx.lineTo(w - padR, openY);
    ctx.stroke();
    ctx.restore();
  }

  let vwapNow = opt.last;
  if (!isIndex && opt.bars.length) {
    let accP = 0;
    let accV = 0;
    ctx.beginPath();
    ctx.strokeStyle = c.vwap;
    ctx.lineWidth = 1.2;
    opt.bars.forEach((b, i) => {
      accP += b.c * b.v;
      accV += b.v;
      const v = accV > 0 ? accP / accV : b.c;
      vwapNow = v;
      const x = xOfT(b.t);
      const y = yOf(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(xOfT(opt.now), yOf(vwapNow));
    ctx.stroke();
  }

  if (opt.cost && opt.cost > 0 && !isIndex) {
    const cy = yOf(opt.cost);
    ctx.save();
    ctx.setLineDash([6, 3]);
    ctx.strokeStyle = c.warn;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, cy);
    ctx.lineTo(w - padR, cy);
    ctx.stroke();
    ctx.restore();
  }

  if (opt.poc && opt.poc > 0 && !isIndex) {
    const y = yOf(opt.poc);
    ctx.save();
    ctx.setLineDash([1, 4]);
    ctx.strokeStyle = c.vol;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.restore();
  }

  const nowX = xOfT(Math.min(opt.now, viewEnd));
  ctx.save();
  ctx.setLineDash([1, 4]);
  ctx.strokeStyle = "#33455c";
  ctx.beginPath();
  ctx.moveTo(nowX, padT);
  ctx.lineTo(nowX, padT + plotH);
  ctx.stroke();
  ctx.restore();

  const color = isIndex ? c.tape : opt.last >= opt.prev ? c.up : c.down;

  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, plotW, plotH);
  ctx.clip();

  if (isWave && opt.ticks.length > 1) {
    const n = opt.ticks.length;
    // Split the tape into runs above / below yesterday's close, so each run
    // can be shaded toward the reference line and stroked in its own colour.
    type Run = { above: boolean; pts: [number, number][] };
    const runs: Run[] = [];
    const t0 = opt.ticks[0]!;
    let run: Run = { above: t0.p >= opt.prev, pts: [[xOfT(t0.t), yOf(t0.p)]] };
    for (let i = 1; i < n; i++) {
      const a = opt.ticks[i - 1]!;
      const b = opt.ticks[i]!;
      const above = b.p >= opt.prev;
      if (above !== run.above) {
        const den = b.p - a.p;
        const u = Math.abs(den) < 1e-9 ? 0 : (opt.prev - a.p) / den;
        const uu = Math.min(1, Math.max(0, u));
        const xCross = xOfT(a.t) + (xOfT(b.t) - xOfT(a.t)) * uu;
        run.pts.push([xCross, prevY]);
        runs.push(run);
        run = { above, pts: [[xCross, prevY]] };
      }
      run.pts.push([xOfT(b.t), yOf(b.p)]);
    }
    runs.push(run);

    for (const r of runs) {
      if (r.pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(r.pts[0]![0], prevY);
      for (const [x, y] of r.pts) ctx.lineTo(x, y);
      ctx.lineTo(r.pts[r.pts.length - 1]![0], prevY);
      ctx.closePath();
      ctx.fillStyle = withAlpha(r.above ? c.up : c.down, 0.14);
      ctx.fill();
    }

    ctx.lineWidth = 1.55;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const r of runs) {
      ctx.beginPath();
      ctx.strokeStyle = r.above ? c.up : c.down;
      r.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
    }
    const lastTk = opt.ticks[n - 1]!;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(xOfT(lastTk.t), yOf(opt.last), 2.6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    if (opt.bars.length) {
      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, withAlpha(color, 0.22));
      grad.addColorStop(1, withAlpha(color, 0));
      ctx.beginPath();
      ctx.moveTo(xOfT(opt.bars[0]!.t), padT + plotH);
      for (const b of opt.bars) ctx.lineTo(xOfT(b.t), yOf(b.c));
      ctx.lineTo(nowX, yOf(opt.last));
      ctx.lineTo(nowX, padT + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (opt.bars.length) {
      opt.bars.forEach((b, i) => {
        const x = xOfT(b.t);
        const y = yOf(b.c);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineTo(nowX, yOf(opt.last));
    } else {
      ctx.moveTo(xOfT(opt.startT), yOf(opt.last));
      ctx.lineTo(nowX, yOf(opt.last));
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(nowX, yOf(opt.last), 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  if (!isIndex && opt.fills.length) {
    for (const f of opt.fills.slice(0, 48)) {
      const x = xOfT(f.t);
      const y = yOf(f.p);
      if (x < padL - 2 || x > padL + plotW + 2) continue;
      ctx.beginPath();
      ctx.fillStyle = f.side === "buy" ? c.up : c.down;
      ctx.moveTo(x, y);
      if (f.side === "buy") {
        ctx.lineTo(x - 3.5, y + 6);
        ctx.lineTo(x + 3.5, y + 6);
      } else {
        ctx.lineTo(x - 3.5, y - 6);
        ctx.lineTo(x + 3.5, y - 6);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();

  if (opt.newsAt.length) {
    ctx.save();
    ctx.strokeStyle = "#3a4c60";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    for (const t of opt.newsAt) {
      if (t < opt.startT - 20 || t > viewEnd + 20) continue;
      const x = xOfT(t);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (opt.showVolume && opt.bars.length) {
    const maxV = Math.max(...opt.bars.map((b) => b.v), 1);
    const base = h - 6;
    const bw = Math.max(1.4, (plotW / Math.max(opt.bars.length, 8)) * 0.62);
    for (const b of opt.bars) {
      const x = xOfT(b.t);
      const bh = (b.v / maxV) * (volH - 8);
      ctx.fillStyle = b.c >= opt.prev ? c.up : c.down;
      if (isIndex) ctx.fillStyle = c.vol;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x - bw / 2, base - bh, bw, bh);
      ctx.globalAlpha = 1;
    }
  }

  const tag = (text: string, y: number, bg: string) => {
    const yy = Math.min(padT + plotH - 8, Math.max(padT + 8, y));
    ctx.fillStyle = bg;
    ctx.fillRect(w - padR + 3, yy - 8, padR - 6, 16);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "10px IBM Plex Mono, ui-monospace, monospace";
    ctx.fillText(text, w - padR / 2 + 1, yy);
  };

  tag(label(opt.last), yOf(opt.last), opt.last >= opt.prev ? c.up : c.down);

  if (!isIndex) {
    const marks: { text: string; y: number; color: string }[] = [
      { text: "昨", y: prevY, color: c.tape },
      { text: "開", y: yOf(opt.open), color: c.muted },
      { text: "均", y: yOf(vwapNow), color: c.vwap },
    ];
    if (opt.cost && opt.cost > 0) {
      marks.push({ text: "成", y: yOf(opt.cost), color: c.warn });
    }
    if (opt.poc && opt.poc > 0) {
      marks.push({ text: "堆", y: yOf(opt.poc), color: c.vol });
    }
    if (isWave && Math.abs(opt.high - opt.low) > Math.abs(opt.prev) * 0.0012) {
      marks.push({ text: "壓", y: yOf(opt.high), color: c.up });
      marks.push({ text: "撐", y: yOf(opt.low), color: c.down });
    }
    marks.sort((a, b) => a.y - b.y);
    for (let i = 1; i < marks.length; i++) {
      const gap = marks[i]!.y - marks[i - 1]!.y;
      if (gap < 11) marks[i]!.y = marks[i - 1]!.y + 11;
    }
    ctx.font = "9px IBM Plex Mono, ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const m of marks) {
      ctx.fillStyle = m.color;
      ctx.fillText(m.text, padL + 4, Math.min(padT + plotH - 6, m.y));
    }
  }

  return {
    padL,
    padR,
    padT,
    plotW,
    plotH,
    yMin,
    yMax,
    startT: opt.startT,
    xSpan,
    viewEnd,
    isIndex,
  };
}
