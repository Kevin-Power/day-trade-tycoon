import { useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, LoaderCircle } from "@/lib/icons";
import { AuthPasswordInput, ClassroomAuthLayout } from "@/components/classroom-auth-layout";
import { CONSENT, DISCLAIMER } from "@/lib/provenance";

type Props = {
  onOpen: () => void;
  submit: (password: string) => Promise<{ ok: boolean; reason?: string }>;
};

export function GateScreen({ onOpen, submit }: Props) {
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !agreed) return;
    setBusy(true);
    setError("");
    try {
      const result = await submit(password);
      if (result.ok) {
        onOpen();
        return;
      }
      setError(result.reason || "密碼錯誤");
    } catch {
      setError("暫時無法核對入場碼，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ClassroomAuthLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">進入交易教室</h1>
        <p className="mt-2 text-base leading-7 text-muted">
          重播真實交易日 09:00–10:30 的行情，用 1,000 萬模擬資金練習當沖。委託不會送到券商。
        </p>
      </div>

      <form onSubmit={onSubmit} aria-busy={busy}>
        <AuthPasswordInput
          id="classroom-gate"
          inputRef={inputRef}
          label="教室入場碼"
          name="password"
          autoComplete="off"
          required
          disabled={busy}
          value={password}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "classroom-gate-error" : undefined}
          onChange={(event) => {
            setPassword(event.target.value);
            if (error) setError("");
          }}
          hint="入場碼由講師於課前提供，請勿公開分享。"
        />
        {error ? (
          <p id="classroom-gate-error" className="mt-3 text-sm leading-6 text-up" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-6 rounded-lg border border-border bg-bg/50 p-4">
          <p className="text-xs font-medium text-fg">練習前，請先了解</p>
          <p id="classroom-disclaimer" className="mt-2 text-xs leading-6 text-muted">
            {DISCLAIMER}
          </p>
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-3 text-pretty text-xs leading-6 text-muted">
          <input
            type="checkbox"
            required
            checked={agreed}
            disabled={busy}
            onChange={(event) => setAgreed(event.target.checked)}
            aria-describedby="classroom-disclaimer"
            className="mt-1 size-4 shrink-0 accent-[var(--color-brand)]"
          />
          <span>{CONSENT}</span>
        </label>

        <button
          type="submit"
          className="academy-button-primary mt-6 w-full"
          disabled={busy || !agreed}
        >
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
          {busy ? "正在核對入場碼…" : "進入教室"}
          {!busy ? <ArrowRight aria-hidden="true" /> : null}
        </button>
        <p className="mt-3 text-pretty text-sm leading-6 text-muted">
          進教室後請先登入，第一次來請申請帳號：練習紀錄才會保存，下次登入就能接著練。
        </p>
      </form>

      {/* Students bring the teacher's code, so the guest trial is the quieter way in, after the form. */}
      <div className="access-trial mt-7 border-t border-border pt-6">
        <p className="text-base font-semibold text-fg">沒有入場碼？</p>
        <p className="mt-1 text-base leading-7 text-muted">
          不用帳號，跟著步驟試一次下單，看成交和成本怎麼算。
        </p>
        <Link to="/try" className="academy-button-secondary mt-4 !min-h-12 w-full !text-base">
          先體驗模擬操作
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </ClassroomAuthLayout>
  );
}
