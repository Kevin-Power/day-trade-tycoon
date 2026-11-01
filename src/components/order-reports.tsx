import { AlertCircle, CircleCheck, Clock3, Minus, TriangleAlert } from "@/lib/icons";
import type { IconComponent } from "@/lib/icons/icon";
import type { OrderReport } from "@/lib/morning-orders";

/** Each state's mark beside its colour, so a report never depends on colour alone. */
const MARKS: Record<OrderReport["tone"], IconComponent> = {
  sent: Clock3,
  filled: CircleCheck,
  closed: Minus,
  failed: AlertCircle,
  unknown: TriangleAlert,
};

/** 委託回報 right under the ticket (the 10/20 meeting): the run's latest order events, newest first. */
export function OrderReports({ reports }: { reports: OrderReport[] }) {
  return (
    <section className="sim-reports" aria-labelledby="sim-reports-title">
      <header>
        <h3 id="sim-reports-title">委託回報</h3>
        <small>送出失敗、回覆不明只記在這次瀏覽</small>
      </header>
      {reports.length ? (
        <ol aria-live="polite">
          {reports.map((report) => {
            const Mark = MARKS[report.tone];
            return (
              <li key={report.key} data-tone={report.tone}>
                <time className="td-num">{report.time ?? "—"}</time>
                <Mark aria-hidden className="sim-report-mark" />
                <span>{report.text}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p>送出委託後，成功、成交或失敗都會列在這裡。</p>
      )}
    </section>
  );
}
