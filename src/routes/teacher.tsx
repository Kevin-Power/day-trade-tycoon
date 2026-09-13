import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { loadTeacherRoster } from "@/lib/classroom-db";
import { LESSONS } from "@/lib/game/curriculum";
import { cn, formatPct } from "@/lib/utils";
import { Leaderboard } from "@/components/leaderboard";

export const Route = createFileRoute("/teacher")({ component: TeacherPage });

const LESSON_IDS = LESSONS.map((l) => l.id);

type Roster = Awaited<ReturnType<typeof loadTeacherRoster>>;

function TeacherPage() {
  const { user, isPending } = useCurrentUserState();
  const [data, setData] = useState<Roster | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void loadTeacherRoster()
      .then(setData)
      .catch(() => setData({ ok: false, reason: "不是教師帳號" }));
  }, [user]);

  if (isPending) return <div className="min-h-dvh bg-bg p-8 text-muted">載入中…</div>;
  if (!user) return <RedirectToSignIn />;

  if (data && data.ok === false) {
    return (
      <main className="min-h-dvh bg-bg p-6 text-fg">
        <p className="text-sm">{data.reason ?? "只有教師帳號看得到這一頁。"}</p>
        <p className="mt-2 text-micro text-muted">註冊時班級代碼填 TEACHER 即為教師。</p>
        <Link to="/" className="mt-4 inline-block text-tape">
          回大廳
        </Link>
      </main>
    );
  }

  const students = data?.ok ? data.students.filter((s) => s.role !== "teacher") : [];
  const sessions = data?.ok ? data.sessions : [];

  return (
    <main className="min-h-dvh bg-bg px-4 py-6 text-fg sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-micro tracking-[0.2em] text-muted">教師儀表板</p>
            <h1 className="text-2xl font-medium">班級 {data?.ok ? data.classCode : ""}</h1>
            <p className="mt-1 text-sm text-muted">
              講師專用：誰卡在第幾課、通過率、違規類型、班級排行。學員說明在教室說明書。
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              className="rounded-sm border border-border-strong px-3 py-1.5 text-xs"
              onClick={() => exportCsv(students, sessions)}
            >
              匯出 CSV
            </button>
            <Link to="/" className="text-xs text-muted hover:text-fg">
              回大廳
            </Link>
          </div>
        </div>

        <ClassSummary sessions={sessions} />

        <section className="mt-6 overflow-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-header-2 text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">學員</th>
                <th className="px-3 py-2 font-medium">已完成課數</th>
                <th className="px-3 py-2 font-medium">目前段位</th>
                <th className="px-3 py-2 font-medium">最近上線</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const mine = sessions.filter((x) => x.user_id === s.user_id);
                const passed = new Set(mine.filter((x) => x.passed).map((x) => x.lesson_id));
                const last = mine.map((x) => x.ended_at).filter(Boolean).sort().at(-1);
                return (
                  <tr key={s.user_id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <button type="button" className="text-left hover:text-tape" onClick={() => setOpen(open === s.user_id ? null : s.user_id)}>
                        {s.display_name || s.user_id.slice(0, 8)}
                      </button>
                      {open === s.user_id && <LessonStrip mine={mine} />}
                    </td>
                    <td className="px-3 py-2 font-mono">{passed.size} / 6</td>
                    <td className="px-3 py-2">{rankLabel(passed.size)}</td>
                    <td className="px-3 py-2 font-mono text-micro text-muted">{last ? last.slice(0, 16).replace("T", " ") : "—"}</td>
                  </tr>
                );
              })}
              {students.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted">
                    還沒有學員。請學員註冊時輸入班級代碼。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium">班級排行榜</h2>
          <Leaderboard />
        </section>
      </div>
    </main>
  );
}

function LessonStrip({
  mine,
}: {
  mine: { lesson_id: string; passed: boolean; final_equity: number; initial_equity: number; max_drawdown_pct: number; discipline_violations_json: string }[];
}) {
  return (
    <div className="mt-2 grid gap-1 text-micro sm:grid-cols-3">
      {LESSON_IDS.map((id) => {
        const rows = mine.filter((x) => x.lesson_id === id);
        const best = rows.sort((a, b) => b.final_equity - a.final_equity)[0];
        const lesson = LESSONS.find((l) => l.id === id);
        const state = !best ? "未打" : best.passed ? "已過" : "未過";
        const ret = best && best.initial_equity ? (best.final_equity - best.initial_equity) / best.initial_equity : 0;
        let v = 0;
        try {
          v = best ? (JSON.parse(best.discipline_violations_json) as string[]).length : 0;
        } catch {
          v = 0;
        }
        return (
          <div key={id} className="rounded-sm border border-border bg-bg px-2 py-1">
            <div className="text-muted">{lesson?.no} {lesson?.skill}</div>
            <div className={cn(state === "已過" ? "text-down" : state === "未過" ? "text-up" : "text-subtle")}>{state}</div>
            {best && (
              <div className="font-mono text-subtle">
                {formatPct(ret * 100)} · DD {(best.max_drawdown_pct * 100).toFixed(1)}% · 違規 {v}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ClassSummary({
  sessions,
}: {
  sessions: { lesson_id: string; passed: boolean; max_drawdown_pct: number; discipline_violations_json: string }[];
}) {
  const by = useMemo(() => {
    return LESSON_IDS.map((id) => {
      const rows = sessions.filter((s) => s.lesson_id === id);
      const n = rows.length;
      const pass = rows.filter((s) => s.passed).length;
      const dd = n ? rows.reduce((a, b) => a + b.max_drawdown_pct, 0) / n : 0;
      const counts: Record<string, number> = {};
      for (const r of rows) {
        try {
          for (const v of JSON.parse(r.discipline_violations_json) as string[]) counts[v] = (counts[v] ?? 0) + 1;
        } catch {
          /* */
        }
      }
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      return { id, n, pass, dd, top: top?.[0] ?? "—" };
    });
  }, [sessions]);

  return (
    <section className="mt-6 grid gap-2 sm:grid-cols-3">
      {by.map((r) => {
        const lesson = LESSONS.find((l) => l.id === r.id);
        return (
          <div key={r.id} className="rounded-lg border border-border bg-surface px-3 py-2">
            <div className="text-xs font-medium">{lesson?.no} {lesson?.skill}</div>
            <div className="mt-1 font-mono text-micro text-muted">
              通過率 {r.n ? `${Math.round((r.pass / r.n) * 100)}%` : "—"} · 平均回撤 {(r.dd * 100).toFixed(1)}%
            </div>
            <div className="text-micro text-subtle">最常見違規：{r.top}</div>
          </div>
        );
      })}
    </section>
  );
}

function rankLabel(passed: number) {
  if (passed >= 6) return "當沖學員";
  if (passed >= 3) return "見習生";
  if (passed >= 1) return "見習生";
  return "尚未開課";
}

function exportCsv(
  students: { user_id: string; display_name: string }[],
  sessions: { user_id: string; lesson_id: string; passed: boolean; final_equity: number; initial_equity: number; max_drawdown_pct: number }[],
) {
  const lines = ["name,lesson,passed,return,drawdown"];
  for (const s of students) {
    for (const id of LESSON_IDS) {
      const rows = sessions.filter((x) => x.user_id === s.user_id && x.lesson_id === id);
      const best = rows[0];
      const ret = best && best.initial_equity ? (best.final_equity - best.initial_equity) / best.initial_equity : "";
      lines.push(`${s.display_name},${id},${best ? (best.passed ? 1 : 0) : ""},${ret},${best?.max_drawdown_pct ?? ""}`);
    }
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "classroom.csv";
  a.click();
}
