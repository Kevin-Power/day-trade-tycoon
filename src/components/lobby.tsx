import { Activity, BookOpen, ChevronRight, Clock3, Shield, Target, TrendingUp } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { nextRank, SCENARIOS } from "@/lib/game/scenarios";
import { lessonById } from "@/lib/game/curriculum";
import { useGame } from "@/lib/game/store";
import { playOpen, unlockAudio } from "@/lib/game/audio";
import { cn, formatMoney, formatPct, formatSigned } from "@/lib/utils";
import { toneClass } from "@/components/signed";
import { LiveTape } from "@/components/live-tape";
import { PreopenBoard } from "@/components/preopen-board";
import { MisSnapshot } from "@/components/mis-snapshot";
import { Leaderboard } from "@/components/leaderboard";
import { WEEK_SESSIONS, formatIndex } from "@/lib/market/week";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { loadMyProfile, upsertMyProfile } from "@/lib/classroom-db";
import backtest from "@/lib/game/strategy-backtest.json";
import { useEffect, useState } from "react";

const WEEK_ORDER = ["mon", "tue", "wed"] as const;

export function Lobby() {
  const profile = useGame((s) => s.profile);
  const start = useGame((s) => s.start);
  const hydrated = useGame((s) => s.hydrated);
  const nxt = nextRank(profile.careerPnl);
  const winRate = profile.sessions ? profile.wins / profile.sessions : 0;
  const { user, isPending } = useCurrentUserState();
  const passed = profile.history.filter((h) => h.passed).length;
  const empty = profile.sessions === 0;
  const [stratOpen, setStratOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [tosOpen, setTosOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    void loadMyProfile()
      .then((p) => {
        setRole(p?.role ?? null);
        if (!p?.tos_accepted_at) setTosOpen(true);
      })
      .catch(() => setTosOpen(true));
  }, [user]);

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
            <span className="hidden sm:inline">教室說明書</span>
            <span className="sm:hidden">說明</span>
          </Link>
          {role === "teacher" ? (
            <Link to="/teacher" className="hidden text-xs text-muted hover:text-fg sm:inline">
              教師
            </Link>
          ) : null}
          {isPending ? (
            <div className="size-9 animate-pulse rounded-sm bg-elevated" />
          ) : user ? (
            <UserButton />
          ) : (
            <Link
              to="/login"
              className="inline-flex h-9 items-center rounded-sm border border-border-strong bg-surface px-3 text-xs hover:bg-elevated"
            >
              登入
            </Link>
          )}
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
        <section className="stagger-in mb-8 max-w-3xl pt-4 sm:pt-10">
          <p className="mb-3 text-xs tracking-[0.28em] text-muted">教材週 · 2026/08/24–08/26</p>
          <h1 className="text-balance text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
            當沖大富翁
          </h1>
          <p className="mt-4 max-w-xl text-pretty text-sm leading-relaxed text-muted sm:text-base">
            固定教材，三天涵蓋殺盤、V轉、攻高三種盤型。加權為證交所每 5 秒指數。下單走模擬撮合，不是實盤。
          </p>
        </section>

        {empty ? (
          <section className="mb-8 rounded-lg border border-border-strong bg-surface p-5">
            <p className="text-sm font-medium">還沒開始。</p>
            <p className="mt-1 text-sm text-muted">第 1 課只打開盤 30 分，約 10 分鐘可打完。</p>
            <Button
              className="mt-4"
              onClick={() => {
                unlockAudio();
                playOpen();
                start("wed-open");
              }}
            >
              從第 1 課開始
              <ChevronRight className="size-4" />
            </Button>
          </section>
        ) : (
          <section className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
            <HeroStat label="生涯損益" value={formatSigned(profile.careerPnl, 0)} tone={profile.careerPnl} />
            <HeroStat label="已完成盤數" value={String(profile.sessions)} />
            <HeroStat label="勝率" value={`${(winRate * 100).toFixed(0)}%`} />
            <div className="bg-surface px-4 py-3">
              <div className="text-micro text-muted">下一階</div>
              <div className="mt-1 font-mono text-lg tabular">{nxt ? `${nxt.title}` : "已達頂點"}</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-xs bg-elevated">
                <div className="h-full bg-header-2" style={{ width: `${Math.min(100, (passed / 6) * 100)}%` }} />
              </div>
              <div className="mt-1 text-micro text-subtle">已通過 {Math.min(passed, 6)} / 6 課</div>
            </div>
          </section>
        )}

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

        <PreopenBoard />
        <MisSnapshot />
        <LiveTape />

        <section>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-sm font-medium tracking-wide">本週課綱</h2>
            <span className="text-micro text-muted">進入後先講解，Space 繼續。</span>
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
          <button
            type="button"
            onClick={() => setStratOpen((v) => !v)}
            className="mb-3 flex w-full items-center justify-between text-left"
          >
            <h2 className="text-sm font-medium tracking-wide">當沖策略 / 盤口策略</h2>
            <span className="text-micro text-subtle">{stratOpen ? "收合" : "展開八張卡"}</span>
          </button>
          {stratOpen && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {backtest.daytrade.map((s) => (
                <div key={s.id} className="rounded-lg border border-border bg-surface p-3">
                  <div className="text-sm font-medium">{s.name}</div>
                  <p className="mt-1 font-mono text-micro text-muted">
                    3 日 · 訊號 {s.signals} 次 · 勝率 {(s.winRate * 100).toFixed(0)}% · 平均 R {s.avgR}
                  </p>
                  <p className="mt-1 text-micro text-subtle">教材週回測，非未來績效</p>
                </div>
              ))}
              {backtest.book.map((s) => (
                <div key={s.id} className="rounded-lg border border-border bg-surface p-3">
                  <div className="text-sm font-medium">{s.name}</div>
                  <p className="mt-1 text-micro text-muted">盤口策略無法離線回測，只提供即時訊號</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-8 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-medium">近況戰績</h2>
            {(!hydrated || profile.history.length === 0) && (
              <p className="py-8 text-center text-sm text-muted">還沒有戰績。先打第 1 課。</p>
            )}
            {hydrated && profile.history.length > 0 && (
              <div className="term-scroll overflow-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 font-medium">關卡</th>
                      <th className="py-1 font-medium">損益</th>
                      <th className="py-1 font-medium">通過</th>
                      <th className="py-1 font-medium">評等</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.history.slice(0, 8).map((h) => (
                      <tr key={h.id} className="border-t border-border">
                        <td className="py-1.5">
                          <Link to="/session/$id/review" params={{ id: h.id }} className="hover:text-tape">
                            {h.scenarioName}
                          </Link>
                        </td>
                        <td className={cn("py-1.5 tabular", toneClass(h.pnl))}>{formatSigned(h.pnl, 0)}</td>
                        <td className="py-1.5">{h.passed === false ? "未過" : h.passed ? "通過" : "—"}</td>
                        <td className="py-1.5">{h.grade}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <Leaderboard />
        </section>

        <section className="mt-8 rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium">教室規則</h2>
          <ul className="space-y-3 text-sm leading-relaxed text-muted">
            <li className="flex gap-2">
              <Clock3 className="mt-0.5 size-4 shrink-0 text-fg" />
              時間軸 09:00–13:30。加權＝證交所 5 秒指數；個股套大盤節奏（非逐筆）。
            </li>
            <li className="flex gap-2">
              <TrendingUp className="mt-0.5 size-4 shrink-0 text-fg" />
              紅漲綠跌、1 張 = 1,000 股、±10% 漲跌停。教學模式會在關鍵分鐘暫停。
            </li>
            <li className="flex gap-2">
              <Activity className="mt-0.5 size-4 shrink-0 text-fg" />
              來回成本約 0.32%。收盤前未平倉將市價出場。
            </li>
          </ul>
          <Link to="/manual" className="mt-4 inline-flex text-xs text-tape hover:underline">
            為什麼這間教室沒有主機代管 →
          </Link>
        </section>

        <p className="mt-10 text-pretty text-micro leading-relaxed text-subtle">
          本站為模擬教學環境，所有行情為歷史或延遲資料，不構成任何投資建議或勸誘。模擬績效不代表實盤結果。資料來源：TWSE MIS，僅供教學展示，非即時報價。
        </p>
      </main>
      {tosOpen && user ? <TosModal onDone={() => setTosOpen(false)} /> : null}
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

function TosModal({ onDone }: { onDone: () => void }) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/80 p-4">
      <div className="w-full max-w-md rounded-lg border border-border-strong bg-surface p-5">
        <h2 className="text-lg font-medium">模擬教學免責</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          本站為模擬教學環境，所有行情為歷史或延遲資料，不構成任何投資建議或勸誘。模擬績效不代表實盤結果。
        </p>
        <label className="mt-4 flex items-start gap-2 text-sm text-muted">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-0.5" />
          我已閱讀並同意。
        </label>
        <Button
          className="mt-4 w-full"
          disabled={!ok || busy}
          onClick={() => {
            setBusy(true);
            void upsertMyProfile({
              data: { displayName: "學員", classCode: "GWVGZ", acceptTos: true },
            })
              .then(onDone)
              .finally(() => setBusy(false));
          }}
        >
          同意並進入
        </Button>
      </div>
    </div>
  );
}
