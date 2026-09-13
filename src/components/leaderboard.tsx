import { useEffect, useState } from "react";
import { loadLeaderboard } from "@/lib/classroom-db";
import { LESSONS } from "@/lib/game/curriculum";
import { cn, formatPct } from "@/lib/utils";

export function Leaderboard() {
  const [lessonId, setLessonId] = useState(LESSONS[0]?.id ?? "wed-open");
  const [rows, setRows] = useState<{ display_name: string; passed: boolean; ret: number; max_drawdown_pct: number; violations: string }[]>([]);

  useEffect(() => {
    void loadLeaderboard({ data: { lessonId } })
      .then(setRows)
      .catch(() => setRows([]));
  }, [lessonId]);

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">班級排行榜</h2>
        <select
          className="h-8 rounded-sm border border-border-strong bg-bg px-2 text-xs"
          value={lessonId}
          onChange={(e) => setLessonId(e.target.value)}
        >
          {LESSONS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.no} {l.skill}
            </option>
          ))}
        </select>
      </div>
      <p className="mb-2 text-micro text-muted">同一課、同本金、同額度才可比。通過者優先 → 報酬高 → 回撤低。</p>
      <table className="w-full text-left font-mono text-xs">
        <thead className="text-muted">
          <tr>
            <th className="py-1 font-medium">#</th>
            <th className="py-1 font-medium">學員</th>
            <th className="py-1 font-medium">報酬</th>
            <th className="py-1 font-medium">回撤</th>
            <th className="py-1 font-medium">違規</th>
            <th className="py-1 font-medium">通過</th>
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
              <tr key={`${r.display_name}-${i}`} className={cn("border-t border-border", !r.passed && "text-subtle")}>
                <td className="py-1.5">{i + 1}</td>
                <td className="py-1.5">{r.display_name || "學員"}</td>
                <td className="py-1.5">{formatPct(Number(r.ret) * 100)}</td>
                <td className="py-1.5">{(Number(r.max_drawdown_pct) * 100).toFixed(2)}%</td>
                <td className="py-1.5">{v}</td>
                <td className="py-1.5">{r.passed ? "是" : "否"}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-muted">
                這一課還沒有人上榜。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
