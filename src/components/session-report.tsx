import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Clock3,
  MessageSquare,
  ReceiptText,
  RotateCcw,
} from "lucide-react";
import { ProvenanceMicro } from "@/components/provenance";
import { lessonById } from "@/lib/game/curriculum";
import { useGame } from "@/lib/game/store";
import type { ReviewBundle } from "@/lib/game/persist";
import { cn, formatMoney, formatSigned, formatTime } from "@/lib/utils";
import { toneClass } from "@/components/signed";
import { PracticeGoalEditor } from "@/components/practice-goal";

export function SessionReport({ bundle }: { bundle: ReviewBundle }) {
  const navigate = useNavigate();
  const rec = bundle.rec;
  const lesson = lessonById(rec.scenarioId);
  const codes = [...new Set(bundle.fills.map((fill) => fill.code))];
  const [code, setCode] = useState(bundle.code);
  const selected = codes.includes(code) ? code : codes[0];
  const fills = bundle.fills.filter((fill) => fill.code === selected);
  return (
    <main className="academy-page">
      <header className="academy-header">
        <div className="academy-container flex flex-wrap items-center justify-between gap-3 py-4">
          <span className="flex items-center gap-2.5 text-sm font-medium">
            <ClipboardList aria-hidden="true" className="size-5 text-brand" />
            當沖大富翁<span className="border-l border-border pl-2.5 text-muted">練習復盤</span>
          </span>
          <button
            type="button"
            className="academy-nav-link"
            onClick={() => {
              useGame.getState().leave();
              void navigate({ to: "/" });
            }}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            教室大廳
          </button>
        </div>
      </header>
      <div className="academy-container py-8 sm:py-11">
        <p className="academy-eyebrow">
          {lesson?.no || "自由練習"} · {bundle.sessionLabel}
        </p>
        <h1 className="academy-title mt-2">{rec.scenarioName} · 完整復盤</h1>
        <p className="academy-description mt-3">把每一次模擬操作，整理成下一次能實踐的改進。</p>
        <p
          className={cn(
            "mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
            lesson && rec.passed
              ? "border-brand/20 bg-brand/10 text-brand"
              : "border-border bg-surface text-muted",
          )}
        >
          {lesson && rec.passed ? (
            <CheckCircle2 aria-hidden="true" className="size-3.5" />
          ) : (
            <ClipboardList aria-hidden="true" className="size-3.5" />
          )}
          {lesson
            ? rec.passed
              ? "本次已完成課程條件"
              : "本次仍有條件待練習"
            : "自由練習不評定課程通過"}
        </p>
        <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["模擬淨損益", formatSigned(rec.pnl, 0)],
            ["最大回撤", `${(rec.maxDrawdown * 100).toFixed(2)}%`],
            ["平倉次數", rec.trades],
            ["費稅", formatMoney(rec.fees, 0)],
          ].map(([label, value]) => (
            <div key={label} className="academy-card p-4 sm:p-5">
              <p className="text-xs text-muted">{label}</p>
              <p
                className={cn(
                  "mt-3 break-words font-mono text-xl font-medium tabular sm:text-2xl",
                  label === "模擬淨損益" && toneClass(rec.pnl),
                )}
              >
                {value}
              </p>
            </div>
          ))}
        </div>
        <section className="academy-card mt-7 p-5 sm:p-6" aria-labelledby="review-discipline-title">
          <div className="mb-5">
            <p className="academy-eyebrow">01 · 操作紀律</p>
            <h2 id="review-discipline-title" className="mt-2 text-lg font-semibold">
              紀律與過關條件
            </h2>
            <p className="mt-2 text-sm text-muted">先看執行過程，再看損益結果。</p>
          </div>
          {bundle.verdicts.length ? (
            <ul className="grid gap-3 lg:grid-cols-2">
              {bundle.verdicts.map((verdict) => (
                <li
                  key={verdict.rule.id}
                  className="flex items-start gap-3 rounded-xl border border-border bg-bg/50 p-4 text-sm"
                >
                  {verdict.passed ? (
                    <CheckCircle2
                      aria-hidden="true"
                      className="mt-0.5 size-5 shrink-0 text-brand"
                    />
                  ) : (
                    <AlertCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">{verdict.rule.label}</span>
                      <span className={cn("text-xs", verdict.passed ? "text-brand" : "text-muted")}>
                        {verdict.passed ? "已達成" : "待練習"}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm leading-6 text-muted">{verdict.detail}</p>
                    {verdict.at !== undefined && (
                      <p className="mt-2 flex items-center gap-1.5 font-mono text-xs text-subtle">
                        <Clock3 aria-hidden="true" className="size-3" />
                        {formatTime(verdict.at)}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted">
              這份紀錄沒有課程條件評分，可從下方成交時間與價格進行復盤。
            </p>
          )}
          <p className="mt-5 border-t border-border pt-4 text-xs leading-6 text-muted">
            暫停中成交 {rec.pausedFills ?? 0}{" "}
            筆。這是模擬練習的自動檢核，講師仍需對照學員的進出場理由。
          </p>
        </section>
        {fills.length > 0 && (
          <section className="academy-card mt-6 p-5 sm:p-6" aria-labelledby="review-chart-title">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="academy-eyebrow">02 · 成交軌跡</p>
                <h2 id="review-chart-title" className="mt-2 text-lg font-semibold">
                  成交時間與價格
                </h2>
              </div>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
                查看標的
                <select
                  aria-label="復盤標的"
                  value={selected}
                  onChange={(event) => setCode(event.target.value)}
                  className="academy-input min-w-32 text-sm"
                >
                  {codes.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted">
              圖上僅呈現本次記錄的模擬成交點，紅色買進、綠色賣出。
            </p>
            <div className="mt-5 h-64 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="time"
                    name="時間"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={formatTime}
                    tick={{ fill: "var(--color-muted)", fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="price"
                    name="價格"
                    domain={["auto", "auto"]}
                    tick={{ fill: "var(--color-muted)", fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    contentStyle={{
                      background: "var(--color-surface)",
                      color: "var(--color-fg)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                    }}
                  />
                  <Scatter
                    name="買進"
                    data={fills.filter((fill) => fill.side === "buy")}
                    fill="var(--color-up)"
                  />
                  <Scatter
                    name="賣出"
                    data={fills.filter((fill) => fill.side === "sell")}
                    fill="var(--color-down)"
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}
        <section
          className="academy-card mt-6 overflow-hidden"
          aria-labelledby="review-trades-title"
        >
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-5 sm:px-6">
            <div>
              <p className="academy-eyebrow">03 · 逐筆回看</p>
              <h2 id="review-trades-title" className="mt-2 text-lg font-semibold">
                完整成交紀錄{" "}
                <span className="ml-2 text-sm font-normal text-muted">
                  {bundle.fills.length} 筆
                </span>
              </h2>
            </div>
            {bundle.fills.length > 0 && (
              <span className="text-xs text-muted sm:hidden">表格可左右滑動</span>
            )}
          </div>
          {bundle.fills.length > 0 ? (
            <div className="term-scroll max-h-[30rem] overflow-auto">
              <table className="w-full min-w-[44rem] whitespace-nowrap text-left text-sm">
                <caption className="sr-only">
                  本盤每一筆模擬成交的時間、商品、方向、張數、價格、費稅與暫停狀態
                </caption>
                <thead className="sticky top-0 bg-bg text-xs text-muted">
                  <tr>
                    {["時間", "代號", "買賣", "張數", "價格", "手續費", "稅", "暫停中成交"].map(
                      (label) => (
                        <th key={label} scope="col" className="px-4 py-3.5 font-medium">
                          {label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {bundle.fills.map((fill) => (
                    <tr
                      key={fill.id}
                      className="border-t border-border transition-colors hover:bg-bg/60"
                    >
                      <td className="px-4 py-3.5 font-mono tabular text-muted">
                        {formatTime(fill.time)}
                      </td>
                      <td className="px-4 py-3.5 font-mono font-medium">{fill.code}</td>
                      <td className="px-4 py-3.5">
                        <span
                          className={cn(
                            "rounded-md px-2 py-1 text-xs font-medium",
                            fill.side === "buy" ? "bg-up/10 text-up" : "bg-down/10 text-down",
                          )}
                        >
                          {fill.side === "buy" ? "買進" : "賣出"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-mono tabular">{fill.lots}</td>
                      <td className="px-4 py-3.5 font-mono tabular">{fill.price}</td>
                      <td className="px-4 py-3.5 font-mono tabular text-muted">{fill.fee}</td>
                      <td className="px-4 py-3.5 font-mono tabular text-muted">{fill.tax}</td>
                      <td className="px-4 py-3.5 text-muted">
                        {fill.filledWhilePaused ? "是" : "否"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-5 py-10 text-center">
              <ReceiptText aria-hidden="true" className="mx-auto mb-3 size-8 text-subtle" />
              <p className="font-medium">本盤沒有成交紀錄</p>
              <p className="mt-2 text-sm text-muted">可回看上方紀律條件，再決定下次練習的重點。</p>
            </div>
          )}
        </section>
        {lesson && (
          <section className="academy-card mt-6 p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <MessageSquare aria-hidden="true" className="size-5 text-brand" />
              帶回課堂討論
            </h2>
            <ul className="mt-4 space-y-3 text-sm leading-7 text-muted">
              {lesson.review.map((item) => (
                <li key={item} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-3 size-1.5 shrink-0 rounded-full bg-brand/60"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}
        <PracticeGoalEditor scenarioId={rec.scenarioId} scenarioName={rec.scenarioName} />
        <ProvenanceMicro
          className="mt-5"
          text="資料來源為本次教室模擬操作。歷史行情與教室生成資料的組合不等於真實成交，模擬成果不代表實際交易結果。"
        />
        <div className="academy-card mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="font-semibold">把復盤帶進下一次練習</h2>
            <p className="mt-1.5 text-sm text-muted">先選一個想改善的動作，再重練這堂課。</p>
          </div>
          <button
            type="button"
            className="academy-button-primary shrink-0"
            onClick={() => {
              useGame.getState().start(rec.scenarioId);
              void navigate({ to: "/" });
            }}
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            重練本課
          </button>
        </div>
      </div>
    </main>
  );
}
