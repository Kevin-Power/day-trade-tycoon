export type TeacherStudent = {
  user_id: string;
  display_name: string;
  role: string;
};

export type TeacherSession = {
  id: string;
  user_id: string;
  lesson_id: string;
  passed: boolean;
  ended_at: string | null;
  initial_equity: number;
  final_equity: number;
  max_drawdown_pct: number;
  discipline_violations_json: string;
  feedback_count?: number | null;
  last_feedback_at?: string | null;
};

export const TEACHER_RECENT_LIMIT = 12;

/** Roster timestamps without a zone are already formatted by the server in Asia/Taipei. */
function timestamp(value: string | null): number {
  if (!value) return 0;
  const iso = value.replace(" ", "T");
  const parsed = Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}+08:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortTeacherSessions<T extends TeacherSession>(sessions: readonly T[]): T[] {
  return [...sessions].sort(
    (a, b) => timestamp(b.ended_at) - timestamp(a.ended_at) || b.id.localeCompare(a.id),
  );
}

/** Invalid legacy condition JSON means unknown, never a clean practice record. */
export function teacherPracticeConditions(value: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? [...new Set(parsed.filter((item) => item.trim()))]
      : null;
  } catch {
    return null;
  }
}

export function buildTeacherWorkspace(
  roster: readonly TeacherStudent[],
  allSessions: readonly TeacherSession[],
  lessonIds: readonly string[],
) {
  const students = roster.filter((student) => student.role !== "teacher");
  const studentIds = new Set(students.map((student) => student.user_id));
  const knownLessonIds = new Set(lessonIds);
  const sessions = sortTeacherSessions(allSessions.filter((row) => studentIds.has(row.user_id)));
  const byStudent = students.map((student) => {
    const mine = sessions.filter((row) => row.user_id === student.user_id);
    return {
      ...student,
      sessions: mine,
      practicedLessons: new Set(
        mine.filter((row) => knownLessonIds.has(row.lesson_id)).map((row) => row.lesson_id),
      ).size,
      passedLessons: new Set(
        mine
          .filter((row) => row.passed && knownLessonIds.has(row.lesson_id))
          .map((row) => row.lesson_id),
      ).size,
      latest: mine[0] ?? null,
      withoutFeedback: mine.filter((row) => row.feedback_count === 0).length,
    };
  });
  const lessons = lessonIds.map((id) => {
    const rows = sessions.filter((row) => row.lesson_id === id);
    const conditions = new Map<string, number>();
    let unknownConditions = 0;
    for (const row of rows) {
      const recorded = teacherPracticeConditions(row.discipline_violations_json);
      if (recorded === null) unknownConditions += 1;
      for (const condition of recorded ?? []) {
        conditions.set(condition, (conditions.get(condition) ?? 0) + 1);
      }
    }
    return {
      id,
      practiceCount: rows.length,
      learners: new Set(rows.map((row) => row.user_id)).size,
      passedCount: rows.filter((row) => row.passed).length,
      topCondition:
        [...conditions].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null,
      unknownConditions,
    };
  });
  return {
    students: byStudent,
    sessions,
    recent: sessions.slice(0, TEACHER_RECENT_LIMIT),
    lessons,
    practicedStudents: byStudent.filter((student) => student.sessions.length > 0).length,
    withoutFeedback: sessions.filter((row) => row.feedback_count === 0).length,
    unknownFeedback: sessions.filter((row) => feedbackState(row.feedback_count) === "unknown")
      .length,
  };
}

export type TeacherWorkspace = ReturnType<typeof buildTeacherWorkspace>;

export function feedbackState(count: number | null | undefined): "none" | "recorded" | "unknown" {
  if (count === 0) return "none";
  if (typeof count === "number" && Number.isInteger(count) && count > 0) return "recorded";
  return "unknown";
}
