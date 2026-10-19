import { useState, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { Eye, EyeOff, ArrowRight } from "@/lib/icons";
import { Link } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import { SimChip } from "@/components/provenance";
import { DisplayControls } from "@/components/display-controls";
import { WorkspacePreview } from "@/components/workspace-preview";

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
    <main className="academy-page classroom-access-page relative isolate min-h-dvh">
      <a href="#classroom-access" className="academy-skip">
        跳到教室入口
      </a>
      <div className="access-container">
        <header className="access-header">
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
            <Link to="/try" className="access-demo-link">
              免費體驗 <ArrowRight aria-hidden />
            </Link>
            <SimChip
              label="模擬教學"
              className="hidden !rounded-full !px-3 !py-1.5 sm:inline-flex"
            />
            <DisplayControls compact className="!rounded-full" />
          </div>
        </header>

        <div className="access-grid">
          <section aria-label="教室介紹" className="access-hero">
            <p className="academy-eyebrow flex items-center gap-2.5">
              <span aria-hidden="true" className="h-px w-6 bg-current opacity-60" />
              股文觀指 · 交易實作教室
            </p>
            <h2 className="access-hero-title">{heroTitle}</h2>
            <p className="mt-4 max-w-md text-pretty text-base leading-7 text-muted">
              {heroDescription}
            </p>
            <WorkspacePreview />
            <ol className="access-features">
              {features.map((feature, index) => (
                <li key={feature.title} className="flex items-start gap-3">
                  <span className="pt-1 font-mono text-xs font-medium text-brand">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="text-sm font-medium text-fg">{feature.title}</h3>
                    <p className="mt-1 text-xs leading-6 text-muted">{feature.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <div className="access-form-column">
            <section
              id="classroom-access"
              tabIndex={-1}
              className="academy-card access-form scroll-mt-6 p-5 sm:p-8"
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
          className="icon-only absolute inset-y-0 right-1 my-auto inline-flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:opacity-50"
        >
          {visible ? (
            <EyeOff aria-hidden="true" />
          ) : (
            <Eye aria-hidden="true" />
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
