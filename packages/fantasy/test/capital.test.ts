import { describe, expect, it } from 'vitest';
import { FORMULAS, weeklyCapital, type CapitalFormula } from '../src/index.js';

describe('weeklyCapital', () => {
  it('matches the brief example: 147.3 points x $1 x 2 (win) = $294.60', () => {
    expect(weeklyCapital(147.3, true, FORMULAS['win2x'] as CapitalFormula)).toBe(29460);
  });

  it('loss pays base score', () => {
    expect(weeklyCapital(147.3, false, FORMULAS['win2x'] as CapitalFormula)).toBe(14730);
  });

  it('1.5x win multiplier', () => {
    expect(weeklyCapital(100, true, FORMULAS['win15x'] as CapitalFormula)).toBe(15000);
    expect(weeklyCapital(147.3, true, FORMULAS['win15x'] as CapitalFormula)).toBe(22095);
  });

  it('fixed bonus: 147 points + win = $247', () => {
    expect(weeklyCapital(147, true, FORMULAS['fixedBonus'] as CapitalFormula)).toBe(24700);
    expect(weeklyCapital(147, false, FORMULAS['fixedBonus'] as CapitalFormula)).toBe(14700);
  });

  it('applies the weekly cap', () => {
    const capped: CapitalFormula = {
      pointValueCents: 100,
      lossMultiplier: 1,
      winMultiplier: 2,
      winBonusCents: 0,
      weeklyCapCents: 20000,
    };
    expect(weeklyCapital(147.3, true, capped)).toBe(20000);
  });

  it('rejects negative points', () => {
    expect(() => weeklyCapital(-1, true, FORMULAS['flat'] as CapitalFormula)).toThrow();
  });
});
