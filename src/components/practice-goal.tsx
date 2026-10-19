import { useEffect, useId, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { Target } from "@/lib/icons";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  PRACTICE_FOCUSES,
  parsePracticeGoal,
  practiceGoalForScenario,
  practiceGoalKey,
  savePracticeGoal,
  type PracticeFocus,
  type PracticeGoal,
} from "@/lib/practice-goal";
import { cn } from "@/lib/utils";

function useSavedGoal() {
  const { user, isPending } = useCurrentUserState();
  const storageKey = practiceGoalKey(user?.id ?? null);
  const [saved, setSaved] = useState<{ key: string; goal: PracticeGoal | null } | null>(null);
  useEffect(() => {
    if (isPending) return;
    try {
      setSaved({ key: storageKey, goal: parsePracticeGoal(localStorage.getItem(storageKey)) });
    } catch {
      setSaved({ key: storageKey, goal: null });
    }
  }, [storageKey, isPending]);
  return {
    storageKey,
    ready: !isPending && saved?.key === storageKey,
    goal: saved?.key === storageKey ? saved.goal : null,
    remember: (goal: PracticeGoal) => setSaved({ key: storageKey, goal }),
  };
}

export function PracticeGoalReminder() {
  const { ready, goal } = useSavedGoal();
  if (!ready || !goal) return null;
  return (
    <aside
      className="rounded-2xl border border-brand/20 bg-brand/5 p-5"
      aria-label="上次保存的練習重點"
    >
      <p className="flex items-center gap-2 text-base font-semibold">
        <Target className="text-brand" aria-hidden />
        下次練習，先做好這一件事
      </p>
      <p className="mt-3 text-lg font-semibold text-brand">
        {PRACTICE_FOCUSES.find((item) => item.id === goal.focus)?.label}
      </p>
      {goal.note ? <p className="mt-2 break-words text-base leading-7">{goal.note}</p> : null}
      <p className="mt-3 text-sm leading-6 text-muted">
        來自「{goal.scenarioName}」復盤。這個重點只保存在這台裝置，完成下一次復盤時可更新。
      </p>
    </aside>
  );
}

type EditorProps = { scenarioId: string; scenarioName: string; onPractice?: () => void };
export function PracticeGoalEditor(props: EditorProps) {
  const { user } = useCurrentUserState();
  return <GoalEditor key={`${user?.id ?? "guest"}:${props.scenarioId}`} {...props} />;
}

function GoalEditor({ scenarioId, scenarioName, onPractice }: EditorProps) {
  const uid = useId();
  const { storageKey, ready, goal, remember } = useSavedGoal();
  const savedForLesson = practiceGoalForScenario(goal, scenarioId);
  const [draft, setDraft] = useState<{ focus: PracticeFocus | null; note: string } | null>(null);
  const [message, setMessage] = useState("");
  const [invalidFocus, setInvalidFocus] = useState(false);
  const [preparation, setPreparation] = useState<
    { kind: "saved"; goal: PracticeGoal } | { kind: "skip" } | null
  >(null);
  const current = draft ?? {
    focus: savedForLesson?.focus ?? null,
    note: savedForLesson?.note ?? "",
  };
  const dirty =
    current.focus !== (savedForLesson?.focus ?? null) ||
    current.note.trim() !== (savedForLesson?.note ?? "");
  const mayLeave = useRef(false);
  const firstChoice = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const preparationTitle = useRef<HTMLHeadingElement>(null);
  const stayButton = useRef<HTMLButtonElement>(null);
  const blocker = useBlocker({
    shouldBlockFn: ({ current: from, next }) =>
      dirty && !mayLeave.current && from.pathname !== next.pathname,
    enableBeforeUnload: () => dirty && !mayLeave.current,
    withResolver: true,
  });
  const update = (value: Partial<typeof current>) => {
    setDraft({ ...current, ...value });
    setMessage("");
    setInvalidFocus(false);
  };
  function save(andPractice: boolean) {
    if (!ready) return;
    if (!current.focus) {
      setInvalidFocus(true);
      setMessage("先選一個下次要練的動作，再保存。");
      firstChoice.current?.focus();
      return;
    }
    const next: PracticeGoal = {
      version: 1,
      focus: current.focus,
      note: current.note.trim(),
      scenarioId,
      scenarioName,
      updatedAt: new Date().toISOString(),
    };
    let stored = false;
    try {
      stored = savePracticeGoal(localStorage, storageKey, next);
    } catch {
      /* Storage itself may be unavailable. */
    }
    if (!stored) {
      setMessage("這台裝置目前無法確認保存。你的選擇留在本頁，請重試，或先自行記下練習重點。");
      requestAnimationFrame(() => statusRef.current?.focus());
      return;
    }
    remember(next);
    setDraft({ focus: next.focus, note: next.note });
    setMessage("你已為下一次選好一個重點。已保存在這台裝置，回到教室大廳也能看到；準備好再練習。");
    if (andPractice) setPreparation({ kind: "saved", goal: next });
    else requestAnimationFrame(() => statusRef.current?.focus());
  }
  function beginPractice() {
    mayLeave.current = true;
    setPreparation(null);
    onPractice?.();
  }

  return (
    <>
      <section
        id="practice-goal"
        className="academy-card mt-6 scroll-mt-4 p-5 sm:p-6"
        aria-labelledby={`${uid}-title`}
      >
        <h2 id={`${uid}-title`} className="text-xl font-semibold">
          下次只練一件事
        </h2>
        <p className="mt-2 text-base leading-7 text-muted">
          回看「{scenarioName}」，選一個下次想做到的動作。練習重點不以單次賺賠評分。
        </p>
        {goal && !savedForLesson && (
          <p className="mt-3 rounded-xl bg-bg p-4 text-base leading-7 text-muted">
            這台裝置上次保存的是「{goal.scenarioName}
            」的重點。本課請重新選擇；保存後會更新大廳的練習提醒。
          </p>
        )}
        {savedForLesson && (
          <p className="mt-3 text-base leading-7 text-brand">
            已載入這堂課上次保存的重點，可直接沿用或調整。
          </p>
        )}
        <fieldset
          className="mt-4 space-y-3"
          disabled={!ready}
          aria-describedby={invalidFocus ? `${uid}-status` : undefined}
          aria-invalid={invalidFocus}
        >
          <legend className="sr-only">選擇下次的練習重點</legend>
          {PRACTICE_FOCUSES.map((item, index) => (
            <label
              key={item.id}
              className={cn(
                "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-4 text-base leading-7",
                current.focus === item.id ? "border-brand bg-brand/5" : "border-border bg-bg/40",
              )}
            >
              <input
                ref={index === 0 ? firstChoice : undefined}
                type="radio"
                name={`${uid}-focus`}
                value={item.id}
                checked={current.focus === item.id}
                onChange={() => update({ focus: item.id })}
                className="size-5 shrink-0 accent-[var(--color-brand)]"
              />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
        <label className="mt-5 block text-base font-medium" htmlFor={`${uid}-note`}>
          再寫一句提醒自己（選填）
        </label>
        <textarea
          id={`${uid}-note`}
          rows={2}
          maxLength={140}
          value={current.note}
          disabled={!ready}
          onChange={(event) => update({ note: event.target.value })}
          className="mt-2 min-h-24 w-full rounded-xl border border-border bg-bg p-3 text-base leading-7"
          placeholder="例：送出前，先唸出商品名稱和張數。"
          aria-describedby={`${uid}-storage ${uid}-count`}
        />
        <p id={`${uid}-count`} className="mt-2 text-base text-muted">
          {current.note.length}/140 字
        </p>
        <p id={`${uid}-storage`} className="mt-2 text-sm leading-6 text-muted">
          只儲存在這台裝置的目前帳號；未登入時為訪客紀錄。換裝置不會自動帶過去，也不會提交給講師。
        </p>
        <p
          ref={statusRef}
          id={`${uid}-status`}
          tabIndex={-1}
          role="status"
          className="mt-3 text-base leading-7 text-brand"
        >
          {message}
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          {onPractice && (
            <button
              ref={saveButton}
              type="button"
              className="academy-button-primary min-h-12 whitespace-normal text-base"
              disabled={!ready}
              onClick={() => save(true)}
            >
              保存重點並重練本課
            </button>
          )}
          <button
            ref={!onPractice ? saveButton : undefined}
            type="button"
            className="academy-button-secondary min-h-12 whitespace-normal text-base"
            disabled={!ready}
            onClick={() => save(false)}
          >
            保存練習重點
          </button>
        </div>
        {onPractice && (
          <button
            type="button"
            className="mt-3 min-h-12 w-full rounded-lg px-3 py-3 text-base leading-7 text-muted underline underline-offset-4 sm:w-auto"
            disabled={!ready}
            onClick={() => setPreparation({ kind: "skip" })}
          >
            不保存這次重點，先重練
          </button>
        )}
      </section>
      <Dialog.Root
        open={preparation !== null}
        onOpenChange={(open) => {
          if (!open) setPreparation(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-bg/80" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[61] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              preparationTitle.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              saveButton.current?.focus();
            }}
          >
            <Dialog.Title ref={preparationTitle} tabIndex={-1} className="text-xl font-semibold">
              {preparation?.kind === "saved" ? "重練前，先看這個重點" : "這次先重練，不保存重點"}
            </Dialog.Title>
            <Dialog.Description className="mt-3 text-base leading-7 text-muted">
              即將重練「{scenarioName}」。準備好再開始；系統不會替你送出委託。
            </Dialog.Description>
            {preparation?.kind === "saved" ? (
              <div className="mt-4 rounded-xl bg-brand/5 p-4">
                <p className="text-lg font-semibold leading-8 text-brand">
                  {PRACTICE_FOCUSES.find((item) => item.id === preparation.goal.focus)?.label}
                </p>
                {preparation.goal.note && (
                  <p className="mt-3 whitespace-pre-wrap break-words text-base leading-8">
                    {preparation.goal.note}
                  </p>
                )}
                <p className="mt-3 text-base leading-7 text-muted">
                  先唸一次這個動作，這一盤就練它。完成後再用成交紀錄檢查是否做到。
                </p>
              </div>
            ) : (
              <p className="mt-4 rounded-xl bg-bg p-4 text-base leading-7">
                本頁尚未保存的選擇與文字會捨棄，先前保存的提醒仍保留。要帶著新重點練習，請返回保存。
              </p>
            )}
            <div className="mt-5 flex flex-col gap-3">
              <button
                type="button"
                className="academy-button-primary min-h-12 whitespace-normal text-base"
                onClick={beginPractice}
              >
                {preparation?.kind === "saved" ? "帶著這個重點開始" : "不保存，開始重練"}
              </button>
              <button
                type="button"
                className="academy-button-secondary min-h-12 whitespace-normal text-base"
                onClick={() => setPreparation(null)}
              >
                返回復盤
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-bg/80" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[61] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-xl"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              stayButton.current?.focus();
            }}
          >
            <Dialog.Title className="text-xl font-semibold">練習重點還沒保存</Dialog.Title>
            <Dialog.Description className="mt-3 text-base leading-7 text-muted">
              離開會失去本頁的修改，先前保存的重點不變。
            </Dialog.Description>
            <div className="mt-5 flex flex-col gap-3">
              <button
                ref={stayButton}
                type="button"
                className="academy-button-primary min-h-12 whitespace-normal text-base"
                onClick={() => blocker.reset?.()}
              >
                留在這頁保存
              </button>
              <button
                type="button"
                className="academy-button-secondary min-h-12 whitespace-normal text-base"
                onClick={() => blocker.proceed?.()}
              >
                不保存，離開這頁
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
