/**
 * Money is represented as integer cents. Quantities of fractional assets are
 * represented as integer micro-units (1e-6 of a share). No financial value in
 * the system is ever stored as a non-integer number.
 *
 * SAFETY-CRITICAL: every mutation of a ledger goes through these helpers.
 */

/** Integer number of cents. */
export type Cents = number;

/** Integer number of micro-shares (1 share = 1_000_000 micro-shares). */
export type MicroShares = number;

export const MICRO = 1_000_000;

export function assertCents(value: number, context = 'amount'): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${context} must be an integer number of cents, got ${value}`);
  }
  return value;
}

export function assertMicro(value: number, context = 'quantity'): MicroShares {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${context} must be an integer number of micro-shares, got ${value}`);
  }
  return value;
}

/** Convert a dollar amount (possibly fractional) to integer cents, rounding half away from zero. */
export function dollarsToCents(dollars: number): Cents {
  return roundToInt(dollars * 100);
}

export function centsToDollars(cents: Cents): number {
  return cents / 100;
}

/** Multiply a cent amount by a real factor, rounding to the nearest cent. */
export function mulCents(cents: Cents, factor: number): Cents {
  assertCents(cents);
  return roundToInt(cents * factor);
}

/** Convert a share quantity (possibly fractional) to integer micro-shares. */
export function sharesToMicro(shares: number): MicroShares {
  return roundToInt(shares * MICRO);
}

export function microToShares(micro: MicroShares): number {
  return micro / MICRO;
}

/** Market value of a micro-share quantity at a price in cents, rounded to the nearest cent. */
export function positionValue(qtyMicro: MicroShares, priceCents: Cents): Cents {
  assertMicro(qtyMicro);
  assertCents(priceCents, 'price');
  return roundToInt((qtyMicro * priceCents) / MICRO);
}

/** How many micro-shares a cent amount buys at a price, rounded down (never overspends). */
export function affordableMicro(spendCents: Cents, priceCents: Cents): MicroShares {
  assertCents(spendCents, 'spend');
  assertCents(priceCents, 'price');
  if (priceCents <= 0) throw new Error(`price must be positive, got ${priceCents}`);
  return Math.floor((spendCents * MICRO) / priceCents);
}

/** Round half away from zero to an integer (deterministic, symmetric for gains/losses). */
export function roundToInt(value: number): number {
  const rounded = value >= 0 ? Math.round(value) : -Math.round(-value);
  if (!Number.isSafeInteger(rounded)) {
    throw new Error(`value ${value} is outside the safe integer range`);
  }
  return rounded;
}

export function fmtUsd(cents: Cents, opts: { sign?: boolean } = {}): string {
  const sign = cents < 0 ? '-' : opts.sign ? '+' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${grouped}.${rem}`;
}

export function fmtPct(fraction: number, digits = 1): string {
  const pct = fraction * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(digits)}%`;
}
