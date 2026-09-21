import { roundToTick } from "../market/ticks.ts";

export const FLASH_KEY = "day-tycoon-flash";

export type ClickSide = "buy" | "sell";

export type ClickTicket = {
  side: ClickSide;
  type: "limit" | "market";
  lots: number;
  price: number;
};

export function loadFlashOrder(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FLASH_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveFlashOrder(on: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FLASH_KEY, on ? "1" : "0");
  } catch {
    /* quota / private mode */
  }
}

export function ticketAfterClickPrice<T extends ClickTicket>(
  ticket: T,
  price: number,
  side?: ClickSide,
): T {
  return {
    ...ticket,
    price: roundToTick(price),
    type: "limit",
    ...(side ? { side } : {}),
  };
}
