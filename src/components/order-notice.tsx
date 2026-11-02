import type { OrderNotice } from "@/lib/morning-notices";

/**
 * 成交／未成交 on top of the page for a few seconds (useOrderNotice); taps go through it to whatever is underneath.
 * Screen readers already hear each fill from 快訊's polite announcement, so this copy is for the eyes only.
 */
export function OrderNoticeToast({ notice }: { notice: OrderNotice | null }) {
  if (!notice) return null;
  return (
    <p
      key={notice.id}
      className="td-order-notice"
      data-label={notice.label === "成交" ? "filled" : "closed"}
      aria-hidden="true"
    >
      <strong>{notice.label}</strong>
      <span>{notice.text}</span>
      {notice.result && <b data-tone={notice.result.tone}>{notice.result.text}</b>}
    </p>
  );
}
