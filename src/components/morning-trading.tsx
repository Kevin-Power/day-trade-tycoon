import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Clock3, Minus, Plus, Wallet } from "lucide-react";
import type { MorningCatalog, MorningState } from "@/lib/morning";
import { formatMoney, formatTime } from "@/lib/utils";
import { estimateRoundTripCost, formatPrice, stepTick } from "@/lib/market/ticks";
import { validMorningLimit } from "@/lib/morning-book";
import { MorningQuoteDetail } from "@/components/morning-quotes";
import { MorningOrderBook } from "@/components/morning-order-book";

export function AccountSummary({ session }: { session: MorningState }) {
  const profit = session.equity - session.startingCash;
  return (
    <section className="sim-account" aria-label="模擬帳戶總覽">
      <div className="sim-account-label">
        <Wallet size={18} aria-hidden />
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

export function PaperOrder({
  catalog,
  session,
  code,
  busy,
  atEnd,
  canAdvance,
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
  busy: boolean;
  atEnd: boolean;
  canAdvance: boolean;
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
  const [limitDraft, setLimitDraft] = useState(() => String(session?.bars[code]?.at(-1)?.c ?? ""));
  const [flash, setFlash] = useState(false);
  const flashRef = useRef(false);
  const [review, setReview] = useState<OrderReview | null>(null);
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
  const position = session?.positions.find((item) => item.code === code);
  const pending = session?.orders.find((item) => item.status === "pending");
  const pendingId = pending?.id;
  useEffect(() => {
    if (pendingId) pendingPanel.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [pendingId]);
  const symbol = catalog.symbols.find((item) => item.code === code);
  const last = session?.bars[code]?.at(-1);
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
      : last
        ? last.c * lots * 1000
        : null;

  function focusReview() {
    window.requestAnimationFrame(() => {
      confirmHeading.current?.focus({ preventScroll: true });
      confirmHeading.current?.closest(".sim-confirm")?.scrollIntoView({
        block: "nearest",
        behavior: "auto",
      });
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
    if (!review || staleReview || locked || invalidSell || submitting.current) return;
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

  return (
    <div className="morning-order-station" data-flash={flash}>
      <MorningQuoteDetail
        catalog={catalog}
        session={session}
        code={code}
        onPaneChange={() => changeFlash(false)}
        onSelect={onSelect}
        selectionDisabled={busy || Boolean(review)}
        book={
          <MorningOrderBook
            code={code}
            cursor={session?.cursor ?? 0}
            last={last?.c}
            previousClose={symbol?.previousClose ?? 0}
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
        }
      />
      <section className="sim-ticket" data-side={side} aria-labelledby="morning-order-title">
        <header className="sim-ticket-header td-titlebar">
          <h2 id="morning-order-title">模擬下單</h2>
          <span className="sim-paper-tag">紙上交易</span>
        </header>
        <div className="sim-ticket-body">
          {pending && (
            <div role="status" className="sim-pending" ref={pendingPanel}>
              <div>
                <Clock3 size={18} aria-hidden />
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
                <button
                  type="button"
                  disabled={busy || !canAdvance}
                  onClick={() => void onAdvance()}
                >
                  前進一分鐘撮合
                </button>
                <button type="button" disabled={busy} onClick={() => void onCancel(pending.id)}>
                  撤回委託
                </button>
              </div>
            </div>
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
                disabled={locked || staleReview || invalidSell}
                onClick={() => void confirmOrder()}
              >
                <Check size={18} aria-hidden />
                {busy ? "正在處理…" : `確認送出模擬${sideName}`}
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
              <p>點上方賣價買進、買價賣出。每次一筆待撮合委託。</p>
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
                    <ArrowUpRight size={20} aria-hidden />
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
                    <ArrowDownLeft size={20} aria-hidden />
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
                        if (!limitDraft && last) setLimitDraft(formatPrice(last.c));
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
          <details className="sim-order-help">
            <summary>撮合方式與教材費用</summary>
            <p>
              每筆 1–3
              張，同時一筆待撮合。市價採下一分鐘開盤價；限價依之後每分鐘開盤價檢核，買進不高於限價、賣出不低於限價，未達價留單至撤回或教材結束。每次成交重新檢核資金與庫存。
            </p>
            <p>
              教材手續費買賣各 0.0855%（最低 20 元），賣出稅費
              0.15%，逐筆四捨五入。五檔價量為教學生成，不代表真實排隊或成交量；不依分鐘高低價推算盤中成交。
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
}: {
  catalog: MorningCatalog;
  session: MorningState;
  busy: boolean;
  onCancel: (id: string) => Promise<void>;
}) {
  const [pane, setPane] = useState<LedgerPane>("positions");
  const name = (code: string) => catalog.symbols.find((item) => item.code === code)?.name ?? code;
  const panes = [
    { id: "positions" as const, label: "庫存", count: session.positions.length },
    { id: "orders" as const, label: "委託", count: session.orders.length },
    { id: "fills" as const, label: "成交", count: session.fills.length },
  ];
  const active = panes.find((item) => item.id === pane)!;
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
            <Wallet size={22} aria-hidden />
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
        ) : (
          <table className="terminal-record-table">
            <caption className="sr-only">本輪模擬{active.label}明細</caption>
            <thead>
              <tr>
                <th scope="col">商品</th>
                <th scope="col">{pane === "positions" ? "持有張數" : "方向 / 張數"}</th>
                {pane === "orders" && <th scope="col">委託價</th>}
                <th scope="col">{pane === "positions" ? "平均成本（未含費）" : "成交價"}</th>
                <th scope="col">
                  {pane === "positions"
                    ? "已揭露收盤價"
                    : pane === "orders"
                      ? "狀態"
                      : "手續費 / 稅費"}
                </th>
              </tr>
            </thead>
            <tbody>
              {pane === "positions" &&
                session.positions.map((item) => (
                  <tr key={item.code}>
                    <th scope="row">
                      <strong>{name(item.code)}</strong>
                      <small>{item.code}</small>
                    </th>
                    <td data-label="持有張數">{item.shares / 1000} 張</td>
                    <td data-label="平均成本（未含費）">
                      {item.averageCost.toLocaleString("zh-TW", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td data-label="已揭露收盤價">
                      {session.bars[item.code]?.at(-1)
                        ? formatPrice(session.bars[item.code].at(-1)!.c)
                        : "—"}
                    </td>
                  </tr>
                ))}
              {pane === "orders" &&
                session.orders
                  .slice()
                  .reverse()
                  .map((item) => (
                    <tr key={item.id}>
                      <th scope="row">
                        <strong>{name(item.code)}</strong>
                        <small>
                          {item.code} · {formatTime(item.submittedCursor * 60).slice(0, 5)}
                          {item.entryMode === "lightning" && " · 閃電"}
                        </small>
                      </th>
                      <td data-label="方向 / 張數" className={`sim-${item.side}`}>
                        {item.side === "buy" ? "買進" : "賣出"} {item.shares / 1000} 張
                      </td>
                      <td data-label="委託價">
                        {item.limitPrice === undefined ? "市價" : formatPrice(item.limitPrice)}
                      </td>
                      <td data-label="成交價">
                        {item.price === undefined ? "—" : formatPrice(item.price)}
                      </td>
                      <td data-label="委託狀態">
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
                      </td>
                    </tr>
                  ))}
              {pane === "fills" &&
                session.fills
                  .slice()
                  .reverse()
                  .map((fill) => (
                    <tr key={fill.id}>
                      <th scope="row">
                        <strong>{name(fill.code)}</strong>
                        <small>
                          {fill.code} · {formatTime(fill.t).slice(0, 5)}
                        </small>
                      </th>
                      <td data-label="方向 / 張數" className={`sim-${fill.side}`}>
                        {fill.side === "buy" ? "買進" : "賣出"} {fill.shares / 1000} 張
                      </td>
                      <td data-label="成交價">{formatPrice(fill.price)}</td>
                      <td data-label="手續費 / 稅費">
                        {formatMoney(fill.fee, 0)} / {formatMoney(fill.tax, 0)}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
