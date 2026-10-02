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
import { Button } from "@/components/ui/button";
import { ProvenanceMicro } from "@/components/provenance";
import { lessonById } from "@/lib/game/curriculum";
import { useGame } from "@/lib/game/store";
import type { ReviewBundle } from "@/lib/game/persist";
import { formatMoney, formatSigned, formatTime } from "@/lib/utils";

export function SessionReport({ bundle }: { bundle: ReviewBundle }) {
  const navigate = useNavigate();
  const rec = bundle.rec;
  const lesson = lessonById(rec.scenarioId);
  const codes = [...new Set(bundle.fills.map((fill) => fill.code))];
  const [code, setCode] = useState(bundle.code);
  const selected = codes.includes(code) ? code : codes[0];
  const fills = bundle.fills.filter((fill) => fill.code === selected);
  return (
    <main className="min-h-dvh bg-bg px-4 py-7 text-fg">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs tracking-widest text-muted">
          {lesson?.no || "自由練習"} · {bundle.sessionLabel}
        </p>
        <h1 className="mt-2 text-3xl">{rec.scenarioName} · 完整復盤</h1>
        <p className="mt-2 text-sm text-muted">
          {lesson
            ? rec.passed
              ? "本次已完成課程條件"
              : "本次仍有條件待練習"
            : "自由練習不評定課程通過"}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["模擬淨損益", formatSigned(rec.pnl, 0)],
            ["最大回撤", `${(rec.maxDrawdown * 100).toFixed(2)}%`],
            ["平倉次數", rec.trades],
            ["費稅", formatMoney(rec.fees, 0)],
          ].map(([label, value]) => (
            <div key={label} className="rounded border border-border bg-surface p-4">
              <p className="text-xs text-muted">{label}</p>
              <p className="mt-1 font-mono text-lg">{value}</p>
            </div>
          ))}
        </div>
        <section className="mt-5 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-base">紀律與過關條件</h2>
          {bundle.verdicts.length ? (
            <ul className="mt-3 space-y-3">
              {bundle.verdicts.map((verdict) => (
                <li key={verdict.rule.id} className="text-sm">
                  <span className={verdict.passed ? "text-down" : "text-up"}>
                    {verdict.passed ? "✓" : "✗"} {verdict.rule.label}
                  </span>
                  <p className="mt-1 text-xs text-muted">
                    {verdict.detail}
                    {verdict.at !== undefined ? ` · ${formatTime(verdict.at)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">這份紀錄沒有課程條件評分。</p>
          )}
          <p className="mt-4 text-xs text-muted">
            暫停中成交 {rec.pausedFills ?? 0}{" "}
            筆。這是模擬練習的自動檢核，講師仍需對照學員的進出場理由。
          </p>
        </section>
        {fills.length > 0 && (
          <section className="mt-5 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base">成交時間與價格</h2>
              <select
                aria-label="復盤標的"
                value={selected}
                onChange={(event) => setCode(event.target.value)}
                className="rounded border border-border bg-bg px-3 py-1 text-sm"
              >
                {codes.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </div>
            <p className="mt-2 text-xs text-muted">
              圖上僅呈現本次記錄的模擬成交點，紅色買進、綠色賣出。
            </p>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid stroke="#33455c" strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="time"
                    name="時間"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={formatTime}
                    tick={{ fill: "#8b9bb0", fontSize: 10 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="price"
                    name="價格"
                    domain={["auto", "auto"]}
                    tick={{ fill: "#8b9bb0", fontSize: 10 }}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    contentStyle={{ background: "#161d27", border: "1px solid #33455c" }}
                  />
                  <Scatter
                    name="買進"
                    data={fills.filter((fill) => fill.side === "buy")}
                    fill="#ff5c5c"
                  />
                  <Scatter
                    name="賣出"
                    data={fills.filter((fill) => fill.side === "sell")}
                    fill="#4dd6a0"
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}
        <section className="mt-5 overflow-x-auto rounded-lg border border-border bg-surface">
          <h2 className="p-4 text-base">完整成交紀錄</h2>
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead className="bg-header-2">
              <tr>
                {["時間", "代號", "買賣", "張數", "價格", "手續費", "稅", "暫停中成交"].map(
                  (label) => (
                    <th key={label} scope="col" className="px-3 py-2">
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {bundle.fills.map((fill) => (
                <tr key={fill.id} className="border-t border-border">
                  <td className="px-3 py-2">{formatTime(fill.time)}</td>
                  <td className="px-3 py-2">{fill.code}</td>
                  <td className="px-3 py-2">{fill.side === "buy" ? "買" : "賣"}</td>
                  <td className="px-3 py-2">{fill.lots}</td>
                  <td className="px-3 py-2">{fill.price}</td>
                  <td className="px-3 py-2">{fill.fee}</td>
                  <td className="px-3 py-2">{fill.tax}</td>
                  <td className="px-3 py-2">{fill.filledWhilePaused ? "是" : "否"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!bundle.fills.length && <p className="p-5 text-sm text-muted">本盤沒有成交。</p>}
        </section>
        {lesson && (
          <section className="mt-5 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-base">帶回課堂討論</h2>
            <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-muted">
              {lesson.review.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        )}
        <ProvenanceMicro
          className="mt-5"
          text="資料來源為本次教室模擬操作。歷史行情與教室生成資料的組合不等於真實成交，模擬成果不代表實際交易結果。"
        />
        <div className="mt-5 flex gap-3">
          <Button
            onClick={() => {
              useGame.getState().start(rec.scenarioId);
              void navigate({ to: "/" });
            }}
          >
            重練本課
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              useGame.getState().leave();
              void navigate({ to: "/" });
            }}
          >
            回大廳
          </Button>
        </div>
      </div>
    </main>
  );
}
