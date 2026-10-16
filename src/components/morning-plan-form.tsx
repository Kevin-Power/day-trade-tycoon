import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowRight } from "lucide-react";
import type { MorningCatalog, MorningPlan } from "@/lib/morning";
import { GUEST_TERMS_TEXT } from "@/lib/morning-access";
import {
  applyPlanTemplate,
  DEFAULT_PLAN_TEMPLATE,
  PLAN_TEMPLATES,
  type PlanTemplateId,
} from "@/lib/plan-templates";
import { cn } from "@/lib/utils";
import { CARD, INPUT, PRIMARY, SECONDARY } from "@/components/morning-styles";

type Choice = PlanTemplateId | "custom";
const CHOICES: { id: Choice; title: string; summary: string }[] = [
  ...PLAN_TEMPLATES.map(({ id, title, summary }) => ({ id, title, summary })),
  { id: "custom", title: "自己寫", summary: "三格都由自己填寫" },
];

export function PlanForm({
  catalog,
  exerciseId,
  busy,
  guest,
  onStart,
  onCancel,
}: {
  catalog: MorningCatalog;
  exerciseId: string;
  busy: boolean;
  guest: boolean;
  onStart: (plan: MorningPlan) => Promise<void>;
  onCancel?: () => void;
}) {
  // A new plan is always blank, so it opens with the default template filled in: one tap to start.
  const [choice, setChoice] = useState<Choice>(DEFAULT_PLAN_TEMPLATE);
  const [plan, setPlan] = useState<MorningPlan>(() =>
    applyPlanTemplate(PLAN_TEMPLATES.find((template) => template.id === DEFAULT_PLAN_TEMPLATE)!, {
      exerciseId,
      bias: "observe",
      focusCode: catalog.symbols[0]?.code ?? "",
      reason: "",
      entry: "",
      stop: "",
    }),
  );
  const [invalid, setInvalid] = useState("");
  const options = useRef<(HTMLButtonElement | null)[]>([]);

  function choose(next: Choice) {
    setChoice(next);
    const template = PLAN_TEMPLATES.find((item) => item.id === next);
    if (template) setPlan((current) => applyPlanTemplate(template, current));
  }
  function moveChoice(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + CHOICES.length) % CHOICES.length;
    choose(CHOICES[next].id);
    options.current[next]?.focus();
  }
  function edit(field: "reason" | "entry" | "stop", value: string) {
    setPlan({ ...plan, [field]: value });
    setChoice("custom");
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = {
      ...plan,
      reason: plan.reason.trim(),
      entry: plan.entry.trim(),
      stop: plan.stop.trim(),
    };
    if (!next.reason || !next.entry || !next.stop) {
      setInvalid("每一欄都寫下自己的想法；尚不確定也可以說明正在等待什麼。");
      return;
    }
    setInvalid("");
    void onStart(next);
  }
  return (
    <section className={CARD} aria-labelledby="morning-plan-title">
      <p className="text-xs font-semibold text-brand">09:00 開始前 · 交易計畫</p>
      <h2 id="morning-plan-title" className="mt-1 text-lg font-semibold">
        寫下今天的作戰藍圖
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        不需要先猜對漲跌。計畫會隨新的一輪保存，重播期間保留原文供復盤核對。
      </p>
      <form className="mt-3 space-y-3" onSubmit={submit}>
        <fieldset disabled={busy} className="min-w-0 space-y-3 disabled:opacity-60">
          <legend className="sr-only">本輪觀察計畫</legend>
          <div role="radiogroup" aria-label="選一個計畫範本" className="td-templates grid gap-2">
            {CHOICES.map((item, index) => (
              <button
                key={item.id}
                ref={(element) => {
                  options.current[index] = element;
                }}
                type="button"
                role="radio"
                aria-checked={choice === item.id}
                tabIndex={choice === item.id ? 0 : -1}
                onClick={() => choose(item.id)}
                onKeyDown={(event) => moveChoice(event, index)}
                className="td-template flex min-h-16 min-w-0 flex-col items-start justify-center rounded-md border border-border px-3 py-2 text-left"
              >
                <strong className="text-base">{item.title}</strong>
                <span className="text-sm leading-relaxed text-muted">{item.summary}</span>
              </button>
            ))}
          </div>
          <label className="block text-base font-medium">
            先關注哪一檔
            <select
              value={plan.focusCode}
              onChange={(event) => setPlan({ ...plan, focusCode: event.target.value })}
              className={cn(INPUT, "mt-1")}
            >
              {catalog.symbols.map((symbol) => (
                <option key={symbol.code} value={symbol.code}>
                  {symbol.code} {symbol.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="min-w-0">
            <legend className="mb-2 text-base font-medium">目前的觀察方向</legend>
            <div className="grid gap-1.5">
              {(
                [
                  { value: "observe", label: "先觀察／不確定" },
                  { value: "bullish", label: "觀察偏多條件" },
                  { value: "bearish", label: "觀察偏空條件" },
                ] as const
              ).map((item) => (
                <label
                  key={item.value}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <input
                    type="radio"
                    name="morning-bias"
                    value={item.value}
                    checked={plan.bias === item.value}
                    onChange={() => setPlan({ ...plan, bias: item.value })}
                    className="size-5 shrink-0"
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {(
            [
              {
                key: "reason",
                label: "我觀察的理由",
                hint: "先描述背景或價格條件，不必寫成買賣答案。",
              },
              {
                key: "entry",
                label: "什麼條件出現，我才考慮操作",
                hint: "沒有符合條件，也可以選擇繼續等待。",
              },
              {
                key: "stop",
                label: "什麼情況代表計畫失效，需要停止或重新核對",
                hint: "寫下自己能核對的條件。",
              },
            ] as const
          ).map((field) => (
            <label key={field.key} className="block text-base font-medium">
              {field.label}
              <span className="mt-1 block text-xs font-normal leading-relaxed text-muted">
                {field.hint}
              </span>
              <textarea
                required
                maxLength={600}
                rows={2}
                value={plan[field.key]}
                onChange={(event) => edit(field.key, event.target.value)}
                className={cn(INPUT, "mt-1 resize-y font-normal")}
              />
            </label>
          ))}
        </fieldset>
        {invalid && (
          <p role="alert" className="text-base text-warn">
            {invalid}
          </p>
        )}
        <div className="border border-border bg-bg p-2 text-xs leading-relaxed text-muted">
          本課紙上資金為新臺幣 1,000 萬元，每筆 1–3 張。價格來自歷史分鐘
          K；學員成交依教材模型估算，不是真實成交回放。
        </div>
        {guest && <p className="td-guest-terms text-base leading-relaxed">{GUEST_TERMS_TEXT}</p>}
        <button type="submit" disabled={busy} className={cn(PRIMARY, "w-full")}>
          {busy ? "正在保存…" : choice === "custom" ? "保存計畫，進入 09:00 練習" : "用這個計畫開始"}
          <ArrowRight className="size-5 shrink-0" aria-hidden />
        </button>
        {onCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={cn(SECONDARY, "w-full")}
          >
            回看上一輪紀錄
          </button>
        )}
      </form>
    </section>
  );
}
