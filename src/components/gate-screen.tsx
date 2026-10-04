import { useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, LoaderCircle, LockKeyhole, ScrollText } from "lucide-react";
import { AuthPasswordInput, ClassroomAuthLayout } from "@/components/classroom-auth-layout";
import { CONSENT, DISCLAIMER } from "@/lib/provenance";
import { LICENSE_QUOTE } from "@/lib/license";

type Props = {
  onOpen: () => void;
  submit: (password: string) => Promise<{ ok: boolean; reason?: string }>;
};

const FEATURES = [
  { title: "跟著講師掌握觀察重點", description: "從盤勢與交易節奏開始，知道每次練習要看什麼。" },
  { title: "在模擬環境反覆練習", description: "練習進出場與風險控管，建立有依據的決策流程。" },
  { title: "透過復盤找到下一步", description: "回看操作與學習紀錄，把每一盤轉化成具體心得。" },
] as const;

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
    <ClassroomAuthLayout
      heroTitle={
        <>
          先練好交易紀律，
          <br />
          再看懂每一次決策。
        </>
      }
      heroDescription="講師帶領、模擬操作、課後復盤。在當沖大富翁，循序練習觀察市場與管理風險。"
      features={FEATURES}
      footer={
        <>
          <Link to="/license" className="academy-nav-link inline-flex items-center gap-1.5">
            <ScrollText className="size-3.5" aria-hidden="true" />
            教室授權說明
          </Link>
          <p className="mt-1">無須入場碼即可查看 · {LICENSE_QUOTE}</p>
        </>
      }
    >
      <div className="mb-6">
        <p className="academy-eyebrow flex items-center gap-2">
          <LockKeyhole className="size-3.5" aria-hidden="true" />
          01 / 教室入場
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg">進入交易教室</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          準備好講師提供的入場碼，開始今天的模擬練習。
        </p>
      </div>

      <div className="mb-7 rounded-xl border border-brand/25 bg-brand/5 p-4">
        <p className="text-base font-semibold text-fg">第一次來？先試著操作看看</p>
        <p className="mt-2 text-base leading-7 text-muted">
          不用帳號，跟著步驟練習確認委託、查看成交與理解成本。
        </p>
        <Link to="/try" className="academy-button-primary mt-4 !min-h-14 w-full !text-base">
          先體驗模擬操作
          <ArrowRight className="size-5" aria-hidden="true" />
        </Link>
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

        <div className="mt-6 rounded-xl border border-border bg-bg/50 p-4">
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
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? "正在核對入場碼…" : "進入教室"}
          {!busy ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
        </button>
        <p className="mt-3 text-center text-xs leading-5 text-muted">
          僅供模擬教學 · 不會送出真實交易委託
        </p>
      </form>
    </ClassroomAuthLayout>
  );
}
