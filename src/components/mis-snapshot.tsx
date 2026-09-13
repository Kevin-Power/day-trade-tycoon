import { useState } from "react";
import { getMarketAdapter } from "@/lib/market/adapter";
import { UNIVERSE } from "@/lib/market/universe";
import { formatPrice } from "@/lib/market/ticks";

export function MisSnapshot() {
  const [open, setOpen] = useState(false);
  const meta = getMarketAdapter().snapshotMeta();
  return (
    <section className="mb-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-end justify-between gap-3 text-left"
      >
        <div>
          <h2 className="text-sm font-medium tracking-wide">證交所 MIS 五檔快照</h2>
          <p className="mt-1 text-micro text-muted">
            {meta.asOf} · {meta.label}
          </p>
        </div>
        <span className="text-micro text-subtle">{open ? "收合" : "展開"}</span>
      </button>
      {open && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <p className="border-b border-border px-3 py-2 text-micro text-subtle">{meta.disclaimer}</p>
          <table className="w-full min-w-[28rem] text-left font-mono text-xs">
            <thead className="bg-header-2 text-fg">
              <tr>
                <th className="px-3 py-2 font-medium">代號</th>
                <th className="px-3 py-2 font-medium">名稱</th>
                <th className="px-3 py-2 font-medium">族群</th>
                <th className="px-3 py-2 font-medium">昨收／快照</th>
              </tr>
            </thead>
            <tbody>
              {UNIVERSE.map((s) => (
                <tr key={s.code} className="border-t border-border">
                  <td className="px-3 py-1.5 tabular">{s.code}</td>
                  <td className="px-3 py-1.5">{s.name}</td>
                  <td className="px-3 py-1.5 text-muted">{s.sectorLabel}</td>
                  <td className="px-3 py-1.5 tabular">{formatPrice(s.refPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
