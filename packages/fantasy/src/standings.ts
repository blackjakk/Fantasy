import type { MatchupResult, StandingsRow } from './types.js';

export function computeStandings(teamIds: string[], results: MatchupResult[]): StandingsRow[] {
  const rows = new Map<string, StandingsRow>(
    teamIds.map((id) => [id, { teamId: id, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }]),
  );
  for (const r of results) {
    const home = rows.get(r.homeTeamId);
    const away = rows.get(r.awayTeamId);
    if (!home || !away)
      throw new Error(`result references unknown team: ${r.homeTeamId} vs ${r.awayTeamId}`);
    home.pointsFor += r.homeScore;
    home.pointsAgainst += r.awayScore;
    away.pointsFor += r.awayScore;
    away.pointsAgainst += r.homeScore;
    if (r.winnerTeamId === r.homeTeamId) {
      home.wins++;
      away.losses++;
    } else {
      away.wins++;
      home.losses++;
    }
  }
  return [...rows.values()].sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor);
}
