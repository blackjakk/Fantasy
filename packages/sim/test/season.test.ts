import { describe, expect, it } from 'vitest';
import { FORMULAS, type CapitalFormula } from '@fc/fantasy';
import { DEFAULT_MIX_12 } from '../src/bots.js';
import { computeMetrics } from '../src/metrics.js';
import { runSeason, type SeasonConfig } from '../src/seasonRunner.js';

const BASE: SeasonConfig = {
  seed: 42,
  nTeams: 12,
  weeks: 14,
  formula: FORMULAS['win15x'] as CapitalFormula,
  startingBankrollCents: 100_000,
  bettingCapPct: 0.3,
  desperationEnabled: false,
  botKeys: DEFAULT_MIX_12,
  listedPlayerCount: 20,
};

describe('season runner', () => {
  it('is exactly reproducible from its seed', () => {
    const a = runSeason(BASE);
    const b = runSeason(BASE);
    expect(a.teams.map((t) => t.finalNavCents)).toEqual(b.teams.map((t) => t.finalNavCents));
    expect(a.teams.map((t) => t.pointsFor)).toEqual(b.teams.map((t) => t.pointsFor));
  });

  it('different seeds produce different seasons', () => {
    const a = runSeason(BASE);
    const b = runSeason({ ...BASE, seed: 43 });
    expect(a.teams.map((t) => t.finalNavCents)).not.toEqual(b.teams.map((t) => t.finalNavCents));
  });

  it('every team plays a full schedule and generates capital', () => {
    const season = runSeason(BASE);
    for (const t of season.teams) {
      expect(t.wins + t.losses).toBe(BASE.weeks);
      expect(t.capitalGeneratedCents).toBeGreaterThan(0);
      expect(t.navByWeek.length).toBe(BASE.weeks + 1);
      expect(t.finalNavCents).toBeGreaterThan(0);
    }
    // League-wide wins must equal losses.
    const wins = season.teams.reduce((a, t) => a + t.wins, 0);
    const losses = season.teams.reduce((a, t) => a + t.losses, 0);
    expect(wins).toBe(losses);
  });

  it('betting cap 0 means nobody ever bets', () => {
    const season = runSeason({ ...BASE, bettingCapPct: 0, desperationEnabled: true });
    for (const t of season.teams) expect(t.betStats.count).toBe(0);
  });

  it.each([8, 10, 14])('runs a %i-team league', (n) => {
    const keys = Array.from(
      { length: n },
      (_, i) => DEFAULT_MIX_12[i % DEFAULT_MIX_12.length] as string,
    );
    const season = runSeason({ ...BASE, nTeams: n, botKeys: keys });
    expect(season.teams.length).toBe(n);
  });

  it('win multiplier increases capital for the same fantasy outcomes (paired seed)', () => {
    const flat = runSeason({ ...BASE, formula: FORMULAS['flat'] as CapitalFormula });
    const boosted = runSeason({ ...BASE, formula: FORMULAS['win2x'] as CapitalFormula });
    // Paired seeds + labeled rng streams: identical fantasy points, more capital.
    expect(flat.teams.map((t) => t.pointsFor)).toEqual(boosted.teams.map((t) => t.pointsFor));
    for (let i = 0; i < flat.teams.length; i++) {
      const flatTeam = flat.teams[i]!;
      const boostedTeam = boosted.teams[i]!;
      expect(boostedTeam.wins).toBe(flatTeam.wins);
      if (flatTeam.wins > 0) {
        // The multiplier only fires on wins; a winless team generates identical capital.
        expect(boostedTeam.capitalGeneratedCents).toBeGreaterThan(flatTeam.capitalGeneratedCents);
      } else {
        expect(boostedTeam.capitalGeneratedCents).toBe(flatTeam.capitalGeneratedCents);
      }
    }
  });

  it('metrics battery computes sane values', () => {
    const seasons = Array.from({ length: 25 }, (_, i) => runSeason({ ...BASE, seed: 500 + i }));
    const m = computeMetrics('test', seasons);
    expect(m.seasons).toBe(25);
    expect(m.spearmanPointsNav).toBeGreaterThan(0); // fantasy must matter
    expect(m.pChampIsPointsLeader).toBeGreaterThanOrEqual(0);
    expect(m.pChampIsPointsLeader).toBeLessThanOrEqual(1);
    expect(m.competitiveLateShare).toBeGreaterThan(0);
    expect(m.navSpreadP90P10).toBeGreaterThan(1);
  });
});
