import { useRef, useState } from "react";
import { Zap } from "@/lib/icons";
import { useTickFlash } from "@/components/use-tick-flash";
import {
  bookCellBlocked,
  bookCellLabel,
  bookCellOrder,
  bookPressure,
  createMorningBook,
  type MorningBookLevel,
} from "@/lib/morning-book";
import { formatPrice } from "@/lib/market/ticks";

type Tone = "up" | "down" | "flat";

/**
 * 教學模擬五檔, side by side like a broker's book: 委買 on the left, 委賣 on the right, best levels on the top
 * row. Lightning goes left-to-buy, right-to-sell (the 10/20 meeting): a left cell buys at its price, a right cell
 * sells at its price. `mode="display"` shows the same book without the lightning controls (the phone's 行情 page,
 * where a tap hands the price to the ticket).
 */
export function MorningOrderBook({
  code,
  cursor,
  last,
  previousClose,
  trade,
  revision,
  simulated,
  lots,
  holdingLots,
  flash,
  disabled,
  mode = "trade",
  onLots,
  onFlash,
  onPick,
}: {
  code: string;
  cursor: number;
  last?: number;
  previousClose: number;
  /** The latest replayed trade: which side the last price sits on, and the trade's place in the minute. */
  trade?: { index: number; side: "ask" | "bid" };
  /** The session's revision: an order or fill refreshes a held book. */
  revision: number;
  /** A minute is replaying, so the last price is a simulated trade. */
  simulated: boolean;
  lots: number;
  holdingLots: number;
  flash: boolean;
  disabled: boolean;
  mode?: "trade" | "display";
  onLots?: (lots: number) => void;
  onFlash?: (enabled: boolean) => void;
  onPick: (price: number, side: "buy" | "sell") => void;
}) {
  const key = `${code}:${cursor}:${revision}`;
  const live = {
    key,
    last,
    book: createMorningBook(code, cursor, last ?? 0, previousClose, trade),
  };
  // With 即送 armed the book holds still while the mouse is on it, a price has keyboard focus, or a finger is down
  // on it, so a click sends the price that was on screen while trades keep coming in. A new minute, an order or
  // another stock refreshes the held book once; leaving releases it.
  const [inside, setInside] = useState(false);
  const [held, setHeld] = useState<typeof live | null>(null);
  const touch = useRef(false);
  const wantHold = mode === "trade" && flash && inside;
  if (wantHold && held?.key !== key) setHeld(live);
  else if (!wantHold && held) setHeld(null);
  const holding = wantHold && held?.key === key ? held : null;
  const { book } = holding ?? live;
  const shownLast = (holding ?? live).last;
  const pick = (price: number, side: "buy" | "sell") => {
    onPick(price, side);
    if (touch.current) {
      touch.current = false;
      window.setTimeout(() => setInside(false), 0);
    }
  };
  const tick = useTickFlash(shownLast, code);
  const maxLots = Math.max(
    1,
    ...book.asks.map((level) => level.lots),
    ...book.bids.map((level) => level.lots),
  );
  const pressure = bookPressure(book);
  const tone = (price: number): Tone =>
    price > previousClose ? "up" : price < previousClose ? "down" : "flat";
  const trading = mode === "trade";
  return (
    <div
      className="td-book"
      data-mode={mode}
      data-flash={flash}
      data-held={Boolean(holding)}
      onPointerMove={(event) => {
        if (event.pointerType !== "touch") setInside(true);
      }}
      onPointerDown={(event) => {
        touch.current = event.pointerType === "touch";
        setInside(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") setInside(false);
      }}
      onPointerCancel={() => {
        touch.current = false;
        setInside(false);
      }}
      onFocus={(event) => {
        if ((event.target as HTMLElement).classList.contains("td-book-cell")) setInside(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInside(false);
      }}
    >
      {/* One line whatever the state: holding swaps the price's label instead of adding one, so the levels
          never move under a pointer that is about to click. */}
      <div className="td-book-head">
        <span className="td-chip" data-kind="sim">
          教學模擬五檔
        </span>
        <span className="td-book-last" data-tone={shownLast ? tone(shownLast) : "flat"}>
          {holding ? (
            <span className="td-book-held" aria-hidden="true">
              暫停跳動
            </span>
          ) : simulated ? (
            "模擬成交"
          ) : (
            "最新"
          )}
          <strong key={tick.key} data-flash={tick.flash} className="td-num">
            {shownLast ? formatPrice(shownLast) : "—"}
          </strong>
        </span>
        {trading && (
          <span className="td-book-holding">
            可賣 <b className="td-num">{holdingLots}</b> 張
          </span>
        )}
      </div>
      <div className="td-book-cols" aria-hidden="true">
        <span>{trading ? "委買｜點價買進" : "委買"}</span>
        <span>{trading ? "委賣｜點價賣出" : "委賣"}</span>
      </div>
      <div
        className="td-book-rows"
        role="group"
        aria-label={trading ? "五檔：左邊點價買進，右邊點價賣出" : "五檔：點價帶入下單"}
      >
        {Array.from({ length: 5 }, (_, row) => (
          <div className="td-book-row" key={row}>
            <BookCell
              level={book.bids[row]}
              side="bid"
              lots={lots}
              maxLots={maxLots}
              tone={tone}
              trading={trading}
              disabled={bookCellBlocked({ cell: "bid", trading, locked: disabled, holdingLots, lots })}
              onPick={pick}
            />
            <BookCell
              level={book.asks[row]}
              side="ask"
              lots={lots}
              maxLots={maxLots}
              tone={tone}
              trading={trading}
              disabled={bookCellBlocked({ cell: "ask", trading, locked: disabled, holdingLots, lots })}
              onPick={pick}
            />
          </div>
        ))}
      </div>
      {!book.bids.length && !book.asks.length && (
        <p className="td-ladder-empty">{shownLast ? "漲跌停範圍內無價位" : "等待第一分鐘"}</p>
      )}
      <div
        className="td-pressure"
        role="img"
        aria-label={`教學模擬委買 ${pressure.bidLots} 張、委賣 ${pressure.askLots} 張`}
      >
        <span style={{ width: `${pressure.bidShare * 100}%` }} />
        <small>委買 {pressure.bidLots}</small>
        <small>模擬</small>
        <small>委賣 {pressure.askLots}</small>
      </div>
      {trading && (
        <>
          <div className="td-flash">
            <span>
              <Zap aria-hidden />
              閃電下單
            </span>
            <button
              type="button"
              role="switch"
              className="td-switch"
              aria-label="閃電即送"
              aria-checked={flash}
              disabled={!flash && disabled}
              onClick={() => onFlash?.(!flash)}
            >
              <i aria-hidden />
              {flash ? "已開啟" : "開啟即送"}
            </button>
          </div>
          <div className="td-lots" role="group" aria-label="五檔下單張數">
            <span>每筆張數</span>
            {[1, 2, 3].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={lots === value}
                disabled={disabled}
                onClick={() => onLots?.(value)}
              >
                {value} 張
              </button>
            ))}
          </div>
          <p className="td-book-hint" role="status">
            {flash
              ? `左邊點價即送 ${lots} 張限價買進、右邊點價即送賣出；游標停在五檔上時暫停跳動`
              : "左邊點價買進、右邊點價賣出，先核對再送出；開啟閃電可直接送單"}
          </p>
        </>
      )}
      <p className="td-book-source">五檔價量為教學生成，非真實委託簿。</p>
    </div>
  );
}

function BookCell({
  level,
  side,
  lots,
  maxLots,
  tone,
  trading,
  disabled,
  onPick,
}: {
  level: MorningBookLevel | undefined;
  side: "bid" | "ask";
  lots: number;
  maxLots: number;
  tone: (price: number) => Tone;
  trading: boolean;
  disabled: boolean;
  onPick: (price: number, side: "buy" | "sell") => void;
}) {
  if (!level)
    return <span className="td-book-cell td-book-cell-empty" data-side={side} aria-hidden="true" />;
  return (
    <button
      type="button"
      className="td-book-cell"
      data-side={side}
      data-level={level.level}
      data-price={level.price}
      data-tone={tone(level.price)}
      disabled={disabled}
      aria-label={bookCellLabel({
        cell: side,
        level: level.level,
        price: formatPrice(level.price),
        lots,
        trading,
      })}
      onKeyDown={(event) => {
        if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
      }}
      onClick={(event) => {
        if (event.detail < 2) onPick(level.price, bookCellOrder(side));
      }}
    >
      <i
        className="td-book-fill"
        style={{ width: `${(level.lots / maxLots) * 100}%` }}
        aria-hidden
      />
      <span className="td-book-lots td-num">{level.lots}</span>
      <strong className="td-book-price td-num">{formatPrice(level.price)}</strong>
    </button>
  );
}
