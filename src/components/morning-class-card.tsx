import { useEffect, useState } from "react";
import { RefreshCw, Users } from "@/lib/icons";
import { loadMorningClassSummary } from "@/lib/morning-teacher";
import type { MorningLessonSummary } from "@/lib/morning-class-summary";

type Loaded = Awaited<ReturnType<typeof loadMorningClassSummary>>;
const money = (value: number) => (value > 0 ? "+" : value < 0 ? "−" : "") + Math.abs(value).toLocaleString("en-US");
const dayText = (date: string) => date.slice(5).replace("-", "/");

/**
 * Teacher workspace: each daily lesson's rounds summed for the class (2026-11-08, the owner: 石大哥 can show the class
 * 「系統今天幫幾個人停利」), newest lesson open, the others folded.
 */
export function MorningClassCard() {
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ key: number; result?: Loaded; error?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadMorningClassSummary()
      .then((result) => !cancelled && setLoaded({ key: revision, result }))
      .catch(() => !cancelled && setLoaded({ key: revision, error: "早盤練習的紀錄暫時無法讀取" }));
    return () => {
      cancelled = true;
    };
  }, [revision]);
  const current = loaded?.key === revision ? loaded : null;
  const lessons = current?.result?.ok ? current.result.lessons : null;
  return (
    <section className="academy-card morning-class-card mt-7 p-5 sm:p-6" aria-labelledby="morning-class-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="morning-class-title" className="flex items-center gap-2 text-lg font-semibold">
          <Users aria-hidden="true" className="text-brand" />
          早盤練習 · 本課總結
        </h2>
        <button type="button" className="academy-button-secondary min-h-12" onClick={() => setRevision((value) => value + 1)}>
          <RefreshCw aria-hidden="true" />
          重新讀取
        </button>
      </div>
      {!current && <p role="status" className="mt-3 text-base text-muted">正在整理早盤練習…</p>}
      {current?.error && <p className="mt-3 text-base text-warn">{current.error}</p>}
      {current?.result && !current.result.ok && <p className="mt-3 text-base text-warn">{current.result.reason}</p>}
      {lessons && lessons.length === 0 && <p className="mt-3 text-base text-muted">班上還沒有完成的早盤練習。</p>}
      {lessons?.map((lesson, index) => <LessonBlock key={lesson.lessonId} lesson={lesson} open={index === 0} />)}
      {lessons && (
        <p className="mt-4 text-sm leading-6 text-muted">
          只計算已完成、沒有放棄的局；訪客不計。本輪損益含已付費稅，是教室的紙上成績，不代表實際交易能力。
        </p>
      )}
    </section>
  );
}

function LessonBlock({ lesson, open }: { lesson: MorningLessonSummary; open: boolean }) {
  return (
    <details className="mt-3 rounded-xl border border-border bg-surface px-4 py-3" open={open}>
      <summary className="cursor-pointer text-base leading-7">
        <strong className="font-mono">{dayText(lesson.date)}</strong>
        {` · ${lesson.students} 人練 ${lesson.rounds} 局 · 買進 ${lesson.buys} 次 · 停利觸發 ${lesson.takeProfit} · 停損觸發 ${lesson.stopLoss}`}
        {` · 留到收盤 ${lesson.held} · 正報酬 ${lesson.positive} 人 · 平均 ${money(lesson.averageResult)}`}
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="daily-teacher-table w-full text-left">
          <thead>
            <tr>
              <th>學員</th>
              <th>局數</th>
              <th>買進</th>
              <th>停利觸發</th>
              <th>停損觸發</th>
              <th>收盤庫存</th>
              <th>本輪損益</th>
            </tr>
          </thead>
          <tbody>
            {lesson.lines.map((line) => (
              <tr key={line.userId}>
                <td>{line.name}</td>
                <td>{line.rounds}</td>
                <td>{line.buys}</td>
                <td>{line.takeProfit}</td>
                <td>{line.stopLoss}</td>
                <td>{line.held ? "有" : "—"}</td>
                <td className="font-mono">{money(line.result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
