import { Rng } from '@fc/core';
import type { FantasyTeam, NflPlayer, Position } from './types.js';
import { ROSTER_SIZE } from './types.js';

/**
 * Snake draft with bot drafters. Each drafter evaluates players by the public
 * projection plus a personal scouting error; the size of that error is the
 * team's "fantasy skill" knob (lower error = better drafter). This produces a
 * realistic spread of roster quality across the league.
 */
export interface DraftConfig {
  /** Per-team scouting error (sd of multiplicative noise on projections). ~0.05 sharp, ~0.30 clueless. */
  scoutingError: number[];
}

const STARTER_NEEDS: Record<Position, number> = { QB: 1, RB: 2, WR: 2, TE: 1 };
// FLEX + SUPERFLEX give extra value to RB/WR/QB depth; drafters slightly
// overweight scarce starter needs early.

export function runSnakeDraft(
  teams: FantasyTeam[],
  pool: NflPlayer[],
  cfg: DraftConfig,
  rng: Rng,
): void {
  if (cfg.scoutingError.length !== teams.length) {
    throw new Error('scoutingError must have one entry per team');
  }
  const available = new Set(pool.map((p) => p.id));
  const byId = new Map(pool.map((p) => [p.id, p]));
  // Each drafter's private board: projection distorted by their scouting error.
  const boards = teams.map((_, i) => {
    const err = cfg.scoutingError[i] as number;
    const boardRng = rng.child(`board-${i}`);
    const values = new Map<string, number>();
    for (const p of pool) values.set(p.id, p.projection * Math.max(0.2, boardRng.normal(1, err)));
    return values;
  });

  const rounds = ROSTER_SIZE;
  for (let round = 0; round < rounds; round++) {
    const order =
      round % 2 === 0 ? teams.map((_, i) => i) : teams.map((_, i) => teams.length - 1 - i);
    for (const teamIdx of order) {
      const team = teams[teamIdx] as FantasyTeam;
      const board = boards[teamIdx] as Map<string, number>;
      const pickId = bestPick(team, board, available, byId);
      available.delete(pickId);
      team.roster.push(pickId);
    }
  }
}

function bestPick(
  team: FantasyTeam,
  board: Map<string, number>,
  available: Set<string>,
  byId: Map<string, NflPlayer>,
): string {
  const counts: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const id of team.roster) counts[(byId.get(id) as NflPlayer).position]++;

  let bestId: string | null = null;
  let bestValue = -Infinity;
  for (const id of available) {
    const player = byId.get(id) as NflPlayer;
    const need = STARTER_NEEDS[player.position] - counts[player.position];
    // Positional need bonus: unfilled starter slots matter, superflex keeps a
    // second QB relevant, and hoarding a 4th TE is penalized.
    let needFactor = 1;
    if (need > 0) needFactor = 1.25;
    else if (player.position === 'QB' && counts.QB < 2) needFactor = 1.1;
    else if (counts[player.position] >= STARTER_NEEDS[player.position] + 3) needFactor = 0.6;
    const value = (board.get(id) as number) * needFactor;
    if (value > bestValue) {
      bestValue = value;
      bestId = id;
    }
  }
  if (bestId === null) throw new Error('draft pool exhausted');
  return bestId;
}
