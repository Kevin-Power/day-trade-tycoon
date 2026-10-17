import { Link } from "@tanstack/react-router";
import { CARD, PRIMARY, SECONDARY } from "@/components/morning-styles";
import { describeAccessProblem, PRACTICE_PATH } from "@/lib/morning-access";
import { loginHref } from "@/lib/safe-next";

/** Why a practice page cannot open yet, with the one next step (retry, finish the profile, or lobby). */
export function AccessCard({
  problem,
  busy,
  onRetry,
}: {
  problem: ReturnType<typeof describeAccessProblem>;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <section className={CARD} aria-labelledby="morning-access-title">
      <h1 id="morning-access-title" className="text-xl font-semibold">
        {problem.title}
      </h1>
      <p className="mt-3 text-muted">{problem.body}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {problem.kind === "guest-start" && (
          <>
            <button type="button" disabled={busy} onClick={onRetry} className={PRIMARY}>
              再試一次
            </button>
            <a href={loginHref({ next: PRACTICE_PATH, mode: "up" })} className={SECONDARY}>
              登入／建立帳號
            </a>
          </>
        )}
        {problem.kind === "profile" && (
          <a href={loginHref({ next: PRACTICE_PATH })} className={PRIMARY}>
            完成學員資料
          </a>
        )}
        {problem.kind === "gate" && (
          <Link to="/" className={PRIMARY}>
            回大廳
          </Link>
        )}
      </div>
    </section>
  );
}
