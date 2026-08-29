import { EMPTY_PROFILE, PROFILE_VERSION, type Profile, type SessionRecord } from "@/lib/game/types";

const KEY = "day-tycoon-v1";
const TEACH_KEY = "day-tycoon-teach";

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
    const blob = JSON.stringify(profile);
    window.localStorage.setItem(KEY, blob);
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
    /* quota / private mode */
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
