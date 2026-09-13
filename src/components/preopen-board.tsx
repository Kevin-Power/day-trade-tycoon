import { useMemo, useState } from "react";
import { UNIVERSE } from "@/lib/market/universe";
import { getMarketAdapter } from "@/lib/market/adapter";
import { stockDayFor } from "@/lib/market/real-paths";
import { formatPrice } from "@/lib/market/ticks";
import { cn } from "@/lib/utils";

type Row = {
  code: string;
  name: string;
  sectorLabel: string;
  prevClose: number;
  impliedOpen: number | null;
  changePct: number | null;
  hasData: boolean;
};

/**
 * 盤前 08:45 個股期。缺值不得填 0。
 * 教室沒有盤前逐筆時整列顯示「—／無盤前資料」，並排到表底。
 */
export function PreopenBoard() {
  const [open, setOpen] = useState(false);
  const meta = getMarketAdapter().snapshotMeta();

  const rows: Row[] = useMemo(() => {
    return UNIVERSE.map((s) => {
      const day = stockDayFor(s.code, "wed");
      // 沒有真實盤前報價就不填 0。教材週只有日 OHLC，開盤≠昨收才視為「有開盤參考」，
      // 仍標成無盤前資料——避免把缺值畫成平盤。
      void day;
      return {
        code: s.code,
        name: s.name,
        sectorLabel: s.sectorLabel,
        prevClose: s.refPrice,
        impliedOpen: null,
        changePct: null,
        hasData: false,
      };
    }).sort((a, b) => Number(b.hasData) - Number(a.hasData) || a.code.localeCompare(b.code));
  }, []);

  const n = rows.filter((r) => r.hasData).length;
  const thin = n < 10;

  return (
    <section className="mb-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-end justify-between gap-3 text-left"
      >
        <div>
          <h2 className="text-sm font-medium tracking-wide">
            {thin ? "本日盤前資料不足" : "盤前 08:45 個股期"}
          </h2>
          <p className="mt-1 text-micro text-muted">
            {n}/{rows.length} 檔有盤前資料 · {meta.disclaimer}
          </p>
        </div>
        <span className="text-micro text-subtle">{open || !thin ? (open ? "收合" : "展開") : "展開看表"}</span>
      </button>
      {(open || !thin) && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[36rem] text-left font-mono text-xs">
            <thead className="bg-header-2 text-fg">
              <tr>
                <th className="px-3 py-2 font-medium">代號</th>
                <th className="px-3 py-2 font-medium">名稱</th>
                <th className="px-3 py-2 font-medium">族群</th>
                <th className="px-3 py-2 font-medium">昨收</th>
                <th className="px-3 py-2 font-medium">現貨將開</th>
                <th className="px-3 py-2 font-medium">盤前%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className="border-t border-border">
                  <td className="px-3 py-1.5 tabular">{r.code}</td>
                  <td className="px-3 py-1.5 font-sans">{r.name}</td>
                  <td className="px-3 py-1.5 font-sans text-muted">{r.sectorLabel}</td>
                  <td className="px-3 py-1.5 tabular">{formatPrice(r.prevClose)}</td>
                  {r.hasData ? (
                    <>
                      <td className="px-3 py-1.5 tabular">{formatPrice(r.impliedOpen ?? 0)}</td>
                      <td className="px-3 py-1.5 tabular">{(r.changePct ?? 0).toFixed(2)}%</td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-1.5 text-subtle">—</td>
                      <td className="px-3 py-1.5 font-sans text-subtle">無盤前資料</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
