import dataset from "../../server/data/morning-2026-10-06.json" with { type: "json" };
import octoberFifth from "../../server/data/morning-2026-10-05.json" with { type: "json" };
import { summarizeMorningLesson, type MorningCatalog } from "./morning.ts";
import type { Bar } from "./game/types";
import { MorningError, type MorningSource } from "./morning-engine.ts";

// Import only from server handlers. Never include this module in a page loader,
// shared store, public directory or offline classroom bundle.
export const morningCatalog: MorningCatalog = dataset.catalog;
export const morningBars: Record<string, Bar[]> = dataset.bars;

// Explicit, reviewed sources only. Missing/unapproved dates never fall back to
// another lesson, a file-system lookup, or generated prices.
export const morningSources: readonly MorningSource[] = [
  { catalog: octoberFifth.catalog, bars: octoberFifth.bars },
  { catalog: morningCatalog, bars: morningBars },
];
export const morningLessons = morningSources.map(source => summarizeMorningLesson(source.catalog));

export function getMorningSource(lessonId?: string): MorningSource {
  const source = morningSources.find(source => source.catalog.lessonId === (lessonId ?? morningCatalog.lessonId));
  if (!source) throw new MorningError(400, "請選擇已提供真實行情的練習日期");
  return source;
}

/** The only permitted query is one exact approved lesson identifier. */
export function selectMorningSource(params: URLSearchParams): MorningSource {
  const entries = [...params.entries()];
  if (!entries.length) return getMorningSource();
  if (entries.length !== 1 || entries[0][0] !== "lesson")
    throw new MorningError(400, "請由課程頁面選擇練習日期");
  return getMorningSource(entries[0][1]);
}
