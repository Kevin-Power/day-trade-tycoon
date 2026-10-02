import { Button } from "@/components/ui/button";
import { useRef, useState, type ReactNode } from "react";
import { ClassroomSimMark, ProvenanceBadge, ProvenanceMicro } from "@/components/provenance";
import { toneClass } from "@/components/signed";
import { useGame } from "@/lib/game/store";
import { orderPresentation } from "@/lib/game/order-presentation";
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
  const orderScope = useGame((s) => s.orderScope);
  const setOrderScope = useGame((s) => s.setOrderScope);
  const orderPage = useGame((s) => s.orderPage);
  const setOrderPage = useGame((s) => s.setOrderPage);
  const frame = useGame((s) => s.frame);
  const [fillPage, setFillPage] = useState(0);
  const orderTabRef = useRef<HTMLButtonElement>(null);
  const allOrdersRef = useRef<HTMLButtonElement>(null);
  void frame;
  if (!engine) return null;
  const pos = engine.openPositions();
  const workingOrders = engine.orders.filter(
    (o) => o.status === "pending" || o.status === "partial",
  );
  const orders = orderScope === "all" ? engine.orders : workingOrders;
  const orderPageSize = 20;
  const orderPageCount = Math.max(1, Math.ceil(orders.length / orderPageSize));
  const currentOrderPage = Math.min(orderPage, orderPageCount - 1);
  const visibleOrders = orders.slice(
    currentOrderPage * orderPageSize,
    (currentOrderPage + 1) * orderPageSize,
  );
  const fills = engine.fills;
  const fillPageSize = 20;
  const fillPageCount = Math.max(1, Math.ceil(fills.length / fillPageSize));
  const currentFillPage = Math.min(fillPage, fillPageCount - 1);
  const visibleFills = fills.slice(
    currentFillPage * fillPageSize,
    (currentFillPage + 1) * fillPageSize,
  );

  function showOriginalOrder(orderId: string) {
    const index = engine!.orders.findIndex((order) => order.id === orderId);
    if (index < 0) return;
    setOrderScope("all");
    setOrderPage(Math.floor(index / orderPageSize));
    setTab("orders");
    requestAnimationFrame(() => allOrdersRef.current?.focus());
  }

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
              ["orders", `委託 ${workingOrders.length}`],
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
      <p className="border-b border-border px-3 py-2 text-sm leading-6 text-muted-foreground lg:text-xs">
        全部平倉會先取消所有待單，再依可用五檔成交；量不足時仍會留下庫存，請核對剩餘張數。
      </p>
      <div className="term-scroll lg:min-h-0 lg:flex-1 lg:overflow-auto">
        {tab === "orders" ? (
          <div className="space-y-3 border-b border-border p-3 text-base leading-7 lg:text-sm">
            <div role="group" aria-label="委託顯示範圍" className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={orderScope === "working"}
                onClick={() => setOrderScope("working")}
                className={cn(
                  "min-h-12 min-w-0 rounded-lg border border-border px-2 py-2",
                  orderScope === "working" && "bg-brand/10 font-semibold text-brand",
                )}
              >
                等待成交 {workingOrders.length}
              </button>
              <button
                ref={allOrdersRef}
                type="button"
                aria-pressed={orderScope === "all"}
                onClick={() => setOrderScope("all")}
                className={cn(
                  "min-h-12 min-w-0 rounded-lg border border-border px-2 py-2",
                  orderScope === "all" && "bg-brand/10 font-semibold text-brand",
                )}
              >
                本盤全部委託 {engine.orders.length}
              </button>
            </div>
            <p className="text-muted">
              {orderScope === "all"
                ? "本盤委託由新到舊，包含已成交與已取消的紀錄。"
                : "這裡只列出仍在等待成交的委託。"}
              取消只撤掉未成交部分；已成交的張數會保留，可用委託編號到「成交」核對。
            </p>
            {orders.length > orderPageSize ? (
              <nav
                aria-label="委託紀錄分頁"
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <p className="w-full text-muted">
                  共 {orders.length} 筆，顯示第 {currentOrderPage * orderPageSize + 1}–
                  {Math.min((currentOrderPage + 1) * orderPageSize, orders.length)}{" "}
                  筆。暫停後翻頁，較容易核對。
                </p>
                <button
                  type="button"
                  disabled={currentOrderPage === 0}
                  onClick={() => setOrderPage(currentOrderPage - 1)}
                  className="min-h-12 rounded-lg border border-border px-3 py-2 disabled:opacity-40"
                >
                  較新委託
                </button>
                <span>
                  第 {currentOrderPage + 1} / {orderPageCount} 頁
                </span>
                <button
                  type="button"
                  disabled={currentOrderPage === orderPageCount - 1}
                  onClick={() => setOrderPage(currentOrderPage + 1)}
                  className="min-h-12 rounded-lg border border-border px-3 py-2 disabled:opacity-40"
                >
                  較早委託
                </button>
              </nav>
            ) : null}
          </div>
        ) : null}
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
              {orders.length === 0 ? (
                <EmptyRecords
                  title={orderScope === "all" ? "本盤還沒有委託紀錄" : "沒有等待成交的委託"}
                  body={
                    orderScope === "all"
                      ? "送出模擬委託後，這裡會保留本盤的委託結果。"
                      : "請切到「本盤全部委託」查核已成交或已取消的原委託；沒有等待成交的單不代表沒有庫存。"
                  }
                />
              ) : null}
              {visibleOrders.map((o) => {
                const presentation = orderPresentation(o);
                return (
                  <RecordCard
                    key={o.id}
                    title={`${o.code} ${engine.quote(o.code)?.name ?? ""}`}
                    status={presentation.statusLabel}
                  >
                    <RecordValue label="委託編號" value={o.id} />
                    <RecordValue label="送出時間" value={formatTime(o.time)} />
                    <RecordValue label="方向" value={o.side === "buy" ? "買進" : "賣出"} />
                    <RecordValue label="委託效期" value={o.tif ?? "ROD"} />
                    <RecordValue
                      label="委託價格"
                      value={o.type === "market" ? "市價" : formatPrice(o.price)}
                    />
                    <RecordValue label="原委託張數" value={`${formatLots(o.lots)} 張`} />
                    <RecordValue label="已成交" value={`${formatLots(o.filled)} 張`} />
                    <RecordValue
                      label="尚待成交"
                      value={`${formatLots(presentation.waitingLots)} 張`}
                    />
                    <RecordValue
                      label="已取消"
                      value={`${formatLots(presentation.cancelledLots)} 張`}
                    />
                    {o.cancelReason ? (
                      <p className="mt-2 break-words text-muted">取消原因：{o.cancelReason}</p>
                    ) : null}
                    {presentation.working ? (
                      <button
                        type="button"
                        onClick={() => {
                          cancelOrder(o.id);
                          orderTabRef.current?.focus();
                        }}
                        aria-label={`取消委託 ${o.id}，${o.code} 的未成交部分`}
                        className="mt-3 min-h-12 w-full rounded-lg border border-border-strong px-3 py-2 text-base font-medium"
                      >
                        取消未成交部分
                      </button>
                    ) : null}
                  </RecordCard>
                );
              })}
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
                  <RecordValue label="對應委託" value={f.orderId} />
                  <RecordValue label="成交時間" value={formatTime(f.time)} />
                  <RecordValue label="成交價格" value={formatPrice(f.price)} />
                  <RecordValue label="本筆成交" value={`${formatLots(f.lots)} 張`} />
                  <RecordValue label="手續費" value={`${formatMoney(f.fee)} 元`} />
                  <RecordValue label="交易稅" value={`${formatMoney(f.tax)} 元`} />
                  {f.filledWhilePaused ? (
                    <p className="mt-2 text-sm text-muted">本筆在模擬暫停時成交。</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => showOriginalOrder(f.orderId)}
                    className="mt-3 min-h-12 w-full rounded-lg border border-border-strong px-3 py-2 text-base font-medium"
                  >
                    查看原委託 {f.orderId}
                  </button>
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
                  {[
                    "委託／商品",
                    "方向／時間",
                    "價格／效期",
                    "已成交／原量",
                    "等待／取消",
                    "狀態／操作",
                  ].map((h) => (
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
                      {orderScope === "all"
                        ? "本盤還沒有委託紀錄"
                        : "沒有等待成交的委託；可切到「本盤全部委託」核對歷程。"}
                    </td>
                  </tr>
                )}
                {visibleOrders.map((o) => {
                  const presentation = orderPresentation(o);
                  return (
                    <tr key={o.id} className="border-b border-border/70">
                      <td className="px-2 py-2">
                        <div className="font-semibold">{o.id}</div>
                        <div>{o.code}</div>
                      </td>
                      <td className={cn("px-2 py-1", o.side === "buy" ? "text-up" : "text-down")}>
                        <div>{o.side === "buy" ? "買進" : "賣出"}</div>
                        <div className="tabular text-muted">{formatTime(o.time)}</div>
                      </td>
                      <td className="px-2 py-1 tabular">
                        <div>{o.type === "market" ? "市價" : formatPrice(o.price)}</div>
                        <div className="text-muted">{o.tif ?? "ROD"}</div>
                      </td>
                      <td className="px-2 py-1 tabular">
                        <div>已成 {formatLots(o.filled)} 張</div>
                        <div className="text-muted">原量 {formatLots(o.lots)} 張</div>
                      </td>
                      <td className="px-2 py-1 tabular">
                        <div>等待 {formatLots(presentation.waitingLots)} 張</div>
                        <div className="text-muted">
                          取消 {formatLots(presentation.cancelledLots)} 張
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <p>{presentation.statusLabel}</p>
                        {o.cancelReason ? (
                          <p className="mt-1 break-words text-muted">取消原因：{o.cancelReason}</p>
                        ) : null}
                        {presentation.working ? (
                          <button
                            type="button"
                            aria-label={`取消委託 ${o.id}，${o.code} 的未成交部分`}
                            className="mt-1 min-h-8 rounded border border-border px-2 text-fg hover:bg-elevated"
                            onClick={() => {
                              cancelOrder(o.id);
                              orderTabRef.current?.focus();
                            }}
                          >
                            取消未成交
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {tab === "fills" && (
            <table className="w-full border-collapse font-mono text-micro">
              <thead className="sticky top-0 bg-surface-2 text-muted">
                <tr>
                  {["委託／時間", "買賣", "商品", "價格", "張", "費稅"].map((h) => (
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
                    <td className="px-2 py-1 tabular text-muted">
                      <button
                        type="button"
                        onClick={() => showOriginalOrder(f.orderId)}
                        aria-label={`查看原委託 ${f.orderId}`}
                        className="min-h-8 rounded border border-border px-2 font-semibold text-brand hover:bg-elevated"
                      >
                        {f.orderId}
                      </button>
                      <div>{formatTime(f.time)}</div>
                    </td>
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
