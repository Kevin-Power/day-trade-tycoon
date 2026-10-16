import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { coachDialogTop, coachSteps, type CoachStep } from "@/lib/coach-steps";
import type { TerminalLayout } from "@/lib/use-terminal-layout";

type Ring = { top: number; left: number; width: number; height: number };
const RING_GAP = 4;

/** First-time hints: dims the desk, rings the parts each step talks about, never auto-advances. */
export function CoachMarks({
  layout,
  onClose,
  onStep,
}: {
  layout: TerminalLayout;
  onClose: () => void;
  onStep?: (step: CoachStep) => void;
}) {
  const steps = useMemo(() => coachSteps(layout), [layout]);
  const [index, setIndex] = useState(0);
  const step = steps[Math.min(index, steps.length - 1)];
  const [rings, setRings] = useState<Ring[]>([]);
  const [dialogTop, setDialogTop] = useState<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const stepListener = useRef(onStep);
  stepListener.current = onStep;
  const last = index === steps.length - 1;

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    stepListener.current?.(step);
  }, [step]);

  useEffect(() => {
    const elements = step.targets.flatMap((selector) => {
      const element = document.querySelector(selector);
      return element ? [element] : [];
    });
    const first = elements[0]?.getBoundingClientRect();
    if (first && (first.top < 0 || first.bottom > window.innerHeight))
      elements[0].scrollIntoView({ block: "center" });
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = elements
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => ({
            top: rect.top - RING_GAP,
            left: rect.left - RING_GAP,
            width: rect.width + RING_GAP * 2,
            height: rect.height + RING_GAP * 2,
          }));
        setRings(next);
        // Place the dialog where it hides none of what this step points at.
        const height = dialog.current?.offsetHeight ?? 0;
        setDialogTop(coachDialogTop(next, window.innerHeight, height));
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  function keep(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    if (!buttons.length) return;
    const first = buttons[0];
    const end = buttons[buttons.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
      event.preventDefault();
      end.focus();
    } else if (!event.shiftKey && document.activeElement === end) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="td-coach" onKeyDown={keep}>
      {/* Dims the desk but cuts the targets out, so the learner sees exactly what is explained. */}
      <svg className="td-coach-backdrop" aria-hidden width="100%" height="100%">
        <defs>
          <mask id="td-coach-cutout">
            <rect width="100%" height="100%" fill="white" />
            {rings.map((ring, ringIndex) => (
              <rect key={ringIndex} x={ring.left} y={ring.top} width={ring.width} height={ring.height} rx={6} fill="black" />
            ))}
          </mask>
        </defs>
        <rect width="100%" height="100%" mask="url(#td-coach-cutout)" />
      </svg>
      {rings.map((ring, ringIndex) => (
        <div key={ringIndex} className="td-coach-ring" aria-hidden style={ring} />
      ))}
      <div
        ref={dialog}
        className="td-coach-dialog"
        style={dialogTop === null ? undefined : { top: dialogTop, bottom: "auto" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="td-coach-title"
        aria-describedby="td-coach-body"
      >
        <p className="td-coach-count">
          第 {index + 1}／{steps.length} 步
        </p>
        <h2 id="td-coach-title" ref={heading} tabIndex={-1}>
          {step.title}
        </h2>
        <p id="td-coach-body">{step.body}</p>
        <div className="td-coach-actions">
          {index > 0 && (
            <button type="button" className="td-button" onClick={() => setIndex(index - 1)}>
              上一步
            </button>
          )}
          <button
            type="button"
            className="td-button"
            data-variant="primary"
            onClick={() => (last ? onClose() : setIndex(index + 1))}
          >
            {last ? "完成" : "下一步"}
          </button>
          <button type="button" className="td-button td-coach-skip" onClick={onClose}>
            跳過
          </button>
        </div>
      </div>
    </div>
  );
}
