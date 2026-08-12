/**
 * Dynasty Treasury governance: fantasy results earn VOICE (voting power),
 * never ownership. Economic shares stay strictly pro-rata to contributions —
 * that split is the load-bearing design rule (see docs/DYNASTY.md).
 *
 * votingPower(member, year) =
 *   base + Σ over past trophy events of earnWeight(kind) x decay^(age in years)
 * then capped at capMultiple x base (cap applies to the total).
 */
export type TrophyKind = 'CHAMPIONSHIP' | 'POINTS_TITLE' | 'PLAYOFF_WIN' | 'REG_SEASON_WIN';

export interface TrophyEvent {
  memberIdx: number;
  /** Season number (1-based) in which the trophy was earned. */
  year: number;
  kind: TrophyKind;
}

export interface GovernanceModel {
  key: string;
  /** Voice every member always holds, independent of results. */
  base: number;
  earn: Record<TrophyKind, number>;
  /** Per-year multiplier applied to earned voice (1 = trophies never fade). */
  decay: number;
  /** Max total power as a multiple of base (null = uncapped). */
  capMultiple: number | null;
}

export const TROPHY_EARN: Record<TrophyKind, number> = {
  CHAMPIONSHIP: 1.0,
  POINTS_TITLE: 0.5,
  PLAYOFF_WIN: 0.25,
  REG_SEASON_WIN: 0,
};

export const WINS_EARN: Record<TrophyKind, number> = {
  CHAMPIONSHIP: 0,
  POINTS_TITLE: 0,
  PLAYOFF_WIN: 0,
  REG_SEASON_WIN: 0.04,
};

export const BLENDED_EARN: Record<TrophyKind, number> = {
  CHAMPIONSHIP: 0.5,
  POINTS_TITLE: 0.25,
  PLAYOFF_WIN: 0.125,
  REG_SEASON_WIN: 0.02,
};

/**
 * Power of every member for the vote held at the START of `voteYear`
 * (i.e. seasons 1..voteYear-1 have been played).
 */
export function votingPower(
  events: TrophyEvent[],
  model: GovernanceModel,
  voteYear: number,
  memberCount: number,
): number[] {
  const power = new Array<number>(memberCount).fill(model.base);
  for (const e of events) {
    if (e.year >= voteYear) continue;
    const age = voteYear - 1 - e.year;
    power[e.memberIdx] =
      (power[e.memberIdx] ?? model.base) + model.earn[e.kind] * Math.pow(model.decay, age);
  }
  if (model.capMultiple !== null) {
    const cap = model.capMultiple * model.base;
    for (let i = 0; i < memberCount; i++) power[i] = Math.min(power[i] ?? 0, cap);
  }
  return power;
}

/** Shares (summing to 1) of total voting power. */
export function powerShares(power: number[]): number[] {
  const total = power.reduce((a, b) => a + b, 0);
  if (total <= 0) return power.map(() => 1 / power.length);
  return power.map((p) => p / total);
}
