import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useGame } from "@/lib/game/store";
import { cn } from "@/lib/utils";

const CLASSROOM_OFFLINE = import.meta.env.BASE_URL === "./";

export function RealCandlesLink({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  if (CLASSROOM_OFFLINE) return null;

  function pauseCurrentPractice() {
    const state = useGame.getState();
    if (state.phase === "live" && !state.paused) state.togglePause();
    state.disarmFlash("已切換至獨立真實 K 教材；舊生成練習不再啟動，閃電下單已解除。");
  }

  return (
    <Link
      to="/morning"
      search={{ panel: "trade" }}
      onClick={pauseCurrentPractice}
      onAuxClick={(event) => {
        if (event.button === 1) pauseCurrentPractice();
      }}
      className={cn(
        "inline-flex min-h-12 min-w-0 items-center justify-center gap-2 whitespace-normal rounded-xl border border-brand bg-brand px-4 py-3 text-base font-semibold leading-relaxed text-brand-fg hover:brightness-95",
        className,
      )}
    >
      {children ?? "改用真實 K 線"}
      <ArrowRight className="size-5 shrink-0" aria-hidden />
    </Link>
  );
}

export function SyntheticChartNotice() {
  return (
    <div className="shrink-0 border-y border-warn/30 bg-warn/5 px-3 py-3">
      <p className="text-base font-semibold leading-relaxed text-fg">
        舊生成行情已停止使用。此課尚未提供對應日期的真實分鐘 K。
      </p>
      {!CLASSROOM_OFFLINE && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-3">
          <RealCandlesLink />
          <p className="min-w-0 flex-1 basis-52 text-sm leading-relaxed text-muted">
            真實教室可選 2026/10/05、10/06，每日 5
            檔股票、09:00–10:30，搭配六個練習主題。原有歷史紀錄保留，不將舊課行情視為真實分鐘 K。
          </p>
        </div>
      )}
    </div>
  );
}
