import type { MorningBookCell, MorningCatalog } from "@/lib/morning";
import { bookPressure, tradeSides, type MorningBookLevel } from "@/lib/morning-book";
import { recentTrades, shownBook, type LiveMorningState } from "@/lib/morning-live";
import { TAPE_LENGTH } from "@/lib/market/real-replay";
import { formatPrice } from "@/lib/market/ticks";

const LEVELS = 5;
const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * Phones' 行情 (2026-11-06, 石大哥: 「急急樂的重點就是讓學員知道如何看N字攻擊、內外盤5檔價格，的下單時機」; the owner
 * chose 走勢＋五檔並排): the 五檔 beside the 江波圖 like a broker app's quote page — 委賣 five above, 委買 five below,
 * best prices meeting in the middle — then 委買／委賣 of those levels and 外盤／內盤 of the latest trades the desk
 * holds. Display only; the 五檔 tab under the chart takes a tap to 下單.
 */
export function SideBook({
  catalog,
  session,
  book,
  code,
}: {
  catalog: MorningCatalog;
  session: LiveMorningState | null;
  /** The recorded book of the newest minute the server sent (one stock's). */
  book?: MorningBookCell;
  code: string;
}) {
  const previousClose = catalog.symbols.find((symbol) => symbol.code === code)?.previousClose ?? 0;
  const shown = shownBook(session, catalog, book, code);
  const pressure = bookPressure(shown);
  const sides = tradeSides(session ? recentTrades(session, code, TAPE_LENGTH) : []);
  const toneOf = (price: number) => (price > previousClose ? "up" : price < previousClose ? "down" : "flat");
  const rows = (levels: readonly MorningBookLevel[], side: "ask" | "bid") => {
    const filled = Array.from({ length: LEVELS }, (_, index) => levels[index] ?? null);
    return (side === "ask" ? filled.reverse() : filled).map((level, index) => (
      <li key={`${side}-${index}`} data-side={side} data-best={level?.level === 1 || undefined}>
        {level ? (
          <>
            <span data-tone={toneOf(level.price)}>{formatPrice(level.price)}</span>
            <span>{shown.sizes && level.lots !== null ? level.lots : ""}</span>
          </>
        ) : null}
      </li>
    ));
  };
  return (
    <aside className="td-side-book" aria-label="五檔與內外盤">
      <p className="td-side-head">
        <span>委賣</span>
        <span>{shown.sizes ? "張" : ""}</span>
      </p>
      <ol className="td-side-levels">
        {rows(shown.asks, "ask")}
        {rows(shown.bids, "bid")}
      </ol>
      <p className="td-side-head">
        <span>委買</span>
        <span>{shown.sizes ? "張" : ""}</span>
      </p>
      {shown.sizes && (
        <div
          className="td-side-bar"
          role="img"
          aria-label={`委買 ${pressure.bidLots} 張、委賣 ${pressure.askLots} 張`}
        >
          <span style={{ width: percent(pressure.bidShare) }} />
          <small>買 {percent(pressure.bidShare)}</small>
          <small>賣 {percent(1 - pressure.bidShare)}</small>
        </div>
      )}
      {sides.askShare !== null && (
        <div
          className="td-side-bar"
          data-kind="trades"
          role="img"
          aria-label={`最近成交：外盤 ${sides.askLots} 張、內盤 ${sides.bidLots} 張`}
          title={`最近 ${TAPE_LENGTH} 筆成交內，成交在賣價（外盤）和買價（內盤）的張數比例`}
        >
          <span style={{ width: percent(sides.askShare) }} />
          <small>外 {percent(sides.askShare)}</small>
          <small>內 {percent(1 - sides.askShare)}</small>
        </div>
      )}
      {shown.note && <small className="td-side-note">{shown.note}</small>}
    </aside>
  );
}
