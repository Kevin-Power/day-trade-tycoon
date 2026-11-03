import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Minus, Plus } from "@/lib/icons";
import type { MorningCatalog } from "@/lib/morning";
import { referencePrice, type LiveMorningState } from "@/lib/morning-live";
import { MAX_LOTS, MIN_LOTS, clampLots } from "@/lib/morning-lots";
import { phoneTrade, tapAllowed } from "@/lib/phone-trade";

/** How long a large buy's first tap waits for the second one. */
const ARM_MS = 6000;
/** How long a button says 未送出 after a send the classroom did not take. */
const MISSED_MS = 4000;

/**
 * Phones' 行情 (2026-11-04, the owner: 「江波圖、買進按鈕、買完馬上看到庫存，通通在一個手機畫面搞定」): one row
 * pinned above the bottom tabs. 買進 sends a market order of the lots chosen at once, 賣出 the whole holding; while the
 * learner's order waits, its progress and 撤回 take their place. The 下單 tab keeps the full ticket (限價, any lots).
 * A tap just after the row changed under the finger is ignored, and 撤回 sits where 「－」 is (a repeated tap there
 * does no harm), so a double tap never confirms a large buy, sells the holding or withdraws an order.
 */
export function PhoneTradeBar({
  catalog,
  session,
  serverReference,
  code,
  lots,
  onLots,
  atEnd,
  busy,
  onOrder,
  onCancel,
}: {
  catalog: MorningCatalog;
  session: LiveMorningState;
  /** The last trade of the newest minute the classroom revealed (it prices a market buy at it). */
  serverReference: number | null;
  code: string;
  lots: number;
  onLots: (lots: number) => void;
  atEnd: boolean;
  busy: boolean;
  onOrder: (side: "buy" | "sell", lots: number, revision: number) => Promise<boolean>;
  onCancel: (id: string) => Promise<void>;
}) {
  const [sending, setSending] = useState<"buy" | "sell" | null>(null);
  const [missed, setMissed] = useState<"buy" | "sell" | null>(null);
  const [armedFor, setArmedFor] = useState<{ code: string; lots: number; at: number } | null>(null);
  const submitting = useRef(false);
  const armed = Boolean(armedFor && armedFor.code === code && armedFor.lots === lots);
  useEffect(() => {
    if (!armedFor) return;
    const timer = window.setTimeout(() => setArmedFor(null), ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armedFor]);
  useEffect(() => {
    if (!missed) return;
    const timer = window.setTimeout(() => setMissed(null), MISSED_MS);
    return () => window.clearTimeout(timer);
  }, [missed]);
  const names = Object.fromEntries(catalog.symbols.map((symbol) => [symbol.code, symbol.name]));
  const view = phoneTrade({
    session,
    code,
    names,
    lots,
    reference: referencePrice(session, code, catalog.symbols.find((symbol) => symbol.code === code)?.previousClose),
    serverReference,
    atEnd,
    busy: busy || sending !== null,
    sending,
    missed,
    armed,
  });
  // When the row last turned into the waiting order or back into the buttons (not when it first appears).
  const changedAt = useRef<number | null>(null);
  const shownKind = useRef(view.kind);
  useLayoutEffect(() => {
    if (shownKind.current === view.kind) return;
    shownKind.current = view.kind;
    changedAt.current = Date.now();
  }, [view.kind]);
  const steady = () => tapAllowed(changedAt.current, Date.now());

  async function send(side: "buy" | "sell", count: number) {
    if (submitting.current) return;
    submitting.current = true;
    setSending(side);
    setMissed(null);
    setArmedFor(null);
    try {
      if (!(await onOrder(side, count, session.revision))) setMissed(side);
    } finally {
      submitting.current = false;
      setSending(null);
    }
  }

  if (view.kind === "waiting")
    return (
      <div className="td-tradebar" data-state="waiting" role="group" aria-label="快速下單">
        <button
          type="button"
          className="td-tradebar-cancel"
          disabled={busy}
          onClick={() => {
            if (steady()) void onCancel(view.orderId);
          }}
        >
          撤回
        </button>
        <p className="td-tradebar-wait" role="status">
          <strong>{view.text}</strong>
          <span>{view.progress}</span>
        </p>
      </div>
    );
  return (
    <div className="td-tradebar" role="group" aria-label="快速下單">
      <div className="td-tradebar-lots" role="group" aria-label="買進張數">
        <button
          type="button"
          aria-label="少買一張"
          disabled={lots <= MIN_LOTS}
          onClick={() => onLots(clampLots(lots - 1))}
        >
          <Minus aria-hidden />
        </button>
        <output aria-live="polite">
          {lots}
          <small> 張</small>
        </output>
        <button
          type="button"
          aria-label="多買一張"
          disabled={lots >= MAX_LOTS}
          onClick={() => onLots(clampLots(lots + 1))}
        >
          <Plus aria-hidden />
        </button>
      </div>
      <button
        type="button"
        className="td-tradebar-buy"
        data-armed={armed || undefined}
        disabled={!view.buy.enabled}
        onClick={() => {
          if (!steady()) return;
          if (view.buy.tap === "arm") setArmedFor({ code, lots, at: Date.now() });
          // The confirming tap only counts once the 確認買進 it answers has been on screen a moment.
          else if (!armed || tapAllowed(armedFor?.at ?? null, Date.now())) void send("buy", lots);
        }}
      >
        <strong>{view.buy.label}</strong> <small>{view.buy.sub}</small>
      </button>
      <button
        type="button"
        className="td-tradebar-sell"
        disabled={!view.sell.enabled}
        onClick={() => {
          if (steady()) void send("sell", view.sell.lots);
        }}
      >
        <strong>{view.sell.label}</strong> <small>{view.sell.sub}</small>
      </button>
    </div>
  );
}
