import { useEffect, useId, type KeyboardEvent } from "react";
import { useGame } from "@/lib/game/store";
import { parseLotsDraft, TICKET_LOTS_ERROR } from "@/lib/game/ticket-draft";
import { SIM_ACCOUNT, type TimeInForce } from "@/lib/broker";
import { formatPrice } from "@/lib/market/ticks";
import { cn } from "@/lib/utils";

const TIFS: { value: TimeInForce; name: string; help: string }[] = [
  { value: "ROD", name: "ROD 留單", help: "未成交部分繼續等待，直到取消或本次練習結束。" },
  { value: "IOC", name: "IOC 餘量取消", help: "立即撮合能成交的張數，其餘立即取消。" },
  { value: "FOK", name: "FOK 全成或全撤", help: "整筆張數必須能一次成交，否則全筆取消。" },
];
function ignoreRepeat(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
}

export function LightningOrder({
  senior = false,
  active = true,
  className,
}: {
  senior?: boolean;
  active?: boolean;
  className?: string;
}) {
  const helpId = useId();
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const phase = useGame((s) => s.phase);
  const venue = useGame((s) => s.venue);
  const accountId = useGame((s) => s.accountId);
  const draft = useGame((s) => s.ticketDraft.lots);
  const tif = useGame((s) => s.ticket.tif);
  const armed = useGame((s) => s.flashOrder);
  const activation = useGame((s) => s.flashActivation);
  const result = useGame((s) => s.flashLastResult);
  const notice = useGame((s) => s.flashNotice);
  const paused = useGame((s) => s.paused);
  const scenarioId = useGame((s) => s.scenario?.id);
  const activeBeat = useGame((s) => s.activeBeat);
  const learnerGuideStep = useGame((s) => s.learnerGuideStep);
  const setFlashOrder = useGame((s) => s.setFlashOrder);
  const disarm = useGame((s) => s.disarmFlash);
  const setTicket = useGame((s) => s.setTicket);
  const editDraft = useGame((s) => s.editTicketDraft);
  const setTab = useGame((s) => s.setMobileTab);
  const frame = useGame((s) => s.frame);
  void frame;

  useEffect(() => {
    if (!active) {
      disarm("已離開閃電下單，需重新啟用。");
      return;
    }
    disarm("請核對商品、張數與效期，再明確啟用即送。");
    const blur = () => disarm("視窗失去焦點，閃電下單已解除。");
    const hide = () => {
      if (document.hidden) disarm("已切換分頁，閃電下單已解除。");
    };
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", hide);
      disarm("已離開閃電下單，需重新啟用。");
    };
  }, [active, senior, disarm]);

  if (!active) return null;
  const quote = engine?.quote(selected);
  const lots = parseLotsDraft(draft);
  const blocked =
    phase !== "live" ||
    !engine ||
    engine.ended ||
    venue !== "sim" ||
    accountId !== SIM_ACCOUNT ||
    learnerGuideStep !== null ||
    (scenarioId === "tycoon" && (paused || Boolean(activeBeat)));
  const eligibility =
    learnerGuideStep !== null
      ? "操作導覽中，請先完成或略過導覽。"
      : scenarioId === "tycoon" && (paused || activeBeat)
        ? "測驗暫停中不可下單，請自行繼續練習。"
        : blocked
          ? "目前無法使用模擬閃電下單。"
          : null;
  const pick = (price: number, side: "buy" | "sell") => {
    if (!quote) return;
    const state = useGame.getState();
    if (armed && activation) {
      state.submitLightning({ code: quote.code, side, price, activationId: activation.id });
    } else {
      state.disarmFlash("已帶入一般委託，請核對後再送出。");
      if (state.selected !== quote.code) return;
      state.clickPrice(price, side);
      state.setMobileTab("trade");
    }
  };
  return (
    <section
      className={cn(
        "lightning-order min-w-0 bg-surface p-3 text-fg sm:p-4",
        senior ? "text-lg" : "text-base",
        className,
      )}
      aria-label="閃電模擬下單"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">
            閃電下單 <span className="text-base text-muted">僅教室模擬</span>
          </h2>
          <p className="mt-2 break-words text-2xl font-bold">
            {selected} {quote?.name ?? "商品尚未載入"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTab("watch")}
          className="min-h-12 rounded-lg border border-border px-4 py-2"
        >
          更換商品
        </button>
      </header>
      <div className="sticky top-0 z-20 -mx-3 mt-3 space-y-2 border-y border-border bg-surface px-3 py-2 sm:-mx-4 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 break-words font-semibold">
            {armed ? "即送已啟用" : "先核對再送出"} · {selected} · {lots ?? "待輸入"} 張 · 限價{" "}
            {tif}
          </p>
          {armed && (
            <button
              type="button"
              onClick={() => setFlashOrder(false)}
              className="min-h-12 shrink-0 rounded-lg border border-warn bg-warn/10 px-4 py-2 font-bold text-fg"
            >
              停止即送
            </button>
          )}
        </div>
        <div role="status" aria-live="polite" className="break-words leading-relaxed">
          {result ? (
            <>
              <p className="line-clamp-2" title={result.message}>
                最近回覆 · {result.code} {result.side === "buy" ? "買進" : "賣出"}{" "}
                {result.lots ?? "待輸入"} 張：{result.message}
              </p>
              <details className="mt-1">
                <summary className="cursor-pointer py-1 text-muted">查看完整送單回覆</summary>
                <p className="mt-2">
                  限價 {formatPrice(result.price)} · {result.tif} ·{" "}
                  {new Date(result.at).toLocaleTimeString("zh-TW")}
                </p>
                <p>{result.message}</p>
                <p className="text-muted">這是送單當時的回覆，後續成交請查委託紀錄。</p>
              </details>
            </>
          ) : (
            <p className="text-muted">本次練習尚無閃電送單回覆。</p>
          )}
        </div>
      </div>
      <p className="my-3 leading-relaxed text-muted">
        {senior ? "大字模式預設先核對再送出。" : "未啟用時，點價只帶入一般委託。"}{" "}
        明確啟用後，點下方報價會立即送出限價模擬委託。
      </p>
      <div className="rounded-xl border border-border bg-bg p-3 sm:p-4">
        <label className="mb-2 block font-semibold" htmlFor={helpId}>
          每筆張數 · 1 張＝1,000 股
        </label>
        <input
          id={helpId}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          onChange={(event) => editDraft("lots", event.target.value)}
          aria-invalid={lots === null}
          aria-describedby={`${helpId}-help`}
          className="min-h-14 w-full rounded-lg border border-border bg-surface px-4 font-mono text-2xl text-fg"
        />
        <p
          id={`${helpId}-help`}
          className={cn("mt-2 leading-relaxed", lots === null ? "text-up" : "text-muted")}
        >
          {lots === null
            ? TICKET_LOTS_ERROR
            : "變更張數後，需要重新啟用即送。此張數與一般委託同步。"}
        </p>
        <div className="mt-3 grid grid-cols-4 gap-2" aria-label="快捷張數">
          {[1, 2, 5, 10].map((count) => (
            <button
              key={count}
              type="button"
              aria-pressed={lots === count}
              onClick={() => setTicket({ lots: count })}
              className={cn(
                "min-h-12 rounded-lg border border-border px-2 py-2 font-semibold",
                lots === count && "bg-header-2",
              )}
            >
              {count} 張
            </button>
          ))}
        </div>
        <fieldset className="mt-4">
          <legend className="mb-2 font-semibold">限價委託效期</legend>
          <div className="flex flex-wrap gap-2">
            {TIFS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={tif === option.value}
                onClick={() => setTicket({ tif: option.value })}
                className={cn(
                  "min-h-12 min-w-40 flex-1 basis-40 rounded-lg border border-border px-3 py-2 text-left",
                  tif === option.value && "bg-header-2 font-semibold",
                )}
              >
                {option.name}
              </button>
            ))}
          </div>
          <p className="mt-2 leading-relaxed text-muted">
            {TIFS.find((option) => option.value === tif)?.help}
          </p>
        </fieldset>
      </div>
      <div
        className={cn(
          "my-4 rounded-xl border p-3 sm:p-4",
          armed ? "border-warn bg-warn/10" : "border-border bg-bg",
        )}
      >
        <p className="break-words font-bold">
          {selected} · {lots ?? "待輸入"} 張 · 限價 {tif}
        </p>
        <p className="mt-1 leading-relaxed">
          {armed
            ? "即送已啟用：點買價／賣價按鈕就送出委託。"
            : "即送尚未啟用：點價後先到一般委託核對。"}
        </p>
        <button
          type="button"
          aria-pressed={armed}
          disabled={!armed && (blocked || lots === null)}
          onKeyDown={ignoreRepeat}
          onClick={(event) => {
            if (event.detail > 1) return;
            setFlashOrder(!armed, lots === null ? undefined : { code: selected, lots, tif });
          }}
          className={cn(
            "mt-3 min-h-14 w-full rounded-lg border border-border px-4 py-3 text-lg font-bold disabled:opacity-50",
            armed ? "bg-header-2 text-fg" : "bg-brand text-brand-fg",
          )}
        >
          {armed ? "停止即送" : `已核對，啟用 ${selected} 即送`}
        </button>
        {eligibility && <p className="mt-2 leading-relaxed text-up">{eligibility}</p>}
        {paused && !blocked && (
          <p className="mt-2 leading-relaxed text-warn">
            教學盤仍在暫停。此時送單會記錄為暫停中成交；啟用不會替你開始計時。
          </p>
        )}
        {notice && (
          <p role="status" className="mt-2 leading-relaxed text-muted">
            {notice}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap gap-3">
        {(["buy", "sell"] as const).map((side) => {
          const levels = side === "buy" ? (quote?.asks ?? []) : (quote?.bids ?? []);
          const action = side === "buy" ? "買進" : "賣出";
          return (
            <section
              key={side}
              className="min-w-0 flex-1 basis-60 rounded-xl border border-border p-3"
              aria-label={`${action}報價`}
            >
              <h3
                className={cn("mb-3 text-xl font-bold", side === "buy" ? "text-up" : "text-down")}
              >
                {action} · {side === "buy" ? "賣方報價" : "買方報價"}
              </h3>
              {levels.length === 0 ? (
                <p className="py-4 leading-relaxed text-muted">目前沒有可用對手量。</p>
              ) : (
                levels.map((level, index) => (
                  <button
                    key={`${side}-${level.price}`}
                    type="button"
                    disabled={blocked || lots === null || level.lots <= 0}
                    onKeyDown={ignoreRepeat}
                    onClick={(event) => {
                      if (event.detail <= 1) pick(level.price, side);
                    }}
                    aria-label={`${armed ? "立即模擬" : "帶入一般委託"}${action} ${selected} ${lots ?? "待輸入"} 張，限價 ${formatPrice(level.price)} 元，${tif}，對手量 ${level.lots} 張`}
                    className={cn(
                      "mb-2 flex min-h-20 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-3 text-left disabled:opacity-50",
                      side === "buy" ? "bg-up-dim text-up" : "bg-down-dim text-down",
                    )}
                  >
                    <span className="w-full font-semibold">
                      {armed ? `立即${action}` : `核對${action}`} {lots ?? "—"} 張{" "}
                      <span className="font-normal">· 第 {index + 1} 檔</span>
                    </span>
                    <span className="break-all font-mono text-2xl font-bold">
                      {formatPrice(level.price)}
                    </span>
                    <span className="break-words">對手 {level.lots} 張</span>
                  </button>
                ))
              )}
            </section>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => {
          useGame.getState().setRightTab("orders");
          setTab("pos");
        }}
        className="mt-3 min-h-12 rounded-lg border border-border px-4 py-2"
      >
        查看委託與成交
      </button>
    </section>
  );
}
