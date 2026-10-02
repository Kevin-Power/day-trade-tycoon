import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { loadTeacherRoster } from "@/lib/classroom-db";
import { LESSONS } from "@/lib/game/curriculum";
import { cn, formatPct } from "@/lib/utils";
import { Leaderboard } from "@/components/leaderboard";
import { csvCell } from "@/lib/classroom-policy";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  GraduationCap,
  LoaderCircle,
  ShieldCheck,
  Users,
} from "lucide-react";

export const Route = createFileRoute("/teacher")({ component: TeacherPage });

const LESSON_IDS = LESSONS.map((l) => l.id);

type Roster = Awaited<ReturnType<typeof loadTeacherRoster>>;

function TeacherPage() {
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id;
  const [data, setData] = useState<Roster | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadTeacherRoster()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setData({ ok: false, reason: "此帳號尚未由管理員授予講師權限" });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (isPending) return <TeacherLoading message="確認講師帳號…" />;
  if (!user) return <RedirectToSignIn />;

  if (data && data.ok === false) {
    return (
      <main className="academy-page flex items-center justify-center px-4 py-16">
        <div className="academy-card w-full max-w-lg p-7 sm:p-9">
          <ShieldCheck aria-hidden="true" className="mb-5 size-9 text-brand" />
          <p className="academy-eyebrow">講師專區</p>
          <h1 className="mt-2 text-2xl font-semibold">目前無法開啟班級資料</h1>
          <p className="mt-4 text-sm leading-7 text-muted">
            {data.reason ?? "只有教師帳號看得到這一頁。"}
          </p>
          <p className="mt-2 text-sm leading-7 text-muted">
            講師權限由主機管理員指定，班級代碼不能用來取得講師權限。
          </p>
          <Link to="/" className="academy-button-secondary mt-6">
            <ArrowLeft aria-hidden="true" className="size-4" />
            回教室大廳
          </Link>
        </div>
      </main>
    );
  }

  if (!data) return <TeacherLoading message="正在整理班級紀錄…" />;

  const students = data?.ok ? data.students.filter((s) => s.role !== "teacher") : [];
  const sessions = data?.ok ? data.sessions : [];

  return (
    <main className="academy-page">
      <header className="academy-header">
        <div className="academy-container flex flex-wrap items-center justify-between gap-4 py-4">
          <span className="flex items-center gap-2.5 text-sm font-medium">
            <GraduationCap aria-hidden="true" className="size-5 text-brand" />
            當沖大富翁<span className="border-l border-border pl-2.5 text-muted">講師工作區</span>
          </span>
          <Link to="/" className="academy-nav-link">
            <ArrowLeft aria-hidden="true" className="size-4" />
            教室大廳
          </Link>
        </div>
      </header>
      <div className="academy-container py-8 sm:py-11">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="academy-eyebrow">TEACHER WORKSPACE</p>
            <h1 className="academy-title mt-2">班級教學總覽</h1>
            <p className="academy-description mt-3">
              先查看各課練習狀況，再展開學員進度，找到下一次帶班值得討論的地方。
            </p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted">
              <ShieldCheck aria-hidden="true" className="size-3.5 text-brand" />
              班級 <span className="font-mono text-fg">{data.classCode}</span>
            </div>
          </div>
          <button
            type="button"
            className="academy-button-secondary shrink-0 self-start"
            onClick={() => exportCsv(students, sessions)}
          >
            <Download aria-hidden="true" className="size-4" />
            匯出班級 CSV
          </button>
        </div>

        <section className="mt-9" aria-labelledby="class-progress-title">
          <div className="mb-4">
            <h2 id="class-progress-title" className="text-lg font-semibold">
              各課練習概況
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              通過率依本班已儲存的練習次數計算，包含同一學員重練。
            </p>
          </div>
          <ClassSummary sessions={sessions} />
        </section>

        <section
          className="academy-card mt-8 overflow-hidden"
          aria-labelledby="student-roster-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-5 sm:px-6">
            <div>
              <h2 id="student-roster-title" className="text-lg font-semibold">
                學員進度{" "}
                <span className="ml-2 text-sm font-normal text-muted">{students.length} 人</span>
              </h2>
              <p className="mt-1 text-sm text-muted">點選姓名，展開各課通過狀況與練習紀錄。</p>
            </div>
            <span className="text-xs text-subtle sm:hidden">表格可左右滑動</span>
          </div>
          <div className="term-scroll overflow-x-auto">
            <table
              className={cn("w-full text-left text-sm", students.length > 0 && "min-w-[40rem]")}
            >
              <caption className="sr-only">本班學員完成課數、段位與最近練習時間</caption>
              <thead className="bg-bg/50 text-xs text-muted">
                <tr>
                  <th scope="col" className="px-5 py-3.5 font-medium sm:px-6">
                    學員
                  </th>
                  <th scope="col" className="px-4 py-3.5 font-medium">
                    已通過課數
                  </th>
                  <th scope="col" className="px-4 py-3.5 font-medium">
                    目前段位
                  </th>
                  <th scope="col" className="px-5 py-3.5 font-medium">
                    最近練習
                  </th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const mine = sessions.filter((x) => x.user_id === s.user_id);
                  const passed = new Set(mine.filter((x) => x.passed).map((x) => x.lesson_id));
                  const last = mine
                    .map((x) => x.ended_at)
                    .filter(Boolean)
                    .sort()
                    .at(-1);
                  return (
                    <Fragment key={s.user_id}>
                      <tr
                        className={cn(
                          "border-t border-border transition-colors hover:bg-elevated/40",
                          open === s.user_id && "bg-elevated/30",
                        )}
                      >
                        <td className="px-5 py-4 sm:px-6">
                          <button
                            type="button"
                            className="inline-flex min-h-9 items-center gap-2.5 rounded-sm text-left font-medium hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                            aria-expanded={open === s.user_id}
                            aria-controls={`student-lessons-${s.user_id}`}
                            onClick={() => setOpen(open === s.user_id ? null : s.user_id)}
                          >
                            <ChevronDown
                              aria-hidden="true"
                              className={cn(
                                "size-4 shrink-0 text-muted transition-transform",
                                open === s.user_id && "rotate-180",
                              )}
                            />
                            {s.display_name || s.user_id.slice(0, 8)}
                          </button>
                        </td>
                        <td className="px-4 py-4">
                          <span className="font-mono tabular">
                            {passed.size} <span className="text-subtle">/ {LESSON_IDS.length}</span>
                          </span>
                          <div
                            aria-hidden="true"
                            className="mt-2 h-1.5 w-24 overflow-hidden rounded-full bg-elevated"
                          >
                            <div
                              className="h-full rounded-full bg-brand"
                              style={{
                                width: `${Math.min(100, (passed.size / LESSON_IDS.length) * 100)}%`,
                              }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-4 text-muted">{rankLabel(passed.size)}</td>
                        <td className="px-5 py-4 font-mono text-xs text-muted">
                          {last ? (
                            <time dateTime={last}>{last.slice(0, 16).replace("T", " ")}</time>
                          ) : (
                            "尚無練習"
                          )}
                        </td>
                      </tr>
                      {open === s.user_id && (
                        <tr id={`student-lessons-${s.user_id}`}>
                          <td
                            colSpan={4}
                            className="border-t border-border bg-bg/40 px-5 py-5 sm:px-6"
                          >
                            <LessonStrip mine={mine} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-12 text-center">
                      <Users aria-hidden="true" className="mx-auto mb-4 size-8 text-subtle" />
                      <p className="font-medium">等待第一位學員加入</p>
                      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
                        請學員完成註冊並填寫本班代碼。學員儲存練習後，就能在這裡查看各課進度。
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8">
          <Leaderboard />
          <p className="mt-4 px-1 text-xs leading-6 text-muted">
            五堂課與一場期末練習。紀錄由學員模擬操作產生，供帶班討論；正式驗收請搭配講師觀察。
          </p>
        </section>
      </div>
    </main>
  );
}

function TeacherLoading({ message }: { message: string }) {
  return (
    <main className="academy-page flex items-center justify-center px-4 py-20">
      <div role="status" className="academy-card flex items-center gap-3 p-6 text-sm text-muted">
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-brand" />
        {message}
      </div>
    </main>
  );
}

function LessonStrip({
  mine,
}: {
  mine: {
    lesson_id: string;
    passed: boolean;
    final_equity: number;
    initial_equity: number;
    max_drawdown_pct: number;
    discipline_violations_json: string;
  }[];
}) {
  return (
    <div className="grid gap-3 text-xs sm:grid-cols-3">
      {LESSON_IDS.map((id) => {
        const rows = mine.filter((x) => x.lesson_id === id);
        const best = rows.sort(
          (a, b) =>
            Number(b.passed) - Number(a.passed) ||
            b.final_equity - b.initial_equity - (a.final_equity - a.initial_equity),
        )[0];
        const lesson = LESSONS.find((l) => l.id === id);
        const state = !best ? "尚未練習" : best.passed ? "已通過" : "待練習";
        const ret =
          best && best.initial_equity
            ? (best.final_equity - best.initial_equity) / best.initial_equity
            : 0;
        let v = 0;
        try {
          v = best ? (JSON.parse(best.discipline_violations_json) as string[]).length : 0;
        } catch {
          v = 0;
        }
        return (
          <div key={id} className="rounded-xl border border-border bg-surface p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">{lesson?.no}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-1 text-[11px]",
                  best?.passed ? "bg-brand/10 text-brand" : "bg-elevated text-muted",
                )}
              >
                {state}
              </span>
            </div>
            <div className="mt-2 font-medium">{lesson?.skill}</div>
            {best && (
              <div className="mt-2 space-y-1 font-mono text-xs text-muted">
                <p>報酬 {formatPct(ret * 100)}</p>
                <p>
                  回撤 {(best.max_drawdown_pct * 100).toFixed(1)}% · 待練習條件 {v}
                </p>
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
  sessions: {
    lesson_id: string;
    passed: boolean;
    max_drawdown_pct: number;
    discipline_violations_json: string;
  }[];
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
          for (const v of JSON.parse(r.discipline_violations_json) as string[])
            counts[v] = (counts[v] ?? 0) + 1;
        } catch {
          /* */
        }
      }
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      return { id, n, pass, dd, top: top?.[0] ?? "—" };
    });
  }, [sessions]);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {by.map((r) => {
        const lesson = LESSONS.find((l) => l.id === r.id);
        return (
          <div key={r.id} className="academy-card p-5">
            <p className="text-xs text-muted">{lesson?.no}</p>
            <h3 className="mt-1.5 font-medium">{lesson?.skill}</h3>
            <div className="mt-5 flex items-end justify-between gap-3">
              <div>
                <p className="text-xs text-muted">練習通過率</p>
                <p className="mt-1 font-mono text-2xl tabular text-brand">
                  {r.n ? `${Math.round((r.pass / r.n) * 100)}%` : "—"}
                </p>
              </div>
              <p className="pb-1 text-xs text-muted">
                {r.n ? `${r.pass} / ${r.n} 筆通過` : "尚無練習"}
              </p>
            </div>
            <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full bg-brand/75"
                style={{ width: `${r.n ? (r.pass / r.n) * 100 : 0}%` }}
              />
            </div>
            <div className="mt-4 space-y-1.5 border-t border-border pt-4 text-xs text-muted">
              <p>
                平均回撤{" "}
                <span className="ml-1 font-mono text-fg">
                  {r.n ? `${(r.dd * 100).toFixed(1)}%` : "—"}
                </span>
              </p>
              <p className="break-words">最常見待練習條件：{r.top}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function rankLabel(passed: number) {
  if (passed >= 6) return "當沖學員";
  if (passed >= 3) return "見習生";
  if (passed >= 1) return "見習生";
  return "尚無通過紀錄";
}

function exportCsv(
  students: { user_id: string; display_name: string }[],
  sessions: {
    user_id: string;
    lesson_id: string;
    passed: boolean;
    final_equity: number;
    initial_equity: number;
    max_drawdown_pct: number;
  }[],
) {
  const lines = ["name,lesson,passed,return,drawdown"];
  for (const s of students) {
    for (const id of LESSON_IDS) {
      const rows = sessions.filter((x) => x.user_id === s.user_id && x.lesson_id === id);
      const best = rows[0];
      const ret =
        best && best.initial_equity
          ? (best.final_equity - best.initial_equity) / best.initial_equity
          : "";
      lines.push(
        [s.display_name, id, best ? (best.passed ? 1 : 0) : "", ret, best?.max_drawdown_pct ?? ""]
          .map(csvCell)
          .join(","),
      );
    }
  }
  const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "classroom.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
