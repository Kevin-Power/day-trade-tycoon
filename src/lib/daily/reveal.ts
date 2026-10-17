import type { Bar } from "../game/types.ts";
import type { DailyChoice, DailyKind, DailyOutcome, DailyQuestionPayload } from "./types.ts";

export type EntryResult = {
  entryT: number;
  entryPrice: number;
  stopPrice: number;
  stopT: number | null;
  exitPrice: number;
  pct: number;
};

const oneDecimal = (value: number) => Math.round(value * 10) / 10 || 0;

/** Paper entry at the next minute's open, like the practice desk; a stop exits at min(stop, that bar's open). */
export function entryResult(question: Pick<DailyQuestionPayload, "bars" | "questionT">, stopPrice: number): EntryResult {
  const after: Bar[] = question.bars.filter((bar) => bar.t > question.questionT);
  const entry = after[0]!;
  const hit = after.find((bar) => bar.l <= stopPrice);
  const exitPrice = hit ? Math.min(stopPrice, hit.o) : after.at(-1)!.c;
  return {
    entryT: entry.t,
    entryPrice: entry.o,
    stopPrice,
    stopT: hit?.t ?? null,
    exitPrice,
    pct: oneDecimal(((exitPrice - entry.o) / entry.o) * 100),
  };
}

export function priceText(price: number): string {
  return price.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function timeText(t: number): string {
  const minutes = 9 * 60 + Math.floor(t / 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Signed one-decimal percent; zero has no sign, negatives use the minus sign. */
function pctText(value: number): string {
  const rounded = oneDecimal(value);
  if (rounded === 0) return "0.0";
  return rounded > 0 ? `+${rounded.toFixed(1)}` : `−${Math.abs(rounded).toFixed(1)}`;
}

export function questionText(question: { name: string; code: string; kind: DailyKind; questionT: number; level: number }): string {
  const where = question.kind === "intraday-high" ? "回到前高" : "漲到昨天最高價";
  return `${question.name}（${question.code}）${timeText(question.questionT)} ${where} ${priceText(question.level)} 附近。接下來你會怎麼做？`;
}

const LESSONS = {
  definition: "前高後高：先出現一個高點，回檔之後，後面又做出更高的高點。",
  "intraday-high-yes": "這次回到前高後，買盤把價格推上去，做出後高：多方結構延續。進場的人有停損保護，風險有限。",
  "intraday-high-no": "這次前高成了壓力，價格沒能做出後高。觀望或不追，避開了之後的回落。",
  "previous-high-yes": "昨天的最高價被突破，代表買盤願意追價。有停損，就算判斷錯也只虧一小段。",
  "previous-high-no": "昨天的最高價擋住了價格，昨高成了壓力。等真的突破再說，比提前追價安全。",
  discipline: "不論判斷對錯，先設停損，錯了也只虧一小段。",
} as const;

export function revealCopy(input: {
  kind: DailyKind;
  level: number;
  outcome: DailyOutcome;
  choice: DailyChoice;
  entry: EntryResult | null;
}): { headline: string; facts: string[]; lessons: string[] } {
  const { kind, level, outcome } = input;
  const headline =
    kind === "intraday-high"
      ? outcome.higherHigh ? "做出後高" : "沒有突破前高"
      : outcome.higherHigh ? "突破昨高" : "沒有突破昨高";
  const facts: string[] = [];
  if (outcome.higherHigh && outcome.firstBreakT !== null)
    facts.push(`${timeText(outcome.firstBreakT)} 突破 ${priceText(level)}，最高到 ${priceText(outcome.maxAfter)}（${pctText(((outcome.maxAfter - level) / level) * 100)}%）；收盤 ${priceText(outcome.close)}。`);
  else if (outcome.firstBreakT !== null && outcome.firstBreakPrice !== null)
    facts.push(`${timeText(outcome.firstBreakT)} 一度碰到 ${priceText(outcome.firstBreakPrice)} 又回落，沒有站穩；收盤 ${priceText(outcome.close)}。`);
  else facts.push(`之後最高只到 ${priceText(outcome.maxAfter)}，沒有越過 ${priceText(level)}；收盤 ${priceText(outcome.close)}。`);
  if (input.choice === "enter" && input.entry) {
    const { entry } = input;
    const start = `假設 ${timeText(entry.entryT)} 開盤價 ${priceText(entry.entryPrice)} 買進、停損 ${priceText(entry.stopPrice)}：`;
    facts.push(
      entry.stopT === null
        ? `${start}停損沒有被觸發，收盤約 ${pctText(entry.pct)}%（不含手續費與稅）。`
        : `${start}停損在 ${timeText(entry.stopT)} 被觸發，約 ${pctText(entry.pct)}%（不含手續費與稅）。`,
    );
  }
  const lesson = LESSONS[`${kind}-${outcome.higherHigh ? "yes" : "no"}` as const];
  return { headline, facts, lessons: [LESSONS.definition, lesson, LESSONS.discipline] };
}
