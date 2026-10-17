import { createHash } from "node:crypto";
import type { Bar } from "../game/types.ts";
import type { DaySymbol } from "../market-days.server.ts";
import { confirmedHighIndexes } from "../market/swing-highs.ts";
import { stepTick, tickSize } from "../market/ticks.ts";
import { breakoutPrice } from "./reveal.ts";
import type { DailyCandidate, DailyOutcome, DailyQuestionPayload } from "./types.ts";

const POOL_SIZE = 50;
const MIN_BARS = 150;
const LEVEL_FROM_T = 300; // 09:05
const LEVEL_TO_T = 9000; // 11:30
const QUESTION_TO_T = 12600; // 12:30
const MIN_AFTER_SECONDS = 1800;
const MIN_PULLBACK = 0.005;
const NEAR = 0.003;
const WIDE_NEAR = 0.006;
const TOP = 10;

/** Top 50 by trade value and top 50 by volume, after removing disposition and thinly traded stocks. */
export function poolSymbols(symbols: readonly DaySymbol[]): DaySymbol[] {
  const eligible = symbols.filter((symbol) => !symbol.disposition && symbol.bars >= MIN_BARS);
  const byValue = [...eligible].sort((a, b) => b.tradeValue - a.tradeValue).slice(0, POOL_SIZE);
  const byVolume = [...eligible].sort((a, b) => b.tradeVolume - a.tradeVolume).slice(0, POOL_SIZE);
  const pool = new Map<string, DaySymbol>();
  for (const symbol of [...byValue, ...byVolume]) pool.set(symbol.code, symbol);
  return [...pool.values()];
}

const cents = (price: number) => Math.round(price * 100) / 100;
/** Largest legal tick price at or below `price`. */
function floorToTick(price: number): number {
  const tick = tickSize(price);
  return cents(Math.floor(cents(price) / tick + 1e-9) * tick);
}
/** Both suggested stops must sit below the question minute's close. */
function belowClose(stop: number, close: number): number {
  let value = stop;
  while (value >= close) value = stepTick(value, -1);
  return value;
}

/** The two stop suggestions: the pullback low and 1% under the level, both legal ticks below the close. */
export function suggestedStops(level: number, pullbackLow: number, close: number): { pullback: number; belowLevel: number } {
  return { pullback: belowClose(pullbackLow, close), belowLevel: belowClose(floorToTick(level * 0.99), close) };
}

/**
 * 做出後高 after the question minute: a confirmed high at least two ticks above the level (one tick
 * and back does not count, spec §2), or a close two ticks above it. A breakout that holds into the
 * close, such as a limit-up lock or a steady rise, never confirms a high.
 */
function outcomeAfter(bars: readonly Bar[], questionIndex: number, level: number): DailyOutcome {
  const after = bars.slice(questionIndex + 1);
  const breakout = cents(breakoutPrice(level));
  const reaches = (price: number) => cents(price) >= breakout;
  const confirmed = confirmedHighIndexes(bars).find((index) => index > questionIndex && reaches(bars[index]!.h));
  const close = bars.at(-1)!.c;
  const held = reaches(close) ? after.find((bar) => reaches(bar.h)) : undefined;
  const firstBreak = after.find((bar) => bar.h > level);
  return {
    higherHigh: confirmed !== undefined || held !== undefined,
    higherHighT: confirmed !== undefined ? bars[confirmed]!.t : (held?.t ?? null),
    firstBreakT: firstBreak?.t ?? null,
    firstBreakPrice: firstBreak?.h ?? null,
    maxAfter: Math.max(...after.map((bar) => bar.h)),
    close,
  };
}

function enoughAfter(bars: readonly Bar[], questionIndex: number): boolean {
  const question = bars[questionIndex]!;
  return question.t <= QUESTION_TO_T && bars.at(-1)!.t - question.t >= MIN_AFTER_SECONDS;
}

function finish(symbol: DaySymbol, bars: Bar[], fields: Pick<DailyCandidate, "kind" | "level" | "levelT"> & {
  questionIndex: number; pullbackLow: number;
}): DailyCandidate {
  const close = bars[fields.questionIndex]!.c;
  return {
    code: symbol.code,
    name: symbol.name,
    kind: fields.kind,
    level: fields.level,
    levelT: fields.levelT,
    questionT: bars[fields.questionIndex]!.t,
    referencePrice: symbol.referencePrice,
    pullbackLow: fields.pullbackLow,
    stops: suggestedStops(fields.level, fields.pullbackLow, close),
    bars,
    outcome: outcomeAfter(bars, fields.questionIndex, fields.level),
    tradeValue: symbol.tradeValue,
    pullbackPct: (fields.level - fields.pullbackLow) / fields.level,
  };
}

/** Return to the day's high so far, after a real pullback (spec §2, type 1). Earliest question wins. */
export function intradayCandidate(symbol: DaySymbol, bars: Bar[], nearPct: number): DailyCandidate | null {
  for (const levelIndex of confirmedHighIndexes(bars)) {
    const level = bars[levelIndex]!.h;
    const levelT = bars[levelIndex]!.t;
    if (levelT < LEVEL_FROM_T || levelT > LEVEL_TO_T) continue;
    if (bars.slice(0, levelIndex).some((bar) => bar.h >= level)) continue;
    const minimumDrop = Math.max(level * MIN_PULLBACK, 2 * tickSize(level));
    let low = level;
    for (let index = levelIndex + 1; index < bars.length; index++) {
      const bar = bars[index]!;
      if (bar.h > level) break;
      low = Math.min(low, bar.l);
      // The high is confirmed once levelIndex + 2 has closed.
      if (index >= levelIndex + 2 && cents(level - low) >= cents(minimumDrop) && bar.c >= level * (1 - nearPct)) {
        if (!enoughAfter(bars, index)) return null;
        return finish(symbol, bars, { kind: "intraday-high", level, levelT, questionIndex: index, pullbackLow: low });
      }
    }
  }
  return null;
}

/** Rise to yesterday's high (spec §2, type 2). Needs a comparable previous day. */
export function previousHighCandidate(
  symbol: DaySymbol,
  bars: Bar[],
  previous: { high: number; close: number } | null,
  nearPct: number,
): DailyCandidate | null {
  if (!previous || !bars.length || symbol.referencePrice !== previous.close) return null;
  const level = previous.high;
  if (bars[0]!.o >= level) return null;
  let low = Infinity;
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index]!;
    if (bar.h > level) return null;
    low = Math.min(low, bar.l);
    if (bar.c >= level * (1 - nearPct)) {
      if (bar.t < LEVEL_FROM_T || !enoughAfter(bars, index)) return null;
      return finish(symbol, bars, { kind: "previous-high", level, levelT: null, questionIndex: index, pullbackLow: low });
    }
  }
  return null;
}

const preferred = (candidate: DailyCandidate) =>
  candidate.questionT >= 900 && candidate.questionT <= LEVEL_TO_T &&
  candidate.pullbackPct >= 0.005 && candidate.pullbackPct <= 0.03;

/** Clean setups first, then by trade value; the top 10. */
export function rankCandidates(candidates: readonly DailyCandidate[]): DailyCandidate[] {
  return [...candidates]
    .sort((a, b) => Number(preferred(b)) - Number(preferred(a)) || b.tradeValue - a.tradeValue)
    .slice(0, TOP);
}

/**
 * One question per data day, the same for everyone. When both outcomes are present, the seed first
 * picks the outcome group (half and half), so neither "always enter" nor "always skip" wins.
 */
export function pickQuestion(dataDate: string, candidates: readonly DailyCandidate[]): DailyCandidate | null {
  const top = rankCandidates(candidates);
  if (!top.length) return null;
  const seed = createHash("sha256").update(dataDate).digest();
  const yes = top.filter((candidate) => candidate.outcome.higherHigh);
  const no = top.filter((candidate) => !candidate.outcome.higherHigh);
  const group = yes.length && no.length ? (seed[0]! % 2 === 0 ? yes : no) : top;
  return group[seed.readUInt32BE(1) % group.length]!;
}

export function buildQuestion(input: {
  dataDate: string;
  symbols: DaySymbol[];
  barsOf: (code: string) => Bar[] | null;
  previousOf: (code: string) => { high: number; close: number } | null;
}): DailyQuestionPayload | null {
  const pool = poolSymbols(input.symbols);
  const scan = (nearPct: number) =>
    pool.flatMap((symbol) => {
      const bars = input.barsOf(symbol.code);
      if (!bars || bars.length < 5) return [];
      const found = [intradayCandidate(symbol, bars, nearPct), previousHighCandidate(symbol, bars, input.previousOf(symbol.code), nearPct)]
        .filter((candidate): candidate is DailyCandidate => candidate !== null)
        .sort((a, b) => a.questionT - b.questionT);
      return found.slice(0, 1);
    });
  const candidates = scan(NEAR);
  const picked = pickQuestion(input.dataDate, candidates.length ? candidates : scan(WIDE_NEAR));
  if (!picked) return null;
  const { tradeValue: _value, pullbackPct: _pullback, ...question } = picked;
  return { dataDate: input.dataDate, ...question };
}
