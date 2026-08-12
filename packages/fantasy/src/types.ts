export type Position = 'QB' | 'RB' | 'WR' | 'TE';

export interface NflPlayer {
  id: string;
  name: string;
  position: Position;
  /** True mean weekly fantasy points (half-PPR scale). Hidden from managers. */
  trueMean: number;
  /** True weekly standard deviation. */
  trueSd: number;
  /** Public consensus projection of weekly points (noisy view of trueMean). */
  projection: number;
}

export type StarterSlot = 'QB' | 'RB1' | 'RB2' | 'WR1' | 'WR2' | 'TE' | 'FLEX' | 'SUPERFLEX';

export const STARTER_SLOTS: readonly StarterSlot[] = [
  'QB',
  'RB1',
  'RB2',
  'WR1',
  'WR2',
  'TE',
  'FLEX',
  'SUPERFLEX',
];

export const BENCH_SIZE = 5;
export const ROSTER_SIZE = STARTER_SLOTS.length + BENCH_SIZE;

export interface FantasyTeam {
  id: string;
  name: string;
  /** All rostered player ids, in draft order. */
  roster: string[];
}

export interface Matchup {
  week: number;
  homeTeamId: string;
  awayTeamId: string;
}

export interface MatchupResult extends Matchup {
  homeScore: number;
  awayScore: number;
  winnerTeamId: string;
}

export interface TeamWeek {
  teamId: string;
  week: number;
  /** Starter player ids in STARTER_SLOTS order. */
  starters: string[];
  /** Points per starter, aligned with `starters`. */
  starterPoints: number[];
  score: number;
  won: boolean;
}

export interface StandingsRow {
  teamId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}
