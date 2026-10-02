import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type RefObject } from "react";
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
  returnFocusRef,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  risk: LeaveDeskRisk;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pos = leaveDeskPositionLine(risk.openPositions);
  const ord = leaveDeskOrderLine(risk.openOrders);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-bg/80" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocusRef.current;
            if (target?.isConnected) target.focus({ preventScroll: true });
          }}
          className="fixed left-1/2 top-1/2 z-[61] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-panel)] sm:p-6"
        >
          <Dialog.Title className="text-xl font-medium">{LEAVE_DESK_TITLE}</Dialog.Title>
          <Dialog.Description className="mt-3 text-base leading-relaxed text-muted">
            {LEAVE_DESK_NO_RECORD}
          </Dialog.Description>
          {(pos || ord) && (
            <ul className="mt-3 space-y-1 text-base leading-relaxed text-fg">
              {pos ? <li>{pos}</li> : null}
              {ord ? <li>{ord}</li> : null}
            </ul>
          )}
          <p className="mt-3 text-base leading-relaxed text-muted">{LEAVE_DESK_NO_FLATTEN}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button
              ref={cancelRef}
              className="h-auto min-h-12 flex-1 whitespace-normal py-3 text-base"
              variant="outline"
              onClick={onCancel}
            >
              {LEAVE_DESK_CANCEL}
            </Button>
            <Button
              className="h-auto min-h-12 flex-1 whitespace-normal py-3 text-base"
              variant="ghost"
              onClick={onConfirm}
            >
              {LEAVE_DESK_CONFIRM}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
