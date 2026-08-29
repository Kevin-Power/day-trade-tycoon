import { useEffect, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGame } from "@/lib/game/store";
import { playOpen, unlockAudio } from "@/lib/game/audio";
import { registerLiveScenarios } from "@/lib/game/scenarios";
import { loadTapeCache, loadTapeFetchedAt, registerTapeDays, saveTapeCache } from "@/lib/market/tape";
import { TEACHING_DATES, type TapeDay, type TapePayload } from "@/lib/market/tape-types";
import { formatIndex } from "@/lib/market/week";
import { cn, formatPct, formatSigned } from "@/lib/utils";
import { toneClass } from "@/components/signed";

const CLASSROOM_OFFLINE = import.meta.env.BASE_URL === "./";

function practiceDays(list: TapeDay[]): TapeDay[] {
  return list.filter((d) => d.complete && !TEACHING_DATES.has(d.date)).slice(0, 4);
}

export function LiveTape() {
  const start = useGame((s) => s.start);
  const [days, setDays] = useState<TapeDay[]>([]);
  const [status, setStatus] = useState("檢查最新盤勢…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const cached = loadTapeCache();
    if (cached.length) {
      registerLiveScenarios(cached);
      setDays(practiceDays(cached));
      const at = loadTapeFetchedAt();
      setStatus(at ? `上次載入 ${formatWhen(at)}` : "已載入快取");
    }
    if (CLASSROOM_OFFLINE) {
      setStatus("地端教室使用內建教材週，不必連網。線上教室每個交易日 13:50 後會自動抓最新完整盤。");
      return;
    }
    void refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh(force: boolean) {
    if (CLASSROOM_OFFLINE) return;
    setBusy(true);
    if (force || days.length === 0) setStatus("正在向證交所抓完整盤（約數秒）…");
    try {
      const url = force ? "/api/tape?fresh=1" : "/api/tape";
      const res = await fetch(url, { cache: force ? "no-store" : "default" });
      const payload = (await res.json()) as TapePayload;
      if (!payload?.ok || !payload.days?.length) {
        setStatus(payload?.error ? `官方站暫時連不上：${payload.error}` : "官方站暫時連不上，沿用教材週。");
        return;
      }
      saveTapeCache(payload.days, payload.fetchedAt);
      registerTapeDays(payload.days);
      registerLiveScenarios(payload.days);
      const next = practiceDays(payload.days);
      setDays(next);
      if (next.length) {
        setStatus(`已載入 ${next.map((d) => d.label).join("、")}。每個交易日 13:50 後自動更新；8/24–8/26 課綱不覆蓋。`);
      } else {
        setStatus("最新完整盤已在教材週裡。下一個交易日收盤後會出現在這裡。");
      }
    } catch {
      setStatus("連不上官方站，沿用教材週。");
    } finally {
      setBusy(false);
    }
  }

  function play(day: TapeDay, kind: "full" | "open") {
    registerTapeDays([day]);
    registerLiveScenarios([day]);
    unlockAudio();
    playOpen();
    start(kind === "full" ? `live-full-${day.id}` : `live-open-${day.id}`);
  }

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium tracking-wide">每日實盤</h2>
          <p className="mt-1 max-w-2xl text-pretty text-micro text-muted">{status}</p>
        </div>
        {!CLASSROOM_OFFLINE && (
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={busy}
            className="inline-flex h-9 min-w-11 items-center gap-1.5 rounded-sm border border-border-strong bg-surface px-2.5 text-2xs text-muted hover:text-fg disabled:opacity-60"
          >
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
            重新抓盤
          </button>
        )}
      </div>

      {busy && days.length === 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-52 animate-pulse rounded-lg border border-border bg-surface" />
          ))}
        </div>
      )}

      {days.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {days.map((d) => {
            const chg = d.close - d.prevClose;
            const pct = (chg / d.prevClose) * 100;
            return (
              <article
                key={d.id}
                className="flex flex-col rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-panel)]"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="rounded-xs bg-elevated px-1.5 py-0.5 text-2xs tracking-wide text-muted">
                    自由練習
                  </span>
                  <span className="font-mono text-micro text-muted">{d.date}</span>
                </div>
                <h3 className="text-lg font-medium">{d.label}</h3>
                <div className={cn("mt-1 font-mono text-xl tabular", toneClass(chg))}>
                  {formatIndex(d.close)}
                </div>
                <div className={cn("font-mono text-micro tabular", toneClass(chg))}>
                  {formatSigned(chg)} · {formatPct(pct)}
                  {d.turnoverYi ? ` · ${Math.round(d.turnoverYi)} 億` : ""}
                </div>
                <div className="mt-1 font-mono text-2xs text-muted">
                  開 {formatIndex(d.open)} · 高 {formatIndex(d.high)} · 低 {formatIndex(d.low)}
                </div>
                <p className="mt-3 text-pretty text-xs leading-relaxed text-muted">
                  加權為證交所每 5 秒指數。沒有課綱暫停，規則自己執行。個股為當日開高低收套大盤節奏。
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button className="w-full" onClick={() => play(d, "full")}>
                    全日
                    <ChevronRight className="size-4" />
                  </Button>
                  <Button variant="subtle" className="w-full" onClick={() => play(d, "open")}>
                    開盤 45 分
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatWhen(isoStr: string): string {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  return d.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
