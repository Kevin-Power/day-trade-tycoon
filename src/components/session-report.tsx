import { useState, type ReactNode } from "react";
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
import { ArrowLeft, CheckCircle2, ClipboardList, MessageSquare, ReceiptText } from "lucide-react";
import { ProvenanceMicro } from "@/components/provenance";
import { lessonById } from "@/lib/game/curriculum";
import { useGame } from "@/lib/game/store";
import type { ReviewBundle } from "@/lib/game/persist";
import { cn, formatMoney, formatSigned, formatTime } from "@/lib/utils";
import { toneClass } from "@/components/signed";
import { PracticeGoalEditor } from "@/components/practice-goal";
import { ReviewConditions } from "@/components/review-conditions";
import { TradePlanReview } from "@/components/trade-plan";
import { formatPrice } from "@/lib/market/ticks";

const FILLS_PER_PAGE = 100;

export function SessionReport({
  bundle,
  viewer,
  feedback,
}: {
  bundle: ReviewBundle;
  viewer?: { kind: "teacher"; studentName: string };
  feedback?: ReactNode;
}) {
  const navigate = useNavigate();
  const teacherView = viewer?.kind === "teacher";
  const rec = bundle.rec;
  const openPositions = bundle.openPositionsAtEnd;
  const lesson = lessonById(rec.scenarioId);
  const codes = [...new Set(bundle.fills.map((fill) => fill.code))];
  const [code, setCode] = useState(bundle.code);
  const selected = codes.includes(code) ? code : codes[0];
  const fills = bundle.fills.filter((fill) => fill.code === selected);
  const [chartPage, setChartPage] = useState(0);
  const [tablePage, setTablePage] = useState(0);
  const chartFills = fills.slice(chartPage * FILLS_PER_PAGE, (chartPage + 1) * FILLS_PER_PAGE);
  const tableFills = bundle.fills.slice(
    tablePage * FILLS_PER_PAGE,
    (tablePage + 1) * FILLS_PER_PAGE,
  );
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
              if (teacherView) {
                void navigate({ to: "/teacher" });
                return;
              }
              useGame.getState().leave();
              void navigate({ to: "/" });
            }}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {teacherView ? "講師工作區" : "教室大廳"}
          </button>
        </div>
      </header>
      <div className="academy-container py-8 sm:py-11">
        <p className="academy-eyebrow">
          {lesson?.no || "自由練習"} · {bundle.sessionLabel}
        </p>
        <h1 className="academy-title mt-2">{rec.scenarioName} · 完整復盤</h1>
        <p className="academy-description mt-3">把每一次模擬操作，整理成下一次能實踐的改進。</p>
        {feedback && (
          <a
            href="#instructor-feedback"
            className="academy-button-secondary mt-4 min-h-12 text-base"
          >
            查看講師回饋
          </a>
        )}
        {teacherView && (
          <aside
            className="mt-5 rounded-xl border border-brand/20 bg-brand/5 p-4 text-base leading-7"
            aria-label="講師復盤說明"
          >
            <p className="font-semibold">{viewer.studentName || "本班學員"} · 講師檢視</p>
            <p className="mt-2">模擬紀錄唯讀；可另外新增講師回饋。</p>
            <p className="mt-2 text-muted">
              以下是學員自述與瀏覽器產生的模擬紀錄，供課堂討論，並非防作弊驗證或能力證明。請對照進出場理由與實際操作觀察。
            </p>
          </aside>
        )}
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
        <section
          className="academy-card mt-5 p-5 text-base leading-7 sm:p-6"
          aria-labelledby="review-positions-title"
        >
          <h2 id="review-positions-title" className="text-lg font-semibold">
            結束時庫存
          </h2>
          {openPositions === undefined ? (
            <p className="mt-3 text-muted">
              這份紀錄未保存結束時庫存，無法判定平倉狀態。損益保留當時紀錄；若當時有未平倉部位，可能包含其估值且未扣未來平倉費稅。
            </p>
          ) : openPositions.length > 0 ? (
            <>
              <p className="mt-3 font-medium">仍有 {openPositions.length} 檔模擬部位未平倉</p>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {openPositions.map((position) => (
                  <li key={position.code} className="rounded-xl border border-border bg-bg/60 p-4">
                    <p>
                      <span className="font-mono font-semibold">{position.code}</span>{" "}
                      {position.lots > 0 ? "買進（多單）" : "賣出（空單）"} · 剩餘{" "}
                      {Math.abs(position.lots)} 張
                    </p>
                    <p className="text-muted">最後模擬價 {formatPrice(position.last)}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-muted">
                模擬淨損益包含未平倉部位按最後模擬價計算的估值，尚未扣除未來平倉的手續費與交易稅。練習結束不代表已全部平倉。
              </p>
            </>
          ) : (
            <p className="mt-3 text-muted">結束時零庫存，沒有未平倉部位。</p>
          )}
        </section>
        <TradePlanReview bundle={bundle} />
        <section className="academy-card mt-7 p-5 sm:p-6" aria-labelledby="review-discipline-title">
          <div className="mb-5">
            <p className="academy-eyebrow">01 · 本盤條件檢核</p>
            <h2 id="review-discipline-title" className="mt-2 text-lg font-semibold">
              分開檢視操作與盈虧目標
            </h2>
            <p className="mt-2 text-base leading-7 text-muted">
              本課過關需達成列出的條件。單盤盈虧不能判定是否學會，請分別檢查操作紀律與成本。
            </p>
          </div>
          {bundle.verdicts.length ? (
            <ReviewConditions verdicts={bundle.verdicts} />
          ) : (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted">
              這份紀錄沒有課程條件評分，可從下方成交時間與價格進行復盤。
            </p>
          )}
          {bundle.fills.length === 0 ? (
            <p className="mt-4 text-base leading-7 text-muted">
              本盤沒有成交，條件達成不代表已完成買進或平倉操作。
            </p>
          ) : null}
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
                  onChange={(event) => {
                    setCode(event.target.value);
                    setChartPage(0);
                  }}
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
            <FillPages
              total={fills.length}
              page={chartPage}
              onChange={setChartPage}
              label="成交軌跡分頁"
            />
            <div className="mt-5 h-64 min-w-0 overflow-hidden sm:h-72">
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
                    labelFormatter={(value) => formatTime(Number(value))}
                    formatter={(value, name) => [
                      name === "時間" ? formatTime(Number(value)) : formatPrice(Number(value)),
                      name,
                    ]}
                    contentStyle={{
                      background: "var(--color-surface)",
                      color: "var(--color-fg)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                    }}
                  />
                  <Scatter
                    name="買進"
                    data={chartFills.filter((fill) => fill.side === "buy")}
                    fill="var(--color-up)"
                  />
                  <Scatter
                    name="賣出"
                    data={chartFills.filter((fill) => fill.side === "sell")}
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
          <div className="px-5 sm:px-6">
            <FillPages
              total={bundle.fills.length}
              page={tablePage}
              onChange={setTablePage}
              label="完整成交紀錄分頁"
            />
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
                  {tableFills.map((fill) => (
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
        {feedback}
        {!teacherView && (
          <PracticeGoalEditor
            scenarioId={rec.scenarioId}
            scenarioName={rec.scenarioName}
            onPractice={() => {
              useGame.getState().start(rec.scenarioId);
              void navigate({ to: "/" });
            }}
          />
        )}
        <ProvenanceMicro
          className="mt-5"
          text="資料來源為本次教室模擬操作。歷史行情與教室生成資料的組合不等於真實成交，模擬成果不代表實際交易結果。"
        />
      </div>
    </main>
  );
}

function FillPages({
  total,
  page,
  onChange,
  label,
}: {
  total: number;
  page: number;
  onChange: (page: number) => void;
  label: string;
}) {
  if (total <= FILLS_PER_PAGE) return null;
  const last = Math.ceil(total / FILLS_PER_PAGE) - 1;
  return (
    <nav aria-label={label} className="my-4 space-y-2 text-base leading-7">
      <p role="status" className="text-muted">
        第 {page * FILLS_PER_PAGE + 1}–{Math.min(total, (page + 1) * FILLS_PER_PAGE)} 筆，共 {total}{" "}
        筆（由新到舊）
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "最新一頁", target: 0, disabled: page === 0 },
          { label: "上一頁", target: page - 1, disabled: page === 0 },
          { label: "下一頁", target: page + 1, disabled: page === last },
          { label: "最早一頁", target: last, disabled: page === last },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={item.disabled}
            onClick={() => onChange(item.target)}
            className="min-h-12 whitespace-normal rounded-lg border border-border px-3 py-2 text-base disabled:opacity-40"
          >
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
