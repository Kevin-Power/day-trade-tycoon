import * as Dialog from "@radix-ui/react-dialog";
import { useId, useRef, useState } from "react";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGame } from "@/lib/game/store";
import type { ReviewBundle } from "@/lib/game/persist";
import {
  tradePlanInputSchema,
  tradePlanDraftFrom,
  type TradePlan,
  type FirstPlannedOrder,
} from "@/lib/game/trade-plan";
import { formatLots, formatMoney, formatTime } from "@/lib/utils";
import { formatPrice } from "@/lib/market/ticks";
import { parseLotsDraft } from "@/lib/game/ticket-draft";

const actionClass = "h-auto min-h-12 whitespace-normal px-4 py-3 text-base leading-6";
type PlanField = "entryCondition" | "exitCondition" | "maxLoss";
const fieldMessages: Record<PlanField, string> = {
  entryCondition: "請寫下進場條件，最多 200 字。",
  exitCondition: "請寫下離場條件，最多 200 字。",
  maxLoss: "請填寫大於 0 的模擬虧損額度。",
};

export function TradePlanEntry() {
  const plan = useGame((s) => s.tradePlan);
  const pendingDraft = useGame((s) => s.tradePlanDraft);
  const order = useGame((s) => s.firstPlannedOrder);
  const selected = useGame((s) => s.selected);
  const ticket = useGame((s) => s.ticket);
  const lotsDraft = useGame((s) => s.ticketDraft.lots);
  const lots = parseLotsDraft(lotsDraft);
  const savePlan = useGame((s) => s.saveTradePlan);
  const editPlanDraft = useGame((s) => s.editTradePlanDraft);
  const removePlan = useGame((s) => s.removeTradePlan);
  const [open, setOpen] = useState(false);
  const draft = pendingDraft ?? tradePlanDraftFrom(plan, { code: selected, side: ticket.side, lots });
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PlanField, string>>>({});
  const titleRef = useRef<HTMLHeadingElement>(null);
  const entryRef = useRef<HTMLTextAreaElement>(null);
  const exitRef = useRef<HTMLTextAreaElement>(null);
  const lossRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const fieldId = useId();
  function editField(field: PlanField, value: string) {
    editPlanDraft(field, value);
    setFieldErrors((previous) => ({ ...previous, [field]: undefined }));
    setError("");
  }
  const changed =
    !!plan && (plan.code !== selected || plan.side !== ticket.side || plan.lots !== lots);
  const draftContextChanged = !!pendingDraft && (
    pendingDraft.code !== selected || pendingDraft.side !== ticket.side || pendingDraft.lots !== lots
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          const state = useGame.getState();
          if (!state.ensureSessionIdentity() || state.phase !== "live") return;
          if (state.phase === "live" && !state.paused) state.togglePause();
          setError("");
          setFieldErrors({});
        }
        setOpen(next);
      }}
    >
      <div className="shrink-0 border-b border-border bg-brand/5 p-3 text-base leading-7">
        <Dialog.Trigger asChild>
          <Button variant="outline" className={`${actionClass} w-full justify-start`}>
            <ClipboardList aria-hidden />
            {order ? "查看第一筆計畫" : pendingDraft ? "草稿尚未保存 · 繼續填寫" : plan ? "已記下計畫 · 可修改" : "第一筆下單前，先寫計畫"}
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
        {!order && pendingDraft ? (
          <p role="status" className="mt-2 text-base text-warn">
            {plan ? "有尚未保存的修改；復盤仍使用原先已保存的計畫。" : "草稿尚未保存，尚未成為本盤計畫。"}
          </p>
        ) : null}
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
          className="term-scroll fixed left-1/2 top-1/2 z-[60] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface text-fg shadow-xl"
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
          <div className="px-5 py-4 text-base leading-7">
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
                    {selected} · {ticket.side === "buy" ? "買進" : "賣出"}{" "}
                    {lots === null ? "張數待完成" : `${formatLots(lots)} 張`}
                  </strong>
                </p>
                {pendingDraft ? (
                  <p role="status" className="mb-4 rounded-xl border border-warn/30 bg-warn/5 p-3">
                    尚未保存。關閉計畫或切換分頁會保留這份草稿；請確認後按「保存計畫，回到委託」。
                  </p>
                ) : null}
                {pendingDraft && draftContextChanged ? (
                  <p className="mb-4 rounded-xl border border-warn/30 p-3 text-warn">
                    草稿開始填寫時是 {pendingDraft.code} · {pendingDraft.side === "buy" ? "買進" : "賣出"}{" "}
                    {pendingDraft.lots === null ? "張數未完成" : `${formatLots(pendingDraft.lots)} 張`}。
                    現在的商品、方向或張數已變更，請重新核對條件，再決定是否保存。
                  </p>
                ) : null}
                <label className="block font-medium" htmlFor={`${fieldId}-entry`}>
                  1. 看到什麼條件，才會進場？
                </label>
                <textarea
                  ref={entryRef}
                  id={`${fieldId}-entry`}
                  rows={3}
                  maxLength={200}
                  value={draft.entryCondition}
                  onChange={(event) => editField("entryCondition", event.target.value)}
                  aria-invalid={!!fieldErrors.entryCondition}
                  aria-describedby={
                    fieldErrors.entryCondition ? `${fieldId}-entry-error` : undefined
                  }
                  className="mt-2 w-full rounded-xl border border-border bg-bg p-3 text-base leading-7"
                  placeholder="用自己的話寫下課堂觀察條件。"
                />
                {fieldErrors.entryCondition ? (
                  <p id={`${fieldId}-entry-error`} className="mt-2 text-base text-up">
                    {fieldErrors.entryCondition}
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-muted">{draft.entryCondition.length} / 200 字</p>
                <label className="mt-5 block font-medium" htmlFor={`${fieldId}-exit`}>
                  2. 發生什麼情況，就要離場？
                </label>
                <textarea
                  ref={exitRef}
                  id={`${fieldId}-exit`}
                  rows={3}
                  maxLength={200}
                  value={draft.exitCondition}
                  onChange={(event) => editField("exitCondition", event.target.value)}
                  aria-invalid={!!fieldErrors.exitCondition}
                  aria-describedby={fieldErrors.exitCondition ? `${fieldId}-exit-error` : undefined}
                  className="mt-2 w-full rounded-xl border border-border bg-bg p-3 text-base leading-7"
                  placeholder="寫下判斷失效或決定結束的條件。"
                />
                {fieldErrors.exitCondition ? (
                  <p id={`${fieldId}-exit-error`} className="mt-2 text-base text-up">
                    {fieldErrors.exitCondition}
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-muted">{draft.exitCondition.length} / 200 字</p>
                <label className="mt-5 block font-medium" htmlFor={`${fieldId}-loss`}>
                  3. 這次自行設定的模擬虧損額度（元）
                </label>
                <input
                  ref={lossRef}
                  id={`${fieldId}-loss`}
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={draft.maxLoss}
                  onChange={(event) => editField("maxLoss", event.target.value)}
                  className="mt-2 min-h-12 w-full rounded-xl border border-border bg-bg p-3 text-base"
                  aria-invalid={!!fieldErrors.maxLoss}
                  aria-describedby={`${fieldId}-notice${fieldErrors.maxLoss ? ` ${fieldId}-loss-error` : ""}`}
                />
                {fieldErrors.maxLoss ? (
                  <p id={`${fieldId}-loss-error`} className="mt-2 text-base text-up">
                    {fieldErrors.maxLoss}
                  </p>
                ) : null}
                <p id={`${fieldId}-notice`} className="mt-3 text-base leading-7 text-muted">
                  這是你和講師討論用的額度，不是停損委託；系統不會依這個數字自動平倉，也不保證虧損不超過額度。
                </p>
                <p className="mt-3 text-sm leading-6 text-muted">
                  只有已保存的計畫會在結算後隨復盤保存。草稿只保留在本次練習，重新整理、結束練習或第一筆委託成功送出後就會清除。第一筆委託成功送出後不能補改；不填計畫仍可練習，紀錄會如實留白。
                </p>
              </>
            )}
          </div>
          <footer className="shrink-0 space-y-2 border-t border-border p-3">
            {error ? (
              <p
                ref={errorRef}
                tabIndex={-1}
                role="alert"
                className="rounded-xl border border-up/30 p-3 text-base leading-7 text-up"
              >
                {error}
              </p>
            ) : null}
            {!order ? (
              <Button
                className={`${actionClass} w-full`}
                onClick={() => {
                  const input = {
                    entryCondition: draft.entryCondition,
                    exitCondition: draft.exitCondition,
                    maxLoss: Number(draft.maxLoss),
                  };
                  const checked = tradePlanInputSchema.safeParse(input);
                  if (!checked.success) {
                    const errors: Partial<Record<PlanField, string>> = {};
                    for (const issue of checked.error.issues) {
                      const field = issue.path[0] as PlanField;
                      if (field in fieldMessages) errors[field] = fieldMessages[field];
                    }
                    setFieldErrors(errors);
                    setError("尚未保存。請先完成標示的欄位，再按保存。");
                    const first = errors.entryCondition
                      ? entryRef
                      : errors.exitCondition
                        ? exitRef
                        : lossRef;
                    requestAnimationFrame(() => first.current?.focus());
                    return;
                  }
                  const result = savePlan(checked.data);
                  if (!result.ok) {
                    setError(
                      lots === null
                        ? "尚未保存，草稿已保留。請關閉計畫，回到委託欄位完成張數後，再打開並保存計畫。"
                        : (result.reason ?? "請確認三個欄位後再保存。"),
                    );
                    requestAnimationFrame(() => errorRef.current?.focus());
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
              {!order && (plan || pendingDraft) ? (
                <Button
                  variant="ghost"
                  className={actionClass}
                  onClick={() => {
                    removePlan();
                    setOpen(false);
                  }}
                >
                  {plan ? "清除計畫與草稿" : "清除草稿"}
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
      <p>{order.type === "market" ? "市價委託" : `限價 ${formatPrice(order.price)}`} · {order.tif ?? "舊紀錄未記效期"}</p>
    </div>
  );
}
