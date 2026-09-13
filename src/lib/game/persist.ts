import { EMPTY_PROFILE, PROFILE_VERSION, type Fill, type Profile, type SessionRecord } from "@/lib/game/types";
import type { RuleVerdict } from "@/lib/game/pass-rules";

const KEY = "day-tycoon-v1";
const TEACH_KEY = "day-tycoon-teach";
const TEACH_LESSON_PREFIX = "day-tycoon-teach-lesson:";
const REVIEW_KEY = "day-tycoon-review-v1";

function migrate(raw: Profile): Profile {
  const merged: Profile = { ...EMPTY_PROFILE, ...raw, version: PROFILE_VERSION };
  if (!Array.isArray(merged.history)) merged.history = [];
  merged.history = merged.history.slice(0, 30);
  return merged;
}

export function loadProfile(): Profile {
  if (typeof window === "undefined") return { ...EMPTY_PROFILE };
  try {
    const txt = window.localStorage.getItem(KEY);
    if (!txt) return { ...EMPTY_PROFILE };
    const parsed = JSON.parse(txt) as Profile;
    return migrate(parsed);
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

export function saveProfile(profile: Profile) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* quota / private mode */
  }
}

export function loadTeachMode(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(TEACH_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveTeachMode(on: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TEACH_KEY, on ? "1" : "0");
  } catch {
    /* quota */
  }
}

export function isFirstVisitLesson(id: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(TEACH_LESSON_PREFIX + id) !== "1";
  } catch {
    return true;
  }
}

export function markLessonVisited(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TEACH_LESSON_PREFIX + id, "1");
  } catch {
    /* quota */
  }
}

export function applySession(profile: Profile, rec: SessionRecord): Profile {
  const next: Profile = {
    ...profile,
    careerPnl: profile.careerPnl + rec.pnl,
    sessions: profile.sessions + 1,
    wins: profile.wins + (rec.pnl > 0 ? 1 : 0),
    bestPnl: Math.max(profile.bestPnl, rec.pnl),
    bestPct: Math.max(profile.bestPct, rec.pnlPct),
    history: [rec, ...profile.history].slice(0, 30),
  };
  saveProfile(next);
  return next;
}

export type ReviewBundle = {
  rec: SessionRecord;
  verdicts: RuleVerdict[];
  fills: Fill[];
  code: string;
  capital: number;
  equity: number;
  sessionLabel: string;
};

export function saveReview(bundle: ReviewBundle) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REVIEW_KEY, JSON.stringify(bundle));
    window.localStorage.setItem(`${REVIEW_KEY}:${bundle.rec.id}`, JSON.stringify(bundle));
  } catch {
    /* quota */
  }
}

export function loadReview(id?: string): ReviewBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const txt = window.localStorage.getItem(id ? `${REVIEW_KEY}:${id}` : REVIEW_KEY);
    if (!txt) return null;
    return JSON.parse(txt) as ReviewBundle;
  } catch {
    return null;
  }
}

export type ServerCareer = {
  careerPnl: number;
  wins: number;
  count: number;
  sessions: Array<{
    id: string;
    lesson_id: string;
    final_equity: number;
    initial_equity: number;
    max_drawdown_pct: number;
    trades_count: number;
    passed: boolean;
    ended_at: string | null;
  }>;
};

export function mergeServerCareer(local: Profile, server: ServerCareer): Profile {
  const history: SessionRecord[] = server.sessions.map((s) => ({
    id: s.id,
    scenarioId: s.lesson_id,
    scenarioName: s.lesson_id,
    endedAt: s.ended_at ? Date.parse(s.ended_at) : Date.now(),
    pnl: s.final_equity - s.initial_equity,
    pnlPct: s.initial_equity ? (s.final_equity - s.initial_equity) / s.initial_equity : 0,
    trades: s.trades_count,
    wins: 0,
    fees: 0,
    maxDrawdown: s.max_drawdown_pct,
    grade: s.passed ? "PASS" : "FAIL",
    title: s.lesson_id,
    passed: s.passed,
  }));
  const next: Profile = {
    ...local,
    careerPnl: server.careerPnl,
    sessions: Math.max(local.sessions, server.count),
    wins: Math.max(local.wins, server.wins),
    history: history.length ? history : local.history,
  };
  saveProfile(next);
  return next;
}
