import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { TapeChart } from "@/components/charts";
import { passRulesOf, lessonById } from "@/lib/game/curriculum";
import { useGame } from "@/lib/game/store";
import { cn, formatMoney, formatPct, formatSigned, formatTime } from "@/lib/utils";
import { toneClass } from "@/components/signed";
import { STOCK_BY_CODE } from "@/lib/market/universe";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Fill } from "@/lib/game/types";
import type { RuleVerdict } from "@/lib/game/pass-rules";

export function ResultScreen() {
  const rec = useGame((s) => s.lastResult);
  const verdicts = useGame((s) => s.lastVerdicts);
  const engine = useGame((s) => s.engine);
  const scenario = useGame((s) => s.scenario);
  const selected = useGame((s) => s.selected);
  const start = useGame((s) => s.start);
  const leave = useGame((s) => s.leave);
  if (!rec || !engine || !scenario) return null;
  const st = engine.stats();
  const lesson = lessonById(scenario.id);
  const q = engine.quote(selected);
  const fills = engine.fills;
  const curve = equityPoints(scenario.capital, fills, st.equity, engine.t);
  const rules: RuleVerdict[] = verdicts.length
    ? verdicts
    : passRulesOf(scenario.id).map((rule) => ({ rule, passed: true, detail: "" }));
  const winTrades = rec.wins;
  const lossTrades = Math.max(0, rec.trades - rec.wins);
  const avgWin = winTrades ? rec.pnl / Math.max(1, rec.trades) : 0;
  const hold = avgHoldMinutes(fills);
  const slip = fills.reduce((s, f) => s + (f.slippageTicks ?? 0), 0);
  const gross = rec.pnl + rec.fees;
  const feeShare = gross > 0 ? (rec.fees / gross) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-bg text-fg">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <p className="text-micro tracking-[0.2em] text-muted">
          {lesson ? `${lesson.no} · ${lesson.skill}` : "SESSION"} · {engine.session.label}
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <h2 className="text-3xl font-medium">{rec.scenarioName}</h2>
          <span className={cn("rounded-sm px-2 py-1 text-lg font-medium", rec.passed ? "bg-down-dim text-down" : "bg-up-dim text-up")}>
            {rec.passed ? "通過" : "未通過"}
          </span>
        </div>
        {!rec.passed && rec.violations && rec.violations.length > 0 && (
          <p className="mt-2 text-sm text-up">未達成：{rec.violations.join("、")}</p>
        )}

        {q && (
          <div className="mt-5 h-56 overflow-hidden rounded-lg border border-border bg-surface">
            <TapeChart
              bars={engine.bars(q.code)}
              ticks={engine.ticks(q.code)}
              prev={q.prevClose}
              high={q.high}
              low={q.low}
              last={q.last}
              open={q.open}
              fills={fills.filter((f) => f.code === q.code).map((f) => ({ t: f.time, p: f.price, side: f.side }))}
              showVolume
              startT={engine.startT}
              endT={engine.endT}
              now={engine.t}
              variant="jiangbo"
            />
          </div>
        )}

        <div className="mt-5 h-48 rounded-lg border border-border bg-surface p-2">
          <p className="px-2 pt-1 text-micro text-muted">權益（左）與回撤（右）</p>
          <ResponsiveContainer width="100%" height="85%">
            <LineChart data={curve}>
              <CartesianGrid stroke="#243040" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: "#8b9bb0", fontSize: 11 }} />
              <YAxis yAxisId="eq" tick={{ fill: "#8b9bb0", fontSize: 11 }} />
              <YAxis yAxisId="dd" orientation="right" tick={{ fill: "#8b9bb0", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#161d27", border: "1px solid #33455c", color: "#e6edf5" }}
              />
              <Line yAxisId="eq" type="monotone" dataKey="equity" stroke="#e8c547" dot={false} name="權益" />
              <Line yAxisId="dd" type="monotone" dataKey="ddPct" stroke="#ff3b3b" dot={false} name="回撤%" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-border sm:grid-cols-4">
          <Cell label="總報酬" value={formatSigned(rec.pnl, 0)} tone={rec.pnl} />
          <Cell label="最大回撤" value={`${(rec.maxDrawdown * 100).toFixed(2)}%`} />
          <Cell label="交易筆數" value={String(rec.trades)} />
          <Cell label="勝率" value={rec.trades ? `${((rec.wins / rec.trades) * 100).toFixed(0)}%` : "—"} />
          <Cell label="平均獲利" value={formatSigned(avgWin, 0)} tone={avgWin} />
          <Cell label="平均虧損" value={lossTrades ? "見成交" : "—"} />
          <Cell label="費稅總額" value={formatMoney(rec.fees, 0)} />
          <Cell label="費稅佔毛利" value={`${feeShare.toFixed(0)}%`} />
          <Cell label="平均持倉" value={`${hold.toFixed(0)} 分`} />
          <Cell label="滑檔總點數" value={String(slip)} />
          <Cell label="暫停中成交" value={`${rec.pausedFills ?? 0} 筆`} />
          <Cell label="評等" value={rec.grade} />
        </div>

        <section className="mt-6 rounded-lg border border-border bg-surface p-4">
          <h3 className="text-sm font-medium">紀律清單</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {rules.map((v) => (
              <li key={v.rule.id} className="flex gap-2 border-b border-border/60 py-1.5">
                <span className={v.passed ? "text-down" : "text-up"}>{v.passed ? "✓" : "✗"}</span>
                <span className="flex-1">
                  {v.rule.label}
                  <span className="ml-2 text-micro text-muted">{v.detail}</span>
                </span>
                {v.at != null && <span className="font-mono text-micro text-subtle">{formatTime(v.at)}</span>}
              </li>
            ))}
            {rules.length === 0 && <li className="text-muted">自由練習，沒有過關條件。</li>}
          </ul>
          <p className="mt-3 text-micro text-muted">暫停中成交 {rec.pausedFills ?? 0} 筆（教學可下單，期末考除外）。</p>
        </section>

        <section className="mt-4 overflow-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-header-2 text-fg">
              <tr>
                <th className="px-3 py-2 font-medium">時間</th>
                <th className="px-3 py-2 font-medium">代號</th>
                <th className="px-3 py-2 font-medium">買賣</th>
                <th className="px-3 py-2 font-medium">張</th>
                <th className="px-3 py-2 font-medium">價格</th>
                <th className="px-3 py-2 font-medium">暫停</th>
              </tr>
            </thead>
            <tbody>
              {fills.map((f) => (
                <tr key={f.id} className="border-t border-border">
                  <td className="px-3 py-1.5">{formatTime(f.time)}</td>
                  <td className="px-3 py-1.5">
                    {f.code} {STOCK_BY_CODE[f.code]?.name ?? ""}
                  </td>
                  <td className={cn("px-3 py-1.5", f.side === "buy" ? "text-up" : "text-down")}>
                    {f.side === "buy" ? "▲ 買" : "▼ 賣"}
                  </td>
                  <td className="px-3 py-1.5">{f.lots}</td>
                  <td className="px-3 py-1.5">{f.price}</td>
                  <td className="px-3 py-1.5">{f.filledWhilePaused ? "是" : ""}</td>
                </tr>
              ))}
              {fills.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted">
                    沒有成交。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" onClick={() => start(scenario.id)}>
            再打一次
          </Button>
          <Button className="flex-1" variant="outline" onClick={leave}>
            回課綱
          </Button>
          <Button className="flex-1" variant="ghost" asChild>
            <Link to="/session/$id/review" params={{ id: rec.id }}>
              開啟報告頁
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <div className="text-micro text-muted">{label}</div>
      <div className={cn("mt-0.5 font-mono text-base tabular", tone !== undefined ? toneClass(tone) : "text-fg")}>
        {value}
      </div>
    </div>
  );
}

function equityPoints(capital: number, fills: Fill[], finalEq: number, endT: number) {
  let eq = capital;
  let peak = capital;
  const pts = [{ t: 0, label: "09:00", equity: capital, ddPct: 0 }];
  for (const f of [...fills].sort((a, b) => a.time - b.time)) {
    eq -= f.fee + f.tax;
    if (f.pnl) eq += f.pnl;
    peak = Math.max(peak, eq);
    pts.push({
      t: f.time,
      label: formatTime(f.time).slice(0, 5),
      equity: Math.round(eq),
      ddPct: peak > 0 ? Number((((peak - eq) / peak) * 100).toFixed(2)) : 0,
    });
  }
  pts.push({
    t: endT,
    label: formatTime(endT).slice(0, 5),
    equity: Math.round(finalEq),
    ddPct: peak > 0 ? Number((((peak - finalEq) / peak) * 100).toFixed(2)) : 0,
  });
  return pts;
}

function avgHoldMinutes(fills: Fill[]): number {
  if (fills.length < 2) return 0;
  const sorted = [...fills].sort((a, b) => a.time - b.time);
  let sum = 0;
  let n = 0;
  for (let i = 1; i < sorted.length; i++) {
    sum += (sorted[i]!.time - sorted[i - 1]!.time) / 60;
    n += 1;
  }
  return n ? sum / n : 0;
}

export type { RuleVerdict };
