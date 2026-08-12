import { Rng } from '@fc/core';
import type { NflPlayer, Position } from './types.js';

/**
 * Synthetic NFL player pool. Weekly means decay with positional rank following
 * roughly real half-PPR shapes (e.g. QB1 ~ 23 ppg, RB1 ~ 19, WR1 ~ 18, TE1 ~ 14,
 * with long flat tails of replacement-level players).
 */
interface PositionShape {
  position: Position;
  count: number;
  top: number; // mean of the best player at the position
  floor: number; // replacement-level mean
  decay: number; // exponential decay rate per rank
  sdRatio: number; // weekly sd as a fraction of mean
  sdMin: number;
}

const SHAPES: readonly PositionShape[] = [
  { position: 'QB', count: 32, top: 23, floor: 10, decay: 0.055, sdRatio: 0.32, sdMin: 4 },
  { position: 'RB', count: 70, top: 19, floor: 3, decay: 0.05, sdRatio: 0.42, sdMin: 3 },
  { position: 'WR', count: 90, top: 18, floor: 3, decay: 0.04, sdRatio: 0.42, sdMin: 3 },
  { position: 'TE', count: 40, top: 14, floor: 2, decay: 0.075, sdRatio: 0.45, sdMin: 2.5 },
];

const FIRST = [
  'Jax',
  'Marcus',
  'DeAndre',
  'Tyler',
  'Chris',
  'Justin',
  'Trey',
  'Jordan',
  'Zay',
  'Malik',
  'Drake',
  'Cade',
  'Bryce',
  'Kenny',
  'Rico',
  'Devon',
  'Amari',
  'Josh',
  'Nico',
  'Xavier',
  'Luther',
  'Reggie',
  'Sam',
  'Dante',
  'Elijah',
  'Cooper',
  'Miles',
  'Trent',
  'Omar',
  'Vince',
];
const LAST = [
  'Callahan',
  'Whitfield',
  'Okafor',
  'Brooks',
  'Delgado',
  'Hargrove',
  'Ellison',
  'McCray',
  'Stanton',
  'Vasquez',
  'Holloway',
  'Barnes',
  'Kirkland',
  'Doss',
  'Pemberton',
  'Ruiz',
  'Ashford',
  'Gatlin',
  'Mercer',
  'Overton',
  'Pruitt',
  'Sterling',
  'Twombly',
  'Ushery',
  'Voss',
  'Winslow',
  'Yates',
  'Zeller',
  'Quarles',
  'Ferris',
];

export function generatePlayerPool(rng: Rng): NflPlayer[] {
  const nameRng = rng.child('names');
  const statRng = rng.child('stats');
  const usedNames = new Set<string>();
  const players: NflPlayer[] = [];

  for (const shape of SHAPES) {
    for (let rank = 0; rank < shape.count; rank++) {
      const base =
        shape.floor +
        (shape.top - shape.floor) * Math.exp(-shape.decay * rank * (rank < 12 ? 1.6 : 1));
      // Individual variation so pools differ run to run.
      const trueMean = Math.max(1, base * statRng.uniform(0.92, 1.08));
      const trueSd = Math.max(shape.sdMin, trueMean * shape.sdRatio);
      // Public projections are a noisy view of the truth: this is where draft
      // skill and market mispricing come from.
      const projection = Math.max(1, trueMean * statRng.normal(1, 0.12));
      players.push({
        id: `${shape.position}${rank + 1}`,
        name: uniqueName(nameRng, usedNames),
        position: shape.position,
        trueMean: round1(trueMean),
        trueSd: round1(trueSd),
        projection: round1(projection),
      });
    }
  }
  return players;
}

function uniqueName(rng: Rng, used: Set<string>): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // Fall back to a suffixed name (only reachable if the pool nearly exhausts combinations).
  const name = `${rng.pick(FIRST)} ${rng.pick(LAST)} Jr.`;
  used.add(name);
  return name;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
