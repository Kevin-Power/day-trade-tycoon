import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Award, ChevronRight } from "@/lib/icons";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { levelProgress, progressText } from "@/lib/discipline/copy";
import type { DisciplineSummary } from "@/lib/discipline/score";

/** Lobby, under today's steps: level, title, the way to the next level and the badge count. */
export function LevelStrip() {
  const { user, guest, isPending } = useCurrentUserState();
  const owner = user?.id ?? guest?.id ?? null;
  const [data, setData] = useState<DisciplineSummary | null>(null);
  useEffect(() => {
    if (isPending || !owner) return;
    let cancelled = false;
    fetch("/api/discipline", { credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: DisciplineSummary | null) => {
        if (!cancelled && body?.level) setData(body);
      })
      .catch(() => {
        /* The strip is extra; the lobby works without it. */
      });
    return () => {
      cancelled = true;
    };
  }, [isPending, owner]);
  if (!data) return null;
  const { level } = data;
  const earned = data.badges.filter((badge) => badge.earned).length;
  const next = progressText(level, data.total);
  return (
    <Link
      to="/progress"
      className="level-strip"
      aria-label={`我的紀律：Lv${level.no} ${level.title}，${next}，徽章 ${earned}／${data.badges.length}`}
    >
      <span className="level-strip-chip" aria-hidden="true">Lv{level.no}</span>
      <span className="level-strip-main" aria-hidden="true">
        <strong>{level.title}</strong>
        <span className="level-strip-bar">
          <span style={{ width: `${levelProgress(level, data.total) * 100}%` }} />
        </span>
        <small>{next}</small>
      </span>
      <span className="level-strip-badges" aria-hidden="true">
        <Award />
        徽章 {earned}／{data.badges.length}
      </span>
      <ChevronRight className="level-strip-go" aria-hidden="true" />
    </Link>
  );
}
