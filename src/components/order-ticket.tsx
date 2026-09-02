import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { KV, PaneTitle, Segmented } from "@/components/ui/pane";
import { Arrow, toneClass } from "@/components/signed";
import { useGame } from "@/lib/game/store";
import { SIM_ACCOUNT, type TimeInForce, type Venue } from "@/lib/broker";
import { formatPrice, LOT_SHARES, ROUND_TRIP_RATE, stepTick } from "@/lib/market/ticks";
import { cn, formatMoney, formatPct } from "@/lib/utils";

const TIF: TimeInForce[] = ["ROD", "IOC", "FOK"];
const QUICK_LOTS = [1, 2, 5, 10];

type OrderType = "limit" | "market";

/**
 * Brokerage-style vertical ticket. Sized by its content so it never gets
 * squeezed: on the desk it sits under the book in the right rail, on phones
 * it is the top of the 下單 tab. Kept under ~340px tall so a 768px-high
 * laptop still shows the whole ticket without scrolling.
 */
export function OrderTicket() {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const ticket = useGame((s) => s.ticket);
  const setTicket = useGame((s) => s.setTicket);
  const submit = useGame((s) => s.submit);
  const flattenSelected = useGame((s) => s.flattenSelected);
  const venue = useGame((s) => s.venue);
  const setVenue = useGame((s) => s.setVenue);
  const accountId = useGame((s) => s.accountId);
  const frame = useGame((s) => s.frame);
  void frame;
  const q = engine?.quote(selected);
  const name = q?.name ?? "";
  const buy = ticket.side === "buy";
  const market = ticket.type === "market";
  const price =
    ticket.price > 0 ? ticket.price : ticket.side === "buy" ? (q?.ask ?? 0) : (q?.bid ?? 0);
  const unit = market ? (q?.last ?? 0) : price;
  const notional = unit * ticket.lots * LOT_SHARES;
  const vsPrev = q && price > 0 ? ((price - q.prevClose) / q.prevClose) * 100 : 0;
  const vsVwap = q && price > 0 && q.vwap > 0 ? ((price - q.vwap) / q.vwap) * 100 : 0;
  const thin = Math.abs(vsVwap) < ROUND_TRIP_RATE * 100 * 0.9;
  const st = engine?.stats();
  const tooBig = st ? notional > st.equity * 0.3 : false;
  const hasPosition = (engine?.positions.get(selected)?.lots ?? 0) !== 0;

  return (
    <div className="flex flex-col bg-surface">
      <PaneTitle className="justify-between px-2">
        <span>委託下單</span>
        <span className="font-mono text-micro text-fg/80">{accountId || SIM_ACCOUNT}</span>
      </PaneTitle>

      <div className="flex h-7 items-center gap-2 border-b border-border bg-elevated/50 px-2 text-2xs">
        <span className="text-muted">通路</span>
        <Segmented<Venue>
          value={venue}
          onChange={setVenue}
          className="h-[22px]"
          options={[
            { id: "sim", label: "模擬" },
            { id: "live", label: "實盤", title: "券商 API 尚未接線" },
          ]}
        />
        <span className="text-tape">現股當沖</span>
        <span className="ml-auto text-muted">TIF</span>
        <Segmented<TimeInForce>
          value={ticket.tif}
          onChange={(tif) => setTicket({ tif })}
          className="h-[22px]"
          itemClassName="font-mono"
          options={TIF.map((t) => ({ id: t, label: t }))}
        />
      </div>

      <div className="flex h-8 items-baseline gap-1.5 border-b border-border px-2 pt-1.5">
        <span className="font-mono text-base leading-none tabular">{selected}</span>
        <span className="text-sm leading-none">{name}</span>
        {q && (
          <span
            className={cn("ml-auto font-mono text-xs leading-none tabular", toneClass(q.change))}
          >
            <Arrow n={q.change} /> {formatPrice(q.last)} {formatPct(q.changePct)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5 p-2">
        <div className="grid grid-cols-2 gap-1" role="group" aria-label="買賣別">
          <button
            type="button"
            aria-pressed={buy}
            onClick={() => setTicket({ side: "buy" })}
            className={cn(
              "h-8 rounded-sm border text-sm font-medium transition-colors",
              buy
                ? "border-up bg-up text-fg shadow-[inset_0_-2px_0_rgb(0_0_0/0.25)]"
                : "border-border bg-bg text-muted hover:border-up/60 hover:text-up",
            )}
          >
            買進
          </button>
          <button
            type="button"
            aria-pressed={!buy}
            onClick={() => setTicket({ side: "sell" })}
            className={cn(
              "h-8 rounded-sm border text-sm font-medium transition-colors",
              !buy
                ? "border-down bg-down text-bg shadow-[inset_0_-2px_0_rgb(0_0_0/0.2)]"
                : "border-border bg-bg text-muted hover:border-down/60 hover:text-down",
            )}
          >
            賣出
          </button>
        </div>

        {/* 限價/市價 doubles as the price row's label: the type decides whether the price is live. */}
        <Row
          label={
            <Segmented<OrderType>
              value={ticket.type}
              onChange={(type) => setTicket({ type })}
              className="h-7 w-full"
              itemClassName="px-1"
              options={[
                { id: "limit", label: "限價" },
                { id: "market", label: "市價" },
              ]}
            />
          }
        >
          <Stepper
            onDec={() => setTicket({ price: stepTick(price, -1), type: "limit" })}
            onInc={() => setTicket({ price: stepTick(price, 1), type: "limit" })}
            className={cn(market && "opacity-70")}
          >
            <input
              type="number"
              inputMode="decimal"
              step="any"
              aria-label="委託價格"
              value={market ? "" : price || ""}
              placeholder={market ? "市價" : ""}
              disabled={market}
              onChange={(e) => setTicket({ price: Number(e.target.value), type: "limit" })}
              className="h-full w-full bg-transparent text-center font-mono text-sm tabular outline-none placeholder:text-muted disabled:text-muted"
            />
          </Stepper>
        </Row>

        <Row label={<span className="pl-1 text-2xs text-muted">張數</span>}>
          <Stepper
            onDec={() => setTicket({ lots: Math.max(1, ticket.lots - 1) })}
            onInc={() => setTicket({ lots: Math.min(200, ticket.lots + 1) })}
          >
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={200}
              aria-label="委託張數"
              value={ticket.lots}
              onChange={(e) => setTicket({ lots: Math.max(1, Number(e.target.value) || 1) })}
              className="h-full w-full bg-transparent text-center font-mono text-sm tabular outline-none"
            />
          </Stepper>
        </Row>

        <Row label={null}>
          <div className="grid grid-cols-4 gap-1">
            {QUICK_LOTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setTicket({ lots: n })}
                aria-pressed={ticket.lots === n}
                className={cn(
                  "h-5 rounded-xs border font-mono text-2xs transition-colors",
                  ticket.lots === n
                    ? "border-header-2 bg-header-2/50 text-fg"
                    : "border-border bg-bg text-muted hover:border-border-strong hover:text-fg",
                )}
              >
                {n} 張
              </button>
            ))}
          </div>
        </Row>

        <div className="grid grid-cols-2 gap-x-3 gap-y-px rounded-sm border border-border bg-bg px-2 py-1 text-2xs">
          <KV k="預估金額" v={formatMoney(notional)} valueClassName="text-xs" />
          <KV k="來回成本" v={`${(ROUND_TRIP_RATE * 100).toFixed(2)}%`} />
          <KV k="距昨收" v={formatPct(vsPrev)} tone={toneClass(vsPrev)} />
          <KV k="距均價" v={formatPct(vsVwap)} tone={toneClass(vsVwap)} />
        </div>

        {(thin || tooBig) && (
          <p className="flex items-start gap-1 text-2xs leading-snug text-warn">
            <span aria-hidden>⚠</span>
            <span>{tooBig ? "超過權益 30%，先降張數。" : "偏離均價不夠費稅，這筆要靠方向。"}</span>
          </p>
        )}

        <div className="flex gap-1.5">
          <Button
            size="md"
            variant={buy ? "buy" : "sell"}
            onClick={submit}
            className="h-9 flex-1 text-sm"
          >
            {buy ? "送出買進" : "送出賣出"}
            <span className="font-mono text-2xs opacity-75">Enter</span>
          </Button>
          <Button
            size="md"
            variant="outline"
            onClick={flattenSelected}
            disabled={!hasPosition}
            className="h-9 px-3 text-xs"
          >
            平倉此檔
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-1.5">
      <div className="min-w-0">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Stepper({
  onDec,
  onInc,
  children,
  className,
}: {
  onDec: () => void;
  onInc: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-7 items-stretch overflow-hidden rounded-sm border border-border bg-bg focus-within:border-ring",
        className,
      )}
    >
      <button
        type="button"
        onClick={onDec}
        aria-label="減"
        className="w-8 shrink-0 text-base leading-none text-muted transition-colors hover:bg-elevated hover:text-fg"
      >
        –
      </button>
      <div className="min-w-0 flex-1 border-x border-border">{children}</div>
      <button
        type="button"
        onClick={onInc}
        aria-label="加"
        className="w-8 shrink-0 text-base leading-none text-muted transition-colors hover:bg-elevated hover:text-fg"
      >
        +
      </button>
    </div>
  );
}
