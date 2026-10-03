import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { TradePlanEntry } from "@/components/trade-plan";
import { ClassroomSimMark, ProvenanceBadge, ProvenanceMicro } from "@/components/provenance";
import { useGame } from "@/lib/game/store";
import { orderPresentation } from "@/lib/game/order-presentation";
import { estimateExecution, executionInputReason } from "@/lib/market/execution";
import {
  parseLotsDraft,
  parsePriceDraft,
  TICKET_LOTS_ERROR,
  TICKET_PRICE_ERROR,
  validateTicketDraft,
} from "@/lib/game/ticket-draft";
import {
  LIVE_UNWIRED_REASON,
  SIM_ACCOUNT,
  SIM_TIF_HINT,
  simAllowsTif,
  venueLabel,
  type TimeInForce,
} from "@/lib/broker";
import { blotterMicro } from "@/lib/provenance";
import { formatPrice, LOT_SHARES, stepTick } from "@/lib/market/ticks";
import { cn, formatMoney } from "@/lib/utils";

const TIF: TimeInForce[] = ["ROD", "IOC", "FOK"];
const TIF_LABELS: Record<TimeInForce, string> = {
  ROD: "ROD・留單等待",
  IOC: "IOC・剩餘取消",
  FOK: "FOK・全成或全撤",
};
const TIF_HELP: Record<TimeInForce, string> = {
  ROD: "未成交部分繼續等待，直到取消或本次練習結束。",
  IOC: "立即撮合；能成交多少就成交多少，其餘立即取消。",
  FOK: "目前五檔必須足夠讓整筆成交，否則整筆取消。",
};

export function OrderTicket() {
  const lotsHelpId = useId();
  const priceHelpId = useId();
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const ticket = useGame((s) => s.ticket);
  const ticketDraft = useGame((s) => s.ticketDraft);
  const setTicket = useGame((s) => s.setTicket);
  const editTicketDraft = useGame((s) => s.editTicketDraft);
  const submit = useGame((s) => s.submit);
  const flattenSelected = useGame((s) => s.flattenSelected);
  const venue = useGame((s) => s.venue);
  const setVenue = useGame((s) => s.setVenue);
  const flashOrder = useGame((s) => s.flashOrder);
  const setFlashOrder = useGame((s) => s.setFlashOrder);
  const accountId = useGame((s) => s.accountId);
  const frame = useGame((s) => s.frame);
  const setMobileTab = useGame((s) => s.setMobileTab);
  const setRightTab = useGame((s) => s.setRightTab);
  const setOrderScope = useGame((s) => s.setOrderScope);
  void frame;
  const q = engine?.quote(selected);
  const name = q?.name ?? "";
  const lots = parseLotsDraft(ticketDraft.lots);
  const enteredPrice = parsePriceDraft(ticketDraft.price);
  const draft = validateTicketDraft(ticketDraft, ticket.type);
  const price = enteredPrice ?? (ticket.side === "buy" ? (q?.ask ?? 0) : (q?.bid ?? 0));
  const executionInput = draft.ok ? { side: ticket.side, type: ticket.type, lots: draft.lots, price: draft.price ?? undefined, tif: ticket.tif } : null;
  const executionReason = executionInput ? executionInputReason(executionInput) : null;
  const preview = q && executionInput && !executionReason ? estimateExecution(q, executionInput) : null;
  const notional = ticket.type === "market" ? preview?.notional ?? 0 : (enteredPrice ?? 0) * (lots ?? 0) * LOT_SHARES;
  const st = engine?.stats();
  const tooBig = st ? notional > st.equity * 0.3 : false;
  const buy = ticket.side === "buy";
  const latestOrder = engine?.orders[0];
  const latestOutcome = latestOrder ? orderPresentation(latestOrder) : null;
  const heldLots = Math.abs(engine?.positions.get(selected)?.lots ?? 0);

  return (
    <div data-order-ticket-start tabIndex={-1} className="trade-ticket flex h-full min-h-0 flex-col bg-surface outline-none">
      <div className="pane-title flex min-h-12 flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span>委託下單</span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="hidden font-mono text-micro text-fg/80 sm:inline">
            現股當沖 · 1 張 = 1,000 股
          </span>
          <ClassroomSimMark />
          <ProvenanceBadge kind="classroom" />
        </span>
      </div>
      <ProvenanceMicro text={blotterMicro()} />
      <TradePlanEntry />

      <details className="border-b border-border bg-bg-1">
        <summary className="cursor-pointer px-3 py-2.5 text-xs text-muted">
          更多下單設定 · 模擬帳戶
        </summary>
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
                    aria-pressed={ticket.tif === t}
                    title={allowed ? TIF_HELP[t] : SIM_TIF_HINT}
                    onClick={() => setTicket({ tif: t })}
                    className={cn(
                      "min-h-11 whitespace-normal px-2 py-2 text-sm leading-6",
                      ticket.tif === t
                        ? "bg-header-2 text-fg"
                        : allowed
                          ? "text-muted hover:text-fg"
                          : "text-subtle",
                    )}
                  >
                    {TIF_LABELS[t]}
                  </button>
                );
              })}
            </span>
            <span className="w-full text-sm leading-6 text-muted">{TIF_HELP[ticket.tif]}</span>
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
                onClick={() => setMobileTab("flash")}
                className={cn(
                  "h-6 px-1.5 text-2xs",
                  flashOrder ? "bg-header-2 text-tape" : "text-muted hover:text-fg",
                )}
              >
                開啟專用頁
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

        <div
          className="ticket-side col-span-2 flex min-w-0 rounded-sm bg-bg p-0.5 sm:col-span-3"
          role="group"
          aria-label="買進或賣出"
        >
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

        <div
          className="ticket-type flex min-w-0 rounded-sm bg-bg p-0.5 sm:col-span-2"
          role="group"
          aria-label="委託方式"
        >
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
            onClick={() => setTicket({ lots: lots === null ? 1 : Math.max(1, lots - 1) })}
          >
            –
          </button>
          <input
            type="text"
            aria-label="委託張數"
            aria-invalid={lots === null}
            aria-describedby={lots === null ? lotsHelpId : undefined}
            inputMode="numeric"
            maxLength={12}
            value={ticketDraft.lots}
            onChange={(e) => editTicketDraft("lots", e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-center font-mono tabular outline-none"
          />
          <button
            type="button"
            aria-label="增加張數"
            className="size-8 text-lg text-muted hover:text-fg"
            onClick={() => setTicket({ lots: lots === null ? 1 : Math.min(200, lots + 1) })}
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
            type="text"
            aria-label="委託價格"
            aria-invalid={ticket.type === "limit" && enteredPrice === null}
            aria-describedby={ticket.type === "limit" && enteredPrice === null ? priceHelpId : undefined}
            inputMode="decimal"
            maxLength={20}
            value={ticket.type === "market" ? "" : ticketDraft.price}
            placeholder={ticket.type === "market" ? "市價" : "輸入價格"}
            onChange={(e) => editTicketDraft("price", e.target.value)}
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

      {!draft.ok && (
        <div className="border-t border-border px-3 py-2 text-base leading-7 text-warn lg:text-sm" role="status">
          {lots === null && <p id={lotsHelpId}>{TICKET_LOTS_ERROR}</p>}
          {ticket.type === "limit" && enteredPrice === null && (
            <p id={priceHelpId}>{TICKET_PRICE_ERROR}</p>
          )}
        </div>
      )}

      {executionReason && <p role="status" className="px-3 py-2 text-base leading-7 text-warn">{executionReason}</p>}

      <section aria-label="送出前核對" className="border-t border-border bg-bg-1 px-3 py-3 text-base leading-7 lg:text-sm lg:leading-6">
        <h3 className="font-semibold">送出前核對：{selected} {name}・{buy ? "買進" : "賣出"} {lots ?? "—"} 張</h3>
        <p>{ticket.type === "market" ? "市價" : `限價 ${enteredPrice === null ? "尚未完成" : formatPrice(enteredPrice)}`} · {TIF_LABELS[ticket.tif]}</p>
        <p className="text-muted">{TIF_HELP[ticket.tif]}</p>
        {preview ? (
          <dl className="mt-2 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            <div className="flex flex-wrap justify-between gap-x-3"><dt>五檔可立即成交</dt><dd>{preview.filledLots}／{lots} 張</dd></div>
            <div className="flex flex-wrap justify-between gap-x-3"><dt>預估成交均價</dt><dd>{preview.averagePrice === null ? "尚無可成交量" : preview.averagePrice.toFixed(2)}</dd></div>
            <div className="flex flex-wrap justify-between gap-x-3"><dt>可成交部分金額</dt><dd>{formatMoney(preview.notional)} 元</dd></div>
            <div className="flex flex-wrap justify-between gap-x-3"><dt>該部分費稅估算</dt><dd>{formatMoney(preview.fee + preview.tax)} 元</dd></div>
          </dl>
        ) : <p className="mt-2 text-muted">完成正確的張數與價格後，這裡會顯示五檔估算。</p>}
        {st && <p className="mt-2 text-muted">可用模擬資金 {formatMoney(st.availableCash)} 元；待買委託占用 {formatMoney(st.reservedCash)} 元。</p>}
        <p className="mt-2 text-sm leading-6 text-muted">依目前生成五檔估算，送出時仍會核對資金與庫存；行情變動會改變成交結果。均價可能跨多個價位。</p>
      </section>

      <div className="order-actions flex flex-wrap items-center gap-2 border-t border-border px-3 py-3">
        <div className="order-summary min-w-0 flex-1 font-mono text-xs">
          <div className={cn("mb-0.5", flashOrder ? "text-tape" : "text-muted")}>
            {flashOrder ? "閃電即送 · 點賣檔限價買、點買檔限價賣" : "點五檔帶入價格與買賣方向"}
          </div>
          <p className="text-muted">核對上方成交估算與可用資金，再送出。</p>
          {ticket.type === "market" && (
            <p className="mt-1 text-muted">市價依可成交五檔估算，未成交量不保證會成交。</p>
          )}
          {tooBig && (
            <div className="mt-0.5 text-warn">
              本筆估算金額超過模擬權益 30%。
            </div>
          )}
        </div>
        <div className="ticket-presets flex flex-wrap gap-2" role="group" aria-label="快速選擇張數">
          {[1, 2, 5, 10].map((n) => (
            <Button
              key={n}
              size="xs"
              variant="subtle"
              aria-pressed={lots === n}
              onClick={() => setTicket({ lots: n })}
            >
              {n} 張
            </Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={flattenSelected} disabled={heldLots === 0} className="ticket-flatten">
          平倉此檔
        </Button>
        <Button
          size="md"
          variant={buy ? "buy" : "sell"}
          onClick={submit}
          disabled={!draft.ok || Boolean(executionReason)}
          className="ticket-submit min-w-28"
        >
          {buy ? "送出買進" : "送出賣出"}
        </Button>
      </div>
      <p className="px-3 pb-3 text-sm leading-6 text-muted">平倉此檔會先取消此商品待單，再按可用五檔平倉。量不足時仍會留下庫存，請核對結果。</p>
      {latestOrder && latestOutcome && (
        <section aria-label="最近一筆委託結果" className="m-3 mt-0 rounded-xl border border-border-strong bg-bg-1 p-3 text-base leading-7 lg:text-sm">
          <h3 className="font-semibold">最近委託 {latestOrder.id} · {latestOrder.code} {latestOrder.side === "buy" ? "買進" : "賣出"}</h3>
          <p role="status">{latestOutcome.statusLabel}：已成交 {latestOrder.filled}／{latestOrder.lots} 張</p>
          <p>等待 {latestOutcome.waitingLots} 張 · 已取消 {latestOutcome.cancelledLots} 張</p>
          {latestOrder.cancelReason && <p className="text-muted">{latestOrder.cancelReason}</p>}
          <button type="button" className="mt-2 min-h-12 w-full rounded-lg border border-border-strong px-3 py-2 font-medium" onClick={() => {
            setOrderScope("all");
            setRightTab("orders");
            setMobileTab("pos");
            document.getElementById("mobile-tab-pos")?.focus();
          }}>查看本盤全部委託</button>
        </section>
      )}
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
