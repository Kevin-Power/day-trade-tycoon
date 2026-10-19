import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ListChecks, RefreshCw } from "@/lib/icons";
import { loadDailyForTeacher } from "@/lib/daily-teacher";
import { DAILY_REASONS } from "@/lib/daily/answer";
import { dataDateText, priceText, revealCopy, timeText } from "@/lib/daily/reveal";
import type { DailyChoice } from "@/lib/daily/types";

type Loaded = Awaited<ReturnType<typeof loadDailyForTeacher>>;
const CHOICE_TEXT: Record<DailyChoice, string> = { enter: "進場", watch: "觀望", skip: "不追" };
const reasonText = (id: string | null) => DAILY_REASONS.find((reason) => reason.id === id)?.label ?? "—";

/** Teacher workspace: today's question, the class split and who has not answered yet. */
export function DailyTeacherCard() {
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ key: number; result?: Loaded; error?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadDailyForTeacher()
      .then((result) => !cancelled && setLoaded({ key: revision, result }))
      .catch(() => !cancelled && setLoaded({ key: revision, error: "每日一題暫時無法讀取" }));
    return () => {
      cancelled = true;
    };
  }, [revision]);
  const current = loaded?.key === revision ? loaded : null;
  const view = current?.result?.ok ? current.result.view : null;
  const question = view?.question ?? null;
  const counts = view?.reveal?.counts;
  const answered = view?.rows.filter((row) => row.choice !== null) ?? [];
  const waiting = view?.rows.filter((row) => row.choice === null) ?? [];
  const share = (value: number) => (counts?.total ? `${(value / counts.total) * 100}%` : "0%");
  return (
    <section className="academy-card daily-teacher-card mt-7 p-5 sm:p-6" aria-labelledby="daily-teacher-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="daily-teacher-title" className="flex items-center gap-2 text-lg font-semibold">
          <ListChecks aria-hidden="true" className="text-brand" />
          每日一題
        </h2>
        <button type="button" className="academy-button-secondary min-h-12" onClick={() => setRevision((value) => value + 1)}>
          <RefreshCw aria-hidden="true" />
          重新讀取
        </button>
      </div>
      {!current && <p role="status" className="mt-3 text-base text-muted">正在讀取每日一題…</p>}
      {current?.error && <p className="mt-3 text-base text-warn">{current.error}</p>}
      {current?.result && !current.result.ok && <p className="mt-3 text-base text-warn">{current.result.reason}</p>}
      {view && !question && <p className="mt-3 text-base text-muted">今天還沒有題目。</p>}
      {question && view?.reveal && (
        <div className="mt-3 space-y-3 text-base">
          <p>
            <strong>{question.name}（{question.code}）</strong>
            {question.kind === "intraday-high" ? " 回到前高 " : " 漲到昨高 "}
            {priceText(question.level)}・題目時間 {timeText(question.questionT)}・取自 {dataDateText(question.dataDate)}
          </p>
          <p className="text-muted">
            揭曉：{revealCopy({ kind: question.kind, level: question.level, outcome: view.reveal.outcome, choice: "watch", entry: null }).headline}
          </p>
          <div>
            <p>
              已有 {counts!.total} 人作答：進場 {counts!.enter}、觀望 {counts!.watch}、不追 {counts!.skip}
              {view.guests > 0 && `（含訪客 ${view.guests} 人）`}
            </p>
            <div className="daily-split-bar mt-2" aria-hidden="true">
              <span data-choice="enter" style={{ width: share(counts!.enter) }} />
              <span data-choice="watch" style={{ width: share(counts!.watch) }} />
              <span data-choice="skip" style={{ width: share(counts!.skip) }} />
            </div>
          </div>
          {answered.length > 0 && (
            <div className="overflow-x-auto">
              <table className="daily-teacher-table w-full text-left">
                <thead>
                  <tr><th>學員</th><th>選擇</th><th>停損</th><th>理由</th><th>時間</th></tr>
                </thead>
                <tbody>
                  {answered.map((row) => (
                    <tr key={row.name + row.answeredAt}>
                      <td>{row.name}</td>
                      <td>{CHOICE_TEXT[row.choice!]}</td>
                      <td>{row.stopPrice === null ? "—" : priceText(row.stopPrice)}</td>
                      <td>{reasonText(row.reason)}</td>
                      <td>{row.answeredAt ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-muted">
            {view.rows.length === 0
              ? "班上還沒有學員資料，作答名單會在學員建立帳號後出現。"
              : `尚未作答（${waiting.length}）：${waiting.length ? waiting.map((row) => row.name).join("、") : "全班都答了"}`}
          </p>
          <Link to="/daily" search={{ teacher: "1" }} className="academy-button-primary inline-flex min-h-12 items-center px-5">
            看題目與解說
          </Link>
        </div>
      )}
    </section>
  );
}
