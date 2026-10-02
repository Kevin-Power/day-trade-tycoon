export type TicketDraft = { lots: string; price: string };

export const TICKET_LOTS_ERROR = "請完成張數：輸入 1–200 的整數，或點下方快速張數。";
export const TICKET_PRICE_ERROR = "請完成限價：輸入大於 0 的價格。";

export function parseLotsDraft(value: string): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isInteger(number) && number >= 1 && number <= 200 ? number : null;
}

export function parsePriceDraft(value: string): number | null {
  const text = value.trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function ticketDraftFrom(ticket: { lots: number; price: number }): TicketDraft {
  return { lots: String(ticket.lots), price: ticket.price > 0 ? String(ticket.price) : "" };
}

/** All submission paths validate the visible draft; none reuse a prior valid value. */
export function validateTicketDraft(draft: TicketDraft, type: "limit" | "market"):
  | { ok: true; lots: number; price: number | null }
  | { ok: false; reason: string } {
  const lots = parseLotsDraft(draft.lots);
  if (lots === null) return { ok: false, reason: TICKET_LOTS_ERROR };
  const price = parsePriceDraft(draft.price);
  if (type === "limit" && price === null) return { ok: false, reason: TICKET_PRICE_ERROR };
  return { ok: true, lots, price };
}
