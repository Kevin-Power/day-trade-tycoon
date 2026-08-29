import { Button } from "@/components/ui/button";
import { toneClass } from "@/components/signed";
import { useGame } from "@/lib/game/store";
import { formatPrice } from "@/lib/market/ticks";
import { cn, formatLots, formatMoney, formatSigned, formatTime } from "@/lib/utils";

export function PositionsDock() {
  const engine = useGame((s) => s.engine);
  const tab = useGame((s) => s.rightTab);
  const setTab = useGame((s) => s.setRightTab);
  const select = useGame((s) => s.select);
  const flattenAll = useGame((s) => s.flattenAll);
  const cancelOrder = useGame((s) => s.cancelOrder);
  const frame = useGame((s) => s.frame);
  void frame;
  if (!engine) return null;
  const pos = engine.openPositions();
  const orders = engine.orders.filter((o) => o.status === "pending" || o.status === "partial");
  const fills = engine.fills;

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="pane-title flex h-7 items-center gap-1 px-1">
        {(
          [
            ["orders", `委託 ${orders.length}`],
            ["fills", `成交 ${fills.length}`],
            ["pos", `庫存 ${pos.length}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "h-6 rounded-xs px-2 text-micro",
              tab === id ? "bg-header-2 text-fg" : "text-fg/70 hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <Button size="xs" variant="outline" onClick={flattenAll} disabled={pos.length === 0}>
          全部平倉
        </Button>
      </div>
      <div className="term-scroll min-h-0 flex-1 overflow-auto">
        {tab === "pos" && (
          <table className="w-full border-collapse font-mono text-micro">
            <thead className="sticky top-0 bg-surface-2 text-muted">
              <tr>
                {["商品", "買賣", "張數", "均價", "現價", "未實現"].map((h) => (
                  <th key={h} className="px-2 py-1 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pos.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-muted">
                    尚無庫存。買進或先賣都會出現在這裡。
                  </td>
                </tr>
              )}
              {pos.map((p) => (
                <tr
                  key={p.code}
                  onClick={() => select(p.code)}
                  className="cursor-pointer border-b border-border/70 hover:bg-elevated"
                >
                  <td className="px-2 py-1">
                    {p.code} {p.name}
                  </td>
                  <td className={cn("px-2 py-1", p.lots > 0 ? "text-up" : "text-down")}>
                    {p.lots > 0 ? "買" : "賣"}
                  </td>
                  <td className={cn("px-2 py-1 tabular", p.lots > 0 ? "text-up" : "text-down")}>
                    {p.lots > 0 ? "+" : ""}
                    {formatLots(p.lots)}
                  </td>
                  <td className="px-2 py-1 tabular">{formatPrice(p.avg)}</td>
                  <td className="px-2 py-1 tabular">{formatPrice(p.last)}</td>
                  <td className={cn("px-2 py-1 tabular", toneClass(p.uPnl))}>{formatSigned(p.uPnl, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "orders" && (
          <table className="w-full border-collapse font-mono text-micro">
            <thead className="sticky top-0 bg-surface-2 text-muted">
              <tr>
                {["時間", "買賣", "商品", "價格", "量", ""].map((h) => (
                  <th key={h} className="px-2 py-1 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-muted">
                    沒有未成交委託
                  </td>
                </tr>
              )}
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-border/70">
                  <td className="px-2 py-1 tabular text-muted">{formatTime(o.time)}</td>
                  <td className={cn("px-2 py-1", o.side === "buy" ? "text-up" : "text-down")}>
                    {o.side === "buy" ? "買" : "賣"}
                  </td>
                  <td className="px-2 py-1">{o.code}</td>
                  <td className="px-2 py-1 tabular">{o.type === "market" ? "市價" : formatPrice(o.price)}</td>
                  <td className="px-2 py-1 tabular">
                    {o.filled}/{o.lots}
                  </td>
                  <td className="px-2 py-1">
                    <button type="button" className="text-muted hover:text-fg" onClick={() => cancelOrder(o.id)}>
                      刪單
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "fills" && (
          <table className="w-full border-collapse font-mono text-micro">
            <thead className="sticky top-0 bg-surface-2 text-muted">
              <tr>
                {["時間", "買賣", "商品", "價格", "張", "費稅"].map((h) => (
                  <th key={h} className="px-2 py-1 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fills.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-muted">
                    尚無成交
                  </td>
                </tr>
              )}
              {fills.map((f) => (
                <tr key={f.id} className="border-b border-border/70">
                  <td className="px-2 py-1 tabular text-muted">{formatTime(f.time)}</td>
                  <td className={cn("px-2 py-1", f.side === "buy" ? "text-up" : "text-down")}>
                    {f.side === "buy" ? "買" : "賣"}
                  </td>
                  <td className="px-2 py-1">{f.code}</td>
                  <td className="px-2 py-1 tabular">{formatPrice(f.price)}</td>
                  <td className="px-2 py-1 tabular">{f.lots}</td>
                  <td className="px-2 py-1 tabular text-muted">{formatMoney(f.fee + f.tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
