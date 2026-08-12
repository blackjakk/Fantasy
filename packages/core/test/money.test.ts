import { describe, expect, it } from 'vitest';
import {
  affordableMicro,
  assertCents,
  dollarsToCents,
  fmtUsd,
  MICRO,
  mulCents,
  positionValue,
  roundToInt,
} from '../src/index.js';

describe('money', () => {
  it('rejects non-integer cents', () => {
    expect(() => assertCents(10.5)).toThrow();
    expect(assertCents(1050)).toBe(1050);
  });

  it('converts dollars to cents with rounding', () => {
    expect(dollarsToCents(147.3)).toBe(14730);
    expect(dollarsToCents(0.005)).toBe(1);
    expect(dollarsToCents(-2.345)).toBe(-235);
  });

  it('rounds symmetrically away from zero', () => {
    expect(roundToInt(2.5)).toBe(3);
    expect(roundToInt(-2.5)).toBe(-3);
  });

  it('computes position value in integer cents', () => {
    // 4.25 shares at $28.40 = $120.70
    expect(positionValue(sharesMicro(4.25), 2840)).toBe(12070);
  });

  it('never overspends when computing affordable quantity', () => {
    const price = 2840;
    const spend = 12070;
    const qty = affordableMicro(spend, price);
    expect(positionValue(qty, price)).toBeLessThanOrEqual(spend);
  });

  it('multiplies cents by real factors deterministically', () => {
    expect(mulCents(14730, 2)).toBe(29460);
    expect(mulCents(14730, 1.5)).toBe(22095);
  });

  it('formats USD', () => {
    expect(fmtUsd(29460)).toBe('$294.60');
    expect(fmtUsd(-125)).toBe('-$1.25');
    expect(fmtUsd(123456789)).toBe('$1,234,567.89');
    expect(fmtUsd(500, { sign: true })).toBe('+$5.00');
  });
});

function sharesMicro(shares: number): number {
  return Math.round(shares * MICRO);
}
