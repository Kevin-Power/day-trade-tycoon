import { readDeviceValue, writeDeviceValue } from "./device-storage.ts";
import type { TerminalLayout } from "./use-terminal-layout.ts";

export type CoachStep = { id: "chart" | "play" | "fills"; title: string; body: string; targets: string[] };
export const COACH_KEY = "day-tycoon-coach-v1";

const target = (name: string) => `[data-coach="${name}"]`;

/** Three first-time hints. Phones and large text show one pane, so they point at the tabs. */
export function coachSteps(layout: TerminalLayout): CoachStep[] {
  const singlePane = layout === "phone" || layout === "senior";
  return [
    {
      id: "chart",
      title: "看走勢圖",
      body: "這是走勢圖。標「昨」的虛線是昨天收盤價，比它高是漲、低是跌。",
      targets: [target("chart")],
    },
    {
      id: "play",
      title: "讓行情動起來",
      body: singlePane
        ? "按「播放」讓行情動起來；想買，先點「下單」分頁再按「買進」。"
        : "按「播放」讓行情動起來；想買就按「買進」。",
      targets: singlePane ? [target("play"), target("tab-trade")] : [target("play"), target("ticket")],
    },
    {
      id: "fills",
      title: "成交與庫存",
      body: "送出後前進一分鐘就會成交，買到的會出現在「庫存」。",
      targets: singlePane ? [target("tab-positions")] : [target("ledger")],
    },
  ];
}

export function readCoachSeen(storage: Pick<Storage, "getItem"> | undefined): boolean {
  return readDeviceValue(storage, COACH_KEY) === "seen";
}
export function writeCoachSeen(storage: Pick<Storage, "setItem" | "removeItem"> | undefined): void {
  writeDeviceValue(storage, COACH_KEY, "seen");
}
export function resetCoachSeen(storage: Pick<Storage, "setItem" | "removeItem"> | undefined): void {
  writeDeviceValue(storage, COACH_KEY, null);
}
