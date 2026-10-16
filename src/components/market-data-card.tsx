import { useEffect, useState } from "react";
import { CalendarClock, RefreshCw } from "lucide-react";
import { loadMarketDataStatus } from "@/lib/market-data";
import type { MarketDataState, MarketDataSummary } from "@/lib/market-data-status";
import { cn } from "@/lib/utils";

const STATE_TEXT: Record<MarketDataState, string> = {
  unconfigured: "未設定",
  never: "尚未執行",
  ok: "成功",
  closed: "休市",
  failed: "失敗",
  running: "執行中",
  stalled: "可能中斷",
  invalid: "狀態異常",
};
const ALERT: MarketDataState[] = ["failed", "stalled", "invalid"];
const time = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";

/** Teacher workspace card: the daily Fubon market-data fetch, read from its status files. */
export function MarketDataCard() {
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ key: number; summary?: MarketDataSummary; error?: string } | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    void loadMarketDataStatus()
      .then((result) => {
        if (!cancelled)
          setLoaded(result.ok ? { key: revision, summary: result.summary } : { key: revision, error: result.reason });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key: revision, error: "每日行情狀態暫時無法讀取" });
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);
  const summary = loaded?.key === revision ? loaded.summary : undefined;
  const error = loaded?.key === revision ? loaded.error : undefined;
  return (
    <section className="academy-card mt-7 p-5 sm:p-6" aria-labelledby="market-data-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="market-data-title" className="flex items-center gap-2 text-lg font-semibold">
          <CalendarClock aria-hidden="true" className="size-5 text-brand" />
          富邦每日行情
        </h2>
        <button
          type="button"
          className="academy-button-secondary min-h-12"
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          重新讀取
        </button>
      </div>
      {!summary && !error && (
        <p role="status" className="mt-3 text-base text-muted">
          正在讀取每日行情狀態…
        </p>
      )}
      {error && <p className="mt-3 text-base text-warn">{error}</p>}
      {summary && (
        <div className="mt-3 space-y-2 text-base">
          <p>
            狀態：
            <strong className={cn("ml-1", ALERT.includes(summary.state) ? "text-warn" : "text-brand")}>
              {STATE_TEXT[summary.state]}
            </strong>
          </p>
          {summary.state === "unconfigured" ? (
            <p className="text-muted">此教室未設定富邦每日資料。</p>
          ) : (
            <>
              <p className="text-muted">
                最新教材日：
                <span className="font-mono text-fg">{summary.latestDay ?? "—"}</span>
                {summary.latestSymbols !== null && `・${summary.latestSymbols.toLocaleString("zh-TW")} 檔`}
                ・已累積 {summary.fullMarketDays} 個全市場交易日
              </p>
              {summary.lastRun && (
                <p className="text-muted">
                  最近一次：{summary.lastRun.date}（{summary.lastRun.mode === "daily" ? "每日" : "補抓"}），
                  {time(summary.lastRun.startedAt)} 開始
                  {summary.lastRun.durationMinutes !== null && `，耗時 ${summary.lastRun.durationMinutes} 分鐘`}
                  ，抓到 {summary.lastRun.symbols.fetched}／{summary.lastRun.symbols.total} 檔
                </p>
              )}
              {summary.reason && <p className="text-warn">原因：{summary.reason}</p>}
              {summary.missingExpectedDay && (
                <p className="text-warn">
                  預期應有 {summary.missingExpectedDay} 的教材，請檢查排程與這台電腦是否開機。
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
