import { useState, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { Eye, EyeOff, MousePointer2, NotebookPen, ScanEye } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { SimChip } from "@/components/provenance";
import { DisplayControls } from "@/components/display-controls";

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
      <a href="#classroom-access" className="academy-skip">
        跳到教室入口
      </a>
      <div className="mx-auto w-full max-w-6xl px-5 py-5 sm:px-8 sm:py-8 lg:px-12">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-5 sm:pb-7">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <BrandMark className="size-10 shrink-0 sm:size-11" />
            <div>
              <p className="text-base font-semibold tracking-wide text-fg sm:text-lg">當沖大富翁</p>
              <p className="mt-0.5 text-[0.6rem] font-medium tracking-[0.16em] text-muted sm:text-[0.65rem]">
                DAY TRADE TYCOON
              </p>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <SimChip
              label="模擬教學"
              className="hidden !rounded-full !px-3 !py-1.5 sm:inline-flex"
            />
            <DisplayControls compact className="!rounded-full" />
          </div>
        </header>

        <div className="grid gap-7 py-8 sm:gap-9 sm:py-12 lg:min-h-[calc(100dvh-10rem)] lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-14 lg:py-14">
          <section
            aria-label="教室介紹"
            className="premium-auth-hero mx-auto w-full min-w-0 max-w-2xl lg:max-w-none"
          >
            <p className="academy-eyebrow flex items-center gap-2.5">
              <span aria-hidden="true" className="h-px w-6 bg-current opacity-60" />
              專注練習，逐步進步
            </p>
            <h2 className="mt-4 text-balance text-[1.75rem] leading-[1.38] font-semibold tracking-tight text-fg sm:text-4xl lg:text-[2.625rem]">
              {heroTitle}
            </h2>
            <p className="mt-4 max-w-md text-pretty text-base leading-7 text-muted">
              {heroDescription}
            </p>
            <LearningPathIllustration />
            <ol className="premium-auth-features mt-8 hidden max-w-md divide-y divide-border/75 lg:block">
              {features.map((feature, index) => (
                <li
                  key={feature.title}
                  className="flex items-start gap-4 py-5 first:pt-0 last:pb-0"
                >
                  <span className="pt-1 font-mono text-xs font-medium text-brand">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="text-base font-medium text-fg">{feature.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted">{feature.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <div className="mx-auto w-full min-w-0 max-w-2xl lg:max-w-none">
            <section
              id="classroom-access"
              tabIndex={-1}
              className="academy-card premium-auth-form scroll-mt-6 p-5 sm:p-8"
            >
              {children}
            </section>
            {footer ? (
              <footer className="mx-auto mt-5 max-w-md text-center text-sm leading-6 text-muted">
                {footer}
              </footer>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

function LearningPathIllustration() {
  return (
    <div
      aria-hidden="true"
      className="relative mt-8 hidden max-w-md overflow-hidden rounded-2xl border border-border/80 bg-surface/70 px-5 py-6 lg:block"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium tracking-wider text-brand">每一次練習，都有方向</p>
        <span className="size-1.5 rounded-full bg-[#b89650]" />
      </div>
      <div className="relative mt-5 grid grid-cols-3 gap-3">
        <div className="absolute inset-x-[16%] top-5 border-t border-dashed border-border-strong" />
        {[
          { label: "觀察盤勢", icon: ScanEye },
          { label: "模擬操作", icon: MousePointer2 },
          { label: "整理復盤", icon: NotebookPen },
        ].map(({ label, icon: Icon }) => (
          <div key={label} className="relative flex flex-col items-center gap-3 text-center">
            <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface text-brand">
              <Icon className="size-[18px]" strokeWidth={1.6} />
            </span>
            <span className="text-sm font-medium text-fg">{label}</span>
          </div>
        ))}
      </div>
    </div>
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
