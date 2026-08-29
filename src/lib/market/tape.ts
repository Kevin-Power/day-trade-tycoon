import type { TapeDay } from "@/lib/market/tape-types";
import { TAPE_CACHE_KEY } from "@/lib/market/tape-types";

const days = new Map<string, TapeDay>();

export function registerTapeDays(list: TapeDay[]) {
  for (const d of list) {
    if (!d?.id || !d.index5s?.length) continue;
    days.set(d.id, d);
  }
}

export function getTapeDay(id: string): TapeDay | undefined {
  return days.get(id);
}

export function listTapeDays(): TapeDay[] {
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function loadTapeCache(): TapeDay[] {
  if (typeof window === "undefined") return [];
  try {
    const txt = window.localStorage.getItem(TAPE_CACHE_KEY);
    if (!txt) return [];
    const parsed = JSON.parse(txt) as { days?: TapeDay[] };
    const list = Array.isArray(parsed?.days) ? parsed.days : [];
    registerTapeDays(list);
    return listTapeDays();
  } catch {
    return [];
  }
}

export function saveTapeCache(list: TapeDay[], fetchedAt: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      TAPE_CACHE_KEY,
      JSON.stringify({ fetchedAt, days: list }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function loadTapeFetchedAt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const txt = window.localStorage.getItem(TAPE_CACHE_KEY);
    if (!txt) return null;
    const parsed = JSON.parse(txt) as { fetchedAt?: string };
    return parsed.fetchedAt ?? null;
  } catch {
    return null;
  }
}
