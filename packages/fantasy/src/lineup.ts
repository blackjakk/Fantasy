import type { NflPlayer, StarterSlot } from './types.js';

/**
 * Pick the optimal starting lineup by a value function (projection for bots,
 * trueMean for oracle analysis). Roster shape: QB, RB x2, WR x2, TE, FLEX
 * (RB/WR/TE), SUPERFLEX (QB/RB/WR/TE).
 */
export function optimalLineup(
  roster: NflPlayer[],
  value: (p: NflPlayer) => number,
): Map<StarterSlot, NflPlayer> {
  const remaining = new Set(roster);
  const lineup = new Map<StarterSlot, NflPlayer>();

  const take = (slot: StarterSlot, eligible: (p: NflPlayer) => boolean): void => {
    let best: NflPlayer | null = null;
    for (const p of remaining) {
      if (!eligible(p)) continue;
      if (best === null || value(p) > value(best)) best = p;
    }
    if (best !== null) {
      remaining.delete(best);
      lineup.set(slot, best);
    }
  };

  take('QB', (p) => p.position === 'QB');
  take('RB1', (p) => p.position === 'RB');
  take('RB2', (p) => p.position === 'RB');
  take('WR1', (p) => p.position === 'WR');
  take('WR2', (p) => p.position === 'WR');
  take('TE', (p) => p.position === 'TE');
  take('FLEX', (p) => p.position === 'RB' || p.position === 'WR' || p.position === 'TE');
  take('SUPERFLEX', () => true);
  return lineup;
}
