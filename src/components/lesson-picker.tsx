import { useId, useMemo, useState } from "react";
import type { LessonPicker as DayPicker, PickerSymbol } from "@/lib/lessons/types";
import {
  DISPOSITION_TEXT,
  FULL_LIST_TEXT,
  MAX_RUN_CODES,
  SEARCH_SHOWN,
  addCode,
  formatPreviousValue,
  removeCode,
  searchSymbols,
} from "@/lib/lesson-choice";
import { formatPrice } from "@/lib/market/ticks";
import { cn } from "@/lib/utils";
import { CARD, INPUT } from "@/components/morning-styles";

/**
 * Before a run (③ §7, list design D–F): the day, then its stocks. The day's default list comes in chosen, under the
 * server's wording for it; stocks can be removed (one always stays) or found by code or name among the day's stocks
 * and added, up to 80. Only what is known before 09:00 is shown: code, name, reference price, the previous day's
 * turnover and the 處置 mark. Phones and large text fold it all into one row inside the plan's card (the day, and
 * the stocks behind one button that opens the wording and the list), so the start button stays on the plan's first
 * screen: one tap from the lobby to 09:00.
 */
export function LessonPicker({
  picker,
  dates,
  codes,
  busy,
  folded,
  onDate,
  onCodes,
}: {
  picker: DayPicker;
  /** The open days as the menu shows them, newest first. */
  dates: { lessonId: string; label: string }[];
  /** The stocks chosen for the run, by code. */
  codes: string[];
  busy: boolean;
  folded: boolean;
  onDate: (lessonId: string) => void;
  onCodes: (codes: string[]) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const bySymbol = useMemo(() => new Map(picker.symbols.map((symbol) => [symbol.code, symbol])), [picker.symbols]);
  const chosen = codes.flatMap((code) => {
    const symbol = bySymbol.get(code);
    return symbol ? [symbol] : [];
  });
  const dateMenu = (
    <select
      aria-label="練習日期"
      className="td-picker-date"
      value={picker.lessonId}
      disabled={busy}
      onChange={(event) => onDate(event.target.value)}
    >
      {dates.map((date) => (
        <option key={date.lessonId} value={date.lessonId}>
          {date.label}
        </option>
      ))}
    </select>
  );
  const note = (
    <div className="td-picker-note">
      <p className="td-picker-note-title">{picker.note.title}</p>
      {picker.note.detail && <p className="td-picker-note-detail">{picker.note.detail}</p>}
    </div>
  );
  const editor = (
    <StockEditor
      picker={picker}
      chosen={chosen}
      codes={codes}
      busy={busy}
      onCodes={onCodes}
    />
  );
  return (
    <section
      className={cn(!folded && CARD, "td-picker")}
      aria-labelledby={`${id}-title`}
      data-folded={folded}
    >
      {/* Folded on phones and large text, where the day and the count already say it. */}
      <h2 id={`${id}-title`} className={folded ? "sr-only" : "td-picker-title"}>
        選日期與股票
      </h2>
      {folded ? (
        <>
          <div className="td-picker-bar">
            {dateMenu}
            <button
              type="button"
              className="td-button td-picker-toggle"
              aria-expanded={open}
              aria-controls={`${id}-stocks`}
              onClick={() => setOpen((value) => !value)}
            >
              <span>股票 {codes.length} 檔</span> <span>· {open ? "收起" : "看／改"}</span>
            </button>
          </div>
          <div id={`${id}-stocks`} className="td-picker-more" hidden={!open}>
            {open && (
              <>
                {note}
                {editor}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <label className="td-picker-field">
            <span>練習日期</span>
            {dateMenu}
          </label>
          <div className="td-picker-head">
            <h3>股票 {codes.length} 檔</h3>
            {note}
          </div>
          {editor}
        </>
      )}
    </section>
  );
}

function StockEditor({
  picker,
  chosen,
  codes,
  busy,
  onCodes,
}: {
  picker: DayPicker;
  chosen: PickerSymbol[];
  codes: string[];
  busy: boolean;
  onCodes: (codes: string[]) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const full = codes.length >= MAX_RUN_CODES;
  const found = useMemo(() => searchSymbols(picker.symbols, query), [picker.symbols, query]);
  const taken = new Set(codes);
  return (
    <div className="td-picker-editor">
      <ul className="td-picker-list" aria-label="已選的股票">
        {chosen.map((symbol) => (
          <li key={symbol.code} className="td-picker-row" data-code={symbol.code}>
            <StockFacts symbol={symbol} />
            <button
              type="button"
              className="td-button td-picker-remove"
              disabled={busy || codes.length <= 1}
              aria-label={`移除 ${symbol.code} ${symbol.name}`}
              onClick={() => onCodes(removeCode(codes, symbol.code))}
            >
              移除
            </button>
          </li>
        ))}
      </ul>
      <p className="td-picker-count" aria-live="polite">
        已選 {codes.length} 檔
      </p>
      {full && (
        <p role="status" className="td-picker-full">
          {FULL_LIST_TEXT}
        </p>
      )}
      <label className="td-picker-field td-picker-search">
        <span>加入股票</span>
        <input
          type="search"
          className={INPUT}
          value={query}
          placeholder="搜尋代號或名稱"
          autoComplete="off"
          enterKeyHint="search"
          aria-controls={`${id}-found`}
          disabled={busy}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {query.trim() && (
        <div id={`${id}-found`}>
          {found.total === 0 ? (
            <p className="td-picker-empty">找不到符合的股票</p>
          ) : (
            <>
              <ul className="td-picker-list td-picker-found" aria-label="搜尋結果">
                {found.shown.map((symbol) => {
                  const added = taken.has(symbol.code);
                  return (
                    <li key={symbol.code} className="td-picker-row" data-code={symbol.code}>
                      <StockFacts symbol={symbol} />
                      <button
                        type="button"
                        className="td-button td-picker-add"
                        disabled={busy || added || full}
                        aria-label={`${added ? "已加入" : "加入"} ${symbol.code} ${symbol.name}`}
                        onClick={() => onCodes(addCode(codes, symbol.code))}
                      >
                        {added ? "已加入" : "加入"}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {found.total > found.shown.length && (
                <p className="td-picker-empty">
                  共 {found.total} 檔符合，只列出前 {SEARCH_SHOWN} 檔；輸入更多字可以縮小範圍。
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One stock as the picker shows it: only what was known before 09:00 that day. */
function StockFacts({ symbol }: { symbol: PickerSymbol }) {
  return (
    <>
      <span className="td-picker-id">
        <b>{symbol.code}</b>
        <span>{symbol.name}</span>
        {symbol.disposition && <em className="td-picker-flag">{DISPOSITION_TEXT}</em>}
      </span>
      <span className="td-picker-facts">
        <span>
          參考價 <b>{formatPrice(symbol.referencePrice)}</b>
        </span>
        <span>
          前一交易日成交值 <b>{formatPreviousValue(symbol.previousValue)}</b>
        </span>
      </span>
    </>
  );
}
