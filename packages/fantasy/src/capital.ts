import type { Cents } from '@fc/core';
import { assertCents, roundToInt } from '@fc/core';

/**
 * The score-to-capital formula — the heart of Fantasy Capital. This is a
 * league setting; the simulator sweeps these knobs to find fair defaults.
 *
 * weeklyCapital = points x pointValue x (won ? winMultiplier : lossMultiplier)
 *                 + (won ? winBonus : 0), clamped to weeklyCap.
 */
export interface CapitalFormula {
  /** Cents generated per fantasy point (100 = $1/point). */
  pointValueCents: number;
  lossMultiplier: number;
  winMultiplier: number;
  winBonusCents: Cents;
  /** Optional cap on capital generated in a single week. */
  weeklyCapCents: Cents | null;
}

export const FORMULAS: Record<string, CapitalFormula> = {
  /** Model A — dramatic 2x winner. */
  win2x: {
    pointValueCents: 100,
    lossMultiplier: 1,
    winMultiplier: 2,
    winBonusCents: 0,
    weeklyCapCents: null,
  },
  /** Model B — 1.5x winner, less snowballing. */
  win15x: {
    pointValueCents: 100,
    lossMultiplier: 1,
    winMultiplier: 1.5,
    winBonusCents: 0,
    weeklyCapCents: null,
  },
  /** Model C — fixed $100 win bonus. */
  fixedBonus: {
    pointValueCents: 100,
    lossMultiplier: 1,
    winMultiplier: 1,
    winBonusCents: 10000,
    weeklyCapCents: null,
  },
  /** Mild 1.25x winner. */
  win125x: {
    pointValueCents: 100,
    lossMultiplier: 1,
    winMultiplier: 1.25,
    winBonusCents: 0,
    weeklyCapCents: null,
  },
  /** No win reward at all — capital is pure scoring (baseline). */
  flat: {
    pointValueCents: 100,
    lossMultiplier: 1,
    winMultiplier: 1,
    winBonusCents: 0,
    weeklyCapCents: null,
  },
};

export function weeklyCapital(points: number, won: boolean, f: CapitalFormula): Cents {
  if (points < 0) throw new Error(`points must be >= 0, got ${points}`);
  const multiplier = won ? f.winMultiplier : f.lossMultiplier;
  let capital = roundToInt(points * f.pointValueCents * multiplier);
  if (won) capital += assertCents(f.winBonusCents, 'winBonus');
  if (f.weeklyCapCents !== null) capital = Math.min(capital, f.weeklyCapCents);
  return capital;
}
