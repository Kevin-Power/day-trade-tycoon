import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { resetCoachSeen } from "@/lib/coach-steps";
import { browserStorage } from "@/lib/device-storage";
import { TODAY_STEP_LABELS, todaySteps, type TodayAction } from "@/lib/today-steps";

const ACTION_LABEL: Record<TodayAction, string> = {
  start: "開始今天的練習",
  continue: "繼續練習",
  review: "寫復盤",
  again: "再練一輪",
};

/** Lobby: today's three steps and one next-step button. A failed read simply shows "start". */
export function TodayCard() {
  const { user, guest, isPending } = useCurrentUserState();
  const owner = user?.id ?? guest?.id ?? null;
  const [today, setToday] = useState(() => todaySteps(null, 0, Date.now()));
  useEffect(() => {
    if (isPending || !owner) return;
    let cancelled = false;
    fetch("/api/morning", { credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled && body?.catalog)
          setToday(todaySteps(body.state ?? null, body.catalog.maxCursor, Date.now()));
      })
      .catch(() => {
        /* Keep "start"; the practice page shows the real state. */
      });
    return () => {
      cancelled = true;
    };
  }, [isPending, owner]);

  return (
    <section className="today-card" aria-labelledby="today-title">
      <h2 id="today-title">今天三件事</h2>
      <ol>
        {TODAY_STEP_LABELS.map((label, index) => {
          const state = today.steps[index];
          return (
            <li key={label} data-state={state} aria-current={state === "now" ? "step" : undefined}>
              <span className="today-step-mark" aria-hidden="true">
                {state === "done" ? <Check size={18} /> : index + 1}
              </span>
              <span className="today-step-label">{label}</span>
              {state === "done" && <span className="sr-only">已完成</span>}
              {state === "now" && <span className="today-step-now">現在</span>}
            </li>
          );
        })}
      </ol>
      {today.action === "again" && <p className="today-done">今天完成了，明天再來</p>}
      <Link to="/morning" search={{ panel: "trade" }} className="academy-button-primary today-primary">
        {ACTION_LABEL[today.action]}
      </Link>
      <Link
        to="/morning"
        search={{ panel: "trade", coach: "1" }}
        onClick={() => resetCoachSeen(browserStorage())}
        className="today-coach-link"
      >
        第一次使用？看新手教學
      </Link>
    </section>
  );
}
