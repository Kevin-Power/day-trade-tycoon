/** TWSE tick size by price band. */
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
  if (!Number.isFinite(price) || price <= 0) return 0;
  const t = tickSize(price);
  const n = Math.round(price / t);
  return Math.round(n * t * 1e6) / 1e6;
}

export function stepTick(price: number, dir: number): number {
  const t = tickSize(price);
  return roundToTick(price + dir * t);
}

export function limitUp(prevClose: number): number {
  return roundToTick(prevClose * 1.1);
}

export function limitDown(prevClose: number): number {
  const raw = prevClose * 0.9;
  const t = tickSize(raw);
  return Math.round(Math.ceil(raw / t) * t * 1e6) / 1e6;
}

export function clampLimit(price: number, prevClose: number): number {
  const lo = limitDown(prevClose);
  const hi = limitUp(prevClose);
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
