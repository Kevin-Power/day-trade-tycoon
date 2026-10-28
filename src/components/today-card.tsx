import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check } from "@/lib/icons";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { resetCoachSeen } from "@/lib/coach-steps";
import { browserStorage } from "@/lib/device-storage";
import {
  TODAY_ACTION_LABELS,
  TODAY_START,
  TODAY_STEP_LABELS,
  todayFromReply,
  todayLink,
  type TodayView,
} from "@/lib/today-steps";

/**
 * Lobby: today's three steps and one next-step button. The read names no lesson, so the server's default decides: the
 * open run, else the newest day. A failed read simply shows "start"; a classroom without daily lessons shows the
 * server's sentence instead of the buttons.
 */
export function TodayCard() {
  const { user, guest, isPending } = useCurrentUserState();
  const owner = user?.id ?? guest?.id ?? null;
  const [today, setToday] = useState<TodayView>(TODAY_START);
  useEffect(() => {
    if (isPending || !owner) return;
    let cancelled = false;
    fetch("/api/morning", { credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        const view = todayFromReply(body, Date.now());
        if (!cancelled && view) setToday(view);
      })
      .catch(() => {
        /* Keep "start"; the practice page shows the real state. */
      });
    return () => {
      cancelled = true;
    };
  }, [isPending, owner]);

  const { action } = today;
  return (
    <section className="today-card" aria-labelledby="today-title">
      <h2 id="today-title">今天三件事</h2>
      <ol>
        {TODAY_STEP_LABELS.map((label, index) => {
          const state = today.steps[index];
          return (
            <li key={label} data-state={state} aria-current={state === "now" ? "step" : undefined}>
              <span className="today-step-mark" aria-hidden="true">
                {state === "done" ? <Check /> : index + 1}
              </span>
              <span className="today-step-label">{label}</span>
              {state === "done" && <span className="sr-only">已完成</span>}
              {state === "now" && <span className="today-step-now">現在</span>}
            </li>
          );
        })}
      </ol>
      {action === "again" && <p className="today-done">今天完成了，明天再來</p>}
      {today.note && (
        <p className="today-done today-unavailable" role="status">
          {today.note}
        </p>
      )}
      {action && (
        <Link to="/morning" search={todayLink(action)} className="academy-button-primary today-primary">
          {TODAY_ACTION_LABELS[action]}
        </Link>
      )}
      {action && (
        <Link
          to="/morning"
          search={{ panel: "trade", coach: "1", new: "1" }}
          onClick={() => resetCoachSeen(browserStorage())}
          className="today-coach-link"
        >
          第一次使用？看新手教學
        </Link>
      )}
    </section>
  );
}
