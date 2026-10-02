import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ClassroomSimMark, ProvenanceBadge, ProvenanceMicro } from "@/components/provenance";
import { useGame } from "@/lib/game/store";
import { LIVE_UNWIRED_REASON, SIM_ACCOUNT, SIM_TIF_HINT, simAllowsTif, venueLabel, type TimeInForce } from "@/lib/broker";
import { blotterMicro } from "@/lib/provenance";
import { LOT_SHARES, ROUND_TRIP_RATE, stepTick } from "@/lib/market/ticks";
import { cn, formatMoney, formatPct } from "@/lib/utils";

const TIF: TimeInForce[] = ["ROD", "IOC", "FOK"];

export function OrderTicket() {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const ticket = useGame((s) => s.ticket);
  const setTicket = useGame((s) => s.setTicket);
  const submit = useGame((s) => s.submit);
  const flattenSelected = useGame((s) => s.flattenSelected);
  const venue = useGame((s) => s.venue);
  const setVenue = useGame((s) => s.setVenue);
  const flashOrder = useGame((s) => s.flashOrder);
  const setFlashOrder = useGame((s) => s.setFlashOrder);
  const accountId = useGame((s) => s.accountId);
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

  return (
    <div className="trade-ticket flex h-full min-h-0 flex-col bg-surface">
      <div className="pane-title flex h-7 items-center justify-between gap-2 px-2">
        <span>委託下單</span>
        <span className="flex items-center gap-1.5">
          <span className="hidden font-mono text-micro text-fg/80 sm:inline">現股當沖 · 1 張 = 1,000 股</span>
          <ClassroomSimMark />
          <ProvenanceBadge kind="classroom" />
        </span>
      </div>
      <ProvenanceMicro text={blotterMicro()} />

      <details className="border-b border-border bg-bg-1">
      <summary className="cursor-pointer px-3 py-2.5 text-xs text-muted">更多下單設定 · 模擬帳戶</summary>
      <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
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
              title={LIVE_UNWIRED_REASON}
              onClick={() => setVenue("live")}
              className="h-6 px-2 text-2xs text-muted hover:text-fg"
            >
              實盤
            </button>
          </span>
        </Field>
        <Field label="TIF">
          <span className="inline-flex overflow-hidden rounded-xs border border-border">
            {TIF.map((t) => {
              const allowed = simAllowsTif(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-disabled={!allowed}
                  title={allowed ? "掛到取消或收盤" : SIM_TIF_HINT}
                  onClick={() => setTicket({ tif: t })}
                  className={cn(
                    "h-6 px-1.5 font-mono text-2xs",
                    ticket.tif === t ? "bg-header-2 text-fg" : allowed ? "text-muted hover:text-fg" : "text-subtle",
                  )}
                >
                  {t}
                </button>
              );
            })}
          </span>
          <span className="text-subtle">{SIM_TIF_HINT}</span>
        </Field>
        <Field label="閃電下單">
          <span className="inline-flex overflow-hidden rounded-xs border border-border">
            <button
              type="button"
              aria-pressed={!flashOrder}
              onClick={() => flashOrder && setFlashOrder(false)}
              className={cn(
                "h-6 px-1.5 text-2xs",
                !flashOrder ? "bg-header-2 text-fg" : "text-muted hover:text-fg",
              )}
            >
              關
            </button>
            <button
              type="button"
              aria-pressed={flashOrder}
              onClick={() => !flashOrder && setFlashOrder(true)}
              className={cn(
                "h-6 px-1.5 text-2xs",
                flashOrder ? "bg-header-2 text-tape" : "text-muted hover:text-fg",
              )}
            >
              開
            </button>
          </span>
        </Field>
        <span className="ml-auto font-mono text-2xs text-muted">{venueLabel(venue)}</span>
      </div>
      </details>

      <div className="ticket-fields grid flex-1 grid-cols-2 gap-2 p-2 sm:grid-cols-12">
        <div className="ticket-product col-span-2 flex min-w-0 flex-col justify-center rounded-sm border border-border bg-bg px-2 py-1.5 sm:col-span-3">
          <div className="text-2xs tracking-wide text-muted">商品</div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-sm tabular">{selected}</span>
            <span className="text-xs">{name}</span>
          </div>
        </div>

        <div className="ticket-side col-span-2 flex min-w-0 rounded-sm bg-bg p-0.5 sm:col-span-3" role="group" aria-label="買進或賣出">
          <button
            type="button"
            aria-pressed={buy}
            onClick={() => setTicket({ side: "buy" })}
            className={cn(
              "h-11 flex-1 rounded-xs text-sm font-medium",
              buy ? "bg-up text-white" : "text-muted hover:text-fg",
            )}
          >
            買進
          </button>
          <button
            type="button"
            aria-pressed={!buy}
            onClick={() => setTicket({ side: "sell" })}
            className={cn(
              "h-11 flex-1 rounded-xs text-sm font-medium",
              !buy ? "bg-down text-white" : "text-muted hover:text-fg",
            )}
          >
            賣出
          </button>
        </div>

        <div className="ticket-type flex min-w-0 rounded-sm bg-bg p-0.5 sm:col-span-2" role="group" aria-label="委託方式">
          <button
            type="button"
            aria-pressed={ticket.type === "limit"}
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
            aria-pressed={ticket.type === "market"}
            onClick={() => setTicket({ type: "market" })}
            className={cn(
              "h-11 flex-1 rounded-xs text-xs",
              ticket.type === "market" ? "bg-elevated text-fg" : "text-muted",
            )}
          >
            市價
          </button>
        </div>

        <div className="ticket-number flex h-11 min-w-0 items-center gap-1 rounded-sm border border-border bg-bg px-2 text-xs sm:col-span-2">
          <span className="ticket-field-label shrink-0 text-muted">張數</span>
          <button
            type="button"
            className="size-8 text-lg text-muted hover:text-fg"
            aria-label="減少張數"
            onClick={() => setTicket({ lots: Math.max(1, ticket.lots - 1) })}
          >
            –
          </button>
          <input
            type="number"
            aria-label="委託張數"
            inputMode="numeric"
            min={1}
            max={200}
            value={ticket.lots}
            onChange={(e) => setTicket({ lots: Math.max(1, Number(e.target.value) || 1) })}
            className="min-w-0 flex-1 bg-transparent text-center font-mono tabular outline-none"
          />
          <button
            type="button"
            aria-label="增加張數"
            className="size-8 text-lg text-muted hover:text-fg"
            onClick={() => setTicket({ lots: Math.min(200, ticket.lots + 1) })}
          >
            +
          </button>
        </div>

        <div className="ticket-number col-span-2 flex h-11 min-w-0 items-center gap-1 rounded-sm border border-border bg-bg px-2 text-xs sm:col-span-2">
          <span className="ticket-field-label shrink-0 text-muted">價格</span>
          <button
            type="button"
            aria-label="降低委託價格"
            className="size-8 text-lg text-muted hover:text-fg"
            onClick={() => setTicket({ price: stepTick(price, -1), type: "limit" })}
          >
            –
          </button>
          <input
            type="number"
            aria-label="委託價格"
            inputMode="decimal"
            step="any"
            value={ticket.type === "market" ? "" : price || ""}
            placeholder="市價"
            onChange={(e) => setTicket({ price: Number(e.target.value), type: "limit" })}
            className="min-w-0 flex-1 bg-transparent text-center font-mono text-sm tabular outline-none"
            disabled={ticket.type === "market"}
          />
          <button
            type="button"
            aria-label="提高委託價格"
            className="size-8 text-lg text-muted hover:text-fg"
            onClick={() => setTicket({ price: stepTick(price, 1), type: "limit" })}
          >
            +
          </button>
        </div>
      </div>

      <div className="order-actions flex flex-wrap items-center gap-2 border-t border-border px-3 py-3">
        <div className="order-summary min-w-0 flex-1 font-mono text-xs">
          <div className={cn("mb-0.5", flashOrder ? "text-tape" : "text-muted")}>
            {flashOrder ? "閃電即送 · 點賣檔限價買、點買檔限價賣" : "點五檔只帶價"}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 text-muted">
            <span>
              預估 <span className="text-fg">{formatMoney(notional)}</span>
            </span>
            <span>來回 {(ROUND_TRIP_RATE * 100).toFixed(2)}%</span>
            <span>距昨 {formatPct(vsPrev)}</span>
            <span>距均 {formatPct(vsVwap)}</span>
          </div>
          {(thin || tooBig) && (
            <div className="mt-0.5 text-warn">
              {tooBig ? "超過權益 30%，先降張數。" : "偏離均價不夠費稅，這筆要靠方向。"}
            </div>
          )}
        </div>
        <div className="ticket-presets flex flex-wrap gap-2" role="group" aria-label="快速選擇張數">
          {[1, 2, 5, 10].map((n) => (
            <Button key={n} size="xs" variant="subtle" aria-pressed={ticket.lots === n} onClick={() => setTicket({ lots: n })}>
              {n} 張
            </Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={flattenSelected} className="ticket-flatten">
          平倉此檔
        </Button>
        <Button size="md" variant={buy ? "buy" : "sell"} onClick={submit} className="ticket-submit min-w-28">
          {buy ? "送出買進" : "送出賣出"}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ticket-setting inline-flex min-w-0 flex-wrap items-center gap-1.5 text-2xs text-muted">
      <span>{label}</span>
      <span className="min-w-0 text-fg">{children}</span>
    </div>
  );
}
