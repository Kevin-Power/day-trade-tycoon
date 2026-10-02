import { useEffect, useState } from "react";
import { loadLeaderboard } from "@/lib/classroom-db";
import { LESSONS } from "@/lib/game/curriculum";
import { cn, formatPct } from "@/lib/utils";
import { AlertCircle, ArrowDownUp, LoaderCircle, RefreshCw, Trophy } from "lucide-react";
import { toneClass } from "@/components/signed";

export function Leaderboard() {
  const [lessonId, setLessonId] = useState(LESSONS[0]?.id ?? "wed-open");
  const [rows, setRows] = useState<
    {
      display_name: string;
      passed: boolean;
      ret: number;
      max_drawdown_pct: number;
      violations: string;
    }[]
  >([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRows([]);
    setError(false);
    setLoading(true);
    void loadLeaderboard({ data: { lessonId } })
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId, requestKey]);

  return (
    <div className="academy-card overflow-hidden">
      <div className="flex flex-col gap-5 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2.5 text-lg font-semibold">
            <Trophy aria-hidden="true" className="size-5 text-brand" />
            班級排行榜
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
            比較同一堂課的練習，從紀律、報酬與回撤一起討論。
          </p>
        </div>
        <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted sm:min-w-44">
          比較課程
          <select
            className="academy-input w-full text-sm"
            value={lessonId}
            aria-label="排行課程"
            onChange={(e) => setLessonId(e.target.value)}
          >
            {LESSONS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.no} {l.skill}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="flex items-start gap-2 border-b border-border bg-bg/60 px-5 py-3 text-xs leading-5 text-muted sm:px-6">
        <ArrowDownUp aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        僅顯示本班同課練習紀錄。通過者優先，再依報酬與回撤排序。
      </p>
      {rows.length > 0 ? (
        <div className="term-scroll overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left text-sm">
            <caption className="sr-only">
              本班同課練習的排名、模擬報酬、回撤、待練習條件與通過狀態
            </caption>
            <thead className="bg-bg/30 text-xs text-muted">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium sm:px-6">
                  名次
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  學員
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  模擬報酬
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  最大回撤
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  待練習條件
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  課程條件
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                let v = 0;
                try {
                  v = (JSON.parse(r.violations) as string[]).length;
                } catch {
                  v = 0;
                }
                return (
                  <tr
                    key={`${r.display_name}-${i}`}
                    className="border-t border-border transition-colors hover:bg-bg/60"
                  >
                    <td className="px-5 py-4 sm:px-6">
                      <span
                        className={cn(
                          "inline-flex size-7 items-center justify-center rounded-lg font-mono text-xs",
                          i === 0 ? "bg-brand/10 font-semibold text-brand" : "bg-bg text-muted",
                        )}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td className="max-w-52 break-words px-4 py-4 font-medium">
                      {r.display_name || "學員"}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-4 text-right font-mono tabular",
                        toneClass(Number(r.ret)),
                      )}
                    >
                      {formatPct(Number(r.ret) * 100)}
                    </td>
                    <td className="px-4 py-4 text-right font-mono tabular text-muted">
                      {(Number(r.max_drawdown_pct) * 100).toFixed(2)}%
                    </td>
                    <td className="px-4 py-4 text-right font-mono tabular text-muted">{v}</td>
                    <td className="px-5 py-4">
                      <span
                        className={cn(
                          "inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs",
                          r.passed ? "bg-brand/10 text-brand" : "bg-bg text-muted",
                        )}
                      >
                        {r.passed ? "已通過" : "待練習"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div role="status" className="px-5 py-12 text-center sm:px-6">
          {loading ? (
            <>
              <LoaderCircle
                aria-hidden="true"
                className="mx-auto mb-3 size-7 animate-spin text-brand"
              />
              <p className="text-sm text-muted">正在讀取這堂課的練習紀錄…</p>
            </>
          ) : error ? (
            <>
              <AlertCircle aria-hidden="true" className="mx-auto mb-3 size-7 text-muted" />
              <p className="font-medium">暫時無法讀取本班排行</p>
              <p className="mt-2 text-sm text-muted">資料尚未載入，可以再試一次。</p>
              <button
                type="button"
                onClick={() => setRequestKey((key) => key + 1)}
                className="academy-button-secondary mt-5"
              >
                <RefreshCw aria-hidden="true" className="size-4" />
                重新載入
              </button>
            </>
          ) : (
            <>
              <Trophy aria-hidden="true" className="mx-auto mb-3 size-8 text-subtle" />
              <p className="font-medium">這堂課的排行還是空的</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">
                學員完成並儲存這堂課的練習後，就能在這裡一起比較與討論。
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
