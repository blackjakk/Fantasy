import type { Matchup } from './types.js';

/**
 * Round-robin schedule via the circle method. With 12 teams and 14 weeks each
 * team plays every other team once (11 weeks), then the first 3 rounds repeat.
 */
export function buildSchedule(teamIds: string[], weeks: number): Matchup[] {
  const n = teamIds.length;
  if (n % 2 !== 0) throw new Error('league size must be even');
  const rounds: Matchup[][] = [];
  const rotating = teamIds.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const round: Matchup[] = [];
    const fixed = teamIds[0] as string;
    const others = rotating
      .slice(r % rotating.length)
      .concat(rotating.slice(0, r % rotating.length));
    round.push({ week: 0, homeTeamId: fixed, awayTeamId: others[0] as string });
    for (let i = 1; i < n / 2; i++) {
      round.push({
        week: 0,
        homeTeamId: others[i] as string,
        awayTeamId: others[n - 1 - i] as string,
      });
    }
    rounds.push(round);
  }
  const out: Matchup[] = [];
  for (let w = 1; w <= weeks; w++) {
    const round = rounds[(w - 1) % rounds.length] as Matchup[];
    for (const m of round) out.push({ ...m, week: w });
  }
  return out;
}
