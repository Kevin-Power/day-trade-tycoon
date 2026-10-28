import type { MorningCatalog } from "@/lib/morning";
import { recentTrades, type LiveMorningState } from "@/lib/morning-live";
import { formatPrice } from "@/lib/market/ticks";
import { formatTime } from "@/lib/utils";

const ROWS = 40;
const ARROW = { up: "▲", down: "▼", same: "" } as const;

/**
 * 成交明細: the replay's simulated trades of one stock, newest first. Lot sizes and 內外盤 appear only for
 * lessons whose volume is verified; otherwise the tape shows time, price and which way each trade ticked.
 */
export function TradeTape({
  catalog,
  session,
  code,
}: {
  catalog: MorningCatalog;
  session: LiveMorningState | null;
  code: string;
}) {
  const symbol = catalog.symbols.find((item) => item.code === code);
  const sized = catalog.volumeUnit === "lot";
  const trades = session && symbol ? recentTrades(session, code, ROWS, catalog) : [];
  const tone = (price: number) =>
    !symbol || price === symbol.previousClose ? "flat" : price > symbol.previousClose ? "up" : "down";
  return (
    <section className="td-tape" data-sized={sized} aria-label="成交明細，依真實一分鐘開高低收模擬的逐筆成交">
      <header className="td-tape-head">
        <h2>成交明細</h2>
        <span
          className="td-chip"
          data-kind="sim"
          title="教材只有一分鐘 K 線；每分鐘內的逐筆依真實開高低收模擬，收在真實收盤價。撮合仍以下一分鐘開盤價為準。"
        >
          模擬逐筆
        </span>
      </header>
      <div className="td-tape-labels" aria-hidden="true">
        <span>時間</span>
        <span>成交</span>
        <span>{sized ? "單量" : "漲跌"}</span>
      </div>
      {trades.length ? (
        <ol className="td-tape-rows">
          {trades.map((trade) => (
            <li key={trade.id} data-move={trade.move}>
              <time>{formatTime(trade.second)}</time>
              <span className="td-num" data-tone={tone(trade.price)}>
                {formatPrice(trade.price)}
              </span>
              {sized ? (
                <span
                  className="td-num td-tape-lots"
                  data-side={trade.side ?? undefined}
                  title={
                    trade.side === "ask"
                      ? "外盤：買方主動成交"
                      : trade.side === "bid"
                        ? "內盤：賣方主動成交"
                        : undefined
                  }
                >
                  {trade.size || "—"}
                </span>
              ) : (
                <span className="td-tape-move" data-move={trade.move} aria-hidden="true">
                  {ARROW[trade.move]}
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="td-tape-empty">前進一分鐘後顯示成交</p>
      )}
    </section>
  );
}
