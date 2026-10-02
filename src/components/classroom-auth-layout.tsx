import { useState, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { ArrowUpRight, ChartNoAxesCombined, Eye, EyeOff } from "lucide-react";
import { SimChip } from "@/components/provenance";

type Feature = { title: string; description: string };

export function ClassroomAuthLayout({
  heroTitle,
  heroDescription,
  features,
  children,
  footer,
}: {
  heroTitle: ReactNode;
  heroDescription: string;
  features: readonly Feature[];
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="academy-page relative isolate min-h-dvh overflow-x-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem] bg-[radial-gradient(ellipse_at_top_left,color-mix(in_oklab,var(--color-brand)_9%,transparent),transparent_65%)]"
      />
      <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 sm:py-9 lg:px-12">
        <header className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--color-brand)]/25 bg-[var(--color-brand)]/10 text-[var(--color-brand)]">
              <ChartNoAxesCombined className="size-6" aria-hidden="true" />
            </span>
            <div>
              <p className="text-base font-semibold tracking-wide text-fg">當沖大富翁</p>
              <p className="mt-0.5 text-[10px] font-medium tracking-[0.18em] text-muted">
                DAY TRADE TYCOON
              </p>
            </div>
          </div>
          <SimChip label="模擬教學" className="!rounded-full !px-3 !py-1.5" />
        </header>

        <div className="grid gap-8 py-10 sm:gap-10 sm:py-14 lg:min-h-[calc(100dvh-10rem)] lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16 lg:py-12">
          <section aria-label="教室介紹" className="min-w-0">
            <p className="academy-eyebrow">觀察 · 練習 · 復盤</p>
            <h2 className="mt-4 text-balance text-3xl leading-[1.3] font-semibold tracking-tight text-fg sm:text-4xl lg:text-[2.75rem]">
              {heroTitle}
            </h2>
            <p className="mt-4 max-w-md text-pretty text-sm leading-7 text-muted sm:text-base">
              {heroDescription}
            </p>
            <ol className="mt-9 hidden max-w-md space-y-5 lg:block">
              {features.map((feature, index) => (
                <li key={feature.title} className="flex items-start gap-4">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border font-mono text-xs text-[var(--color-brand)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="pt-0.5">
                    <h3 className="text-sm font-medium text-fg">{feature.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted">{feature.description}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-8 hidden items-center gap-2 border-t border-border/70 pt-5 text-xs text-muted lg:flex">
              <ArrowUpRight className="size-4 text-[var(--color-brand)]" aria-hidden="true" />
              把專注留給學習，逐步建立自己的交易紀律。
            </p>
          </section>

          <div className="min-w-0">
            <section className="academy-card p-6 sm:p-8">{children}</section>
            {footer ? (
              <footer className="mt-5 text-center text-xs leading-6 text-muted">{footer}</footer>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

export function AuthPasswordInput({
  label,
  hint,
  inputRef,
  id,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  id: string;
  label: string;
  hint?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [props["aria-describedby"], hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label}
      </label>
      <div className="relative mt-2">
        <input
          {...props}
          id={id}
          ref={inputRef}
          type={visible ? "text" : "password"}
          aria-describedby={describedBy}
          className="academy-input w-full !pr-12"
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? `隱藏${label}` : `顯示${label}`}
          aria-pressed={visible}
          disabled={props.disabled}
          className="absolute inset-y-0 right-1 my-auto inline-flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:opacity-50"
        >
          {visible ? (
            <EyeOff className="size-[18px]" aria-hidden="true" />
          ) : (
            <Eye className="size-[18px]" aria-hidden="true" />
          )}
        </button>
      </div>
      {hint ? (
        <p id={hintId} className="mt-2 text-xs leading-5 text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
