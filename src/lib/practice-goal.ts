export const PRACTICE_FOCUSES = [
  { id: "check-order", label: "送出前，先看清楚商品與張數" },
  { id: "check-fill", label: "送出後，先確認成交與庫存" },
  { id: "plan-exit", label: "操作前，先說清楚自己的出場條件" },
] as const;

export type PracticeFocus = (typeof PRACTICE_FOCUSES)[number]["id"];
export type PracticeGoal = {
  version: 1;
  focus: PracticeFocus;
  note: string;
  scenarioId: string;
  scenarioName: string;
  updatedAt: string;
};

export function practiceGoalKey(userId: string | null): string {
  return `dtt:practice-goal:v1:${userId ? `user:${encodeURIComponent(userId)}` : "guest"}`;
}

export function parsePracticeGoal(raw: string | null): PracticeGoal | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const goal = value as Record<string, unknown>;
    if (goal.version !== 1 || !PRACTICE_FOCUSES.some(item => item.id === goal.focus)
      || typeof goal.note !== "string" || goal.note.length > 140
      || typeof goal.scenarioId !== "string" || goal.scenarioId.length > 100
      || typeof goal.scenarioName !== "string" || goal.scenarioName.length > 100
      || typeof goal.updatedAt !== "string" || !Number.isFinite(Date.parse(goal.updatedAt))) return null;
    return { version: 1, focus: goal.focus as PracticeFocus, note: goal.note,
      scenarioId: goal.scenarioId, scenarioName: goal.scenarioName, updatedAt: goal.updatedAt };
  } catch { return null; }
}

export function practiceGoalForScenario(goal: PracticeGoal | null, scenarioId: string): PracticeGoal | null {
  return goal?.scenarioId === scenarioId ? goal : null;
}

export function savePracticeGoal(
  storage: Pick<Storage, "getItem" | "setItem">,
  storageKey: string,
  goal: PracticeGoal,
): boolean {
  try {
    const validated = parsePracticeGoal(JSON.stringify(goal));
    if (!validated) return false;
    const serialized = JSON.stringify(validated);
    storage.setItem(storageKey, serialized);
    return storage.getItem(storageKey) === serialized;
  } catch { return false; }
}
