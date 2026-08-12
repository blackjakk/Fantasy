/**
 * Fantasy Capital — first vertical slice.
 *
 * One synthetic 12-team league, playable end to end in the terminal:
 * draft → weekly scores → matchups → capital generation → deploy capital
 * across simulated markets → NAV leaderboard → season awards.
 *
 *   pnpm slice                   scripted demo (deterministic)
 *   pnpm slice:interactive       you manage seat 1 yourself
 *   flags: --seed N --weeks N --formula win15x|win2x|fixedBonus|win125x|flat
 *          --bankroll dollars --cap 0.3|none
 */
import * as readline from 'node:readline/promises';
import { dollarsToCents, fmtPct, fmtUsd, Rng, type Cents } from '@fc/core';
import {
  buildSchedule,
  computeStandings,
  FORMULAS,
  generatePlayerPool,
  optimalLineup,
  runSnakeDraft,
  samplePlayerWeek,
  weeklyCapital,
  type CapitalFormula,
  type FantasyTeam,
  type MatchupResult,
  type NflPlayer,
} from '@fc/fantasy';
import { americanOdds, Market, type BetOffer } from '@fc/markets';
import { Portfolio } from '@fc/portfolio';
import { ALL_BOTS, maxAdditionalStake, type BotContext, type StrategyBot } from '@fc/sim';
import { box, rule, table } from './ui.js';

// ---------- configuration ----------

const argv = process.argv.slice(2);
const INTERACTIVE = argv.includes('--interactive');
const SEED = numFlag('--seed') ?? 20260812;
const WEEKS = numFlag('--weeks') ?? 14;
const FORMULA_KEY = strFlag('--formula') ?? 'win15x';
const FORMULA = resolveFormula(FORMULA_KEY);
function resolveFormula(key: string): CapitalFormula {
  const f = FORMULAS[key];
  if (!f) throw new Error(`unknown formula ${key} (try ${Object.keys(FORMULAS).join(', ')})`);
  return f;
}
const BANKROLL: Cents = dollarsToCents(numFlag('--bankroll') ?? 1000);
const CAP_FLAG = strFlag('--cap');
const BETTING_CAP: number | null =
  CAP_FLAG === 'none' ? null : CAP_FLAG !== null ? Number(CAP_FLAG) : 0.3;
// League odds cap (decimal). Default +600 (7.0): lottery tickets aren't sold.
const MAX_ODDS: number | null =
  strFlag('--max-odds') === 'none' ? null : (numFlag('--max-odds') ?? 7);

// ---------- league setup ----------

const rng = new Rng(SEED);
const pool = generatePlayerPool(rng.child('pool'));
const playerById = new Map(pool.map((p) => [p.id, p]));

const seatBots: (StrategyBot | null)[] = [
  null,
  ...ALL_BOTS.slice(0, 8),
  ALL_BOTS[7] ?? null,
  ALL_BOTS[0] ?? null,
  ALL_BOTS[1] ?? null,
];
const teams: FantasyTeam[] = seatBots.map((b, i) => ({
  id: `T${i + 1}`,
  name: i === 0 ? (INTERACTIVE ? 'You' : 'Brian Capital') : `${(b as StrategyBot).name} ${i + 1}`,
  roster: [],
}));
const teamIds = teams.map((t) => t.id);
const focusId = teamIds[0] as string;

const skillRng = rng.child('skill');
const otherSkills = skillRng.shuffle(
  teams.slice(1).map((_, i) => 0.06 + (0.24 * i) / (teams.length - 2)),
);
runSnakeDraft(teams, pool, { scoutingError: [0.08, ...otherSkills] }, rng.child('draft'));

const schedule = buildSchedule(teamIds, WEEKS);
const listedPlayers = [...pool].sort((a, b) => b.projection - a.projection).slice(0, 20);
const market = new Market({ listedPlayers, totalWeeks: WEEKS, maxDecimalOdds: MAX_ODDS });
const portfolios = new Map<string, Portfolio>(
  teamIds.map((id) => [id, new Portfolio(id, { maxOpenStakeFractionOfNav: BETTING_CAP })]),
);
if (BANKROLL > 0) for (const p of portfolios.values()) p.deposit(0, BANKROLL, 'starting bankroll');

const realizedAvg = new Map<string, number>(pool.map((p) => [p.id, p.projection]));
const perceived = (p: NflPlayer): number =>
  0.5 * p.projection + 0.5 * (realizedAvg.get(p.id) ?? p.projection);

const results: MatchupResult[] = [];
const capitalGenerated = new Map<string, Cents>(teamIds.map((id) => [id, 0]));
const lastWeek = new Map<
  string,
  { score: number; won: boolean; capital: Cents; opponent: string; oppScore: number }
>();
const parlayNet = new Map<string, Cents>(teamIds.map((id) => [id, 0]));
const bestWeekScore = new Map<string, number>(teamIds.map((id) => [id, 0]));
const scoreRng = rng.child('scores');
const botRng = rng.child('bots');
let stdinExhausted = false;

// ---------- game ----------

console.log(
  box(
    [
      'FANTASY CAPITAL — VERTICAL SLICE',
      '',
      `Seed ${SEED} · ${teams.length} teams · ${WEEKS} weeks`,
      `Formula: ${FORMULA_KEY} ($${(FORMULA.pointValueCents / 100).toFixed(2)}/pt, win x${FORMULA.winMultiplier}${FORMULA.winBonusCents ? `, +${fmtUsd(FORMULA.winBonusCents)} bonus` : ''})`,
      `Bankroll: ${fmtUsd(BANKROLL)} · Betting cap: ${BETTING_CAP === null ? 'none' : `${BETTING_CAP * 100}% of NAV`}`,
    ],
    58,
  ),
);

console.log(rule('SNAKE DRAFT — ROUND 1'));
console.log(
  table(
    ['Pick', 'Team', 'Player', 'Pos', 'Proj/wk'],
    teams.map((t, i) => {
      const p = playerById.get(t.roster[0] as string) as NflPlayer;
      return [String(i + 1), t.name, p.name, p.position, p.projection.toFixed(1)];
    }),
  ),
);

await playSeason();
printFinale();

// ---------- season loop (same ordering contract as the simulator) ----------

async function playSeason(): Promise<void> {
  for (let week = 1; week <= WEEKS; week++) {
    const offers = market.openWeek(week, rng);

    // Reward moment: last week's games settled, capital is in — deploy it.
    if (week > 1) printRewardMoment(week - 1);

    // Trading phase — everyone acts on prior information only.
    const navsEntering = teamIds.map((id) => (portfolios.get(id) as Portfolio).navCents(market));
    const leaderNav = Math.max(...navsEntering);
    for (let i = 1; i < teams.length; i++) {
      const ctx = botCtx(week, i, navsEntering, leaderNav, offers);
      (seatBots[i] as StrategyBot).act(ctx);
    }
    const focusCtx = botCtx(week, 0, navsEntering, leaderNav, offers);
    if (INTERACTIVE) await interactiveTurn(focusCtx);
    else scriptedFocusTurn(focusCtx);

    // Games play out.
    const weekPoints = new Map<string, number>();
    for (const p of pool) weekPoints.set(p.id, samplePlayerWeek(p, scoreRng));
    for (const m of schedule.filter((x) => x.week === week)) {
      const home = teams.find((t) => t.id === m.homeTeamId) as FantasyTeam;
      const away = teams.find((t) => t.id === m.awayTeamId) as FantasyTeam;
      const hs = teamScore(home, weekPoints);
      const as = teamScore(away, weekPoints);
      const winnerTeamId = hs >= as ? home.id : away.id;
      results.push({ ...m, homeScore: hs, awayScore: as, winnerTeamId });
      for (const [team, score, opp, oppScore] of [
        [home, hs, away, as],
        [away, as, home, hs],
      ] as const) {
        const won = winnerTeamId === team.id;
        const capital = weeklyCapital(score, won, FORMULA);
        (portfolios.get(team.id) as Portfolio).deposit(week, capital, `week ${week} capital`);
        capitalGenerated.set(team.id, (capitalGenerated.get(team.id) as Cents) + capital);
        lastWeek.set(team.id, { score, won, capital, opponent: opp.name, oppScore });
        if (score > (bestWeekScore.get(team.id) as number)) bestWeekScore.set(team.id, score);
      }
    }
    for (const p of pool) {
      realizedAvg.set(
        p.id,
        0.7 * (realizedAvg.get(p.id) as number) + 0.3 * (weekPoints.get(p.id) as number),
      );
    }

    // Markets realize the week.
    const outcome = market.stepWeek(weekPoints, rng);
    for (const [id, portfolio] of portfolios) {
      for (const [assetId, perShare] of outcome.dividendsPerShare)
        portfolio.applyDividend(week, assetId, perShare);
      for (const bet of portfolio.openBetList()) {
        const won = outcome.betOutcomes.get(bet.offer.id);
        if (won !== undefined && bet.offer.kind !== 'single') {
          const payout = won ? Math.round(bet.stakeCents * bet.offer.decimalOdds) : 0;
          parlayNet.set(id, (parlayNet.get(id) as Cents) + payout - bet.stakeCents);
        }
      }
      portfolio.settleWeek(week, outcome.betOutcomes);
      portfolio.checkInvariants(market);
    }

    printWeekBoard(week);
  }
}

function botCtx(
  week: number,
  seat: number,
  navs: Cents[],
  leaderNav: Cents,
  offers: BetOffer[],
): BotContext {
  const myNav = navs[seat] as Cents;
  return {
    week,
    weeksTotal: WEEKS,
    rng: botRng.child(`act-${week}-${seat}`),
    portfolio: portfolios.get(teamIds[seat] as string) as Portfolio,
    market,
    offers,
    bettingCapPct: BETTING_CAP,
    desperationEnabled: false,
    myRank: 1 + navs.filter((n) => n > myNav).length,
    leaderNavCents: leaderNav,
    nTeams: teams.length,
  };
}

function teamScore(team: FantasyTeam, weekPoints: Map<string, number>): number {
  const roster = team.roster.map((id) => playerById.get(id) as NflPlayer);
  let score = 0;
  for (const p of optimalLineup(roster, perceived).values()) score += weekPoints.get(p.id) ?? 0;
  return Math.round(score * 10) / 10;
}

// ---------- focus manager: scripted strategy ----------

function scriptedFocusTurn(ctx: BotContext): void {
  const cash = ctx.portfolio.cashCents();
  if (cash < 500) return;
  const cheapest = market.playerMarket
    .assets()
    .map((a) => ({
      id: a.id,
      ratio: market.quote(a.id) / Math.max(1, market.playerMarket.fairValueOf(a.id)),
    }))
    .sort((x, y) => x.ratio - y.ratio)[0];
  tryBuy(ctx, 'SPY', Math.floor(cash * 0.4));
  tryBuy(ctx, 'BTC', Math.floor(cash * 0.3));
  if (cheapest && market.playerMarket.weeksLeft() > 1)
    tryBuy(ctx, cheapest.id, Math.floor(cash * 0.2));
}

function tryBuy(ctx: BotContext, assetId: string, spend: Cents): void {
  const capped = Math.min(spend, ctx.portfolio.cashCents());
  if (capped >= 100) ctx.portfolio.buy(ctx.week, assetId, capped, ctx.market);
}

// ---------- focus manager: interactive turn ----------

async function interactiveTurn(ctx: BotContext): Promise<void> {
  if (stdinExhausted) {
    scriptedFocusTurn(ctx); // input ended (EOF/pipe): autopilot the remaining weeks
    return;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(rule(`WEEK ${ctx.week} — YOUR MOVE`));
  console.log(
    `Commands: p(ortfolio) · m(arket) · o(ffers) · buy SYM $X · sell SYM · bet N $X · done`,
  );
  const eof = new Promise<null>((resolve) => rl.once('close', () => resolve(null)));
  for (;;) {
    const answer = await Promise.race([rl.question('> '), eof]);
    if (answer === null) {
      stdinExhausted = true;
      break;
    }
    const line = answer.trim();
    if (line === '' || line === 'done' || line === 'd') break;
    try {
      handleCommand(ctx, line);
    } catch (err) {
      console.log(`  ! ${(err as Error).message}`);
    }
  }
  rl.close();
}

function handleCommand(ctx: BotContext, line: string): void {
  const [cmd, ...rest] = line.split(/\s+/);
  const p = ctx.portfolio;
  switch (cmd) {
    case 'p': {
      console.log(
        `  Cash ${fmtUsd(p.cashCents())} · NAV ${fmtUsd(p.navCents(market))} · Deposits ${fmtUsd(p.totalDepositsCents())} · Return ${fmtPct(p.investmentReturn(market))}`,
      );
      for (const pos of p.positionList()) {
        const value = Math.round((pos.qtyMicro * market.quote(pos.assetId)) / 1_000_000);
        console.log(
          `    ${symbolOf(pos.assetId).padEnd(12)} ${(pos.qtyMicro / 1_000_000).toFixed(4).padStart(12)} sh  ${fmtUsd(value).padStart(12)}  (cost ${fmtUsd(pos.costBasisCents)})`,
        );
      }
      for (const bet of p.openBetList())
        console.log(`    OPEN BET ${bet.offer.description} — stake ${fmtUsd(bet.stakeCents)}`);
      break;
    }
    case 'm': {
      for (const a of market.allAssets()) {
        const extra = market.isPlayerAsset(a.id)
          ? `  (consensus ${market.playerMarket.consensusOf(a.id).toFixed(1)} pts/wk, last wk ${market.playerMarket.lastWeekPointsOf(a.id).toFixed(1)})`
          : '';
        console.log(
          `    ${a.symbol.padEnd(12)} ${fmtUsd(market.quote(a.id)).padStart(12)}${extra}`,
        );
      }
      break;
    }
    case 'o': {
      ctx.offers.forEach((o, i) =>
        console.log(`    [${i + 1}] ${o.description.padEnd(30)} ${americanOdds(o.decimalOdds)}`),
      );
      break;
    }
    case 'buy': {
      const [sym, amt] = rest;
      const assetId = resolveSymbol(sym ?? '');
      const spend = parseDollars(amt ?? '');
      p.buy(ctx.week, assetId, spend, market);
      console.log(
        `  ✓ bought ${fmtUsd(spend)} of ${symbolOf(assetId)} @ ${fmtUsd(market.quote(assetId))}`,
      );
      break;
    }
    case 'sell': {
      const assetId = resolveSymbol(rest[0] ?? '');
      const proceeds = p.sell(ctx.week, assetId, 'all', market);
      console.log(`  ✓ sold ${symbolOf(assetId)} for ${fmtUsd(proceeds)}`);
      break;
    }
    case 'bet': {
      const idx = Number(rest[0]) - 1;
      const offer = ctx.offers[idx];
      if (!offer) throw new Error(`no offer #${rest[0]} (see 'o')`);
      const stake = parseDollars(rest[1] ?? '');
      if (stake > maxAdditionalStake(ctx)) {
        throw new Error(
          `league betting cap: max additional stake is ${fmtUsd(maxAdditionalStake(ctx))}`,
        );
      }
      p.placeBet(ctx.week, offer, stake, market);
      console.log(
        `  ✓ ${fmtUsd(stake)} on ${offer.description} (${americanOdds(offer.decimalOdds)})`,
      );
      break;
    }
    default:
      console.log(`  ? unknown command: ${cmd}`);
  }
}

function resolveSymbol(sym: string): string {
  const s = sym.toUpperCase();
  const hit = market
    .allAssets()
    .find((a) => a.symbol.toUpperCase() === s || a.id.toUpperCase() === s);
  if (!hit) throw new Error(`unknown asset ${sym} (see 'm')`);
  return hit.id;
}

function symbolOf(assetId: string): string {
  return market.allAssets().find((a) => a.id === assetId)?.symbol ?? assetId;
}

function parseDollars(raw: string): Cents {
  const v = Number(raw.replace(/^\$/, ''));
  if (!Number.isFinite(v) || v <= 0) throw new Error(`bad amount: ${raw}`);
  return dollarsToCents(v);
}

// ---------- reporting ----------

function printRewardMoment(settledWeek: number): void {
  const lw = lastWeek.get(focusId);
  if (!lw) return;
  const p = portfolios.get(focusId) as Portfolio;
  const base = Math.round(lw.score * FORMULA.pointValueCents);
  console.log(
    '\n' +
      box(
        [
          `WEEK ${settledWeek} SETTLED — ${(teams[0] as FantasyTeam).name}`,
          '',
          `Fantasy Score        ${lw.score.toFixed(1)}`,
          `vs ${lw.opponent.padEnd(18)} ${lw.oppScore.toFixed(1)}`,
          '',
          lw.won ? 'MATCHUP WON' : 'MATCHUP LOST',
          '',
          `Base Capital         ${fmtUsd(base, { sign: true })}`,
          `Multiplier           x${lw.won ? FORMULA.winMultiplier : FORMULA.lossMultiplier}${lw.won && FORMULA.winBonusCents ? ` + ${fmtUsd(FORMULA.winBonusCents)}` : ''}`,
          '',
          `CAPITAL GENERATED    ${fmtUsd(lw.capital, { sign: true })}`,
          `Portfolio NAV        ${fmtUsd(p.navCents(market))}`,
          '',
          '[ DEPLOY CAPITAL ]',
        ],
        46,
      ),
  );
}

function printWeekBoard(week: number): void {
  const rows = teamIds
    .map((id) => {
      const t = teams.find((x) => x.id === id) as FantasyTeam;
      const p = portfolios.get(id) as Portfolio;
      const s = computeStandings(teamIds, results).find((r) => r.teamId === id);
      return {
        name: t.name,
        record: `${s?.wins ?? 0}-${s?.losses ?? 0}`,
        capital: capitalGenerated.get(id) as Cents,
        nav: p.navCents(market),
        ret: p.investmentReturn(market),
      };
    })
    .sort((a, b) => b.nav - a.nav);
  console.log(rule(`WEEK ${week} — NAV LEADERBOARD`));
  console.log(
    table(
      ['#', 'Team', 'Record', 'Capital', 'Portfolio', 'Return'],
      rows.map((r, i) => [
        String(i + 1),
        r.name,
        r.record,
        fmtUsd(r.capital),
        fmtUsd(r.nav),
        fmtPct(r.ret),
      ]),
    ),
  );
}

function printFinale(): void {
  printRewardMoment(WEEKS);
  const standings = computeStandings(teamIds, results);
  const fantasyChamp = standings[0];
  const byNav = teamIds
    .map((id) => ({
      id,
      name: (teams.find((t) => t.id === id) as FantasyTeam).name,
      nav: (portfolios.get(id) as Portfolio).navCents(market),
      ret: (portfolios.get(id) as Portfolio).investmentReturn(market),
    }))
    .sort((a, b) => b.nav - a.nav);
  const bestReturn = [...byNav].sort((a, b) => b.ret - a.ret)[0];
  const bestScore = [...bestWeekScore.entries()].sort((a, b) => b[1] - a[1])[0];
  const biggestHit = [...parlayNet.entries()].sort((a, b) => b[1] - a[1])[0];

  console.log(rule('SEASON COMPLETE — TROPHIES'));
  const nameOf = (id: string): string => (teams.find((t) => t.id === id) as FantasyTeam).name;
  console.log(
    box(
      [
        `CAPITAL CHAMPION      ${byNav[0]?.name ?? '—'}`,
        `  Final NAV           ${fmtUsd(byNav[0]?.nav ?? 0)}`,
        '',
        `FANTASY CHAMPION      ${fantasyChamp ? nameOf(fantasyChamp.teamId) : '—'}`,
        `  Record              ${fantasyChamp?.wins}-${fantasyChamp?.losses}`,
        '',
        `BEST INVESTOR         ${bestReturn?.name ?? '—'} (${fmtPct(bestReturn?.ret ?? 0)})`,
        `HIGHEST WEEK SCORE    ${bestScore ? `${nameOf(bestScore[0])} (${bestScore[1].toFixed(1)})` : '—'}`,
        `MIRACLE HIT (parlay)  ${biggestHit && biggestHit[1] > 0 ? `${nameOf(biggestHit[0])} (${fmtUsd(biggestHit[1], { sign: true })})` : 'nobody'}`,
      ],
      52,
    ),
  );
}

function numFlag(name: string): number | null {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return null;
  const v = Number(argv[i + 1]);
  if (!Number.isFinite(v)) throw new Error(`bad value for ${name}`);
  return v;
}

function strFlag(name: string): string | null {
  const i = argv.indexOf(name);
  return i === -1 || i + 1 >= argv.length ? null : (argv[i + 1] as string);
}
