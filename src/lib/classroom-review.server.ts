import { classroomRole, type ClassroomIdentity } from "./classroom-policy.ts";
import { reviewBundleSchema } from "./game/review-schema.ts";
import type { Sql } from "./db.ts";
import type { ReviewBundle } from "./game/persist.ts";

/** user must come from the server-verified session, never the request payload. */
export async function readTeacherClassroomReview(
  sql: Sql,
  id: string,
  user: ClassroomIdentity | null,
  policy: { teacherIds?: string; teacherEmails?: string },
): Promise<{ bundle: ReviewBundle; studentName: string } | null> {
  if (!user?.emailVerified || classroomRole(user, policy) !== "teacher") {
    throw new Error("目前帳號無權查看班級復盤");
  }
  const rows = await sql<{ review_json: string; display_name: string }>`
    SELECT s.review_json, student.display_name
    FROM classroom_sessions s
    JOIN classroom_profiles student ON student.user_id = s.user_id
    JOIN classroom_profiles teacher ON teacher.user_id = ${user.id}
    WHERE s.id = ${id}
      AND NULLIF(BTRIM(teacher.class_code), '') IS NOT NULL
      AND student.class_code = teacher.class_code
      AND teacher.tos_accepted_at IS NOT NULL
      AND student.tos_accepted_at IS NOT NULL`;
  if (!rows[0]) return null;
  try {
    const parsed = reviewBundleSchema.safeParse(JSON.parse(rows[0].review_json));
    if (!parsed.success || parsed.data.rec.id !== id) return null;
    return { bundle: parsed.data as ReviewBundle, studentName: rows[0].display_name };
  } catch {
    return null;
  }
}
