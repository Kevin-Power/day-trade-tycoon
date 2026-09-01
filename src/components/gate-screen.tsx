import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  onOpen: () => void;
  submit: (password: string) => Promise<{ ok: boolean; reason?: string }>;
};

export function GateScreen({ onOpen, submit }: Props) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await submit(password);
    setBusy(false);
    if (res.ok) {
      onOpen();
      return;
    }
    setError(res.reason || "密碼錯誤");
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-x-hidden bg-bg px-4 text-fg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklab, var(--color-border) 70%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--color-border) 70%, transparent) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklab,var(--color-header-2)_28%,transparent),transparent_70%)]" />

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <Mark />
          <div>
            <div className="text-xs tracking-[0.22em] text-muted">DAY TRADE TYCOON</div>
            <div className="font-medium">股文觀指教室</div>
          </div>
          <span className="ml-auto rounded-xs bg-tape/15 px-1.5 py-0.5 text-2xs tracking-wide text-tape">
            模擬盤
          </span>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-lg border border-border bg-surface p-5 shadow-[var(--shadow-panel)] sm:p-6"
        >
          <p className="text-xs tracking-[0.28em] text-muted">CLASSROOM GATE</p>
          <h1 className="mt-2 text-2xl font-medium tracking-tight">教室入場</h1>
          <p className="mt-2 text-pretty text-sm leading-relaxed text-muted">
            輸入講師發給的入場密碼。這不是券商帳號，也不會送到實盤。
          </p>

          <label className="mt-5 block text-micro text-muted" htmlFor="classroom-gate">
            入場密碼
          </label>
          <div className="mt-1.5 flex items-center gap-1 rounded-md border border-border-strong bg-bg focus-within:ring-2 focus-within:ring-ring">
            <input
              id="classroom-gate"
              ref={inputRef}
              name="password"
              type={show ? "text" : "password"}
              inputMode="numeric"
              autoComplete="off"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError("");
              }}
              className="h-11 min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-fg outline-none"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="mr-1 inline-flex size-9 items-center justify-center rounded-sm text-muted hover:text-fg"
              aria-label={show ? "隱藏密碼" : "顯示密碼"}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>

          {error ? (
            <p className="mt-2 text-sm text-up" role="alert">
              {error}
            </p>
          ) : (
            <p className="mt-2 text-micro text-subtle">密碼由講師當面或課前發給。不要轉貼到公開頻道。</p>
          )}

          <Button type="submit" className="mt-5 w-full" size="lg" disabled={busy}>
            {busy ? "核對中…" : "進入教室"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function Mark() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden className="rounded-sm">
      <rect width="36" height="36" fill="#163a6b" />
      <path d="M8 24 V14 H11 V24 Z" fill="#ff3b3b" />
      <path d="M9.5 10 V14 M9.5 24 V28" stroke="#ff3b3b" strokeWidth="1.4" />
      <path d="M16 24 V18 H19 V24 Z" fill="#8b9bb0" />
      <path d="M17.5 15 V18 M17.5 24 V26" stroke="#8b9bb0" strokeWidth="1.4" />
      <path d="M24 24 V11 H27 V24 Z" fill="#17c964" />
      <path d="M25.5 8 V11 M25.5 24 V30" stroke="#17c964" strokeWidth="1.4" />
    </svg>
  );
}
