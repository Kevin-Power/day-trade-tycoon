// Stock price grid: TWSE Operating Rules, Article 62.
// https://twse-regulation.twse.com.tw/TW/law/DOC01.aspx?FLCODE=FL007304&FLNO=62
// Integer cents and a continuous tick index keep both directions legal at band edges.
const PRICE_BANDS = [
  { cents: 0, tick: 1, index: 0 },
  { cents: 1000, tick: 5, index: 1000 },
  { cents: 5000, tick: 10, index: 1800 },
  { cents: 10000, tick: 50, index: 2300 },
  { cents: 50000, tick: 100, index: 3100 },
  { cents: 100000, tick: 500, index: 3600 },
] as const;

function bandFor(cents: number) {
  for (let i = PRICE_BANDS.length - 1; i > 0; i--) {
    if (cents >= PRICE_BANDS[i].cents) return PRICE_BANDS[i];
  }
  return PRICE_BANDS[0];
}

// Remove only arithmetic noise near an integer, e.g. 9.95 * 100 = 994.9999999999999.
function stableInteger(value: number): number {
  const nearest = Math.round(value);
  const tolerance = Math.min(1e-8, Number.EPSILON * Math.max(1, Math.abs(value)) * 4);
  return Math.abs(value - nearest) <= tolerance ? nearest : value;
}

function priceCents(price: number): number {
  const cents = stableInteger(price * 100);
  return Number.isFinite(cents) && cents > 0 && cents <= Number.MAX_SAFE_INTEGER ? cents : 0;
}

function alignCents(cents: number, round: (value: number) => number): number {
  if (!Number.isFinite(cents) || cents <= 0 || cents > Number.MAX_SAFE_INTEGER) return 0;
  const tick = bandFor(cents).tick;
  // Stabilize whole and half ticks so an exact midpoint such as 9.995 ties upward.
  const aligned = round(stableInteger((cents / tick) * 2) / 2) * tick;
  return Number.isSafeInteger(aligned) && aligned > 0 ? aligned / 100 : 0;
}

/** TWSE stock tick size by price band. */
export function tickSize(price: number): number {
  const p = Math.abs(price);
  if (p < 10) return 0.01;
  if (p < 50) return 0.05;
  if (p < 100) return 0.1;
  if (p < 500) return 0.5;
  if (p < 1000) return 1;
  return 5;
}

export function roundToTick(price: number): number {
  return alignCents(priceCents(price), Math.round);
}

/**
 * Legacy off-tick prices first round to the nearest tick (ties upward), then move
 * by a whole number of legal ticks. A tick index is equivalent to stepping one
 * tick at a time, without a long loop for large counts. Invalid inputs or moving
 * below the minimum price return 0, which is not a valid order price.
 */
export function stepTick(price: number, dir: number): number {
  const rounded = roundToTick(price);
  if (rounded === 0 || !Number.isSafeInteger(dir)) return 0;
  const cents = Math.round(rounded * 100);
  const band = bandFor(cents);
  const index = band.index + (cents - band.cents) / band.tick + dir;
  if (!Number.isSafeInteger(index) || index < 1) return 0;
  let nextBand: (typeof PRICE_BANDS)[number] = PRICE_BANDS[0];
  for (let i = PRICE_BANDS.length - 1; i > 0; i--) {
    if (index >= PRICE_BANDS[i].index) {
      nextBand = PRICE_BANDS[i];
      break;
    }
  }
  const nextCents = nextBand.cents + (index - nextBand.index) * nextBand.tick;
  return Number.isSafeInteger(nextCents) ? nextCents / 100 : 0;
}

// The classroom models ordinary stock limits within +/-10% (Article 63).
// It does not model the sub-one-tick or newly listed stock exceptions in that rule.
// https://twse-regulation.twse.com.tw/TW/law/DOC01.aspx?FLCODE=FL007304&FLNO=63
export function limitUp(prevClose: number): number {
  const cents = priceCents(prevClose);
  return cents >= 1 ? alignCents((cents * 11) / 10, Math.floor) : 0;
}

export function limitDown(prevClose: number): number {
  const cents = priceCents(prevClose);
  return cents >= 1 ? alignCents((cents * 9) / 10, Math.ceil) : 0;
}

export function clampLimit(price: number, prevClose: number): number {
  if (priceCents(price) === 0) return 0;
  const lo = limitDown(prevClose);
  const hi = limitUp(prevClose);
  if (lo === 0 || hi === 0 || lo > hi) return 0;
  return roundToTick(Math.min(hi, Math.max(lo, price)));
}

export function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return "--";
  const t = tickSize(price);
  if (t >= 1) return price.toFixed(0);
  if (t >= 0.1) return price.toFixed(1);
  return price.toFixed(2);
}

export function decimalsFor(price: number): number {
  const t = tickSize(price);
  if (t >= 1) return 0;
  if (t >= 0.1) return 1;
  return 2;
}

export const LOT_SHARES = 1000;
export const FEE_RATE = 0.001425 * 0.6;
export const DAYTRADE_TAX = 0.0015;
export const MIN_FEE = 20;
/** 當沖來回約 0.321%（費 0.0855%×2 + 稅 0.15%）。 */
export const ROUND_TRIP_RATE = FEE_RATE * 2 + DAYTRADE_TAX;

export function commission(notional: number): number {
  return Math.max(MIN_FEE, Math.round(Math.abs(notional) * FEE_RATE));
}

export function sellTax(notional: number): number {
  return Math.round(Math.abs(notional) * DAYTRADE_TAX);
}

export const OPEN_SECONDS = 0;
export const CLOSE_SECONDS = 270 * 60;
export const MARKET_MINUTES = 270;
