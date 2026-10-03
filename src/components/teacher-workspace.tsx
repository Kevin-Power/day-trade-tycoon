import { Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  Download,
  GraduationCap,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { DisplayControls } from "@/components/display-controls";
import { LESSONS } from "@/lib/game/curriculum";
import { courseStepFor } from "@/lib/game/learning-path";
import { csvCell } from "@/lib/classroom-policy";
import { cn, formatPct } from "@/lib/utils";
import {
  buildTeacherWorkspace,
  feedbackState,
  TEACHER_RECENT_LIMIT,
  type TeacherSession,
  type TeacherStudent,
  type TeacherWorkspace,
} from "@/lib/teacher-workspace";

const LESSON_IDS = LESSONS.map((lesson) => lesson.id);
const inputClass =
  "mt-2 min-h-12 w-full min-w-0 rounded-xl border border-border-strong bg-surface px-3 py-2 text-base text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

export function TeacherWorkspaceView({
  data,
  onRefresh,
}: {
  data: { classCode: string; students: TeacherStudent[]; sessions: TeacherSession[] };
  onRefresh: () => void;
}) {
  const model = useMemo(
    () => buildTeacherWorkspace(data.students, data.sessions, LESSON_IDS),
    [data],
  );
  const [query, setQuery] = useState("");
  const [lesson, setLesson] = useState("");
  const [feedback, setFeedback] = useState("all");
  const [studentState, setStudentState] = useState("all");
  const names = new Map(model.students.map((student) => [student.user_id, studentName(student)]));
  const needle = query.trim().toLocaleLowerCase();
  const nameMatches = (id: string) =>
    !needle || (names.get(id) ?? "").toLocaleLowerCase().includes(needle);
  const filteredSessions = model.sessions.filter(
    (session) =>
      nameMatches(session.user_id) &&
      (!lesson || session.lesson_id === lesson) &&
      (feedback === "all" || feedbackState(session.feedback_count) === feedback),
  );
  const filteredStudents = model.students.filter((student) => {
    const mine = student.sessions.filter((session) => !lesson || session.lesson_id === lesson);
    return (
      nameMatches(student.user_id) &&
      (studentState === "none"
        ? mine.length === 0
        : studentState === "practiced" || lesson
          ? mine.length > 0
          : true)
    );
  });
  const filterKey = `${query}:${lesson}:${feedback}`;

  return (
    <main className="academy-page">
      <header className="academy-header">
        <div className="academy-container flex flex-wrap items-center justify-between gap-3 py-4">
          <span className="flex items-center gap-2 text-base font-medium">
            <GraduationCap aria-hidden="true" className="size-5 shrink-0 text-brand" />
            當沖大富翁・講師工作區
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <DisplayControls compact />
            <Link to="/" className="academy-nav-link min-h-12">
              <ArrowLeft aria-hidden="true" className="size-4" />
              教室大廳
            </Link>
          </div>
        </div>
      </header>
      <div className="academy-container py-8 sm:py-11">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="academy-eyebrow">TEACHER WORKSPACE</p>
            <h1 className="academy-title mt-2">陪學員完成下一步</h1>
            <p className="academy-description mt-3">
              找到一份練習，指出一個做得清楚的動作，再留下下一次的練習重點。
            </p>
            <p className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-muted">
              <ShieldCheck aria-hidden="true" className="size-4 text-brand" />
              本班代碼 <strong className="break-all font-mono text-fg">{data.classCode}</strong>
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="academy-button-secondary min-h-12" onClick={onRefresh}>
              <RefreshCw aria-hidden="true" className="size-4" />
              更新班級紀錄
            </button>
            <button
              type="button"
              className="academy-button-secondary min-h-12"
              onClick={() => exportCsv(model)}
            >
              <Download aria-hidden="true" className="size-4" />
              匯出所有練習 CSV
            </button>
          </div>
        </div>

        <section
          className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          aria-label="班級學習概況"
        >
          <OverviewCard
            title="尚無講師回饋"
            value={model.withoutFeedback}
            unit="份"
            detail="可先開啟復盤，留下一個可執行的建議。"
            icon="feedback"
          />
          <OverviewCard
            title="已保存練習"
            value={model.sessions.length}
            unit="份"
            detail="包含同一位學員的重練紀錄。"
            icon="lesson"
          />
          <OverviewCard
            title="已有練習紀錄"
            value={model.practicedStudents}
            unit="人"
            detail={`本班 ${model.students.length} 位學員；只計算已同步到教室的紀錄。`}
            icon="people"
          />
          <OverviewCard
            title="尚無保存紀錄"
            value={model.students.length - model.practicedStudents}
            unit="人"
            detail="可先協助進入第一課，或確認是否完成儲存。"
            icon="people"
          />
        </section>
        <p className="mt-3 text-sm leading-6 text-muted">
          回饋筆數表示講師已留下文字，不代表學員已讀或已完成練習。
          {model.unknownFeedback > 0
            ? ` 另有 ${model.unknownFeedback} 份回饋狀態未取得，未計入「尚無講師回饋」。`
            : ""}
        </p>

        <section className="academy-card mt-8 p-5 sm:p-6" aria-labelledby="teacher-find-title">
          <h2 id="teacher-find-title" className="flex items-center gap-2 text-lg font-semibold">
            <Search aria-hidden="true" className="size-5 text-brand" />
            找學員、找課程
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="min-w-0 text-base font-medium" htmlFor="teacher-student-search">
              學員姓名
              <input
                id="teacher-student-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="輸入學員姓名"
                className={inputClass}
              />
            </label>
            <label className="min-w-0 text-base font-medium" htmlFor="teacher-lesson-filter">
              課程
              <select
                id="teacher-lesson-filter"
                value={lesson}
                onChange={(event) => setLesson(event.target.value)}
                className={inputClass}
              >
                <option value="">全部課程</option>
                {LESSONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.no} · {courseStepFor(item.id)?.title ?? item.skill}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(query || lesson) && (
            <button
              type="button"
              className="academy-button-secondary mt-4 min-h-12"
              onClick={() => {
                setQuery("");
                setLesson("");
              }}
            >
              清除姓名與課程篩選
            </button>
          )}
        </section>

        <section className="mt-8" aria-labelledby="teacher-recent-title">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="teacher-recent-title" className="text-xl font-semibold">
                從一份復盤開始回饋
              </h2>
              <p className="mt-2 max-w-2xl text-base leading-7 text-muted">
                依練習結束時間由新到舊排列。可先找尚無回饋的紀錄，開啟後核對首筆計畫、成交與庫存。
              </p>
            </div>
            <label
              className="w-full min-w-0 text-base font-medium sm:w-auto"
              htmlFor="teacher-feedback-filter"
            >
              回饋紀錄
              <select
                id="teacher-feedback-filter"
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                className={inputClass}
              >
                <option value="all">全部復盤</option>
                <option value="none">尚無講師回饋</option>
                <option value="recorded">已有講師回饋</option>
                <option value="unknown">回饋狀態未取得</option>
              </select>
            </label>
          </div>
          <ReviewQueue key={filterKey} sessions={filteredSessions} names={names} />
        </section>

        <section className="mt-9" aria-labelledby="teacher-students-title">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="teacher-students-title" className="text-xl font-semibold">
                每位學員的練習起點
              </h2>
              <p className="mt-2 text-base leading-7 text-muted">
                展開姓名查看練過哪些課，帶班時先問清楚下一步要練什麼。
              </p>
            </div>
            <label
              className="w-full min-w-0 text-base font-medium sm:w-auto"
              htmlFor="teacher-student-state"
            >
              保存狀況{lesson ? "（所選課程）" : ""}
              <select
                id="teacher-student-state"
                value={studentState}
                onChange={(event) => setStudentState(event.target.value)}
                className={inputClass}
              >
                <option value="all">全部學員</option>
                <option value="none">尚無保存紀錄</option>
                <option value="practiced">已有練習紀錄</option>
              </select>
            </label>
          </div>
          <StudentList
            key={`${query}:${lesson}:${studentState}`}
            students={filteredStudents}
            lesson={lesson}
            emptyClass={model.students.length === 0}
          />
        </section>

        <section className="mt-9" aria-labelledby="teacher-lessons-title">
          <h2 id="teacher-lessons-title" className="text-xl font-semibold">
            準備下一堂帶練
          </h2>
          <p className="mt-2 text-base leading-7 text-muted">
            以下顯示整個班級的各課紀錄。重練計入練習份數，參與人數不重複計算。
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {model.lessons.map((item) => {
              const course = courseStepFor(item.id);
              const original = LESSONS.find((entry) => entry.id === item.id);
              return (
                <article key={item.id} className="academy-card min-w-0 p-5">
                  <p className="text-sm font-medium text-brand">
                    {original?.no} · {course?.stage}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold">{course?.title ?? original?.skill}</h3>
                  <p className="mt-3 text-base leading-7 text-muted">{course?.focus}</p>
                  <p className="mt-4 text-base">
                    <strong className="font-mono text-2xl tabular">{item.learners}</strong> 人有紀錄{" "}
                    <span className="ml-2 text-muted">共 {item.practiceCount} 份練習</span>
                  </p>
                  <div className="mt-4 border-t border-border pt-4 text-base leading-7">
                    <p className="font-medium">可帶班討論</p>
                    <p className="mt-1 break-words text-muted">
                      {item.topCondition
                        ? `${item.topCondition[0]}（${item.topCondition[1]} 份紀錄出現）`
                        : course?.reflection}
                    </p>
                  </div>
                  <details className="mt-3 rounded-xl bg-bg/60 p-3 text-sm leading-6">
                    <summary className="min-h-12 cursor-pointer py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                      教材條件統計
                    </summary>
                    <p className="mt-2 text-muted">
                      {item.practiceCount
                        ? `${item.passedCount} / ${item.practiceCount} 份紀錄完成教材條件。包含重練，非學員通過率。`
                        : "尚無紀錄。"}
                    </p>
                    {item.unknownConditions > 0 && (
                      <p className="mt-2 text-muted">
                        {item.unknownConditions} 份條件明細無法辨識，未當作全部完成。
                      </p>
                    )}
                  </details>
                </article>
              );
            })}
          </div>
        </section>
        <p className="mt-6 text-sm leading-7 text-muted">
          這裡呈現已同步到教室的模擬練習。教學重點請搭配學員說明與講師觀察；單次損益、練習次數與教材條件皆不等同實際交易能力。
        </p>
      </div>
    </main>
  );
}

function OverviewCard({
  title,
  value,
  unit,
  detail,
  icon,
}: {
  title: string;
  value: number;
  unit: string;
  detail: string;
  icon: "feedback" | "lesson" | "people";
}) {
  const Icon = icon === "feedback" ? MessageSquare : icon === "lesson" ? BookOpen : Users;
  return (
    <article className="academy-card p-5">
      <p className="flex items-center gap-2 text-base font-medium">
        <Icon aria-hidden="true" className="size-5 shrink-0 text-brand" />
        {title}
      </p>
      <p className="mt-3">
        <strong className="font-mono text-3xl tabular">{value}</strong>
        <span className="ml-2 text-base text-muted">{unit}</span>
      </p>
      <p className="mt-2 text-sm leading-6 text-muted">{detail}</p>
    </article>
  );
}

function ReviewQueue({
  sessions,
  names,
}: {
  sessions: TeacherSession[];
  names: Map<string, string>;
}) {
  const [page, setPage] = useState(0);
  const pageStart = useRef<HTMLParagraphElement>(null);
  const lastPage = Math.max(0, Math.ceil(sessions.length / TEACHER_RECENT_LIMIT) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = sessions.slice(
    currentPage * TEACHER_RECENT_LIMIT,
    (currentPage + 1) * TEACHER_RECENT_LIMIT,
  );
  return (
    <div>
      <p
        ref={pageStart}
        tabIndex={-1}
        className="mb-3 scroll-mt-6 text-sm text-muted outline-none"
        role="status"
      >
        符合條件 {sessions.length} 份；每頁最多 {TEACHER_RECENT_LIMIT} 份。
      </p>
      {visible.length ? (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((session) => (
            <li className="academy-card flex min-w-0 flex-col p-5" key={session.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="break-words text-lg font-semibold">{names.get(session.user_id)}</p>
                <FeedbackBadge session={session} />
              </div>
              <p className="mt-2 text-base font-medium">
                {courseStepFor(session.lesson_id)?.title ?? session.lesson_id}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted">
                練習結束：{displayTime(session.ended_at)}
              </p>
              {feedbackState(session.feedback_count) === "recorded" && (
                <p className="mt-1 text-sm leading-6 text-muted">
                  最近回饋：{displayTime(session.last_feedback_at)}
                </p>
              )}
              <p className="mt-3 text-sm leading-6 text-muted">
                {session.passed
                  ? "本次已完成教材條件，可對照操作理由。"
                  : "本次仍有教材條件可練，可選一個重點討論。"}
              </p>
              <Link
                to="/teacher-review/$id"
                params={{ id: session.id }}
                className="academy-button-secondary mt-4 min-h-12 w-full text-base"
              >
                {feedbackState(session.feedback_count) === "none"
                  ? "開啟復盤並回饋"
                  : "查看復盤與回饋"}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="目前沒有符合條件的復盤"
          detail="可調整姓名、課程或回饋篩選。學員儲存並同步練習後，紀錄會出現在這裡。"
        />
      )}
      <Pagination
        current={currentPage}
        last={lastPage}
        onChange={(next) => {
          setPage(next);
          requestAnimationFrame(() => pageStart.current?.focus());
        }}
        label="班級復盤分頁"
      />
    </div>
  );
}

function StudentList({
  students,
  lesson,
  emptyClass,
}: {
  students: TeacherWorkspace["students"];
  lesson: string;
  emptyClass: boolean;
}) {
  const [page, setPage] = useState(0);
  const pageStart = useRef<HTMLParagraphElement>(null);
  const lastPage = Math.max(0, Math.ceil(students.length / 12) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = students.slice(currentPage * 12, (currentPage + 1) * 12);
  return (
    <div>
      <p
        ref={pageStart}
        tabIndex={-1}
        role="status"
        className="mb-3 scroll-mt-6 text-sm text-muted outline-none"
      >
        符合條件 {students.length} 位學員。
      </p>
      <div className="space-y-3">
        {visible.map((student) => (
          <details key={student.user_id} className="academy-card group min-w-0 p-4 sm:p-5">
            <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center justify-between gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <div className="min-w-0">
                <p className="break-words text-lg font-semibold">{studentName(student)}</p>
                <p className="mt-1 text-sm leading-6 text-muted">
                  練過 {student.practicedLessons} / {LESSON_IDS.length} 課 · 保存{" "}
                  {student.sessions.length} 份 · 尚無講師回饋 {student.withoutFeedback} 份
                </p>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted">
                <span>
                  最近練習
                  <br />
                  {student.latest ? displayTime(student.latest.ended_at) : "尚無保存紀錄"}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-5 shrink-0 transition-transform group-open:rotate-180"
                />
              </div>
            </summary>
            <div className="mt-5 border-t border-border pt-5">
              <p className="mb-3 text-sm text-muted">
                以下為這位學員的全部課程；教材條件以已保存紀錄為準。
              </p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {LESSONS.map((item) => {
                  const rows = student.sessions.filter((session) => session.lesson_id === item.id);
                  const latest = rows[0];
                  return (
                    <div
                      key={item.id}
                      className="min-w-0 rounded-xl border border-border bg-bg/40 p-4"
                    >
                      <p className="text-sm text-brand">{item.no}</p>
                      <p className="mt-1 font-medium">
                        {courseStepFor(item.id)?.title ?? item.skill}
                      </p>
                      <p className="mt-2 text-sm text-muted">
                        {rows.length ? `保存 ${rows.length} 份練習` : "尚無保存紀錄"}
                      </p>
                      {latest && (
                        <>
                          <p className="mt-1 text-sm text-muted">
                            最近一份：{latest.passed ? "已完成教材條件" : "仍有條件可練"}
                          </p>
                          <Link
                            to="/teacher-review/$id"
                            params={{ id: latest.id }}
                            className="academy-button-secondary mt-3 min-h-12 w-full"
                          >
                            查看最近復盤
                          </Link>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <details className="mt-4 rounded-xl bg-bg/50 p-4">
                <summary className="min-h-12 cursor-pointer py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  查看原始教材與模擬數字
                </summary>
                <p className="mt-2 text-sm leading-6 text-muted">
                  曾完成教材條件 {student.passedLessons} / {LESSON_IDS.length} 課。以下顯示
                  {lesson ? "所選課程" : "所有課程"}最近 6 份；完整逐次紀錄可用上方姓名篩選或匯出
                  CSV 查看。
                </p>
                <ul className="mt-3 space-y-3">
                  {student.sessions
                    .filter((session) => !lesson || session.lesson_id === lesson)
                    .slice(0, 6)
                    .map((session) => (
                      <li
                        key={session.id}
                        className="border-t border-border pt-3 text-sm leading-6"
                      >
                        <p>
                          {courseStepFor(session.lesson_id)?.title ?? session.lesson_id} ·{" "}
                          {displayTime(session.ended_at)}
                        </p>
                        <p className="text-muted">
                          模擬報酬{" "}
                          {session.initial_equity
                            ? formatPct(
                                ((session.final_equity - session.initial_equity) /
                                  session.initial_equity) *
                                  100,
                              )
                            : "未記錄"}{" "}
                          · 回撤 {(session.max_drawdown_pct * 100).toFixed(1)}%
                        </p>
                        <Link
                          to="/teacher-review/$id"
                          params={{ id: session.id }}
                          className="mt-1 inline-flex min-h-12 items-center font-medium text-brand underline underline-offset-4"
                        >
                          開啟這份復盤
                        </Link>
                      </li>
                    ))}
                </ul>
              </details>
            </div>
          </details>
        ))}
      </div>
      {!students.length && (
        <EmptyState
          title={emptyClass ? "等待第一位學員加入" : "沒有符合篩選的學員"}
          detail={
            emptyClass
              ? "請學員完成註冊並填寫本班代碼。第一次帶班可先協助熟悉觀察、核對與儲存復盤。"
              : "可調整姓名、課程或保存狀況；尚無保存紀錄不代表學員沒有在本機練習。"
          }
        />
      )}
      <Pagination
        current={currentPage}
        last={lastPage}
        onChange={(next) => {
          setPage(next);
          requestAnimationFrame(() => pageStart.current?.focus());
        }}
        label="學員名單分頁"
      />
    </div>
  );
}

function FeedbackBadge({ session }: { session: TeacherSession }) {
  const state = feedbackState(session.feedback_count);
  return (
    <span
      className={cn(
        "rounded-lg border px-2 py-1 text-sm leading-6",
        state === "none"
          ? "border-brand/30 bg-brand/10 text-brand"
          : "border-border bg-bg text-muted",
      )}
    >
      {state === "none"
        ? "尚無講師回饋"
        : state === "recorded"
          ? `${session.feedback_count} 則回饋`
          : "回饋狀態未取得"}
    </span>
  );
}

function Pagination({
  current,
  last,
  onChange,
  label,
}: {
  current: number;
  last: number;
  onChange: (page: number) => void;
  label: string;
}) {
  if (!last) return null;
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="academy-button-secondary min-h-12 disabled:opacity-40"
        disabled={current === 0}
        onClick={() => onChange(current - 1)}
      >
        上一頁
      </button>
      <p role="status" className="text-base">
        第 {current + 1} / {last + 1} 頁
      </p>
      <button
        type="button"
        className="academy-button-secondary min-h-12 disabled:opacity-40"
        disabled={current === last}
        onClick={() => onChange(current + 1)}
      >
        下一頁
      </button>
    </nav>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="academy-card px-5 py-9 text-center">
      <Users aria-hidden="true" className="mx-auto mb-3 size-7 text-brand" />
      <p className="text-lg font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-xl text-base leading-7 text-muted">{detail}</p>
    </div>
  );
}

function studentName(student: Pick<TeacherStudent, "display_name" | "user_id">) {
  return student.display_name || student.user_id.slice(0, 8);
}
function displayTime(value: string | null | undefined) {
  return value ? value.replace("T", " ").slice(0, 16) : "時間未記錄";
}

function exportCsv(model: TeacherWorkspace) {
  const names = new Map(model.students.map((student) => [student.user_id, studentName(student)]));
  const lines = [
    "name,session_id,lesson,ended_at,passed,return,drawdown,feedback_count,last_feedback_at",
  ];
  for (const session of model.sessions)
    lines.push(
      [
        names.get(session.user_id) ?? "",
        session.id,
        session.lesson_id,
        session.ended_at ?? "",
        session.passed ? 1 : 0,
        session.initial_equity
          ? (session.final_equity - session.initial_equity) / session.initial_equity
          : "",
        session.max_drawdown_pct,
        feedbackState(session.feedback_count) === "unknown" ? "" : (session.feedback_count ?? ""),
        session.last_feedback_at ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "classroom-sessions.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
