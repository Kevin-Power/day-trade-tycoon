import { EMPTY_PROFILE, PROFILE_VERSION, type Fill, type Profile, type SessionRecord } from "@/lib/game/types";
import type { RuleVerdict } from "@/lib/game/pass-rules";
import { reviewBundleSchema } from "@/lib/game/review-schema";

export { loadFlashOrder, saveFlashOrder } from "@/lib/game/flash-order";

const KEY = "day-tycoon-v1";
const TEACH_KEY = "day-tycoon-teach";
let profileIdentity: string | null = null;
const scopedKey = (key: string) => profileIdentity ? `${key}:user:${profileIdentity}` : key;
export function setProfileIdentity(userId: string | null) { profileIdentity = userId; }
export function getProfileIdentity() { return profileIdentity; }

function migrate(raw: Profile): Profile {
  const merged: Profile = { ...EMPTY_PROFILE, ...raw, version: PROFILE_VERSION };
  if (!Array.isArray(merged.history)) merged.history = [];
  merged.history = merged.history.slice(0, 30);
  return merged;
}

export function loadProfile(): Profile {
  if (typeof window === "undefined") return { ...EMPTY_PROFILE };
  try {
    const txt = window.localStorage.getItem(scopedKey(KEY));
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
    window.localStorage.setItem(scopedKey(KEY), blob);
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
    const indexKey = scopedKey("day-tycoon-review-index-v2");
    const previous = JSON.parse(window.localStorage.getItem(indexKey) ?? "[]") as string[];
    const ids = [bundle.rec.id, ...previous.filter((id) => id !== bundle.rec.id)];
    window.localStorage.setItem(scopedKey(`day-tycoon-review-v2:${bundle.rec.id}`), JSON.stringify(bundle));
    for (const id of ids.slice(30)) window.localStorage.removeItem(scopedKey(`day-tycoon-review-v2:${id}`));
    window.localStorage.setItem(indexKey, JSON.stringify(ids.slice(0, 30)));
  } catch { /* Private mode/quota: current in-memory result remains available. */ }
}

export function loadReview(id: string): ReviewBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(scopedKey(`day-tycoon-review-v2:${id}`));
    if (!value) return null;
    const parsed = reviewBundleSchema.safeParse(JSON.parse(value));
    return parsed.success && parsed.data.rec.id === id ? parsed.data as ReviewBundle : null;
  } catch { return null; }
}
