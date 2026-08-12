import type { Cents } from '@fc/core';
import { Rng, mulCents } from '@fc/core';

/**
 * Simulated sportsbook. Every week it publishes a slate of offers:
 *   - singles (moneyline/spread-ish, ~-110 style pricing)
 *   - parlays (2-4 legs, per-leg vig compounds against the bettor)
 *   - one longshot future (+1200 to +3000 range, heavy hold)
 *
 * The line has noise around the true probability, so sharp bettors who can
 * estimate true probabilities find occasional +EV lines (closing-line value),
 * while random bettors pay the vig on average. Offers settle once, globally:
 * every manager on the same ticket shares the same outcome.
 */
export type BetKind = 'single' | 'parlay' | 'longshot';

export interface BetOffer {
  id: string;
  week: number;
  kind: BetKind;
  legs: number;
  description: string;
  /** True win probability (hidden from normal managers). */
  trueProb: number;
  /** Offered decimal odds: payout per 1.0 staked, including stake. */
  decimalOdds: number;
}

export interface SportsbookConfig {
  singlesPerWeek: number;
  parlaysPerWeek: number;
  longshotsPerWeek: number;
  vigSingle: number; // book margin on singles
  vigPerLeg: number; // margin per parlay leg
  vigLongshot: number;
  lineNoiseSigma: number; // sd of the multiplicative error in the book's implied prob
}

export const DEFAULT_SPORTSBOOK_CONFIG: SportsbookConfig = {
  singlesPerWeek: 8,
  parlaysPerWeek: 4,
  longshotsPerWeek: 1,
  vigSingle: 0.045,
  vigPerLeg: 0.045,
  vigLongshot: 0.15,
  lineNoiseSigma: 0.05,
};

const MATCH_DESCRIPTIONS = [
  'Hawks ML',
  'Bulls -3.5',
  'Over 47.5 SF/DAL',
  'Riders +6',
  'Comets ML',
  'Under 41 GB/CHI',
  'Storm -1.5',
  'Threshers ML',
  'Over 51 KC/BUF',
  'Wolves +4.5',
  'Union ML',
  'Under 44 NE/NYJ',
];

export function makeWeeklyOffers(
  week: number,
  rng: Rng,
  cfg = DEFAULT_SPORTSBOOK_CONFIG,
): BetOffer[] {
  const offers: BetOffer[] = [];
  let n = 0;
  const nextId = (): string => `BET:w${week}:${n++}`;

  for (let i = 0; i < cfg.singlesPerWeek; i++) {
    const trueProb = rng.uniform(0.35, 0.65);
    offers.push({
      id: nextId(),
      week,
      kind: 'single',
      legs: 1,
      description: rng.pick(MATCH_DESCRIPTIONS),
      trueProb,
      decimalOdds: offeredOdds(trueProb, cfg.vigSingle, cfg.lineNoiseSigma, rng),
    });
  }

  for (let i = 0; i < cfg.parlaysPerWeek; i++) {
    const legs = rng.int(2, 4);
    let prob = 1;
    let odds = 1;
    for (let l = 0; l < legs; l++) {
      const p = rng.uniform(0.45, 0.62);
      prob *= p;
      odds *= offeredOdds(p, cfg.vigPerLeg, cfg.lineNoiseSigma, rng);
    }
    offers.push({
      id: nextId(),
      week,
      kind: 'parlay',
      legs,
      description: `${legs}-leg parlay (${americanOdds(odds)})`,
      trueProb: prob,
      decimalOdds: odds,
    });
  }

  for (let i = 0; i < cfg.longshotsPerWeek; i++) {
    const trueProb = rng.uniform(0.03, 0.08);
    const odds = offeredOdds(trueProb, cfg.vigLongshot, cfg.lineNoiseSigma, rng);
    offers.push({
      id: nextId(),
      week,
      kind: 'longshot',
      legs: 1,
      description: `Longshot future (${americanOdds(odds)})`,
      trueProb,
      decimalOdds: odds,
    });
  }

  return offers;
}

function offeredOdds(trueProb: number, vig: number, noiseSigma: number, rng: Rng): number {
  // The book's implied probability is a noisy estimate of the truth plus margin.
  const impliedProb = Math.min(0.98, Math.max(0.01, trueProb * rng.normal(1, noiseSigma)));
  return round2((1 - vig) / impliedProb);
}

/** Settle every offer once. Returned map is shared by all bets on the ticket. */
export function settleOffers(offers: BetOffer[], rng: Rng): Map<string, boolean> {
  const outcomes = new Map<string, boolean>();
  for (const o of offers) outcomes.set(o.id, rng.chance(o.trueProb));
  return outcomes;
}

export function payoutFor(stakeCents: Cents, offer: BetOffer, won: boolean): Cents {
  return won ? mulCents(stakeCents, offer.decimalOdds) : 0;
}

/** Bettor's expected value per dollar staked (diagnostic). */
export function offerEv(offer: BetOffer): number {
  return offer.trueProb * offer.decimalOdds - 1;
}

export function americanOdds(decimal: number): string {
  if (decimal >= 2) return `+${Math.round((decimal - 1) * 100)}`;
  return `${Math.round(-100 / (decimal - 1))}`;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
