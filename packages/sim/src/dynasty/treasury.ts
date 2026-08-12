import type { Cents } from '@fc/core';
import { Rng, mulCents } from '@fc/core';

/**
 * The shared treasury, simulated at annual resolution over a multi-decade
 * horizon. Ownership is strictly pro-rata to contributions; the vote only
 * steers ALLOCATION. All value is integer cents.
 */
export type AssetClass = 'INDEX' | 'BONDS' | 'GOLD' | 'CRYPTO';
export const ASSET_CLASSES: readonly AssetClass[] = ['INDEX', 'BONDS', 'GOLD', 'CRYPTO'];

/** Fractions summing to 1. */
export type Allocation = Record<AssetClass, number>;

/** Annual log-return parameters, roughly calibrated to long-run behavior. */
const RETURN_PARAMS: Record<AssetClass, { mu: number; sigma: number }> = {
  INDEX: { mu: 0.055, sigma: 0.16 },
  BONDS: { mu: 0.03, sigma: 0.045 },
  GOLD: { mu: 0.03, sigma: 0.15 },
  CRYPTO: { mu: 0.1, sigma: 0.65 },
};

/** One year of returns per asset class (multiplicative factors). */
export function annualReturnFactors(rng: Rng): Record<AssetClass, number> {
  const out = {} as Record<AssetClass, number>;
  for (const c of ASSET_CLASSES) {
    const { mu, sigma } = RETURN_PARAMS[c];
    out[c] = Math.exp(rng.normal(mu - (sigma * sigma) / 2, sigma));
  }
  return out;
}

/** Member preference archetypes: fixed target allocations they vote for. */
export const PREF_ARCHETYPES: Record<string, Allocation> = {
  indexer: { INDEX: 0.8, BONDS: 0.15, GOLD: 0.05, CRYPTO: 0 },
  conservative: { INDEX: 0.35, BONDS: 0.55, GOLD: 0.1, CRYPTO: 0 },
  cryptoBull: { INDEX: 0.4, BONDS: 0.1, GOLD: 0, CRYPTO: 0.5 },
  goldBug: { INDEX: 0.25, BONDS: 0.35, GOLD: 0.4, CRYPTO: 0 },
  degen: { INDEX: 0.2, BONDS: 0.05, GOLD: 0, CRYPTO: 0.75 },
};

/** Default 12-member preference mix. */
export const DEFAULT_PREF_MIX = [
  'indexer',
  'indexer',
  'indexer',
  'indexer',
  'conservative',
  'conservative',
  'conservative',
  'cryptoBull',
  'cryptoBull',
  'goldBug',
  'degen',
  'degen',
];

export type Aggregation = 'weighted-average' | 'proposal';

/**
 * Turn member preferences + voting power into the treasury allocation.
 *
 * weighted-average: the committee compromise — every voice pulls the mix
 * proportionally (models amendment-and-horse-trading governance).
 *
 * proposal: winner-take-all — each member backs the proposal closest to their
 * own preference (their archetype), and the proposal with the most weighted
 * support sets the whole allocation (models up-or-down proposal voting).
 */
export function aggregateVotes(
  prefs: Allocation[],
  power: number[],
  aggregation: Aggregation,
): Allocation {
  if (aggregation === 'weighted-average') {
    const total = power.reduce((a, b) => a + b, 0);
    const out: Allocation = { INDEX: 0, BONDS: 0, GOLD: 0, CRYPTO: 0 };
    for (let i = 0; i < prefs.length; i++) {
      const w = (power[i] ?? 0) / total;
      for (const c of ASSET_CLASSES) out[c] += (prefs[i] as Allocation)[c] * w;
    }
    return out;
  }
  // proposal: support goes to the nearest distinct preference by L1 distance.
  const candidates: Allocation[] = [];
  for (const p of prefs) {
    if (!candidates.some((c) => l1(c, p) < 1e-9)) candidates.push(p);
  }
  const support = new Array<number>(candidates.length).fill(0);
  for (let i = 0; i < prefs.length; i++) {
    let best = 0;
    for (let k = 1; k < candidates.length; k++) {
      if (
        l1(candidates[k] as Allocation, prefs[i] as Allocation) <
        l1(candidates[best] as Allocation, prefs[i] as Allocation)
      ) {
        best = k;
      }
    }
    support[best] = (support[best] ?? 0) + (power[i] ?? 0);
  }
  let winner = 0;
  for (let k = 1; k < candidates.length; k++) {
    if ((support[k] ?? 0) > (support[winner] ?? 0)) winner = k;
  }
  return { ...(candidates[winner] as Allocation) };
}

function l1(a: Allocation, b: Allocation): number {
  let d = 0;
  for (const c of ASSET_CLASSES) d += Math.abs(a[c] - b[c]);
  return d;
}

/** Constitution guardrail: cap the crypto sleeve, redistributing the excess. */
export function applyCryptoCap(alloc: Allocation, cap: number | null): Allocation {
  if (cap === null || alloc.CRYPTO <= cap) return alloc;
  const excess = alloc.CRYPTO - cap;
  const rest = alloc.INDEX + alloc.BONDS + alloc.GOLD;
  const out: Allocation = { ...alloc, CRYPTO: cap };
  if (rest <= 0) {
    out.INDEX += excess;
    return out;
  }
  out.INDEX += excess * (alloc.INDEX / rest);
  out.BONDS += excess * (alloc.BONDS / rest);
  out.GOLD += excess * (alloc.GOLD / rest);
  return out;
}

export interface TreasuryYear {
  year: number;
  allocation: Allocation;
  valueCents: Cents;
}

/**
 * Run the treasury for `years`: contribute, vote (caller supplies the
 * allocation per year), grow by that year's returns.
 */
export function runTreasury(
  years: number,
  contributionPerYearCents: Cents,
  allocationForYear: (year: number) => Allocation,
  returnsForYear: (year: number) => Record<AssetClass, number>,
): { path: TreasuryYear[]; terminalCents: Cents; maxDrawdown: number } {
  let value: Cents = 0;
  const path: TreasuryYear[] = [];
  let peak = 0;
  let maxDD = 0;
  for (let year = 1; year <= years; year++) {
    value += contributionPerYearCents;
    const allocation = allocationForYear(year);
    const factors = returnsForYear(year);
    let next = 0;
    for (const c of ASSET_CLASSES) next += mulCents(mulCents(value, allocation[c]), factors[c]);
    value = next;
    path.push({ year, allocation, valueCents: value });
    if (value > peak) peak = value;
    else if (peak > 0) maxDD = Math.max(maxDD, (peak - value) / peak);
  }
  return { path, terminalCents: value, maxDrawdown: maxDD };
}
