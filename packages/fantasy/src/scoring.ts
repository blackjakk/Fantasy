import { Rng } from '@fc/core';
import type { NflPlayer } from './types.js';

/**
 * Sample one week of fantasy points for a player. Truncated normal around the
 * player's true mean, with a small chance of a dud week (game script/minor
 * injury) and a small chance of a spike week.
 */
export function samplePlayerWeek(player: NflPlayer, rng: Rng): number {
  let pts = rng.normal(player.trueMean, player.trueSd);
  if (rng.chance(0.06))
    pts *= 0.25; // dud: benched early, blowout, tweak
  else if (rng.chance(0.05)) pts *= 1.6; // spike: multi-TD explosion
  return Math.max(0, Math.round(pts * 10) / 10);
}
