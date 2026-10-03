import type { SwingHighResult } from "@/lib/market/swing-highs";
import { formatPrice } from "@/lib/market/ticks";
import { formatTime } from "@/lib/utils";

/** Labels describe observed one-minute highs, never an instruction to trade. */
export function SwingHighSummary({ data, visibleStart }: { data: SwingHighResult; visibleStart: number }) {
  const previous = data.confirmed.length === 2 ? data.confirmed[0] : undefined;
  const recent = data.confirmed.at(-1);
  const comparison = data.comparison === "higher" ? "後高高於前高"
    : data.comparison === "lower" ? "後高低於前高"
      : data.comparison === "equal" ? "前後高相同" : "等待兩個已確認高點";
  return (
    <section aria-label="江波圖前後高比較" className="shrink-0 border-t border-border bg-surface px-3 py-2 text-sm leading-relaxed">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="font-semibold text-fg">前後高比較 · 1 分 K</h3>
        <p className="font-medium text-fg">{comparison}</p>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2">
        {[
          { title: "① 前高", point: previous },
          { title: data.confirmed.length === 1 ? "首個已確認高點" : "② 後高", point: recent },
        ].map(({ title, point }) => (
          <div key={title} className="min-w-0 rounded-md border border-border px-2 py-1">
            <dt className="text-muted">{title}</dt>
            <dd className="flex flex-wrap items-baseline gap-x-2 font-mono text-base text-fg">
              {point ? <><strong>{formatPrice(point.p)}</strong><span className="text-sm">{formatTime(point.t).slice(0, 5)}</span></> : "等待確認"}
            </dd>
            {point && <dd className="text-muted">{formatTime(point.confirmedAt).slice(0, 5)} 確認{point.t < visibleStart ? " · 圖外" : ""}</dd>}
          </div>
        ))}
      </dl>
      <p className="mt-1 break-words text-muted">
        {data.candidate
          ? `觀察高點 ${formatPrice(data.candidate.p)}（${formatTime(data.candidate.t).slice(0, 5)}），尚未確認。`
          : "目前沒有新的觀察高點。"}
      </p>
      <details className="mt-1 text-muted">
        <summary className="min-h-10 cursor-pointer py-2">高點如何確認</summary>
        <p className="pb-2">本課內，左右各 2 根已完成的 1 分鐘 K 線高價都較低，才確認中間高點；等高平台不確認。觀察高點也只用已完成 K 線。①②標示該分鐘的高價區間，不是精確成交秒數；高低比較不代表買賣訊號。</p>
      </details>
    </section>
  );
}
