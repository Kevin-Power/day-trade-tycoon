import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Clock3, Minus, Plus, Wallet } from "@/lib/icons";
import type { MorningCatalog, MorningState } from "@/lib/morning";
import { ledgerSummary } from "@/lib/morning-ledger";
import { lastTrade, serverSession } from "@/lib/morning-live";
import { formatMoney, formatTime } from "@/lib/utils";
import { estimateRoundTripCost, formatPrice, stepTick } from "@/lib/market/ticks";
import { validMorningLimit } from "@/lib/morning-book";
import { positionMark } from "@/lib/morning-quote";
import { MorningOrderBook } from "@/components/morning-order-book";
import { OrderReports } from "@/components/order-reports";
import { MinuteTable, QuoteDetailGrid, StockTabs } from "@/components/stock-detail";
import { TradeTape } from "@/components/trade-tape";
import { isLargeOrder, orderReports, type LocalOrderFailure } from "@/lib/morning-orders";

export function AccountSummary({ session }: { session: MorningState }) {
  const profit = session.equity - session.startingCash;
  return (
    <section className="sim-account" aria-label="模擬帳戶總覽">
      <div className="sim-account-label">
        <Wallet aria-hidden />
        <span>
          模擬帳戶<small>TWD · 臺股整股</small>
        </span>
      </div>
      <dl>
        <div>
          <dt>可用資金</dt>
          <dd>{formatMoney(session.cash, 0)}</dd>
        </div>
        <div>
          <dt>帳戶估值</dt>
          <dd>{formatMoney(session.equity, 0)}</dd>
        </div>
        <div>
          <dt>本輪損益（含已付費稅）</dt>
          <dd className={profit > 0 ? "text-up" : profit < 0 ? "text-down" : undefined}>
            {profit > 0 ? "+" : ""}
            {formatMoney(profit, 0)}
          </dd>
        </div>
        <div>
          <dt>庫存 / 待撮合</dt>
          <dd>
            {session.positions.length}
            <small> 檔 / </small>
            {session.orders.filter((item) => item.status === "pending").length}
            <small> 筆</small>
          </dd>
        </div>
      </dl>
      <span className="sim-account-note">
        期初 {formatMoney(session.startingCash, 0)}
        <br />
        依已揭露收價估值
      </span>
    </section>
  );
}

export type MorningOrderOptions = { limitPrice?: number; entryMode?: "lightning" };
type OrderReview = {
  side: "buy" | "sell";
  lots: number;
  revision: number;
  sessionId: string;
  limitPrice?: number;
};

/** A waiting paper order and its two actions; the ticket shows it, and so does 下單 while 行情 shows the index. */
export function PendingOrder({
  catalog,
  pending,
  busy,
  canAdvance,
  onAdvance,
  onCancel,
  ref,
}: {
  catalog: MorningCatalog;
  pending: MorningState["orders"][number];
  busy: boolean;
  canAdvance: boolean;
  onAdvance: () => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div role="status" className="sim-pending" ref={ref}>
      <div>
        <Clock3 aria-hidden />
        <strong>委託已送出 · 等待撮合</strong>
      </div>
      <p>
        {pending.code} {catalog.symbols.find((item) => item.code === pending.code)?.name} ·{" "}
        {pending.side === "buy" ? "買進" : "賣出"} {pending.shares / 1000} 張
        {pending.limitPrice === undefined
          ? " · 市價"
          : ` · 限價 ${formatPrice(pending.limitPrice)}`}
        {pending.entryMode === "lightning" && " · 閃電"}
      </p>
      <small>
        {pending.limitPrice === undefined
          ? "前進下一分鐘後，依開盤價與資金／庫存檢核處理。"
          : "之後每分鐘開盤價達限價才成交；未達價繼續留單，可隨時撤回。"}
      </small>
      <div className="sim-pending-actions">
        <button type="button" disabled={busy || !canAdvance} onClick={() => void onAdvance()}>
          前進一分鐘撮合
        </button>
        <button type="button" disabled={busy} onClick={() => void onCancel(pending.id)}>
          撤回委託
        </button>
      </div>
    </div>
  );
}

/**
 * The phone's 行情 book: the same teaching book, display only. A tap hands its price and direction to 下單
 * (a bid buys, an ask sells); nothing is sent from here.
 */
export function DisplayBook({
  catalog,
  session,
  code,
  onPick,
}: {
  catalog: MorningCatalog;
  session: MorningState | null;
  code: string;
  onPick: (price: number, side: "buy" | "sell") => void;
}) {
  const symbol = catalog.symbols.find((item) => item.code === code);
  const trade = session ? lastTrade(session, code, catalog) : null;
  return (
    <MorningOrderBook
      mode="display"
      code={code}
      cursor={session?.cursor ?? 0}
      last={session?.bars[code]?.at(-1)?.c}
      previousClose={symbol?.previousClose ?? 0}
      trade={trade ? { index: trade.index, side: trade.side } : undefined}
      revision={session?.revision ?? 0}
      simulated={Boolean(session && "replay" in session && session.replay)}
      lots={1}
      holdingLots={0}
      flash={false}
      disabled={false}
      onPick={onPick}
    />
  );
}

export function PaperOrder({
  catalog,
  session,
  code,
  busy,
  sending = false,
  atEnd,
  canAdvance,
  variant = "desk",
  failures = [],
  prefill,
  onSelect,
  onPrepare,
  onReview,
  onAdvance,
  onOrder,
  onCancel,
}: {
  catalog: MorningCatalog;
  session: MorningState | null;
  code: string;
  /** The ticket is locked: a request is in flight, or an error or notice waits above the desk. */
  busy: boolean;
  /** This ticket's order is being sent, so the confirm button says 正在處理…; otherwise it keeps its label. */
  sending?: boolean;
  atEnd: boolean;
  canAdvance: boolean;
  /** desk: quote grid + 五檔/明細/分鐘 tabs beside the ticket; phone: only the tradable book above the ticket. */
  variant?: "desk" | "phone";
  /** Sends that failed in this visit, for 委託回報. */
  failures?: readonly LocalOrderFailure[];
  /** A price and side handed over from the display book on the phone's 行情 page (not sent); only for its stock. */
  prefill?: { price: number; side: "buy" | "sell"; nonce: number; code: string };
  onSelect: (code: string) => void;
  onPrepare: () => void;
  onReview: () => void;
  onAdvance: () => Promise<void>;
  onOrder: (
    side: "buy" | "sell",
    lots: number,
    revision: number,
    options?: MorningOrderOptions,
  ) => Promise<boolean>;
  onCancel: (id: string) => Promise<void>;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [lots, setLots] = useState(1);
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  // Limit defaults and the reference amount use the revealed close, never a replayed in-minute price.
  const [limitDraft, setLimitDraft] = useState(() =>
    String((session ? serverSession(session) : null)?.bars[code]?.at(-1)?.c ?? ""),
  );
  const [flash, setFlash] = useState(false);
  const flashRef = useRef(false);
  const [review, setReview] = useState<OrderReview | null>(null);
  // The large-order tick belongs to one review: a new or changed review starts unticked.
  const [largeAckFor, setLargeAckFor] = useState<OrderReview | null>(null);
  // Lightning hands a large order to the confirm card with a note; the note belongs to that review only.
  const [largeNoticeFor, setLargeNoticeFor] = useState<OrderReview | null>(null);
  const submitting = useRef(false);
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const pendingPanel = useRef<HTMLDivElement>(null);
  function changeFlash(enabled: boolean) {
    flashRef.current = enabled;
    setFlash(enabled);
    if (enabled) onReview();
  }
  function changeLots(value: number) {
    flashRef.current = false;
    setFlash(false);
    setLots(value);
  }
  useEffect(() => {
    const disarm = () => {
      flashRef.current = false;
      setFlash(false);
    };
    const hidden = () => {
      if (document.hidden) disarm();
    };
    window.addEventListener("blur", disarm);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      flashRef.current = false;
      window.removeEventListener("blur", disarm);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  useEffect(() => {
    // The ticket remounts per stock: another stock's price is never carried over.
    if (!prefill || prefill.code !== code) return;
    setSide(prefill.side);
    setOrderType("limit");
    setLimitDraft(formatPrice(prefill.price));
  }, [prefill, code]);
  const position = session?.positions.find((item) => item.code === code);
  const pending = session?.orders.find((item) => item.status === "pending");
  const pendingId = pending?.id;
  useEffect(() => {
    if (pendingId) pendingPanel.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
    // A new waiting order means the reviewed order was accepted, also when 「重試這次操作」 resent it after a
    // failed send: the confirm card can no longer be used (sending is locked while an order waits), so close it.
    if (pendingId) setReview(null);
  }, [pendingId]);
  const symbol = catalog.symbols.find((item) => item.code === code);
  const last = session?.bars[code]?.at(-1);
  const revealed = session ? serverSession(session).bars[code]?.at(-1) : undefined;
  const latestTrade = session ? lastTrade(session, code, catalog) : null;
  const holdingLots = (position?.shares ?? 0) / 1000;
  const invalidSell = side === "sell" && lots > holdingLots;
  const ready = Boolean(session && session.cursor >= 1 && !session.completed && !atEnd);
  const locked = busy || Boolean(pending) || !ready;
  const staleReview = Boolean(
    review && (review.revision !== session?.revision || review.sessionId !== session?.id),
  );
  const sideName = side === "buy" ? "買進" : "賣出";
  const limitPrice = limitDraft.trim() ? Number(limitDraft) : NaN;
  const invalidLimit =
    orderType === "limit" && (!symbol || !validMorningLimit(limitPrice, symbol.previousClose));
  const referenceAmount =
    orderType === "limit"
      ? invalidLimit
        ? null
        : limitPrice * lots * 1000
      : revealed
        ? revealed.c * lots * 1000
        : null;

  const names = Object.fromEntries(catalog.symbols.map((item) => [item.code, item.name]));
  const reports = orderReports(session ? serverSession(session) : null, names, failures);
  const reviewAmount = review
    ? (review.limitPrice ?? revealed?.c ?? Number.NaN) * review.lots * 1000
    : null;
  const reviewLarge = Boolean(
    review &&
    session &&
    isLargeOrder({
      side: review.side,
      amount: reviewAmount !== null && Number.isFinite(reviewAmount) ? reviewAmount : null,
      availableCash: session.cash,
    }),
  );
  const largeAck = Boolean(review && largeAckFor === review);
  const largeShare =
    reviewLarge && session && reviewAmount !== null
      ? Math.round((reviewAmount / session.cash) * 100)
      : null;

  function focusReview() {
    window.requestAnimationFrame(() => {
      confirmHeading.current?.focus({ preventScroll: true });
      const card = confirmHeading.current?.closest(".sim-confirm");
      card?.scrollIntoView({ block: "nearest", behavior: "auto" });
      // A large order's tick is the decision: bring it above the pinned 確認送出 button (scroll-padding).
      card?.querySelector(".sim-large")?.scrollIntoView({ block: "nearest", behavior: "auto" });
    });
  }

  async function pickBookPrice(price: number, pickedSide: "buy" | "sell") {
    if (
      locked ||
      review ||
      !session ||
      submitting.current ||
      (pickedSide === "sell" && holdingLots < lots)
    )
      return;
    setSide(pickedSide);
    setOrderType("limit");
    setLimitDraft(formatPrice(price));
    onReview();
    if (
      flashRef.current &&
      isLargeOrder({ side: pickedSide, amount: price * lots * 1000, availableCash: session.cash })
    ) {
      // Lightning never sends a large order: it opens the confirm card instead.
      const next = {
        side: pickedSide,
        lots,
        revision: session.revision,
        sessionId: session.id,
        limitPrice: price,
      };
      setLargeNoticeFor(next);
      setReview(next);
      focusReview();
      return;
    }
    if (flashRef.current) {
      submitting.current = true;
      try {
        if (
          !(await onOrder(pickedSide, lots, session.revision, {
            limitPrice: price,
            entryMode: "lightning",
          }))
        )
          changeFlash(false);
      } finally {
        submitting.current = false;
      }
    } else {
      setReview({
        side: pickedSide,
        lots,
        revision: session.revision,
        sessionId: session.id,
        limitPrice: price,
      });
      focusReview();
    }
  }

  async function confirmOrder() {
    if (
      !review ||
      staleReview ||
      locked ||
      invalidSell ||
      submitting.current ||
      (reviewLarge && !largeAck)
    )
      return;
    submitting.current = true;
    try {
      if (
        await onOrder(
          review.side,
          review.lots,
          review.revision,
          review.limitPrice === undefined ? undefined : { limitPrice: review.limitPrice },
        )
      )
        setReview(null);
    } finally {
      submitting.current = false;
    }
  }

  const book = (
    <MorningOrderBook
      code={code}
      cursor={session?.cursor ?? 0}
      last={last?.c}
      previousClose={symbol?.previousClose ?? 0}
      trade={latestTrade ? { index: latestTrade.index, side: latestTrade.side } : undefined}
      revision={session?.revision ?? 0}
      simulated={Boolean(session && "replay" in session && session.replay)}
      lots={lots}
      holdingLots={holdingLots}
      flash={flash}
      disabled={locked || Boolean(review)}
      onLots={changeLots}
      onFlash={changeFlash}
      onPick={(price, pickedSide) => {
        void pickBookPrice(price, pickedSide);
      }}
    />
  );

  return (
    <div className="morning-order-station" data-flash={flash} data-variant={variant}>
      <section className="td-book-pane" data-pane="book" aria-label="個股報價與五檔">
        {variant === "desk" ? (
          <>
            <QuoteDetailGrid catalog={catalog} session={session} code={code} />
            <StockTabs
              onChange={(id) => {
                if (id !== "book") changeFlash(false);
              }}
              tabs={[
                { id: "book", label: "五檔", content: book },
                {
                  id: "tape",
                  label: "明細",
                  content: <TradeTape catalog={catalog} session={session} code={code} />,
                },
                {
                  id: "minutes",
                  label: "分鐘",
                  content: <MinuteTable session={session} code={code} />,
                },
              ]}
            />
          </>
        ) : (
          book
        )}
      </section>
      <section
        className="sim-ticket"
        data-pane="ticket"
        data-coach="ticket"
        data-side={side}
        aria-labelledby="morning-order-title"
      >
        <header className="sim-ticket-header td-titlebar">
          <h2 id="morning-order-title">模擬下單</h2>
          <select
            aria-label="下單商品"
            value={code}
            disabled={busy || Boolean(review)}
            onChange={(event) => onSelect(event.target.value)}
          >
            {catalog.symbols.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} {item.name}
              </option>
            ))}
          </select>
          <span className="sim-paper-tag">紙上交易</span>
        </header>
        <div className="sim-ticket-body">
          {pending && (
            <PendingOrder
              ref={pendingPanel}
              catalog={catalog}
              pending={pending}
              busy={busy}
              canAdvance={canAdvance}
              onAdvance={onAdvance}
              onCancel={onCancel}
            />
          )}

          {review ? (
            <div className="sim-confirm" aria-labelledby="sim-confirm-title">
              <h3 id="sim-confirm-title" ref={confirmHeading} tabIndex={-1}>
                確認模擬委託
              </h3>
              <p className="sim-confirm-symbol">
                {code} {symbol?.name}
              </p>
              <div className="sim-confirm-main">
                <strong>{review.side === "buy" ? "買進" : "賣出"}</strong>
                <span>
                  {review.lots}
                  <small> 張</small>
                </span>
              </div>
              <dl className="sim-order-facts">
                <div>
                  <dt>委託股數</dt>
                  <dd>{(review.lots * 1000).toLocaleString("zh-TW")} 股</dd>
                </div>
                <div>
                  <dt>委託價格</dt>
                  <dd>
                    {review.limitPrice === undefined
                      ? "市價模擬"
                      : `限價 ${formatPrice(review.limitPrice)}`}
                  </dd>
                </div>
                <div>
                  <dt>參考金額（未含費）</dt>
                  <dd>{referenceAmount === null ? "—" : formatMoney(referenceAmount, 0)}</dd>
                </div>
                <div>
                  <dt>預估來回費稅（假設同價出場）</dt>
                  <dd>
                    {referenceAmount === null
                      ? "—"
                      : formatMoney(estimateRoundTripCost(referenceAmount), 0)}
                  </dd>
                </div>
              </dl>
              {reviewLarge && (
                <div className="sim-large" role="alert">
                  <strong>
                    大額委託：參考金額 {formatMoney(reviewAmount ?? 0, 0)}，占可用資金 {largeShare}%
                  </strong>
                  <p>
                    {largeNoticeFor === review && "大額委託需要確認，閃電即送不會直接送出。"}
                    一筆用掉一半以上的資金，請再看一次計畫。
                  </p>
                  <label htmlFor="sim-large-ack">
                    <input
                      id="sim-large-ack"
                      type="checkbox"
                      checked={largeAck}
                      onChange={(event) => setLargeAckFor(event.target.checked ? review : null)}
                    />
                    我已確認這是大額委託
                  </label>
                </div>
              )}
              <p className="sim-help">
                {review.limitPrice === undefined
                  ? "參考金額依已揭露收盤價計算，下一分鐘開盤價撮合。"
                  : "依後續分鐘開盤價檢核：買進不高於限價、賣出不低於限價，未達價繼續留單。"}
                送出當下尚未成交。
              </p>
              {staleReview && (
                <p role="alert" className="sim-ticket-message">
                  行情或帳戶已更新，請返回重新核對委託。
                </p>
              )}
              <button
                type="button"
                className="sim-submit"
                disabled={locked || staleReview || invalidSell || (reviewLarge && !largeAck)}
                onClick={() => void confirmOrder()}
              >
                <Check aria-hidden />
                {sending ? "正在處理…" : `確認送出模擬${sideName}`}
              </button>
              <button
                type="button"
                className="sim-back"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                返回修改
              </button>
            </div>
          ) : !pending && flash ? (
            <div className="morning-flash-ready" role="status">
              <strong>閃電即送已開啟 · 每筆 {lots} 張</strong>
              <p>點五檔左邊的委買價買進、右邊的委賣價賣出。每次一筆待撮合委託。</p>
              <button type="button" onClick={() => changeFlash(false)}>
                關閉閃電，使用一般委託
              </button>
            </div>
          ) : !pending ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (locked || invalidSell || invalidLimit || !session) return;
                onReview();
                setReview({
                  side,
                  lots,
                  revision: session.revision,
                  sessionId: session.id,
                  ...(orderType === "limit" ? { limitPrice } : {}),
                });
                focusReview();
              }}
            >
              <fieldset
                className="sim-order-fields"
                disabled={busy || Boolean(pending) || Boolean(session?.completed)}
              >
                <legend className="sr-only">模擬委託方向與張數</legend>
                <div className="sim-side-switch" role="group" aria-label="模擬買賣方向">
                  <button
                    type="button"
                    data-side="buy"
                    aria-pressed={side === "buy"}
                    onClick={() => setSide("buy")}
                  >
                    <ArrowUpRight aria-hidden />
                    買進
                  </button>
                  <button
                    type="button"
                    data-side="sell"
                    aria-pressed={side === "sell"}
                    onClick={() => {
                      setSide("sell");
                      if (holdingLots > 0) changeLots(Math.min(lots, holdingLots));
                    }}
                  >
                    <ArrowDownLeft aria-hidden />
                    賣出
                  </button>
                </div>
                <div className="sim-execution">
                  <div className="morning-order-type" role="group" aria-label="委託價格類型">
                    <button
                      type="button"
                      aria-pressed={orderType === "market"}
                      onClick={() => setOrderType("market")}
                    >
                      市價
                    </button>
                    <button
                      type="button"
                      aria-pressed={orderType === "limit"}
                      onClick={() => {
                        setOrderType("limit");
                        if (!limitDraft && revealed) setLimitDraft(formatPrice(revealed.c));
                      }}
                    >
                      限價
                    </button>
                  </div>
                  <strong>
                    {orderType === "market" ? "下一分鐘開盤價撮合" : "開盤價達價才成交"}
                  </strong>
                </div>
                {orderType === "limit" && (
                  <div className="morning-limit-field">
                    <label htmlFor="morning-limit-price">委託價格</label>
                    <div>
                      <button
                        type="button"
                        aria-label="降低一檔價格"
                        disabled={
                          !symbol ||
                          !validMorningLimit(stepTick(limitPrice, -1), symbol.previousClose)
                        }
                        onClick={() => setLimitDraft(formatPrice(stepTick(limitPrice, -1)))}
                      >
                        −
                      </button>
                      <input
                        id="morning-limit-price"
                        inputMode="decimal"
                        value={limitDraft}
                        aria-invalid={invalidLimit}
                        onChange={(event) => setLimitDraft(event.target.value)}
                      />
                      <button
                        type="button"
                        aria-label="提高一檔價格"
                        disabled={
                          !symbol ||
                          !validMorningLimit(stepTick(limitPrice, 1), symbol.previousClose)
                        }
                        onClick={() => setLimitDraft(formatPrice(stepTick(limitPrice, 1)))}
                      >
                        ＋
                      </button>
                    </div>
                    {invalidLimit && (
                      <p role="alert">請輸入符合升降單位與昨收上下 10% 範圍的價格。</p>
                    )}
                  </div>
                )}
                <div className="sim-quantity-heading">
                  <label htmlFor="sim-lots-value">委託張數</label>
                  <span>1 張 = 1,000 股</span>
                </div>
                <div className="sim-stepper">
                  <button
                    type="button"
                    aria-label="減少一張"
                    disabled={lots <= 1}
                    onClick={() => changeLots(lots - 1)}
                  >
                    <Minus aria-hidden />
                  </button>
                  <output id="sim-lots-value" aria-live="polite">
                    {lots}
                    <span>張</span>
                  </output>
                  <button
                    type="button"
                    aria-label="增加一張"
                    disabled={lots >= 3 || (side === "sell" && lots >= holdingLots)}
                    onClick={() => changeLots(lots + 1)}
                  >
                    <Plus aria-hidden />
                  </button>
                </div>
                <dl className="sim-order-facts">
                  <div>
                    <dt>
                      參考金額<small>（未含費）</small>
                    </dt>
                    <dd>{referenceAmount === null ? "—" : formatMoney(referenceAmount, 0)}</dd>
                  </div>
                  <div>
                    <dt>
                      預估來回費稅<small>（假設同價出場）</small>
                    </dt>
                    <dd>
                      {referenceAmount === null
                        ? "—"
                        : formatMoney(estimateRoundTripCost(referenceAmount), 0)}
                    </dd>
                  </div>
                  <div>
                    <dt>{side === "buy" ? "可用模擬資金" : "可賣出庫存"}</dt>
                    <dd>
                      {side === "buy"
                        ? session
                          ? formatMoney(session.cash, 0)
                          : "待開始練習"
                        : `${holdingLots} 張`}
                    </dd>
                  </div>
                </dl>
                {invalidSell && (
                  <p className="sim-ticket-message">
                    {holdingLots
                      ? "賣出張數超過庫存，請減少張數。"
                      : "這檔目前沒有庫存，先模擬買進後才能賣出。"}
                  </p>
                )}
                {ready && (
                  <button
                    type="submit"
                    className="sim-submit"
                    disabled={locked || invalidSell || invalidLimit}
                  >
                    核對模擬{sideName}
                    <span>{lots} 張</span>
                  </button>
                )}
              </fieldset>
              {!session ? (
                <button type="button" className="sim-prepare" disabled={busy} onClick={onPrepare}>
                  填寫作戰計畫，開始下單練習
                </button>
              ) : session.completed || atEnd ? (
                <p className="sim-ticket-message">
                  {session.completed
                    ? "本輪已結束，可查看下方委託與成交紀錄。"
                    : "已到教材最後一分鐘，無法再送出新委託。"}
                </p>
              ) : session.cursor < 1 ? (
                <button
                  type="button"
                  className="sim-prepare"
                  disabled={busy || !canAdvance}
                  onClick={() => void onAdvance()}
                >
                  觀看第一分鐘，開啟模擬下單
                </button>
              ) : null}
            </form>
          ) : null}
          <OrderReports reports={reports} />
          <details className="sim-order-help">
            <summary>撮合方式與教材費用</summary>
            <p>
              每筆 1–3
              張，同時一筆待撮合。市價採下一分鐘開盤價；限價依之後每分鐘開盤價檢核，買進不高於限價、賣出不低於限價，未達價留單至撤回或教材結束。每次成交重新檢核資金與庫存。
            </p>
            <p>
              教材手續費買賣各 0.0855%（最低 20 元），賣出稅費
              0.15%，逐筆四捨五入。五檔價量與分鐘內的逐筆跳動都是教學模擬，不代表真實排隊、成交或成交量；撮合不依分鐘高低價或模擬逐筆推算盤中成交。
            </p>
          </details>
          <p className="sim-ticket-footnote">教學模擬・不連接券商、不送出真實委託</p>
        </div>
      </section>
    </div>
  );
}

const ORDER_STATUS = {
  pending: "待撮合",
  filled: "已成交",
  cancelled: "已撤回",
  rejected: "未接受",
};
type LedgerPane = "positions" | "orders" | "fills";

export function Ledger({
  catalog,
  session,
  busy,
  onCancel,
  cards = false,
}: {
  catalog: MorningCatalog;
  session: MorningState;
  busy: boolean;
  onCancel: (id: string) => Promise<void>;
  /** Phones and large text: one card per record instead of a wide table. */
  cards?: boolean;
}) {
  const [pane, setPane] = useState<LedgerPane>("positions");
  const summary = ledgerSummary(session);
  const name = (code: string) => catalog.symbols.find((item) => item.code === code)?.name ?? code;
  const panes = [
    { id: "positions" as const, label: "庫存", count: summary.positions },
    { id: "orders" as const, label: "委託", count: summary.orders },
    { id: "fills" as const, label: "成交", count: summary.fills },
  ];
  const active = panes.find((item) => item.id === pane)!;
  const records = ledgerRecords(pane, session, name, busy, onCancel);
  return (
    <section className="sim-ledger" aria-label="模擬交易紀錄">
      <div className="sim-ledger-header td-titlebar">
        <nav aria-label="交易紀錄分類">
          {panes.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={pane === item.id}
              aria-controls="sim-ledger-content"
              onClick={() => setPane(item.id)}
            >
              {item.label}
              <span>{item.count}</span>
              {item.id === "orders" && summary.pending > 0 && (
                <em className="sim-pending-badge">{summary.pending} 待成交</em>
              )}
            </button>
          ))}
        </nav>
        <span className="td-ledger-meta">
          帳戶估值 <b>{formatMoney(session.equity, 0)}</b> · 期初{" "}
          <b>{formatMoney(session.startingCash, 0)}</b> ·{" "}
          <time>{formatTime(session.cursor * 60).slice(0, 5)}</time>
        </span>
      </div>
      <div id="sim-ledger-content" className="sim-ledger-content" aria-label={active.label}>
        {active.count === 0 ? (
          <div className="sim-ledger-empty">
            <Wallet size={30} aria-hidden />
            <strong>
              {pane === "positions"
                ? "目前沒有庫存"
                : pane === "orders"
                  ? "尚未送出委託"
                  : "尚無模擬成交"}
            </strong>
            <p>
              {pane === "positions"
                ? "成交後顯示持有張數與平均成本。"
                : pane === "orders"
                  ? "確認送單後，在這裡核對狀態或撤單。"
                  : "送出委託，再前進一分鐘查看撮合結果。"}
            </p>
          </div>
        ) : cards ? (
          <ul className="sim-cards" aria-label={`本輪模擬${active.label}明細`}>
            {records.map((record) => (
              <li key={record.key} className="sim-card">
                <div className="sim-card-head">
                  <strong>{record.name}</strong>
                  <small>{record.sub}</small>
                </div>
                <dl>
                  {record.cells.map((cell) => (
                    <div key={cell.label}>
                      <dt>{cell.label}</dt>
                      <dd data-tone={cell.tone} className={cell.className}>
                        {cell.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        ) : (
          <table className="terminal-record-table">
            <caption className="sr-only">本輪模擬{active.label}明細</caption>
            <thead>
              <tr>
                <th scope="col">商品</th>
                {records[0].cells.map((cell) => (
                  <th key={cell.label} scope="col">
                    <ColumnLabel text={cell.label} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.key}>
                  <th scope="row">
                    <strong>{record.name}</strong>
                    <small>{record.sub}</small>
                  </th>
                  {record.cells.map((cell) => (
                    <td
                      key={cell.label}
                      data-label={cell.label}
                      data-tone={cell.tone}
                      className={cell.className}
                    >
                      {cell.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

/** A column head with its （…） qualifier on a second line, so the desk ledger fits its column. */
function ColumnLabel({ text }: { text: string }) {
  const at = text.indexOf("（");
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <small>{text.slice(at)}</small>
    </>
  );
}

type LedgerCell = { label: string; value: ReactNode; tone?: string; className?: string };
type LedgerRecord = { key: string; name: string; sub: string; cells: LedgerCell[] };

/** One row per position, order or fill; the desk shows them as a table, phones as cards. */
function ledgerRecords(
  pane: LedgerPane,
  session: MorningState,
  name: (code: string) => string,
  busy: boolean,
  onCancel: (id: string) => Promise<void>,
): LedgerRecord[] {
  if (pane === "positions")
    return session.positions.map((item) => {
      const lastClose = session.bars[item.code]?.at(-1)?.c;
      const mark = positionMark(item, lastClose);
      return {
        key: item.code,
        name: name(item.code),
        sub: item.code,
        cells: [
          { label: "持有張數", value: `${item.shares / 1000} 張` },
          {
            label: "平均成本（未含費）",
            value: item.averageCost.toLocaleString("zh-TW", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }),
          },
          { label: "最新價", value: lastClose === undefined ? "—" : formatPrice(lastClose) },
          {
            label: "參考損益（未含費稅）",
            value:
              mark.value === null
                ? "—"
                : `${mark.value > 0 ? "+" : ""}${formatMoney(mark.value, 0)}`,
            tone: mark.tone,
            className: "sim-mark",
          },
        ],
      };
    });
  if (pane === "orders")
    return session.orders
      .slice()
      .reverse()
      .map((item) => ({
        key: item.id,
        name: name(item.code),
        sub: `${item.code} · ${formatTime(item.submittedCursor * 60).slice(0, 5)}${item.entryMode === "lightning" ? " · 閃電" : ""}`,
        cells: [
          {
            label: "方向 / 張數",
            value: `${item.side === "buy" ? "買進" : "賣出"} ${item.shares / 1000} 張`,
            className: `sim-${item.side}`,
          },
          {
            label: "委託價",
            value: item.limitPrice === undefined ? "市價" : formatPrice(item.limitPrice),
          },
          { label: "成交價", value: item.price === undefined ? "—" : formatPrice(item.price) },
          {
            label: "狀態",
            value: (
              <>
                <span className="sim-status" data-status={item.status}>
                  {ORDER_STATUS[item.status]}
                </span>
                {item.status === "pending" && !session.completed && (
                  <button
                    type="button"
                    className="sim-cancel"
                    disabled={busy}
                    onClick={() => void onCancel(item.id)}
                  >
                    撤回委託
                  </button>
                )}
                {item.reason && <small className="sim-record-reason">{item.reason}</small>}
              </>
            ),
          },
        ],
      }));
  return session.fills
    .slice()
    .reverse()
    .map((fill) => ({
      key: fill.id,
      name: name(fill.code),
      sub: `${fill.code} · ${formatTime(fill.t).slice(0, 5)}`,
      cells: [
        {
          label: "方向 / 張數",
          value: `${fill.side === "buy" ? "買進" : "賣出"} ${fill.shares / 1000} 張`,
          className: `sim-${fill.side}`,
        },
        { label: "成交價", value: formatPrice(fill.price) },
        {
          label: "手續費 / 稅費",
          value: `${formatMoney(fill.fee, 0)} / ${formatMoney(fill.tax, 0)}`,
        },
      ],
    }));
}
