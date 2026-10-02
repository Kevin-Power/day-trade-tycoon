import { Button } from "@/components/ui/button";
import { useRef, useState, type ReactNode } from "react";
import { ClassroomSimMark, ProvenanceBadge, ProvenanceMicro } from "@/components/provenance";
import { toneClass } from "@/components/signed";
import { useGame } from "@/lib/game/store";
import { blotterMicro } from "@/lib/provenance";
import { formatPrice } from "@/lib/market/ticks";
import { cn, formatLots, formatMoney, formatSigned, formatTime } from "@/lib/utils";

export function PositionsDock() {
  const engine = useGame((s) => s.engine);
  const tab = useGame((s) => s.rightTab);
  const setTab = useGame((s) => s.setRightTab);
  const select = useGame((s) => s.select);
  const setMobileTab = useGame((s) => s.setMobileTab);
  const flattenAll = useGame((s) => s.flattenAll);
  const cancelOrder = useGame((s) => s.cancelOrder);
  const frame = useGame((s) => s.frame);
  const [fillPage, setFillPage] = useState(0);
  const orderTabRef = useRef<HTMLButtonElement>(null);
  void frame;
  if (!engine) return null;
  const pos = engine.openPositions();
  const orders = engine.orders.filter((o) => o.status === "pending" || o.status === "partial");
  const fills = engine.fills;
  const fillPageSize = 20;
  const fillPageCount = Math.max(1, Math.ceil(fills.length / fillPageSize));
  const currentFillPage = Math.min(fillPage, fillPageCount - 1);
  const visibleFills = fills.slice(
    currentFillPage * fillPageSize,
    (currentFillPage + 1) * fillPageSize,
  );

  return (
    <div className="term-scroll h-full min-h-0 overflow-y-auto bg-bg lg:flex lg:flex-col lg:overflow-hidden">
      <div className="pane-title flex shrink-0 flex-wrap items-center gap-2 p-2 lg:gap-1 lg:px-1 lg:py-1">
        <div
          role="group"
          aria-label="查看委託、成交或庫存"
          className="grid w-full grid-cols-3 gap-2 lg:flex lg:w-auto lg:gap-1"
        >
          {(
            [
              ["orders", `委託 ${orders.length}`],
              ["fills", `成交 ${fills.length}`],
              ["pos", `庫存 ${pos.length}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              ref={id === "orders" ? orderTabRef : undefined}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={cn(
                "min-h-12 min-w-0 rounded-lg px-2 py-2 text-base leading-6 lg:min-h-6 lg:rounded-xs lg:py-0 lg:text-micro",
                tab === id ? "bg-header-2 text-fg" : "text-fg/70 hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <ClassroomSimMark />
          <ProvenanceBadge kind="classroom" />
        </div>
        <Button
          size="xs"
          variant="outline"
          className="h-auto min-h-12 whitespace-normal px-3 py-2 text-base lg:min-h-7 lg:px-2 lg:py-0 lg:text-micro"
          onClick={flattenAll}
          disabled={pos.length === 0}
        >
          全部平倉
        </Button>
      </div>
      <ProvenanceMicro text={blotterMicro()} />
      <div className="term-scroll lg:min-h-0 lg:flex-1 lg:overflow-auto">
        {tab === "fills" && fills.length > fillPageSize ? (
          <nav
            aria-label="成交紀錄分頁"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3 text-base lg:text-sm"
          >
            <p className="w-full text-muted">
              共 {fills.length} 筆，顯示第 {currentFillPage * fillPageSize + 1}–
              {Math.min((currentFillPage + 1) * fillPageSize, fills.length)}{" "}
              筆。暫停後翻頁，較容易核對。
            </p>
            <button
              type="button"
              disabled={currentFillPage === 0}
              onClick={() => setFillPage(currentFillPage - 1)}
              className="min-h-12 rounded-lg border border-border px-4 py-2 disabled:opacity-40"
            >
              較新成交
            </button>
            <span>
              第 {currentFillPage + 1} / {fillPageCount} 頁
            </span>
            <button
              type="button"
              disabled={currentFillPage === fillPageCount - 1}
              onClick={() => setFillPage(currentFillPage + 1)}
              className="min-h-12 rounded-lg border border-border px-4 py-2 disabled:opacity-40"
            >
              較早成交
            </button>
          </nav>
        ) : null}
        <div className="space-y-3 p-3 text-base leading-7 lg:hidden">
          {tab === "pos" ? (
            <>
              <p className="text-muted">
                庫存是目前還沒結清的部位。平倉後，請再確認張數與成交紀錄。
              </p>
              {pos.length === 0 ? (
                <EmptyRecords
                  title="目前沒有庫存"
                  body="若剛送出委託，先到「委託」和「成交」確認狀態；沒有庫存不代表委託沒有送出。"
                />
              ) : null}
              {pos.map((p) => (
                <RecordCard
                  key={p.code}
                  title={`${p.code} ${p.name}`}
                  status={p.lots > 0 ? "買進持有" : "先賣待回補"}
                >
                  <RecordValue label="手上張數" value={`${formatLots(Math.abs(p.lots))} 張`} />
                  <RecordValue label="平均成交價" value={formatPrice(p.avg)} />
                  <RecordValue label="目前模擬價" value={formatPrice(p.last)} />
                  <RecordValue label="未實現損益" value={formatSigned(p.uPnl, 0)} tone={p.uPnl} />
                  <p className="mt-2 text-sm leading-6 text-muted">
                    未實現損益按目前價格估算，尚未扣除平倉費稅。
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      select(p.code);
                      setMobileTab("trade");
                      document.getElementById("mobile-tab-trade")?.focus();
                    }}
                    className="mt-3 min-h-12 w-full rounded-lg border border-border-strong px-3 py-2 text-base font-medium"
                  >
                    查看此商品的下單頁
                  </button>
                </RecordCard>
              ))}
            </>
          ) : null}
          {tab === "orders" ? (
            <>
              <p className="text-muted">
                這裡列出尚未全部成交的委託。取消只會撤掉未成交部分，已成交部分仍會保留。
              </p>
              {orders.length === 0 ? (
                <EmptyRecords
                  title="沒有等待成交的委託"
                  body="已成交的單請到「成交」查看；取消委託不會移除已成交紀錄。"
                />
              ) : null}
              {orders.map((o) => (
                <RecordCard
                  key={o.id}
                  title={`${o.code} ${engine.quote(o.code)?.name ?? ""}`}
                  status={o.status === "partial" ? "部分成交" : "等待成交"}
                >
                  <RecordValue label="送出時間" value={formatTime(o.time)} />
                  <RecordValue label="方向" value={o.side === "buy" ? "買進" : "賣出"} />
                  <RecordValue
                    label="委託價格"
                    value={o.type === "market" ? "市價" : formatPrice(o.price)}
                  />
                  <RecordValue label="原委託張數" value={`${formatLots(o.lots)} 張`} />
                  <RecordValue label="已成交" value={`${formatLots(o.filled)} 張`} />
                  <RecordValue label="尚待成交" value={`${formatLots(o.lots - o.filled)} 張`} />
                  <button
                    type="button"
                    onClick={() => {
                      cancelOrder(o.id);
                      orderTabRef.current?.focus();
                    }}
                    aria-label={`取消 ${o.code} ${formatTime(o.time)} 的未成交部分`}
                    className="mt-3 min-h-12 w-full rounded-lg border border-border-strong px-3 py-2 text-base font-medium"
                  >
                    取消未成交部分
                  </button>
                </RecordCard>
              ))}
            </>
          ) : null}
          {tab === "fills" ? (
            <>
              <p className="text-muted">
                這裡列出已成交的紀錄，最新一筆在最上方。一筆委託可能分成多筆成交。
              </p>
              {fills.length === 0 ? (
                <EmptyRecords
                  title="目前沒有成交紀錄"
                  body="送出委託後，要等模擬撮合才會出現成交。先到「委託」確認原本那一筆，避免重複送單。"
                />
              ) : null}
              {visibleFills.map((f) => (
                <RecordCard
                  key={f.id}
                  title={`${f.code} ${engine.quote(f.code)?.name ?? ""}`}
                  status={f.side === "buy" ? "買進已成交" : "賣出已成交"}
                >
                  <RecordValue label="成交時間" value={formatTime(f.time)} />
                  <RecordValue label="成交價格" value={formatPrice(f.price)} />
                  <RecordValue label="本筆成交" value={`${formatLots(f.lots)} 張`} />
                  <RecordValue label="手續費" value={`${formatMoney(f.fee)} 元`} />
                  <RecordValue label="交易稅" value={`${formatMoney(f.tax)} 元`} />
                  {f.filledWhilePaused ? (
                    <p className="mt-2 text-sm text-muted">本筆在模擬暫停時成交。</p>
                  ) : null}
                </RecordCard>
              ))}
            </>
          ) : null}
        </div>
        <div className="hidden lg:block">
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
                    <td className={cn("px-2 py-1 tabular", toneClass(p.uPnl))}>
                      {formatSigned(p.uPnl, 0)}
                    </td>
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
                    <td className="px-2 py-1 tabular">
                      {o.type === "market" ? "市價" : formatPrice(o.price)}
                    </td>
                    <td className="px-2 py-1 tabular">
                      {o.filled}/{o.lots}
                    </td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        className="text-muted hover:text-fg"
                        onClick={() => {
                          cancelOrder(o.id);
                          orderTabRef.current?.focus();
                        }}
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
                {visibleFills.map((f) => (
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
    </div>
  );
}

function RecordCard({
  title,
  status,
  children,
}: {
  title: string;
  status: string;
  children: ReactNode;
}) {
  return (
    <article className="min-w-0 rounded-xl border border-border bg-surface p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="rounded-md bg-brand/10 px-2 py-1 text-base font-medium text-brand">
          {status}
        </p>
      </header>
      {children}
    </article>
  );
}

function RecordValue({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <dl className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-b border-border/70 py-2 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd
        className={cn("font-mono tabular-nums", tone !== undefined ? toneClass(tone) : "text-fg")}
      >
        {value}
      </dd>
    </dl>
  );
}

function EmptyRecords({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border-strong bg-surface p-4">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-base leading-7 text-muted">{body}</p>
    </div>
  );
}
