import { Button } from "@/components/ui/button";
import { toneClass } from "@/components/signed";
import { PaneTab, PaneTitle } from "@/components/ui/pane";
import { useGame } from "@/lib/game/store";
import { formatPrice } from "@/lib/market/ticks";
import { cn, formatLots, formatMoney, formatSigned, formatTime } from "@/lib/utils";

const TH = "whitespace-nowrap px-2 py-1 text-right font-medium";
const TD = "whitespace-nowrap px-2 py-[3px] text-right tabular";

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
  const unrealized = pos.reduce((sum, p) => sum + p.uPnl, 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <PaneTitle>
        {(
          [
            ["orders", "委託", orders.length],
            ["fills", "成交", fills.length],
            ["pos", "庫存", pos.length],
          ] as const
        ).map(([id, label, n]) => (
          <PaneTab key={id} active={tab === id} onClick={() => setTab(id)}>
            {label}
            <span className={cn("ml-1 font-mono tabular", n > 0 ? "text-fg" : "text-fg/50")}>
              {n}
            </span>
          </PaneTab>
        ))}
        {pos.length > 0 && (
          <span className="ml-2 hidden font-mono text-micro tabular sm:inline">
            <span className="text-fg/70">未實現 </span>
            <span className={toneClass(unrealized)}>{formatSigned(unrealized, 0)}</span>
          </span>
        )}
        <div className="flex-1" />
        <Button size="xs" variant="outline" onClick={flattenAll} disabled={pos.length === 0}>
          全部平倉
        </Button>
      </PaneTitle>
      <div className="term-scroll min-h-0 flex-1 overflow-auto">
        {tab === "pos" && (
          <table className="w-full border-collapse font-mono text-micro">
            <thead className="sticky top-0 z-10 bg-surface-2 text-2xs text-muted shadow-[inset_0_-1px_0_var(--color-border-strong)]">
              <tr>
                <th className={cn(TH, "text-left")}>商品</th>
                <th className={TH}>買賣</th>
                <th className={TH}>張數</th>
                <th className={TH}>均價</th>
                <th className={TH}>現價</th>
                <th className={TH}>未實現</th>
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
                  className="cursor-pointer border-b border-border/70 transition-colors hover:bg-elevated"
                >
                  <td className={cn(TD, "text-left")}>
                    <span className="text-muted">{p.code}</span>{" "}
                    <span className="font-sans text-xs">{p.name}</span>
                  </td>
                  <td className={cn(TD, p.lots > 0 ? "text-up" : "text-down")}>
                    {p.lots > 0 ? "買" : "賣"}
                  </td>
                  <td className={cn(TD, p.lots > 0 ? "text-up" : "text-down")}>
                    {p.lots > 0 ? "+" : ""}
                    {formatLots(p.lots)}
                  </td>
                  <td className={TD}>{formatPrice(p.avg)}</td>
                  <td className={TD}>{formatPrice(p.last)}</td>
                  <td className={cn(TD, "font-medium", toneClass(p.uPnl))}>
                    {formatSigned(p.uPnl, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "orders" && (
          <table className="w-full border-collapse font-mono text-micro">
            <thead className="sticky top-0 z-10 bg-surface-2 text-2xs text-muted shadow-[inset_0_-1px_0_var(--color-border-strong)]">
              <tr>
                <th className={cn(TH, "text-left")}>時間</th>
                <th className={TH}>買賣</th>
                <th className={cn(TH, "text-left")}>商品</th>
                <th className={TH}>價格</th>
                <th className={TH}>成交/委託</th>
                <th className={TH} />
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
                  <td className={cn(TD, "text-left text-muted")}>{formatTime(o.time)}</td>
                  <td className={cn(TD, o.side === "buy" ? "text-up" : "text-down")}>
                    {o.side === "buy" ? "買" : "賣"}
                  </td>
                  <td className={cn(TD, "text-left")}>{o.code}</td>
                  <td className={TD}>{o.type === "market" ? "市價" : formatPrice(o.price)}</td>
                  <td className={TD}>
                    {o.filled}/{o.lots}
                  </td>
                  <td className={TD}>
                    <button
                      type="button"
                      className="rounded-xs border border-border px-1.5 py-px text-2xs text-muted transition-colors hover:border-up hover:text-up"
                      onClick={() => cancelOrder(o.id)}
                    >
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
            <thead className="sticky top-0 z-10 bg-surface-2 text-2xs text-muted shadow-[inset_0_-1px_0_var(--color-border-strong)]">
              <tr>
                <th className={cn(TH, "text-left")}>時間</th>
                <th className={TH}>買賣</th>
                <th className={cn(TH, "text-left")}>商品</th>
                <th className={TH}>價格</th>
                <th className={TH}>張</th>
                <th className={TH}>費稅</th>
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
                  <td className={cn(TD, "text-left text-muted")}>{formatTime(f.time)}</td>
                  <td className={cn(TD, f.side === "buy" ? "text-up" : "text-down")}>
                    {f.side === "buy" ? "買" : "賣"}
                  </td>
                  <td className={cn(TD, "text-left")}>{f.code}</td>
                  <td className={TD}>{formatPrice(f.price)}</td>
                  <td className={TD}>{f.lots}</td>
                  <td className={cn(TD, "text-muted")}>{formatMoney(f.fee + f.tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
