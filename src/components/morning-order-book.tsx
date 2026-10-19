import { Zap } from "@/lib/icons";
import { bookPressure, createMorningBook, type MorningBookLevel } from "@/lib/morning-book";
import { formatPrice } from "@/lib/market/ticks";

type Tone = "up" | "down" | "flat";

export function MorningOrderBook({
  code,
  cursor,
  last,
  previousClose,
  lots,
  holdingLots,
  flash,
  disabled,
  onLots,
  onFlash,
  onPick,
}: {
  code: string;
  cursor: number;
  last?: number;
  previousClose: number;
  lots: number;
  holdingLots: number;
  flash: boolean;
  disabled: boolean;
  onLots: (lots: number) => void;
  onFlash: (enabled: boolean) => void;
  onPick: (price: number, side: "buy" | "sell") => void;
}) {
  const book = createMorningBook(code, cursor, last ?? 0, previousClose);
  const maxLots = Math.max(
    1,
    ...book.asks.map((level) => level.lots),
    ...book.bids.map((level) => level.lots),
  );
  const pressure = bookPressure(book);
  const tone = (price: number): Tone =>
    price > previousClose ? "up" : price < previousClose ? "down" : "flat";
  return (
    <div className="td-book" data-flash={flash}>
      <div className="td-book-head">
        <span className="td-chip" data-kind="sim">
          教學模擬五檔
        </span>
        <span>
          可賣 <b className="td-num">{holdingLots}</b> 張
        </span>
      </div>
      <div className="td-ladder-labels" aria-hidden="true">
        <span>檔位</span>
        <span>價格</span>
        <span>模擬量</span>
      </div>
      <BookLevels
        levels={[...book.asks].reverse()}
        side="buy"
        lots={lots}
        maxLots={maxLots}
        tone={tone}
        disabled={disabled}
        onPick={onPick}
        empty={last ? "漲停範圍內無價位" : "等待第一分鐘"}
      />
      <div className="td-ladder-mid" data-tone={last ? tone(last) : "flat"}>
        <span>最新分鐘收價</span>
        <strong>{last ? formatPrice(last) : "—"}</strong>
      </div>
      <BookLevels
        levels={book.bids}
        side="sell"
        lots={lots}
        maxLots={maxLots}
        tone={tone}
        disabled={disabled || holdingLots < lots}
        onPick={onPick}
        empty={last ? "跌停範圍內無價位" : "等待第一分鐘"}
      />
      <div
        className="td-pressure"
        role="img"
        aria-label={`教學模擬委買 ${pressure.bidLots} 張、委賣 ${pressure.askLots} 張`}
      >
        <span style={{ width: `${pressure.bidShare * 100}%` }} />
        <small>委買 {pressure.bidLots}</small>
        <small>委賣 {pressure.askLots}</small>
      </div>
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
          onClick={() => onFlash(!flash)}
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
            onClick={() => onLots(value)}
          >
            {value} 張
          </button>
        ))}
      </div>
      <p className="td-book-hint" role="status">
        {flash ? `點價即送 ${lots} 張限價模擬委託` : "點價格核對委託；開啟閃電可直接送單"}
      </p>
      <p className="td-book-source">五檔價量為教學生成，非真實委託簿。</p>
    </div>
  );
}

function BookLevels({
  levels,
  side,
  lots,
  maxLots,
  tone,
  disabled,
  onPick,
  empty,
}: {
  levels: MorningBookLevel[];
  side: "buy" | "sell";
  lots: number;
  maxLots: number;
  tone: (price: number) => Tone;
  disabled: boolean;
  onPick: (price: number, side: "buy" | "sell") => void;
  empty: string;
}) {
  const ask = side === "buy";
  return (
    <div
      className="td-ladder"
      data-side={side}
      role="group"
      aria-label={ask ? "賣方五檔，點價模擬買進" : "買方五檔，點價模擬賣出"}
    >
      {levels.map((level) => (
        <button
          type="button"
          key={level.level}
          className="td-level"
          data-side={side}
          data-tone={tone(level.price)}
          disabled={disabled}
          aria-label={`${ask ? "賣" : "買"}${level.level} 價格 ${formatPrice(level.price)}，模擬${ask ? "買進" : "賣出"} ${lots} 張`}
          onKeyDown={(event) => {
            if (event.repeat && (event.key === "Enter" || event.key === " "))
              event.preventDefault();
          }}
          onClick={(event) => {
            if (event.detail < 2) onPick(level.price, side);
          }}
        >
          <i
            className="td-level-fill"
            style={{ width: `${(level.lots / maxLots) * 100}%` }}
            aria-hidden
          />
          <span className="td-level-rank">
            {ask ? "賣" : "買"}
            {level.level}
          </span>
          <strong className="td-level-price">{formatPrice(level.price)}</strong>
          <span className="td-level-lots">{level.lots}</span>
        </button>
      ))}
      {!levels.length && <p className="td-ladder-empty">{empty}</p>}
    </div>
  );
}
