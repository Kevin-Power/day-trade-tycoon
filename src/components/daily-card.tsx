import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Flame } from "@/lib/icons";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { dataDateText, revealCopy } from "@/lib/daily/reveal";
import type { WeekDot } from "@/lib/daily/progress";
import type { DailyResponse } from "@/lib/daily-question.server";

const WEEKDAY = ["一", "二", "三", "四", "五"];
const DOT_TEXT: Record<WeekDot["state"], string> = { done: "已完成", missed: "沒有作答", todo: "還沒到", off: "休" };

/** Lobby, first thing in the morning: today's question, the streak and this week's five days. */
export function DailyCard() {
  const { user, guest, isPending } = useCurrentUserState();
  const owner = user?.id ?? guest?.id ?? null;
  const [data, setData] = useState<DailyResponse | null>(null);
  useEffect(() => {
    if (isPending || !owner) return;
    let cancelled = false;
    fetch("/api/daily", { credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: DailyResponse | null) => {
        if (!cancelled && body?.progress) setData(body);
      })
      .catch(() => {
        /* The card still offers to start; the page shows any real problem. */
      });
    return () => {
      cancelled = true;
    };
  }, [isPending, owner]);

  const question = data?.question ?? null;
  const answered = Boolean(data?.answer);
  const noQuestion = data !== null && question === null;
  const headline =
    question && data?.reveal && data.answer
      ? revealCopy({ kind: question.kind, level: question.level, outcome: data.reveal.outcome, choice: data.answer.choice, entry: data.reveal.entry }).headline
      : "";
  const progress = data?.progress;
  return (
    <section className="daily-card" aria-labelledby="daily-card-title">
      <div className="daily-card-main">
        <h2 id="daily-card-title">{answered ? "今天的一題 · 已完成" : "今天的一題"}</h2>
        <p>
          {noQuestion
            ? "每個平日早上 6 點出新的一題"
            : answered
              ? headline
              : `約 1 分鐘${question ? ` · 題目取自 ${dataDateText(question.dataDate)} 真實走勢` : ""}`}
        </p>
        {!noQuestion && (
          <Link to="/daily" className="academy-button-primary daily-card-primary">
            {answered ? "看解說" : "開始作答"}
          </Link>
        )}
      </div>
      {progress && (
        <div className="daily-card-progress">
          <p className="daily-card-streak">
            <Flame aria-hidden />
            連續 {progress.streak} 天
          </p>
          <ol className="daily-card-week" aria-label={`本週完成 ${progress.week.done}／${progress.week.total} 天`}>
            {progress.week.days.map((day, index) => (
              <li key={day.date} data-state={day.state}>
                <span aria-hidden="true">{day.state === "off" ? "休" : WEEKDAY[index]}</span>
                <span className="sr-only">週{WEEKDAY[index]}：{DOT_TEXT[day.state]}</span>
              </li>
            ))}
          </ol>
          <p className="daily-card-week-text">本週 {progress.week.done}／{progress.week.total} 天</p>
        </div>
      )}
    </section>
  );
}
