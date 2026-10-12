import { Zap } from "lucide-react";
import { createMorningBook, type MorningBookLevel } from "@/lib/morning-book";
import { formatPrice } from "@/lib/market/ticks";

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
  return (
    <div className="morning-book" data-flash={flash}>
      <div className="morning-book-last">
        <div>
          <span>最新分鐘收價</span>
          <strong>{last ? formatPrice(last) : "—"}</strong>
        </div>
        <span className="studio-simulation-badge">教學模擬五檔</span>
      </div>
      <div className="studio-book-columns">
        <BookSide
          levels={book.bids}
          side="sell"
          lots={lots}
          maxLots={maxLots}
          disabled={disabled || holdingLots < lots}
          onPick={onPick}
          empty={last ? "跌停範圍內無價位" : "等待第一分鐘"}
        />
        <BookSide
          levels={book.asks}
          side="buy"
          lots={lots}
          maxLots={maxLots}
          disabled={disabled}
          onPick={onPick}
          empty={last ? "漲停範圍內無價位" : "等待第一分鐘"}
        />
      </div>
      <div className="morning-flash-control">
        <span>
          <Zap size={16} aria-hidden />
          閃電下單
        </span>
        <button
          type="button"
          role="switch"
          aria-label="閃電即送"
          aria-checked={flash}
          disabled={!flash && disabled}
          onClick={() => onFlash(!flash)}
        >
          <i aria-hidden />
          {flash ? "已開啟" : "開啟即送"}
        </button>
      </div>
      <div className="morning-book-lots" role="group" aria-label="五檔下單張數">
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
      <p className="morning-flash-hint" role="status">
        {flash ? `點價即送 ${lots} 張限價模擬委託` : "點價格核對委託；開啟閃電可直接送單"}
      </p>
      <p className="morning-book-source">
        五檔價量為教學生成，非真實委託簿。可賣 {holdingLots} 張。
      </p>
    </div>
  );
}

function BookSide({
  levels,
  side,
  lots,
  maxLots,
  disabled,
  onPick,
  empty,
}: {
  levels: MorningBookLevel[];
  side: "buy" | "sell";
  lots: number;
  maxLots: number;
  disabled: boolean;
  onPick: (price: number, side: "buy" | "sell") => void;
  empty: string;
}) {
  const ask = side === "buy";
  return (
    <div className="studio-book-side" data-side={side}>
      <div className="morning-book-heading">
        <strong>{ask ? "賣方" : "買方"}</strong>
        <span>點價{ask ? "買進" : "賣出"}</span>
      </div>
      <div className="studio-book-labels">
        <span>價格</span>
        <span>模擬量 / 張</span>
      </div>
      <div
        className="morning-book-levels"
        role="group"
        aria-label={ask ? "賣方五檔，點價模擬買進" : "買方五檔，點價模擬賣出"}
      >
        {levels.map((level) => (
          <button
            type="button"
            key={level.level}
            data-side={side}
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
              className="studio-book-fill"
              style={{ width: `${(level.lots / maxLots) * 100}%` }}
              aria-hidden
            />
            <span className="studio-book-rank">{level.level}</span>
            <strong>{formatPrice(level.price)}</strong>
            <span className="morning-book-depth">{level.lots}</span>
          </button>
        ))}
        {!levels.length && <p className="morning-book-empty">{empty}</p>}
      </div>
    </div>
  );
}
