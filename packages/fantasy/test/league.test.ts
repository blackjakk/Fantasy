import { describe, expect, it } from 'vitest';
import { Rng } from '@fc/core';
import {
  buildSchedule,
  generatePlayerPool,
  optimalLineup,
  ROSTER_SIZE,
  runSnakeDraft,
  samplePlayerWeek,
  type FantasyTeam,
} from '../src/index.js';

function makeTeams(n: number): FantasyTeam[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `T${i + 1}`,
    name: `Team ${i + 1}`,
    roster: [],
  }));
}

describe('player pool', () => {
  it('generates a full pool with sane point distributions', () => {
    const pool = generatePlayerPool(new Rng(1));
    expect(pool.length).toBe(232);
    const qbs = pool.filter((p) => p.position === 'QB');
    expect(qbs.length).toBe(32);
    const bestQb = Math.max(...qbs.map((q) => q.trueMean));
    expect(bestQb).toBeGreaterThan(18);
    expect(bestQb).toBeLessThan(30);
    for (const p of pool) {
      expect(p.trueMean).toBeGreaterThan(0);
      expect(p.trueSd).toBeGreaterThan(0);
    }
  });
});

describe('snake draft', () => {
  it('fills every roster with unique players', () => {
    const rng = new Rng(2);
    const pool = generatePlayerPool(rng.child('pool'));
    const teams = makeTeams(12);
    runSnakeDraft(teams, pool, { scoutingError: teams.map(() => 0.1) }, rng.child('draft'));
    const all = teams.flatMap((t) => t.roster);
    expect(new Set(all).size).toBe(12 * ROSTER_SIZE);
    for (const t of teams) expect(t.roster.length).toBe(ROSTER_SIZE);
  });

  it('every roster can field a full lineup', () => {
    const rng = new Rng(3);
    const pool = generatePlayerPool(rng.child('pool'));
    const byId = new Map(pool.map((p) => [p.id, p]));
    const teams = makeTeams(12);
    runSnakeDraft(teams, pool, { scoutingError: teams.map(() => 0.15) }, rng.child('draft'));
    for (const t of teams) {
      const roster = t.roster.map((id) => byId.get(id)!);
      const lineup = optimalLineup(roster, (p) => p.projection);
      expect(lineup.size).toBe(8);
    }
  });
});

describe('schedule', () => {
  it.each([8, 10, 12, 14])('every one of %i teams plays every week', (n) => {
    const ids = Array.from({ length: n }, (_, i) => `T${i + 1}`);
    const weeks = 14;
    const schedule = buildSchedule(ids, weeks);
    expect(schedule.length).toBe((n / 2) * weeks);
    for (let w = 1; w <= weeks; w++) {
      const games = schedule.filter((m) => m.week === w);
      const seen = new Set<string>();
      for (const g of games) {
        expect(g.homeTeamId).not.toBe(g.awayTeamId);
        seen.add(g.homeTeamId);
        seen.add(g.awayTeamId);
      }
      expect(seen.size).toBe(n);
    }
  });
});

describe('scoring', () => {
  it('is non-negative and centered near the true mean', () => {
    const rng = new Rng(4);
    const player = {
      id: 'X',
      name: 'X',
      position: 'RB' as const,
      trueMean: 15,
      trueSd: 6,
      projection: 15,
    };
    const xs = Array.from({ length: 5000 }, () => samplePlayerWeek(player, rng));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeGreaterThan(12);
    expect(mean).toBeLessThan(17);
  });
});
