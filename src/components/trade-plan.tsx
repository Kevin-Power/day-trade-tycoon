import * as Dialog from "@radix-ui/react-dialog";
import { useId, useRef, useState } from "react";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGame } from "@/lib/game/store";
import type { ReviewBundle } from "@/lib/game/persist";
import type { TradePlan, FirstPlannedOrder } from "@/lib/game/trade-plan";
import { formatLots, formatMoney, formatTime } from "@/lib/utils";
import { formatPrice } from "@/lib/market/ticks";

const actionClass = "h-auto min-h-12 whitespace-normal px-4 py-3 text-base leading-6";

export function TradePlanEntry() {
  const plan = useGame((s) => s.tradePlan);
  const order = useGame((s) => s.firstPlannedOrder);
  const selected = useGame((s) => s.selected);
  const ticket = useGame((s) => s.ticket);
  const savePlan = useGame((s) => s.saveTradePlan);
  const removePlan = useGame((s) => s.removeTradePlan);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ entryCondition: "", exitCondition: "", maxLoss: "" });
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const fieldId = useId();
  const changed =
    !!plan && (plan.code !== selected || plan.side !== ticket.side || plan.lots !== ticket.lots);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          const state = useGame.getState();
          if (state.phase === "live" && !state.paused) state.togglePause();
          setDraft({
            entryCondition: plan?.entryCondition ?? "",
            exitCondition: plan?.exitCondition ?? "",
            maxLoss: plan ? String(plan.maxLoss) : "",
          });
          setError("");
        }
        setOpen(next);
      }}
    >
      <div className="shrink-0 border-b border-border bg-brand/5 p-3 text-base leading-7">
        <Dialog.Trigger asChild>
          <Button variant="outline" className={`${actionClass} w-full justify-start`}>
            <ClipboardList aria-hidden />
            {order ? "查看第一筆計畫" : plan ? "已記下計畫 · 可修改" : "第一筆下單前，先寫計畫"}
          </Button>
        </Dialog.Trigger>
        <p className="mt-2 text-sm leading-6 text-muted">
          {order
            ? plan
              ? "第一筆委託已送出，原計畫已鎖定供復盤。"
              : "第一筆委託前未記錄計畫，本盤不補寫。"
            : plan
              ? `${plan.code} · ${plan.side === "buy" ? "買進" : "賣出"} ${formatLots(plan.lots)} 張。結算後隨復盤保存。`
              : "先寫進場、離場條件與模擬虧損額度，再核對委託。"}
        </p>
        {!order && changed ? (
          <p role="status" className="mt-2 text-base text-warn">
            現在的商品、方向或張數與計畫不同，送出前請再核對。
          </p>
        ) : null}
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-fg/25 backdrop-blur-sm" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef.current?.focus();
          }}
          className="fixed left-1/2 top-1/2 z-[60] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-surface text-fg shadow-xl"
        >
          <header className="shrink-0 border-b border-border px-5 py-4">
            <Dialog.Title
              ref={titleRef}
              tabIndex={-1}
              className="text-xl font-semibold outline-none"
            >
              第一筆進場計畫
            </Dialog.Title>
          </header>
          <div className="term-scroll min-h-0 overflow-y-auto overscroll-contain px-5 py-4 text-base leading-7">
            <Dialog.Description className="mb-4 text-muted">
              寫下判斷，再和成交紀錄一起回看。模擬已暫停，關閉後由你自行繼續。
            </Dialog.Description>
            {order ? (
              <>
                <p className="mb-4 rounded-xl bg-brand/5 p-3">
                  首次成功送出委託後，計畫保留原樣；即使尚未成交或已撤單，也不補改。
                </p>
                {plan ? (
                  <PlanDetails plan={plan} />
                ) : (
                  <p>本盤第一筆委託前沒有保存計畫。下次練習可以先記下自己的判斷。</p>
                )}
                <OrderDetails order={order} />
              </>
            ) : (
              <>
                <p className="mb-5 rounded-xl bg-bg p-3">
                  這次準備：
                  <strong>
                    {selected} · {ticket.side === "buy" ? "買進" : "賣出"} {formatLots(ticket.lots)}{" "}
                    張
                  </strong>
                </p>
                <label className="block font-medium" htmlFor={`${fieldId}-entry`}>
                  1. 看到什麼條件，才會進場？
                </label>
                <textarea
                  id={`${fieldId}-entry`}
                  rows={3}
                  maxLength={200}
                  value={draft.entryCondition}
                  onChange={(event) => setDraft({ ...draft, entryCondition: event.target.value })}
                  className="mt-2 w-full rounded-xl border border-border bg-bg p-3 text-base leading-7"
                  placeholder="用自己的話寫下課堂觀察條件。"
                />
                <label className="mt-5 block font-medium" htmlFor={`${fieldId}-exit`}>
                  2. 發生什麼情況，就要離場？
                </label>
                <textarea
                  id={`${fieldId}-exit`}
                  rows={3}
                  maxLength={200}
                  value={draft.exitCondition}
                  onChange={(event) => setDraft({ ...draft, exitCondition: event.target.value })}
                  className="mt-2 w-full rounded-xl border border-border bg-bg p-3 text-base leading-7"
                  placeholder="寫下判斷失效或決定結束的條件。"
                />
                <label className="mt-5 block font-medium" htmlFor={`${fieldId}-loss`}>
                  3. 這次自行設定的模擬虧損額度（元）
                </label>
                <input
                  id={`${fieldId}-loss`}
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={draft.maxLoss}
                  onChange={(event) => setDraft({ ...draft, maxLoss: event.target.value })}
                  className="mt-2 min-h-12 w-full rounded-xl border border-border bg-bg p-3 text-base"
                  aria-describedby={`${fieldId}-notice`}
                />
                <p id={`${fieldId}-notice`} className="mt-3 text-base leading-7 text-muted">
                  這是你和講師討論用的額度，不是停損委託；系統不會依這個數字自動平倉，也不保證虧損不超過額度。
                </p>
                <p className="mt-3 text-sm leading-6 text-muted">
                  計畫目前暫存在本盤，結算後才隨復盤保存。未結算就重新整理會遺失；第一筆委託成功送出後不能補改。不填計畫仍可練習，紀錄會如實留白。
                </p>
                {error ? (
                  <p
                    role="alert"
                    className="mt-4 rounded-xl border border-up/30 p-3 text-base text-up"
                  >
                    {error}
                  </p>
                ) : null}
              </>
            )}
          </div>
          <footer className="shrink-0 space-y-2 border-t border-border p-3">
            {!order ? (
              <Button
                className={`${actionClass} w-full`}
                onClick={() => {
                  const result = savePlan({
                    entryCondition: draft.entryCondition,
                    exitCondition: draft.exitCondition,
                    maxLoss: Number(draft.maxLoss),
                  });
                  if (!result.ok) {
                    setError(result.reason ?? "請確認三個欄位後再保存。");
                    return;
                  }
                  setOpen(false);
                }}
              >
                保存計畫，回到委託
              </Button>
            ) : null}
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <Button variant="outline" className={`${actionClass} flex-1`}>
                  關閉，保持暫停
                </Button>
              </Dialog.Close>
              {!order && plan ? (
                <Button
                  variant="ghost"
                  className={actionClass}
                  onClick={() => {
                    removePlan();
                    setOpen(false);
                  }}
                >
                  清除計畫
                </Button>
              ) : null}
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function TradePlanReview({ bundle }: { bundle: ReviewBundle }) {
  const snapshot = bundle.firstTradePlan;
  const plan = snapshot?.plan;
  const order = snapshot?.order;
  const changed =
    plan &&
    order &&
    (plan.code !== order.code || plan.side !== order.side || plan.lots !== order.lots);
  const firstFills = order ? bundle.fills.filter((fill) => fill.orderId === order.id) : [];
  return (
    <section
      className="academy-card mt-7 p-5 text-base leading-7 sm:p-6"
      aria-labelledby="review-plan-title"
    >
      <p className="academy-eyebrow">進場前的紀錄</p>
      <h2 id="review-plan-title" className="mt-2 text-xl font-semibold">
        先前的計畫，和第一筆委託
      </h2>
      <p className="mt-3 text-muted">
        這是學員當時寫下的判斷，供課堂討論；沒有自動認定條件成立或操作合格。
      </p>
      {!snapshot ? (
        <p className="mt-4">這份舊紀錄沒有進場計畫欄位，不補造當時的理由。</p>
      ) : !plan ? (
        <p className="mt-4">本盤未記錄進場計畫。下次練習可以先寫下條件，再核對委託。</p>
      ) : (
        <div className="mt-5">
          <PlanDetails plan={plan} />
        </div>
      )}
      {order ? (
        <>
          <OrderDetails order={order} />
          <p className="mt-3 text-muted">
            這筆委託在本盤記錄中有 {firstFills.length}{" "}
            筆成交。送出委託與成交是不同時間點，請對照下方完整成交紀錄。
          </p>
          {changed ? (
            <p className="mt-3 rounded-xl border border-warn/30 bg-warn/5 p-3">
              第一筆送出的商品、方向或張數與計畫不同。請和講師討論當時為什麼調整；這個提醒不直接修改課程成績。
            </p>
          ) : null}
        </>
      ) : snapshot ? (
        <p className="mt-4 text-muted">本盤沒有記錄到成功送出的第一筆委託。</p>
      ) : null}
      {plan ? (
        <div className="mt-5 border-t border-border pt-4">
          <p className="font-medium">帶著兩個問題回看</p>
          <ol className="mt-2 list-decimal space-y-2 pl-6">
            <li>送出當下，自己寫的進場條件是否出現？用哪段紀錄說明？</li>
            <li>離場是否依照原先條件？下次想保留或改進哪一個動作？</li>
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function PlanDetails({ plan }: { plan: TradePlan }) {
  return (
    <dl className="space-y-4 [overflow-wrap:anywhere]">
      <div>
        <dt className="text-muted">模擬 {formatTime(plan.simTime)} 記下的準備</dt>
        <dd className="font-medium">
          {plan.code} · {plan.side === "buy" ? "買進" : "賣出"} {formatLots(plan.lots)} 張
        </dd>
      </div>
      <div>
        <dt className="font-medium">進場條件</dt>
        <dd className="mt-1 whitespace-pre-wrap">{plan.entryCondition}</dd>
      </div>
      <div>
        <dt className="font-medium">離場條件</dt>
        <dd className="mt-1 whitespace-pre-wrap">{plan.exitCondition}</dd>
      </div>
      <div>
        <dt className="font-medium">自行設定的模擬虧損額度</dt>
        <dd className="mt-1">{formatMoney(plan.maxLoss, 2)} 元</dd>
        <dd className="mt-1 text-muted">僅供討論，不是停損委託，也沒有依此自動平倉。</dd>
      </div>
    </dl>
  );
}

function OrderDetails({ order }: { order: FirstPlannedOrder }) {
  return (
    <div className="mt-5 rounded-xl border border-border bg-bg p-4 text-base leading-7">
      <p className="font-medium">首次成功送出的委託</p>
      <p className="mt-2">
        {formatTime(order.time)} · {order.code} · {order.side === "buy" ? "買進" : "賣出"}{" "}
        {formatLots(order.lots)} 張
      </p>
      <p>{order.type === "market" ? "市價委託" : `限價 ${formatPrice(order.price)}`}</p>
    </div>
  );
}
