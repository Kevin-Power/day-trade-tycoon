import { Activity, BookOpen, ChevronRight, Clock3, Download, HardDrive, LogOut, Shield, Target, TrendingUp } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { nextRank, rankFor, SCENARIOS } from "@/lib/game/scenarios";
import { lessonById, PRINCIPLES } from "@/lib/game/curriculum";
import { useGame } from "@/lib/game/store";
import { playOpen, unlockAudio } from "@/lib/game/audio";
import { cn, formatMoney, formatPct, formatSigned } from "@/lib/utils";
import { toneClass } from "@/components/signed";
import { LiveTape } from "@/components/live-tape";
import { WEEK_SESSIONS, formatIndex } from "@/lib/market/week";
import { useGate } from "@/lib/gate/context";

const WEEK_ORDER = ["mon", "tue", "wed"] as const;
const CLASSROOM_OFFLINE = import.meta.env.BASE_URL === "./";

export function Lobby() {
  const profile = useGame((s) => s.profile);
  const start = useGame((s) => s.start);
  const hydrated = useGame((s) => s.hydrated);
  const rank = rankFor(profile.careerPnl);
  const nxt = nextRank(profile.careerPnl);
  const winRate = profile.sessions ? profile.wins / profile.sessions : 0;
  const { lock } = useGate();

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-bg text-fg">
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

      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Mark />
          <div>
            <div className="text-xs tracking-[0.22em] text-muted">DAY TRADE TYCOON</div>
            <div className="font-medium">模擬當沖教室</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden rounded-xs bg-tape/15 px-1.5 py-0.5 text-2xs tracking-wide text-tape sm:inline">
            模擬盤
          </span>
          <Link
            to="/manual"
            className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border-strong bg-surface px-3 text-xs text-fg hover:bg-elevated"
          >
            <BookOpen className="size-3.5" />
            <span className="hidden sm:inline">說明書</span>
            <span className="sm:hidden">說明</span>
          </Link>
          {CLASSROOM_OFFLINE ? (
            <span className="rounded-xs border border-border-strong bg-elevated px-2 py-1 text-micro text-muted">
              地端教室 · 離線
            </span>
          ) : (
            <a
              href="/daytrade-tycoon-offline.zip"
              download="當沖大富翁-地端教室.zip"
              className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border-strong bg-surface px-3 text-xs text-fg hover:bg-elevated"
            >
              <Download className="size-3.5" />
              <span className="hidden sm:inline">下載地端教室</span>
              <span className="sm:hidden">地端</span>
            </a>
          )}
          <div className="text-right">
            <div className="text-micro text-muted">目前段位</div>
            <div className="text-sm font-medium">{rank.title}</div>
          </div>
          <button
            type="button"
            onClick={lock}
            className="inline-flex size-9 items-center justify-center rounded-sm border border-border-strong bg-surface text-muted hover:bg-elevated hover:text-fg"
            aria-label="登出"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
        <section className="stagger-in mb-8 max-w-3xl pt-4 sm:pt-10">
          <p className="mb-3 text-xs tracking-[0.28em] text-muted">本週實盤 · 2026/08/24–08/26</p>
          <h1 className="text-balance text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
            當沖大富翁
          </h1>
          <p className="mt-4 max-w-xl text-pretty text-sm leading-relaxed text-muted sm:text-base">
            加權為證交所每 5 秒指數。課綱凍結 8/24–8/26。下單畫面比照券商現股當沖：模擬撮合已開，實盤 API 接上後只換通路。
          </p>
        </section>

        <section className="mb-8 flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
          <span className="w-fit rounded-xs bg-tape/15 px-1.5 py-0.5 text-2xs tracking-wide text-tape">模擬盤</span>
          <span className="text-sm">現股當沖 · 帳號 CLASSROOM-SIM</span>
          <span className="text-micro text-muted sm:ml-auto">
            委託單與實盤共用。券商 API 尚未接線，點實盤會提示。
          </span>
        </section>

        <section className="mb-8 flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">給石大哥的說明書</div>
            <p className="mt-1 text-pretty text-micro leading-relaxed text-muted">
              學員怎麼玩、資料哪裡來、模擬跟實盤差在哪。可列印、可下載 PDF。
            </p>
          </div>
          <Link
            to="/manual"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-sm bg-header-2 px-3 text-xs text-fg hover:bg-header"
          >
            <BookOpen className="size-3.5" />
            打開說明書
          </Link>
        </section>

        <section className="mb-8 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
          {WEEK_ORDER.map((id) => {
            const s = WEEK_SESSIONS[id]!;
            const chg = s.close - s.prevClose;
            const pct = (chg / s.prevClose) * 100;
            return (
              <div key={id} className="bg-surface px-4 py-3">
                <div className="text-micro text-muted">{s.label} 加權</div>
                <div className={cn("mt-1 font-mono text-lg tabular", toneClass(chg))}>
                  {formatIndex(s.close)}
                </div>
                <div className={cn("font-mono text-micro tabular", toneClass(chg))}>
                  {formatSigned(chg)} · {formatPct(pct)}
                </div>
                <div className="mt-1 font-mono text-2xs text-muted">
                  開 {formatIndex(s.open)} · 高 {formatIndex(s.high)} · 低 {formatIndex(s.low)}
                </div>
              </div>
            );
          })}
        </section>

        <LiveTape />

        <section className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
          <HeroStat label="生涯損益" value={formatSigned(profile.careerPnl, 0)} tone={profile.careerPnl} />
          <HeroStat label="已完成盤數" value={String(profile.sessions)} />
          <HeroStat label="勝率" value={`${(winRate * 100).toFixed(0)}%`} />
          <HeroStat
            label="下一階"
            value={nxt ? `${nxt.title} · ${nxt.need}` : "已達頂點"}
          />
        </section>

        <section>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-sm font-medium tracking-wide">本週課綱</h2>
            <span className="text-micro text-muted">建議依序打。進入後先講解，Space 繼續。</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SCENARIOS.map((sc) => {
              const lesson = lessonById(sc.id);
              return (
              <article
                key={sc.id}
                className="group flex flex-col rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-panel)] transition-[border-color] duration-150 hover:border-border-strong"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="rounded-xs bg-elevated px-1.5 py-0.5 text-2xs tracking-wide text-muted">
                    {lesson ? `${lesson.no} · ${lesson.skill}` : sc.tag}
                  </span>
                  <span className="font-mono text-micro text-muted">
                    {sc.minutes} 分 · {sc.speed}x
                  </span>
                </div>
                <h3 className="text-lg font-medium">{sc.name}</h3>
                <p className="mt-2 flex-1 text-pretty text-sm leading-relaxed text-muted">{sc.blurb}</p>
                <ul className="mt-3 space-y-1 text-micro text-subtle">
                  <li className="flex items-center gap-1.5">
                    <Target className="size-3.5" />
                    {sc.objective}
                  </li>
                  {lesson && (
                    <li className="flex items-center gap-1.5">
                      <BookOpen className="size-3.5" />
                      {lesson.principle}
                    </li>
                  )}
                  <li className="flex items-center gap-1.5">
                    <Shield className="size-3.5" />
                    本金 {formatMoney(sc.capital)} · {sc.leverage}x 額度
                    {sc.allowShort ? " · 可先賣" : " · 僅先買"}
                  </li>
                </ul>
                <Button
                  className="mt-4 w-full"
                  onClick={() => {
                    unlockAudio();
                    playOpen();
                    start(sc.id);
                  }}
                >
                  進入盤室
                  <ChevronRight className="size-4" />
                </Button>
              </article>
              );
            })}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium tracking-wide">當沖六式</h2>
          <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {PRINCIPLES.map((p) => (
              <div key={p.no} className="bg-surface px-4 py-3">
                <div className="font-mono text-micro text-muted">{p.no}</div>
                <div className="mt-1 text-sm font-medium">{p.title}</div>
                <p className="mt-1 text-pretty text-xs leading-relaxed text-muted">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-medium">近況戰績</h2>
            {(!hydrated || profile.history.length === 0) && (
              <p className="py-8 text-center text-sm text-muted">還沒有戰績。先打第 1 課 開盤觀察。</p>
            )}
            {hydrated && profile.history.length > 0 && (
              <div className="term-scroll overflow-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 font-medium">關卡</th>
                      <th className="py-1 font-medium">損益</th>
                      <th className="py-1 font-medium">報酬</th>
                      <th className="py-1 font-medium">評等</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.history.slice(0, 8).map((h) => (
                      <tr key={h.id} className="border-t border-border">
                        <td className="py-1.5">{h.scenarioName}</td>
                        <td className={cn("py-1.5 tabular", toneClass(h.pnl))}>{formatSigned(h.pnl, 0)}</td>
                        <td className={cn("py-1.5 tabular", toneClass(h.pnlPct))}>{formatPct(h.pnlPct)}</td>
                        <td className="py-1.5">{h.grade}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-medium">教室規則</h2>
            <ul className="space-y-3 text-sm leading-relaxed text-muted">
              <li className="flex gap-2">
                <Clock3 className="mt-0.5 size-4 shrink-0 text-fg" />
                時間軸 09:00–13:30。加權＝證交所每 5 秒指數；個股＝公開日成交套大盤節奏（非逐筆）。下單走模擬撮合。實盤 API 接上後只換 adapter。
              </li>
              <li className="flex gap-2">
                <TrendingUp className="mt-0.5 size-4 shrink-0 text-fg" />
                紅漲綠跌、1 張 = 1,000 股、±10% 漲跌停、五檔撮合。個股預設江波圖，分價表看堆積。教學模式會在關鍵分鐘暫停。
              </li>
              <li className="flex gap-2">
                <Activity className="mt-0.5 size-4 shrink-0 text-fg" />
                手續費約 0.0855%（最低 20 元），當沖稅 0.15%。來回成本約 0.32%。
              </li>
              <li className="flex gap-2">
                <HardDrive className="mt-0.5 size-4 shrink-0 text-fg" />
                地端包與線上同一套。解壓後雙擊 START.bat，教室電腦不必連網。戰績存在該機瀏覽器。
              </li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}

function HeroStat({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="text-micro text-muted">{label}</div>
      <div className={cn("mt-1 font-mono text-lg tabular", tone !== undefined ? toneClass(tone) : "text-fg")}>
        {value}
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
