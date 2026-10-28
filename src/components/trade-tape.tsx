import type { MorningCatalog } from "@/lib/morning";
import { recentTrades, type LiveMorningState } from "@/lib/morning-live";
import { formatPrice } from "@/lib/market/ticks";
import { formatTime } from "@/lib/utils";

const ROWS = 40;
const ARROW = { up: "▲", down: "▼", same: "" } as const;

/**
 * 成交明細: the real Fubon trades of one stock that the replay has reached, newest first, each at its real second.
 * Lot sizes and 內外盤 appear when the lesson documents its volume unit; otherwise the tape shows time, price and
 * which way each trade ticked.
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
    <section className="td-tape" data-sized={sized} aria-label="成交明細，富邦的真實逐筆成交，依真實成交時間重播">
      <header className="td-tape-head">
        <h2>成交明細</h2>
        <span
          className="td-chip"
          data-kind="real"
          title="富邦收盤後提供的真實逐筆成交，依真實成交時間重播，只顯示播放到的部分。"
        >
          富邦逐筆
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
