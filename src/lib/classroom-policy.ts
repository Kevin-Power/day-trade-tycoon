export type ClassroomIdentity = { id: string; email: string | null; emailVerified?: boolean };

export function classroomRole(
  user: ClassroomIdentity,
  config: { teacherIds?: string; teacherEmails?: string },
): "teacher" | "student" {
  const ids = (config.teacherIds ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const emails = (config.teacherEmails ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return ids.includes(user.id) ||
    (user.emailVerified === true && !!user.email && emails.includes(user.email.toLowerCase()))
    ? "teacher"
    : "student";
}

export function assertSessionOwner(ownerId: string, callerId: string): void {
  if (ownerId !== callerId) throw new Error("無權修改其他學員的練習紀錄");
}

export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
