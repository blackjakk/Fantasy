import { mean, median, quantile, rankCorrelation } from '@fc/core';
import type { SeasonResult, TeamSeason } from './seasonRunner.js';

/**
 * The metric battery: everything we need to judge whether a rule set produces
 * competitive, interesting seasons. Computed over many Monte Carlo seasons of
 * a single config.
 */
export interface ConfigMetrics {
  label: string;
  seasons: number;
  /** Median champion final NAV (dollars, for eyeballing scale). */
  medianChampionNavUsd: number;
  medianChampionReturn: number;
  /** Rank correlation between total fantasy points and final NAV (fantasy relevance). */
  spearmanPointsNav: number;
  /** Rank correlation between investment return and final NAV (investing relevance). */
  spearmanReturnNav: number;
  pChampIsPointsLeader: number;
  pChampIsReturnLeader: number;
  /** P(the objectively best-drafted roster wins the capital title). */
  pChampIsBestRoster: number;
  /** P(the NAV leader at the 60% mark of the season wins). */
  leaderPersistence: number;
  /** P(champion was outside the NAV top 3 at the 60% mark). */
  comebackRate: number;
  /** Mean share of teams within 80% of the leader NAV with 4 weeks left. */
  competitiveLateShare: number;
  /** P(champion's net parlay/longshot winnings exceed the title margin). */
  gamblingTitleRate: number;
  /** p90/p10 of final NAVs pooled across seasons (inequality of outcomes). */
  navSpreadP90P10: number;
  /** Champion rate per bot, normalized so 1.0 = fair share given seats held. */
  botWinIndex: Record<string, number>;
  botMeanReturn: Record<string, number>;
  /** P(the skilled seat finishes top-3 NAV); NaN if no skilled seat. */
  skilledTop3Rate: number;
  meanChampionDrawdown: number;
}

export function computeMetrics(label: string, seasons: SeasonResult[]): ConfigMetrics {
  if (seasons.length === 0) throw new Error('no seasons');
  const first = seasons[0] as SeasonResult;
  const weeks = first.config.weeks;
  const nTeams = first.config.nTeams;
  const checkpoint = Math.round(weeks * 0.6); // e.g. week 8 of 14
  const lateWeek = Math.max(1, weeks - 4);

  const championNavs: number[] = [];
  const championReturns: number[] = [];
  const championDrawdowns: number[] = [];
  const pointsNavCorrs: number[] = [];
  const returnNavCorrs: number[] = [];
  let champIsPointsLeader = 0;
  let champIsReturnLeader = 0;
  let champIsBestRoster = 0;
  let leaderPersist = 0;
  let comebacks = 0;
  const lateCompetitiveShares: number[] = [];
  let gamblingTitles = 0;
  const allFinalNavs: number[] = [];
  const champCountByBot = new Map<string, number>();
  const seatsByBot = new Map<string, number>();
  const returnsByBot = new Map<string, number[]>();
  let skilledTop3 = 0;
  let skilledSeasons = 0;

  for (const season of seasons) {
    const teams = season.teams;
    const byNav = [...teams].sort((a, b) => b.finalNavCents - a.finalNavCents);
    const champ = byNav[0] as TeamSeason;
    const second = byNav[1] as TeamSeason;

    championNavs.push(champ.finalNavCents / 100);
    championReturns.push(champ.investmentReturn);
    championDrawdowns.push(champ.maxDrawdown);
    allFinalNavs.push(...teams.map((t) => t.finalNavCents));

    pointsNavCorrs.push(
      rankCorrelation(
        teams.map((t) => t.pointsFor),
        teams.map((t) => t.finalNavCents),
      ),
    );
    returnNavCorrs.push(
      rankCorrelation(
        teams.map((t) => t.investmentReturn),
        teams.map((t) => t.finalNavCents),
      ),
    );

    const pointsLeader = teams.reduce((a, b) => (b.pointsFor > a.pointsFor ? b : a));
    const returnLeader = teams.reduce((a, b) => (b.investmentReturn > a.investmentReturn ? b : a));
    const bestRoster = teams.reduce((a, b) => (b.oracleStrength > a.oracleStrength ? b : a));
    if (champ.teamId === pointsLeader.teamId) champIsPointsLeader++;
    if (champ.teamId === returnLeader.teamId) champIsReturnLeader++;
    if (champ.teamId === bestRoster.teamId) champIsBestRoster++;

    const champRankAtCheckpoint = champ.rankByWeek[checkpoint - 1] ?? 1;
    if (champRankAtCheckpoint === 1) leaderPersist++;
    if (champRankAtCheckpoint > 3) comebacks++;

    const lateNavs = teams.map((t) => t.navByWeek[lateWeek] ?? 0);
    const lateLeader = Math.max(...lateNavs);
    if (lateLeader > 0) {
      lateCompetitiveShares.push(lateNavs.filter((n) => n >= 0.8 * lateLeader).length / nTeams);
    }

    const margin = champ.finalNavCents - second.finalNavCents;
    if (champ.betStats.parlayNetCents > 0 && champ.betStats.parlayNetCents > margin)
      gamblingTitles++;

    for (const t of teams) {
      seatsByBot.set(t.botKey, (seatsByBot.get(t.botKey) ?? 0) + 1);
      const rs = returnsByBot.get(t.botKey) ?? [];
      rs.push(t.investmentReturn);
      returnsByBot.set(t.botKey, rs);
    }
    champCountByBot.set(champ.botKey, (champCountByBot.get(champ.botKey) ?? 0) + 1);

    const skilledSeats = teams.filter((t) => t.botKey === 'skilled');
    if (skilledSeats.length > 0) {
      skilledSeasons++;
      const top3Ids = new Set(byNav.slice(0, 3).map((t) => t.teamId));
      if (skilledSeats.some((t) => top3Ids.has(t.teamId))) skilledTop3++;
    }
  }

  const n = seasons.length;
  const botWinIndex: Record<string, number> = {};
  const botMeanReturn: Record<string, number> = {};
  for (const [bot, seats] of seatsByBot) {
    // Observed championship rate vs fair share given seats held (1.0 = fair).
    const winRate = (champCountByBot.get(bot) ?? 0) / n;
    const fairShare = seats / n / nTeams;
    botWinIndex[bot] = fairShare > 0 ? winRate / fairShare : 0;
    botMeanReturn[bot] = mean(returnsByBot.get(bot) ?? []);
  }

  return {
    label,
    seasons: n,
    medianChampionNavUsd: Math.round(median(championNavs)),
    medianChampionReturn: median(championReturns),
    spearmanPointsNav: mean(pointsNavCorrs),
    spearmanReturnNav: mean(returnNavCorrs),
    pChampIsPointsLeader: champIsPointsLeader / n,
    pChampIsReturnLeader: champIsReturnLeader / n,
    pChampIsBestRoster: champIsBestRoster / n,
    leaderPersistence: leaderPersist / n,
    comebackRate: comebacks / n,
    competitiveLateShare: mean(lateCompetitiveShares),
    gamblingTitleRate: gamblingTitles / n,
    navSpreadP90P10: quantile(allFinalNavs, 0.9) / Math.max(1, quantile(allFinalNavs, 0.1)),
    botWinIndex,
    botMeanReturn,
    skilledTop3Rate: skilledSeasons > 0 ? skilledTop3 / skilledSeasons : NaN,
    meanChampionDrawdown: mean(championDrawdowns),
  };
}
