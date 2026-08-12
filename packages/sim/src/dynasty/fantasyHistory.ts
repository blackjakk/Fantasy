import { Rng } from '@fc/core';
import type { FantasyTeam, NflPlayer } from '@fc/fantasy';
import {
  buildSchedule,
  computeStandings,
  generatePlayerPool,
  optimalLineup,
  runSnakeDraft,
  samplePlayerWeek,
} from '@fc/fantasy';
import type { TrophyEvent } from './governance.js';

/**
 * Multi-season fantasy history for a dynasty league, using the real fantasy
 * engine (fresh pool + redraft each season, 14-week round robin, top-4
 * playoff: semifinals + final).
 *
 * Member skill persists across seasons with slow drift and occasional regime
 * changes (life happens over 20 years), producing realistic dynasties AND
 * eventual turnover — exactly the tension governance decay must handle.
 */
export interface SeasonSummary {
  year: number;
  wins: number[];
  pointsFor: number[];
  championIdx: number;
  pointsTitleIdx: number;
}

export interface FantasyHistory {
  seasons: SeasonSummary[];
  events: TrophyEvent[];
  /** Mean scouting error per member across all seasons (lower = truly better). */
  meanSkillError: number[];
}

export function simulateFantasyHistory(nMembers: number, years: number, rng: Rng): FantasyHistory {
  const skillRng = rng.child('skill');
  // Initial skill spread, decoupled from member index.
  let skills = skillRng.shuffle(
    Array.from({ length: nMembers }, (_, i) => 0.05 + (0.25 * i) / (nMembers - 1)),
  );
  const skillSums = new Array<number>(nMembers).fill(0);
  const seasons: SeasonSummary[] = [];
  const events: TrophyEvent[] = [];

  for (let year = 1; year <= years; year++) {
    const yearRng = rng.child(`year-${year}`);
    const summary = simulateOneSeason(nMembers, skills, yearRng);
    seasons.push({ ...summary, year });

    events.push({ memberIdx: summary.championIdx, year, kind: 'CHAMPIONSHIP' });
    events.push({ memberIdx: summary.pointsTitleIdx, year, kind: 'POINTS_TITLE' });
    for (const idx of summary.playoffWinnerIdxs)
      events.push({ memberIdx: idx, year, kind: 'PLAYOFF_WIN' });
    for (let i = 0; i < nMembers; i++) {
      for (let w = 0; w < (summary.wins[i] ?? 0); w++) {
        events.push({ memberIdx: i, year, kind: 'REG_SEASON_WIN' });
      }
    }

    for (let i = 0; i < nMembers; i++) skillSums[i] = (skillSums[i] ?? 0) + (skills[i] ?? 0);

    // Skill drift + occasional regime change.
    const driftRng = rng.child(`drift-${year}`);
    skills = skills.map((s) => {
      if (driftRng.chance(0.05)) return driftRng.uniform(0.05, 0.3);
      return Math.min(0.3, Math.max(0.05, s + driftRng.normal(0, 0.02)));
    });
  }

  return {
    seasons,
    events,
    meanSkillError: skillSums.map((s) => s / years),
  };
}

interface OneSeason {
  wins: number[];
  pointsFor: number[];
  championIdx: number;
  pointsTitleIdx: number;
  playoffWinnerIdxs: number[];
}

function simulateOneSeason(nMembers: number, skills: number[], rng: Rng): OneSeason {
  const weeks = 14;
  const pool = generatePlayerPool(rng.child('pool'));
  const byId = new Map(pool.map((p) => [p.id, p]));
  const teams: FantasyTeam[] = Array.from({ length: nMembers }, (_, i) => ({
    id: `M${i}`,
    name: `M${i}`,
    roster: [],
  }));
  runSnakeDraft(teams, pool, { scoutingError: skills }, rng.child('draft'));
  const schedule = buildSchedule(
    teams.map((t) => t.id),
    weeks,
  );

  const scoreRng = rng.child('scores');
  const teamScore = (team: FantasyTeam): number => {
    const roster = team.roster.map((id) => byId.get(id) as NflPlayer);
    const lineup = optimalLineup(roster, (p) => p.projection);
    let score = 0;
    for (const p of lineup.values()) score += samplePlayerWeek(p, scoreRng);
    return Math.round(score * 10) / 10;
  };

  const results = [];
  for (let week = 1; week <= weeks; week++) {
    for (const m of schedule.filter((x) => x.week === week)) {
      const home = teams.find((t) => t.id === m.homeTeamId) as FantasyTeam;
      const away = teams.find((t) => t.id === m.awayTeamId) as FantasyTeam;
      const hs = teamScore(home);
      const as = teamScore(away);
      results.push({
        ...m,
        homeScore: hs,
        awayScore: as,
        winnerTeamId: hs >= as ? home.id : away.id,
      });
    }
  }
  const standings = computeStandings(
    teams.map((t) => t.id),
    results,
  );
  const idxOf = (teamId: string): number => teams.findIndex((t) => t.id === teamId);

  // Top-4 playoff: 1v4 and 2v3 semifinals, winners meet in the final.
  const seeds = standings.slice(0, 4).map((s) => idxOf(s.teamId));
  const playoffScore = (idx: number): number => teamScore(teams[idx] as FantasyTeam);
  const semi = (a: number, b: number): number => (playoffScore(a) >= playoffScore(b) ? a : b);
  const finalist1 = semi(seeds[0] as number, seeds[3] as number);
  const finalist2 = semi(seeds[1] as number, seeds[2] as number);
  const championIdx = semi(finalist1, finalist2);

  const playoffWinnerIdxs = [finalist1, finalist2, championIdx]; // semi wins + final win

  const winsByIdx = new Array<number>(nMembers).fill(0);
  const pfByIdx = new Array<number>(nMembers).fill(0);
  for (const s of standings) {
    winsByIdx[idxOf(s.teamId)] = s.wins;
    pfByIdx[idxOf(s.teamId)] = s.pointsFor;
  }
  let pointsTitleIdx = 0;
  for (let i = 1; i < nMembers; i++) {
    if ((pfByIdx[i] ?? 0) > (pfByIdx[pointsTitleIdx] ?? 0)) pointsTitleIdx = i;
  }

  return { wins: winsByIdx, pointsFor: pfByIdx, championIdx, pointsTitleIdx, playoffWinnerIdxs };
}
