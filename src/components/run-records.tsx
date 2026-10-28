import { useEffect, useId, useRef, useState } from "react";
import type { RunRecord } from "@/lib/lessons/types";
import {
  ABANDON_CONFIRM_TEXT,
  RETIRED_TEXT,
  formatPnl,
  lessonDayLabel,
  openableRecords,
  recordStatus,
  shortDate,
} from "@/lib/lesson-choice";
import { cn } from "@/lib/utils";
import { CARD } from "@/components/morning-styles";

/**
 * 練習紀錄 under the plan (③ §7): the learner's latest runs, newest first, with the day, how many stocks, the result
 * and whether it was reviewed. A retired lesson's runs say so. A lesson opens its latest run, so only that one of a
 * day's runs is a link; the others are listed as they are.
 */
export function RunRecords({
  records,
  currentId,
  busy,
  onOpen,
}: {
  records: readonly RunRecord[];
  /** The run on screen, marked as the current one. */
  currentId?: string;
  busy: boolean;
  onOpen: (record: RunRecord) => void;
}) {
  const id = useId();
  if (!records.length) return null;
  const openable = openableRecords(records);
  return (
    <section className={cn(CARD, "td-records")} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="td-records-title">
        練習紀錄
      </h2>
      <div className="td-record-row td-record-head" aria-hidden>
        <span>日期</span>
        <span>檔數</span>
        <span>損益</span>
        <span>復盤</span>
      </div>
      <ul className="td-record-list">
        {records.map((record) => {
          const tone = record.pnl > 0 ? "up" : record.pnl < 0 ? "down" : "flat";
          const cells = (
            <>
              <span className="td-record-date">
                {record.retired ? (
                  <>
                    {shortDate(record.date)} <em className="td-record-retired">{RETIRED_TEXT}</em>
                  </>
                ) : (
                  lessonDayLabel(record.date)
                )}
              </span>
              <span className="td-record-codes">{record.codes} 檔</span>
              <span className="td-record-pnl" data-tone={tone}>
                {formatPnl(record.pnl)}
              </span>
              <span className="td-record-status" data-status={recordStatus(record)}>
                {recordStatus(record)}
              </span>
            </>
          );
          return (
            <li key={record.id}>
              {openable.has(record.id) ? (
                <button
                  type="button"
                  className="td-record-row td-record-open"
                  disabled={busy}
                  aria-current={record.id === currentId ? "true" : undefined}
                  onClick={() => onOpen(record)}
                >
                  {cells}
                </button>
              ) : (
                <div className="td-record-row">{cells}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Giving a run up, asked once more first (ruling R10's words). The run then ends without a reflection and never
 * counts for discipline; a daily lesson's day can be picked again.
 */
export function AbandonRun({
  label,
  busy,
  onConfirm,
}: {
  label: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  const id = useId();
  const [asking, setAsking] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (asking) {
      // Clear of the phones' bottom tabs (scroll-margin), then on 取消: nothing is given up by a stray Enter.
      box.current?.scrollIntoView({ block: "nearest" });
      cancel.current?.focus({ preventScroll: true });
    } else if (asked.current) opener.current?.focus();
    asked.current = asking;
  }, [asking]);
  if (!asking)
    return (
      <button
        ref={opener}
        type="button"
        className="td-button td-abandon"
        disabled={busy}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
  return (
    <div
      ref={box}
      role="alertdialog"
      aria-labelledby={`${id}-ask`}
      className="td-abandon-confirm"
      onKeyDown={(event) => {
        if (event.key === "Escape") setAsking(false);
      }}
    >
      <p id={`${id}-ask`}>{ABANDON_CONFIRM_TEXT}</p>
      <div className="td-banner-actions">
        <button
          type="button"
          className="td-button"
          data-variant="danger"
          disabled={busy}
          onClick={() => {
            asked.current = false;
            setAsking(false);
            onConfirm();
          }}
        >
          確定放棄
        </button>
        <button ref={cancel} type="button" className="td-button" onClick={() => setAsking(false)}>
          取消
        </button>
      </div>
    </div>
  );
}
