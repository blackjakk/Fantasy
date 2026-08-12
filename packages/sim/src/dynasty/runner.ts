import type { Cents } from '@fc/core';
import { Rng, mean, rankCorrelation } from '@fc/core';
import { simulateFantasyHistory, type FantasyHistory } from './fantasyHistory.js';
import { powerShares, votingPower, type GovernanceModel } from './governance.js';
import {
  aggregateVotes,
  annualReturnFactors,
  applyCryptoCap,
  runTreasury,
  PREF_ARCHETYPES,
  DEFAULT_PREF_MIX,
  type Aggregation,
  type Allocation,
  type AssetClass,
} from './treasury.js';

/**
 * A "world" is everything governance does NOT control: 20 years of fantasy
 * results, market returns, and member preferences. Worlds are generated once
 * per trial seed and shared by every governance variant, so metric differences
 * between variants isolate the governance rule — same paired-seed discipline
 * as the season experiments.
 */
export interface DynastyWorld {
  nMembers: number;
  years: number;
  history: FantasyHistory;
  returnsByYear: Record<AssetClass, number>[];
  prefs: Allocation[];
  /** Terminal value of the same world under a pure 100% index policy. */
  indexOnlyTerminalCents: Cents;
}

export interface DynastyGovConfig {
  model: GovernanceModel;
  aggregation: Aggregation;
  cryptoCap: number | null;
  contributionPerYearCents: Cents;
}

export interface DynastyTrialResult {
  terminalCents: Cents;
  maxDrawdown: number;
  meanCryptoWeight: number;
  /** Voting-power share of the top member / top 3 members at the final vote. */
  top1Share: number;
  top3Share: number;
  minShare: number;
  /** Spearman corr between true skill (lower error = better) and final power. */
  skillPowerCorr: number;
  /** True-skill rank (1 = best) of the most powerful member at year 20. */
  topPowerSkillRank: number;
  beatIndexOnly: boolean;
}

export function generateWorld(seed: number, nMembers: number, years: number): DynastyWorld {
  const rng = new Rng(seed);
  const history = simulateFantasyHistory(nMembers, years, rng.child('fantasy'));
  const marketRng = rng.child('markets');
  const returnsByYear = Array.from({ length: years }, () => annualReturnFactors(marketRng));
  const prefRng = rng.child('prefs');
  const mix = prefRng.shuffle(
    Array.from(
      { length: nMembers },
      (_, i) => DEFAULT_PREF_MIX[i % DEFAULT_PREF_MIX.length] as string,
    ),
  );
  const prefs = mix.map((k) => ({ ...(PREF_ARCHETYPES[k] as Allocation) }));

  const contribution = 100_000 as Cents; // placeholder; index baseline scales linearly
  const indexOnly = runTreasury(
    years,
    contribution * nMembers,
    () => ({ INDEX: 1, BONDS: 0, GOLD: 0, CRYPTO: 0 }),
    (year) => returnsByYear[year - 1] as Record<AssetClass, number>,
  );

  return {
    nMembers,
    years,
    history,
    returnsByYear,
    prefs,
    indexOnlyTerminalCents: indexOnly.terminalCents,
  };
}

export function evaluateGovernance(world: DynastyWorld, cfg: DynastyGovConfig): DynastyTrialResult {
  const { nMembers, years } = world;
  const cryptoWeights: number[] = [];

  const allocationForYear = (year: number): Allocation => {
    const power = votingPower(world.history.events, cfg.model, year, nMembers);
    const alloc = applyCryptoCap(
      aggregateVotes(world.prefs, power, cfg.aggregation),
      cfg.cryptoCap,
    );
    cryptoWeights.push(alloc.CRYPTO);
    return alloc;
  };

  const treasury = runTreasury(
    years,
    cfg.contributionPerYearCents * nMembers,
    allocationForYear,
    (year) => world.returnsByYear[year - 1] as Record<AssetClass, number>,
  );

  // Power structure at the final vote (after years-1 seasons; the "year 20 board").
  const finalPower = votingPower(world.history.events, cfg.model, years, nMembers);
  const shares = powerShares(finalPower).sort((a, b) => b - a);
  const top1Share = shares[0] ?? 0;
  const top3Share = (shares[0] ?? 0) + (shares[1] ?? 0) + (shares[2] ?? 0);
  const minShare = shares[shares.length - 1] ?? 0;

  // Merit: does final power track true skill? (Skill = negative mean error.)
  const trueSkill = world.history.meanSkillError.map((e) => -e);
  const skillPowerCorr = rankCorrelation(trueSkill, finalPower);
  let topPowerIdx = 0;
  for (let i = 1; i < nMembers; i++) {
    if ((finalPower[i] ?? 0) > (finalPower[topPowerIdx] ?? 0)) topPowerIdx = i;
  }
  const skillRanks = rankOf(trueSkill);
  const topPowerSkillRank = skillRanks[topPowerIdx] ?? nMembers;

  // Scale index baseline to this config's contribution level.
  const scale = cfg.contributionPerYearCents / 100_000;
  const indexTerminal = Math.round(world.indexOnlyTerminalCents * scale);

  return {
    terminalCents: treasury.terminalCents,
    maxDrawdown: treasury.maxDrawdown,
    meanCryptoWeight: mean(cryptoWeights),
    top1Share,
    top3Share,
    minShare,
    skillPowerCorr,
    topPowerSkillRank,
    beatIndexOnly: treasury.terminalCents > indexTerminal,
  };
}

function rankOf(values: number[]): number[] {
  const idx = values.map((v, i) => ({ v, i }));
  idx.sort((a, b) => b.v - a.v);
  const out = new Array<number>(values.length).fill(0);
  idx.forEach((x, rank) => (out[x.i] = rank + 1));
  return out;
}
