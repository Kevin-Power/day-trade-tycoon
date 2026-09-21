import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  LEAVE_DESK_CANCEL,
  LEAVE_DESK_CONFIRM,
  LEAVE_DESK_NO_FLATTEN,
  LEAVE_DESK_NO_RECORD,
  LEAVE_DESK_TITLE,
  leaveDeskOrderLine,
  leaveDeskPositionLine,
  type LeaveDeskRisk,
} from "@/lib/game/leave-desk";

export function LeaveDeskDialog({
  open,
  risk,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  risk: LeaveDeskRisk;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  const pos = leaveDeskPositionLine(risk.openPositions);
  const ord = leaveDeskOrderLine(risk.openOrders);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-bg/80 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-desk-title"
        className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-panel)] sm:p-6"
      >
        <h2 id="leave-desk-title" className="text-xl font-medium">
          {LEAVE_DESK_TITLE}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">{LEAVE_DESK_NO_RECORD}</p>
        {(pos || ord) && (
          <ul className="mt-3 space-y-1 text-sm leading-relaxed text-fg">
            {pos ? <li>{pos}</li> : null}
            {ord ? <li>{ord}</li> : null}
          </ul>
        )}
        <p className="mt-3 text-sm leading-relaxed text-muted">{LEAVE_DESK_NO_FLATTEN}</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" variant="outline" onClick={onCancel}>
            {LEAVE_DESK_CANCEL}
          </Button>
          <Button className="flex-1" variant="ghost" onClick={onConfirm}>
            {LEAVE_DESK_CONFIRM}
          </Button>
        </div>
      </div>
    </div>
  );
}
