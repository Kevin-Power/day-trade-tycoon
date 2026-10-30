import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Minus, Plus } from "@/lib/icons";
import { LOT_PICKS, MAX_LOTS, MIN_LOTS, parseLots } from "@/lib/morning-lots";

/**
 * The 張數 field of the ticket and of the lightning book (design 2026-10-30): a number box (1–400; − and +, its
 * spinner and the arrow keys step by one) and 快選, which opens XQ's four rows of quick picks. Picking one closes the
 * grid and puts the focus back in the box. Enter or Space on 快選 opens it (on the current pick), Esc closes it, Tab
 * moves through the picks. On a desk the grid drops under the field; on phones and large text it rises from the
 * bottom of the screen, seven (large text: four) to a row.
 */
export function LotPicker({
  id,
  name,
  value,
  max = MAX_LOTS,
  disabled = false,
  onChange,
}: {
  /** The number box's id; the field's visible <label> points at it. */
  id: string;
  /** The field's name (委託張數, 每筆張數): 快選 and its grid are named after it. */
  name: string;
  value: number;
  /** A lower cap than 400 (a sell of the lots held): picks above it are off, typing stops at it. */
  max?: number;
  disabled?: boolean;
  onChange: (lots: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(String(value));
  }
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const cap = Math.max(MIN_LOTS, Math.min(MAX_LOTS, max));
  const picksId = `${id}-picks`;
  if (open && disabled) setOpen(false);

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) input.current?.focus({ preventScroll: true });
  }
  function choose(lots: number) {
    onChange(Math.min(lots, cap));
    close(true);
  }
  function toggle() {
    if (open) {
      close(false);
      return;
    }
    const layout = root.current?.closest(".trading-desk")?.getAttribute("data-layout");
    setSheet(layout === "phone" || layout === "senior");
    setOpen(true);
  }
  function type(text: string) {
    setDraft(text);
    const parsed = parseLots(text);
    if (parsed === null) return;
    const lots = Math.min(parsed, cap);
    if (String(lots) !== text.trim()) setDraft(String(lots));
    if (lots !== value) onChange(lots);
  }

  // A desk's grid drops under the field (above it when there is no room), kept inside the window; it follows the
  // field when a pane scrolls or the window changes size. Phones and large text use the bottom sheet (CSS).
  useLayoutEffect(() => {
    if (!open || sheet) return;
    const place = () => {
      const box = grid.current;
      const anchor = field.current?.getBoundingClientRect();
      if (!box || !anchor) return;
      const width = box.offsetWidth;
      const height = box.offsetHeight;
      const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
      const below = anchor.bottom + 4;
      const top =
        below + height > window.innerHeight - 8 && anchor.top - 4 - height >= 8 ? anchor.top - 4 - height : below;
      box.style.left = `${Math.round(left)}px`;
      box.style.top = `${Math.round(top)}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, sheet]);
  // Opening puts the focus on the current pick (or the first), so Tab goes through the grid from there.
  useEffect(() => {
    if (!open) return;
    const picks = grid.current?.querySelectorAll<HTMLButtonElement>("button[data-lots]:not(:disabled)");
    const current = [...(picks ?? [])].find((button) => button.getAttribute("aria-pressed") === "true");
    (current ?? picks?.[0])?.focus({ preventScroll: true });
  }, [open]);
  // A press anywhere else closes it, leaving the focus where the press put it.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);

  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  return (
    <div className="td-lotpick" ref={root} onKeyDown={escape}>
      <div className="td-lotpick-field" ref={field}>
        <button
          type="button"
          className="td-lotpick-step"
          aria-label="減少一張"
          disabled={disabled || value <= MIN_LOTS}
          onClick={() => onChange(Math.max(MIN_LOTS, Math.min(value - 1, cap)))}
        >
          <Minus aria-hidden />
        </button>
        <input
          id={id}
          ref={input}
          type="number"
          inputMode="numeric"
          min={MIN_LOTS}
          max={cap}
          step={1}
          value={draft}
          disabled={disabled}
          onChange={(event) => type(event.target.value)}
          onBlur={() => setDraft(String(value))}
          onKeyDown={(event) => {
            // Enter sends the ticket with the lots last accepted: show them first.
            if (event.key === "Enter") setDraft(String(value));
          }}
        />
        <span className="td-lotpick-unit" aria-hidden="true">
          張
        </span>
        <button
          type="button"
          className="td-lotpick-step"
          aria-label="增加一張"
          disabled={disabled || value >= cap}
          onClick={() => onChange(Math.min(cap, value + 1))}
        >
          <Plus aria-hidden />
        </button>
        <button
          type="button"
          className="td-lotpick-toggle"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? picksId : undefined}
          aria-label={`快選${name}`}
          disabled={disabled}
          onClick={toggle}
        >
          快選
          <ChevronDown aria-hidden />
        </button>
      </div>
      {open && (
        <div
          id={picksId}
          ref={grid}
          className="td-lotpick-grid"
          data-sheet={sheet}
          role="group"
          aria-label={`快選${name}`}
          onBlur={(event) => {
            // Only the focus moving to something outside closes it (Tab past the last pick). Focus lost to nothing
            // is a press: Safari on a Mac does not focus the button it presses, so the pick that had the focus loses
            // it before the click lands, and closing here would take the grid away from under it. Presses outside
            // are closed by the pointerdown listener.
            const next = event.relatedTarget as Node | null;
            if (next && !root.current?.contains(next)) setOpen(false);
          }}
        >
          <div className="td-lotpick-head">
            <strong>快選張數</strong>
            <small>1 張 = 1,000 股</small>
          </div>
          {LOT_PICKS.map((row, index) => (
            <div className="td-lotpick-row" key={row[0]} role="group" aria-label={`第 ${index + 1} 排`}>
              {row.map((lots) => (
                <button
                  key={lots}
                  type="button"
                  data-lots={lots}
                  aria-pressed={lots === value}
                  aria-label={`${lots} 張`}
                  disabled={lots > cap}
                  onClick={() => choose(lots)}
                >
                  {lots}
                </button>
              ))}
            </div>
          ))}
          <button type="button" className="td-lotpick-close" onClick={() => close(true)}>
            關閉
          </button>
        </div>
      )}
    </div>
  );
}
