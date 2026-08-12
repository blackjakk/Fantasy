import { describe, expect, it } from 'vitest';
import {
  powerShares,
  votingPower,
  TROPHY_EARN,
  type GovernanceModel,
  type TrophyEvent,
} from '../src/dynasty/governance.js';
import {
  aggregateVotes,
  applyCryptoCap,
  ASSET_CLASSES,
  PREF_ARCHETYPES,
  type Allocation,
} from '../src/dynasty/treasury.js';
import { evaluateGovernance, generateWorld } from '../src/dynasty/runner.js';

const MODEL: GovernanceModel = {
  key: 't',
  base: 1,
  earn: TROPHY_EARN,
  decay: 0.8,
  capMultiple: 3,
};

describe('governance voting power', () => {
  it('applies base, earn, decay, and cap exactly', () => {
    const events: TrophyEvent[] = [
      { memberIdx: 0, year: 1, kind: 'CHAMPIONSHIP' }, // age at year-3 vote: 1
      { memberIdx: 0, year: 2, kind: 'POINTS_TITLE' }, // age 0
      { memberIdx: 1, year: 2, kind: 'PLAYOFF_WIN' },
    ];
    const power = votingPower(events, MODEL, 3, 3);
    expect(power[0]).toBeCloseTo(1 + 1.0 * 0.8 + 0.5, 10);
    expect(power[1]).toBeCloseTo(1.25, 10);
    expect(power[2]).toBe(1);
  });

  it('future events never count, and the cap binds', () => {
    const events: TrophyEvent[] = Array.from({ length: 10 }, (_, i) => ({
      memberIdx: 0,
      year: i + 1,
      kind: 'CHAMPIONSHIP' as const,
    }));
    expect(votingPower(events, MODEL, 1, 2)[0]).toBe(1); // nothing played yet
    const capped = votingPower(events, { ...MODEL, decay: 1 }, 11, 2);
    expect(capped[0]).toBe(3); // 1 + 10 championships, capped at 3x base
  });

  it('power shares sum to 1', () => {
    const shares = powerShares([1, 2, 3, 4]);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});

describe('vote aggregation', () => {
  const prefs: Allocation[] = [
    PREF_ARCHETYPES['indexer'] as Allocation,
    PREF_ARCHETYPES['degen'] as Allocation,
  ];

  it('weighted-average blends by power and sums to 1', () => {
    const alloc = aggregateVotes(prefs, [3, 1], 'weighted-average');
    const total = ASSET_CLASSES.reduce((a, c) => a + alloc[c], 0);
    expect(total).toBeCloseTo(1, 10);
    expect(alloc.CRYPTO).toBeCloseTo(0.75 * 0.25, 10); // degen holds 1/4 of power
  });

  it('proposal voting is winner-take-all for the dominant bloc', () => {
    expect(aggregateVotes(prefs, [3, 1], 'proposal')).toEqual(PREF_ARCHETYPES['indexer']);
    expect(aggregateVotes(prefs, [1, 3], 'proposal')).toEqual(PREF_ARCHETYPES['degen']);
  });

  it('crypto cap redistributes the excess and keeps the total at 1', () => {
    const capped = applyCryptoCap(PREF_ARCHETYPES['degen'] as Allocation, 0.1);
    expect(capped.CRYPTO).toBeCloseTo(0.1, 10);
    const total = ASSET_CLASSES.reduce((a, c) => a + capped[c], 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('dynasty worlds', () => {
  it('is deterministic per seed and produces a full history', () => {
    const a = generateWorld(9001, 12, 20);
    const b = generateWorld(9001, 12, 20);
    expect(a.history.events.length).toBe(b.history.events.length);
    expect(a.indexOnlyTerminalCents).toBe(b.indexOnlyTerminalCents);
    expect(a.history.seasons.length).toBe(20);
    // 12 members x 14 weeks: 84 wins + champion + points title + 3 playoff wins per season
    const perSeason = a.history.events.length / 20;
    expect(perSeason).toBe(84 + 1 + 1 + 3);
  });

  it('evaluates governance with sane metric ranges', () => {
    const world = generateWorld(9002, 12, 20);
    const r = evaluateGovernance(world, {
      model: MODEL,
      aggregation: 'weighted-average',
      cryptoCap: 0.25,
      contributionPerYearCents: 100_000,
    });
    expect(r.terminalCents).toBeGreaterThan(0);
    expect(r.top1Share).toBeGreaterThan(1 / 12 - 1e-9);
    expect(r.top1Share).toBeLessThan(3 / (3 + 11)); // cap bound: 3 vs 11 floors
    expect(r.minShare).toBeGreaterThan(0);
    expect(r.meanCryptoWeight).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(r.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(r.maxDrawdown).toBeLessThan(1);
  });
});
