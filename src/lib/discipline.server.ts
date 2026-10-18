import type { Sql } from "./db.ts";
import { readDisciplineInput } from "./discipline/records.server.ts";
import { disciplineSummary, type DisciplineSummary } from "./discipline/score.ts";
import { requirePracticeAccess } from "./morning-session.server.ts";

export { readDisciplineInput };

/** Members with an accepted profile and guests only, like the practice and the daily question. */
export async function loadDiscipline(sql: Sql, userId: string, now: number): Promise<DisciplineSummary> {
  await requirePracticeAccess(sql, userId);
  return disciplineSummary(await readDisciplineInput(sql, userId, now));
}
