/** Fail clearly if an online-only write ever escapes the offline UI guard. */
export async function saveClassroomSession() { throw new Error("離線紀錄只保存在本機瀏覽器，尚未傳送到教室主機。"); }
export async function upsertMyProfile() { throw new Error("離線教室沒有班級帳號服務。"); }
export async function loadMyProfile() { return null; }
export async function loadMyCareer() { return { sessions: [], careerPnl: 0, count: 0, wins: 0 }; }
export async function loadLeaderboard() { return []; }
export async function loadSessionDetail() { return null; }
export async function loadTeacherRoster() { return { ok: false as const, reason: "講師後台需要使用線上教室。" }; }
