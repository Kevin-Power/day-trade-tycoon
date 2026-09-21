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

/** 期末考 / 盲測：暫停或引導中不送單（須有 toast，不可靜默）。 */
export const FLASH_EXAM_PAUSE_TOAST = "測驗不可在暫停中下單";

export type FlashClickContext = {
  flashOrder: boolean;
  /** 教學引導卡（activeBeat）。關閉教學後應為 false。 */
  guideActive: boolean;
  teachMode: boolean;
  paused: boolean;
  /** tycoon / 盲測 */
  examMode: boolean;
};

export type FlashClickDecision =
  | { action: "fill" }
  | { action: "submit" }
  | { action: "block"; reason: string };

export function isExamScenario(scenarioId: string | null | undefined): boolean {
  return scenarioId === "tycoon";
}

/**
 * Flash click after the ticket has been filled.
 * Teaching guide never silently no-ops — it submits (盤面可下單).
 * 盲測暫停 / 期末考引導中: block + toast.
 */
export function flashClickDecision(ctx: FlashClickContext): FlashClickDecision {
  if (!ctx.flashOrder) return { action: "fill" };
  if (ctx.examMode && (ctx.paused || ctx.guideActive)) {
    return { action: "block", reason: FLASH_EXAM_PAUSE_TOAST };
  }
  return { action: "submit" };
}
