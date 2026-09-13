import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useGame } from "@/lib/game/store";
import { SIM_ACCOUNT, venueLabel, type TimeInForce } from "@/lib/broker";
import { LOT_SHARES, ROUND_TRIP_RATE, stepTick } from "@/lib/market/ticks";
import { cn, formatMoney, formatPct } from "@/lib/utils";

const TIF: TimeInForce[] = ["ROD", "IOC", "FOK"];

export function OrderTicket({ variant = "full" }: { variant?: "full" | "phone" }) {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const ticket = useGame((s) => s.ticket);
  const setTicket = useGame((s) => s.setTicket);
  const submit = useGame((s) => s.submit);
  const flattenSelected = useGame((s) => s.flattenSelected);
  const venue = useGame((s) => s.venue);
  const setVenue = useGame((s) => s.setVenue);
  const accountId = useGame((s) => s.accountId);
  const paused = useGame((s) => s.paused);
  const scenario = useGame((s) => s.scenario);
  const frame = useGame((s) => s.frame);
  void frame;
  const q = engine?.quote(selected);
  const name = q?.name ?? "";
  const price =
    ticket.price > 0 ? ticket.price : ticket.side === "buy" ? (q?.ask ?? 0) : (q?.bid ?? 0);
  const notional = (ticket.type === "market" ? (q?.last ?? 0) : price) * ticket.lots * LOT_SHARES;
  const vsPrev = q && price > 0 ? ((price - q.prevClose) / q.prevClose) * 100 : 0;
  const vsVwap = q && price > 0 && q.vwap > 0 ? ((price - q.vwap) / q.vwap) * 100 : 0;
  const thin = Math.abs(vsVwap) < ROUND_TRIP_RATE * 100 * 0.9;
  const st = engine?.stats();
  const tooBig = st ? notional > st.equity * 0.3 : false;
  const buy = ticket.side === "buy";
  const examPaused = paused && scenario?.id === "tycoon";

  if (variant === "phone") {
    return (
      <div className="border-t border-border bg-surface px-2 py-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="rounded-xs bg-tape/15 px-1.5 py-0.5 text-2xs tracking-wide text-tape">模擬盤</span>
          <span className="font-mono text-sm tabular">
            {selected} {name}
          </span>
        </div>
        {examPaused && <p className="mb-1 text-sm text-warn">期末考不可在暫停中下單</p>}
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[1, 2, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setTicket({ lots: n })}
                className={cn(
                  "h-11 min-w-11 rounded-sm border border-border-strong px-3 text-sm",
                  ticket.lots === n ? "bg-header-2 text-fg" : "bg-bg text-muted",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <Button
            size="md"
            variant="buy"
            className="h-12 min-h-12 flex-1 text-base"
            disabled={examPaused}
            onClick={() => {
              setTicket({ side: "buy" });
              submit();
            }}
          >
            買進
          </Button>
          <Button
            size="md"
            variant="sell"
            className="h-12 min-h-12 flex-1 text-base"
            disabled={examPaused}
            onClick={() => {
              const pos = engine?.positions.get(selected);
              if (pos && pos.lots !== 0) flattenSelected();
              else {
                setTicket({ side: "sell" });
                submit();
              }
            }}
          >
            賣出／平倉
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="pane-title flex h-8 items-center justify-between px-2">
        <span>委託下單</span>
        <span className="font-mono text-sm text-fg/80">現股當沖 · 1 張 = 1,000 股</span>
      </div>
      <div className="flex items-center justify-between border-b border-border bg-elevated/80 px-2 py-1">
        <span className="rounded-xs bg-tape/15 px-1.5 py-0.5 text-2xs tracking-wide text-tape">模擬盤</span>
        <span className="text-sm text-muted">非實盤 · 成交走教室撮合</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-elevated/60 px-2 py-1.5">
        <Field label="帳號">
          <span className="font-mono">{accountId || SIM_ACCOUNT}</span>
        </Field>
        <Field label="盤別">
          <span className="text-tape">現股當沖</span>
        </Field>
        <Field label="通路">
          <span className="inline-flex overflow-hidden rounded-xs border border-border">
            <button
              type="button"
              onClick={() => setVenue("sim")}
              className={cn(
                "h-6 px-2 text-2xs",
                venue === "sim" ? "bg-header-2 text-fg" : "text-muted hover:text-fg",
              )}
            >
              模擬
            </button>
            <button
              type="button"
              onClick={() => setVenue("live")}
              className="h-6 px-2 text-2xs text-muted hover:text-fg"
            >
              實盤
            </button>
          </span>
        </Field>
        <Field label="TIF">
          <span className="inline-flex overflow-hidden rounded-xs border border-border">
            {TIF.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTicket({ tif: t })}
                className={cn(
                  "h-6 px-1.5 font-mono text-2xs",
                  ticket.tif === t ? "bg-header-2 text-fg" : "text-muted hover:text-fg",
                )}
              >
                {t}
              </button>
            ))}
          </span>
        </Field>
        <span className="ml-auto font-mono text-2xs text-muted">{venueLabel(venue)}</span>
      </div>

      <div className="grid flex-1 grid-cols-2 gap-2 p-2 sm:grid-cols-12">
        <div className="col-span-2 flex flex-col justify-center rounded-sm border border-border bg-bg px-2 py-1.5 sm:col-span-3">
          <div className="text-2xs tracking-wide text-muted">商品</div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-sm tabular">{selected}</span>
            <span className="text-xs">{name}</span>
          </div>
        </div>

        <div className="col-span-2 flex rounded-sm bg-bg p-0.5 sm:col-span-3">
          <button
            type="button"
            onClick={() => setTicket({ side: "buy" })}
            className={cn(
              "h-11 flex-1 rounded-xs text-sm font-medium",
              buy ? "bg-up text-fg" : "text-muted hover:text-fg",
            )}
          >
            買進
          </button>
          <button
            type="button"
            onClick={() => setTicket({ side: "sell" })}
            className={cn(
              "h-11 flex-1 rounded-xs text-sm font-medium",
              !buy ? "bg-down text-bg" : "text-muted hover:text-fg",
            )}
          >
            賣出
          </button>
        </div>

        <div className="flex rounded-sm bg-bg p-0.5 sm:col-span-2">
          <button
            type="button"
            onClick={() => setTicket({ type: "limit" })}
            className={cn(
              "h-11 flex-1 rounded-xs text-xs",
              ticket.type === "limit" ? "bg-elevated text-fg" : "text-muted",
            )}
          >
            限價
          </button>
          <button
            type="button"
            onClick={() => setTicket({ type: "market" })}
            className={cn(
              "h-11 flex-1 rounded-xs text-xs",
              ticket.type === "market" ? "bg-elevated text-fg" : "text-muted",
            )}
          >
            市價
          </button>
        </div>

        <label className="flex h-11 items-center gap-1 rounded-sm border border-border bg-bg px-2 text-sm sm:col-span-2">
          <span className="text-muted">張數</span>
          <button
            type="button"
            className="size-8 text-lg text-muted hover:text-fg"
            onClick={() => setTicket({ lots: Math.max(1, ticket.lots - 1) })}
          >
            –
          </button>
          <input
            type="number"
            min={1}
            max={200}
            value={ticket.lots}
            onChange={(e) => setTicket({ lots: Math.max(1, Number(e.target.value) || 1) })}
            className="min-w-0 flex-1 bg-transparent text-center font-mono tabular outline-none"
          />
          <button
            type="button"
            className="size-8 text-lg text-muted hover:text-fg"
            onClick={() => setTicket({ lots: Math.min(200, ticket.lots + 1) })}
          >
            +
          </button>
        </label>

        <div className="col-span-2 flex h-11 items-center gap-1 rounded-sm border border-border bg-bg px-2 text-sm sm:col-span-2">
          <span className="text-muted">價格</span>
          <button
            type="button"
            className="size-8 text-lg text-muted hover:text-fg"
            onClick={() => setTicket({ price: stepTick(price, -1), type: "limit" })}
          >
            –
          </button>
          <input
            type="number"
            step="any"
            value={ticket.type === "market" ? "" : price || ""}
            placeholder="市價"
            onChange={(e) => setTicket({ price: Number(e.target.value), type: "limit" })}
            className="min-w-0 flex-1 bg-transparent text-center font-mono text-sm tabular outline-none"
            disabled={ticket.type === "market"}
          />
          <button
            type="button"
            className="size-8 text-lg text-muted hover:text-fg"
            onClick={() => setTicket({ price: stepTick(price, 1), type: "limit" })}
          >
            +
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-2 py-2">
        <div className="min-w-0 flex-1 font-mono text-sm">
          <div className="flex flex-wrap items-center gap-x-3 text-muted">
            <span>
              預估 <span className="text-fg">{formatMoney(notional)}</span>
            </span>
            <span>來回 {(ROUND_TRIP_RATE * 100).toFixed(2)}%</span>
            <span>距昨 {formatPct(vsPrev)}</span>
            <span>距均 {formatPct(vsVwap)}</span>
          </div>
          {examPaused && <div className="mt-0.5 text-warn">期末考不可在暫停中下單</div>}
          {!examPaused && (thin || tooBig) && (
            <div className="mt-0.5 text-warn">
              {tooBig ? "超過權益 30%，先降張數。" : "偏離均價不夠費稅，這筆要靠方向。"}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {[1, 2, 5, 10].map((n) => (
            <Button key={n} size="xs" variant="subtle" onClick={() => setTicket({ lots: n })}>
              {n} 張
            </Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={flattenSelected} disabled={examPaused}>
          平倉此檔
        </Button>
        <Button size="md" variant={buy ? "buy" : "sell"} onClick={submit} className="min-w-28" disabled={examPaused}>
          {buy ? "送出買進" : "送出賣出"}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-2xs text-muted">
      <span>{label}</span>
      <span className="text-fg">{children}</span>
    </label>
  );
}
