import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { PRACTICE_FOCUSES, parsePracticeGoal, practiceGoalKey, type PracticeFocus, type PracticeGoal } from "@/lib/practice-goal";
import { cn } from "@/lib/utils";

function useSavedGoal() {
  const { user, isPending } = useCurrentUserState();
  const storageKey = practiceGoalKey(user?.id ?? null);
  const [saved, setSaved] = useState<{ key: string; goal: PracticeGoal | null } | null>(null);
  useEffect(() => {
    if (isPending) return;
    try { setSaved({ key: storageKey, goal: parsePracticeGoal(localStorage.getItem(storageKey)) }); }
    catch { setSaved({ key: storageKey, goal: null }); }
  }, [storageKey, isPending]);
  return { storageKey, ready: !isPending && saved?.key === storageKey, goal: saved?.key === storageKey ? saved.goal : null };
}

export function PracticeGoalReminder() {
  const { ready, goal } = useSavedGoal();
  if (!ready || !goal) return null;
  return (
    <aside className="rounded-2xl border border-brand/20 bg-brand/5 p-5" aria-label="上次保存的練習重點">
      <p className="flex items-center gap-2 text-base font-semibold"><Target className="size-5 text-brand" aria-hidden />下次練習，先做好這一件事</p>
      <p className="mt-3 text-lg font-semibold text-brand">{PRACTICE_FOCUSES.find(item => item.id === goal.focus)?.label}</p>
      {goal.note ? <p className="mt-2 break-words text-base leading-7">{goal.note}</p> : null}
      <p className="mt-3 text-sm leading-6 text-muted">來自「{goal.scenarioName}」復盤。這個重點只保存在這台裝置，完成下一次復盤時可更新。</p>
    </aside>
  );
}

export function PracticeGoalEditor({ scenarioId, scenarioName }: { scenarioId: string; scenarioName: string }) {
  const { storageKey, ready, goal } = useSavedGoal();
  const [draft, setDraft] = useState<{ key: string; focus: PracticeFocus | null; note: string } | null>(null);
  const [message, setMessage] = useState("");
  const current = draft?.key === storageKey ? draft : { key: storageKey, focus: goal?.focus ?? null, note: goal?.note ?? "" };
  const update = (value: Partial<typeof current>) => { setDraft({ ...current, ...value }); setMessage(""); };
  return (
    <section className="academy-card mt-6 p-5 sm:p-6" aria-labelledby="practice-goal-title">
      <h2 id="practice-goal-title" className="text-xl font-semibold">下次只練一件事</h2>
      <p className="mt-2 text-base leading-7 text-muted">選一個可做到的動作，再重練這堂課。練習重點不以單次賺賠評分。</p>
      <fieldset className="mt-4 space-y-3" disabled={!ready}>
        <legend className="sr-only">選擇下次的練習重點</legend>
        {PRACTICE_FOCUSES.map(item => (
          <label key={item.id} className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-4 text-base leading-7", current.focus === item.id ? "border-brand bg-brand/5" : "border-border bg-bg/40")}>
            <input type="radio" name="practice-goal" value={item.id} checked={current.focus === item.id} onChange={() => update({ focus: item.id })} className="size-5 shrink-0 accent-[var(--color-brand)]" />
            <span>{item.label}</span>
          </label>
        ))}
      </fieldset>
      <label className="mt-5 block text-base font-medium" htmlFor="practice-goal-note">再寫一句提醒自己（選填）</label>
      <textarea id="practice-goal-note" rows={2} maxLength={140} value={current.note} disabled={!ready} onChange={event => update({ note: event.target.value })} className="mt-2 min-h-24 w-full rounded-xl border border-border bg-bg p-3 text-base leading-7" placeholder="例：送出前，先唸出商品名稱和張數。" />
      <p className="mt-2 text-sm leading-6 text-muted">只儲存在這台裝置的目前帳號；未登入時為訪客紀錄。換裝置不會自動帶過去。</p>
      <button type="button" className="academy-button-primary mt-4 min-h-12 w-full text-base sm:w-auto" disabled={!ready || !current.focus} onClick={() => {
        if (!current.focus) return;
        const next: PracticeGoal = { version: 1, focus: current.focus, note: current.note.trim(), scenarioId, scenarioName, updatedAt: new Date().toISOString() };
        try { localStorage.setItem(storageKey, JSON.stringify(next)); setMessage("已保存。回到教室大廳時會提醒你。"); }
        catch { setMessage("這台裝置目前無法保存。請先記下重點，稍後再試。"); }
      }}>保存下次練習重點</button>
      <p role="status" className="mt-3 text-base leading-7 text-brand">{message}</p>
    </section>
  );
}
