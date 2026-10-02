import { EMPTY_PROFILE, PROFILE_VERSION, type Fill, type Profile, type SessionRecord } from "@/lib/game/types";
import type { RuleVerdict } from "@/lib/game/pass-rules";
import { localReviewBundleSchema } from "@/lib/game/review-schema";
import type { FirstTradePlanSnapshot } from "@/lib/game/trade-plan";

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
  firstTradePlan?: FirstTradePlanSnapshot;
  /** Missing on older records; an empty array explicitly records zero inventory. */
  openPositionsAtEnd?: Array<{ code: string; lots: number; last: number }>;
};

const memoryReviews = new Map<string, ReviewBundle>();
const reviewKey = (id: string) => scopedKey(`day-tycoon-review-v2:${id}`);

export function saveReview(bundle: ReviewBundle): boolean {
  if (typeof window === "undefined") return false;
  const key = reviewKey(bundle.rec.id);
  memoryReviews.set(key, bundle);
  for (const stale of [...memoryReviews.keys()].slice(0, -30)) memoryReviews.delete(stale);
  try {
    if (!localReviewBundleSchema.safeParse(bundle).success) return false;
    const indexKey = scopedKey("day-tycoon-review-index-v2");
    const rawIndex: unknown = JSON.parse(window.localStorage.getItem(indexKey) ?? "[]");
    const previous = Array.isArray(rawIndex) ? rawIndex.filter((id): id is string => typeof id === "string") : [];
    const ids = [bundle.rec.id, ...previous.filter((id) => id !== bundle.rec.id)];
    window.localStorage.setItem(key, JSON.stringify(bundle));
    window.localStorage.setItem(indexKey, JSON.stringify(ids.slice(0, 30)));
    for (const id of ids.slice(30)) window.localStorage.removeItem(reviewKey(id));
    return true;
  } catch { return false; }
}

export function loadReviewState(id: string): { bundle: ReviewBundle; localSaved: boolean } | null {
  const key = reviewKey(id);
  if (typeof window !== "undefined") {
    try {
      const value = window.localStorage.getItem(key);
      const parsed = value ? localReviewBundleSchema.safeParse(JSON.parse(value)) : null;
      if (parsed?.success && parsed.data.rec.id === id) return { bundle: parsed.data as ReviewBundle, localSaved: true };
    } catch { /* A blocked storage read can still use this page's transient copy. */ }
  }
  const bundle = memoryReviews.get(key);
  return bundle ? { bundle, localSaved: false } : null;
}

export function loadReview(id: string): ReviewBundle | null {
  return loadReviewState(id)?.bundle ?? null;
}
