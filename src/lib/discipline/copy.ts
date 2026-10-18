import { LEVELS, type Celebration, type LevelView } from "./score.ts";

export function progressText(level: LevelView, total: number): string {
  if (!level.next) return "已是最高等級";
  return `再 ${level.next.min - total} 分升到 Lv${level.next.no} ${level.next.title}`;
}

/** How far through the current level, 0 to 1; the top level is always full. */
export function levelProgress(level: LevelView, total: number): number {
  if (!level.next) return 1;
  return Math.min(1, Math.max(0, (total - level.min) / (level.next.min - level.min)));
}

export function cheerFor(levelNo: number): string {
  return LEVELS.find((level) => level.no === levelNo)?.cheer ?? "";
}

export function celebrationHeadline(celebration: Celebration): string {
  return celebration.alreadyCounted ? "今天的練習分已經算過了" : `這次拿到 +${celebration.points} 分`;
}

export function celebrationSpeech(celebration: Celebration): string {
  if (celebration.alreadyCounted) return "今天的練習分已經算過了。";
  const levelUp = celebration.after.no > celebration.before.no;
  return `拿到 ${celebration.points} 分。${levelUp ? `升級了，第 ${celebration.after.no} 級，${celebration.after.title}。` : ""}`;
}
