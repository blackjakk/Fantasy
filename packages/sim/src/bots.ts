import type { Cents } from '@fc/core';
import { Rng } from '@fc/core';
import type { BetOffer, Market } from '@fc/markets';
import type { Portfolio } from '@fc/portfolio';

/**
 * Strategy bots: each models one archetype of manager so the simulator can
 * measure how different allocation styles fare under different league rules.
 * Bots only see public information (prices, offers, their own portfolio) —
 * except `skilled`, which is deliberately given an information edge to measure
 * how much skill can matter.
 */
export interface BotContext {
  week: number;
  weeksTotal: number;
  rng: Rng;
  portfolio: Portfolio;
  market: Market;
  offers: BetOffer[];
  /** League rule: max fraction of NAV in open sportsbook stakes (null = uncapped, 0 = banned). */
  bettingCapPct: number | null;
  /** League rule under test: trailing managers ramp variance late in the season. */
  desperationEnabled: boolean;
  /** NAV rank entering this week (1 = leader). */
  myRank: number;
  leaderNavCents: Cents;
  nTeams: number;
}

export interface StrategyBot {
  key: string;
  name: string;
  act(ctx: BotContext): void;
}

const MIN_TRADE: Cents = 100; // $1 minimum ticket

/** Additional stake allowed under the league's betting cap. */
export function maxAdditionalStake(ctx: BotContext): Cents {
  const cash = ctx.portfolio.cashCents();
  if (ctx.bettingCapPct === null) return cash;
  const nav = ctx.portfolio.navCents(ctx.market);
  const allowed = Math.floor(nav * ctx.bettingCapPct) - ctx.portfolio.openBetStakesCents();
  return Math.max(0, Math.min(cash, allowed));
}

/**
 * Endgame game theory: when far behind with a few weeks left, rational
 * managers reach for variance. Applied to every bot when the league setting
 * is on, so experiments can measure how degenerate this makes the endgame.
 */
function desperationBet(ctx: BotContext): void {
  if (!ctx.desperationEnabled) return;
  const weeksLeft = ctx.weeksTotal - ctx.week + 1;
  if (weeksLeft > 3) return;
  if (ctx.myRank <= Math.ceil(ctx.nTeams / 3)) return;
  const myNav = ctx.portfolio.navCents(ctx.market);
  if (myNav >= 0.75 * ctx.leaderNavCents) return;
  const ticket =
    ctx.offers.find((o) => o.kind === 'longshot') ?? ctx.offers.find((o) => o.kind === 'parlay');
  if (!ticket) return;
  const stake = Math.min(maxAdditionalStake(ctx), Math.floor(ctx.portfolio.cashCents() * 0.4));
  if (stake >= MIN_TRADE) ctx.portfolio.placeBet(ctx.week, ticket, stake, ctx.market);
}

function buyIfAffordable(ctx: BotContext, assetId: string, spend: Cents): void {
  const capped = Math.min(spend, ctx.portfolio.cashCents());
  if (capped >= MIN_TRADE) ctx.portfolio.buy(ctx.week, assetId, capped, ctx.market);
}

const passiveIndex: StrategyBot = {
  key: 'passive-index',
  name: 'Passive Index',
  act(ctx) {
    desperationBet(ctx);
    buyIfAffordable(ctx, 'SPY', ctx.portfolio.cashCents());
  },
};

const cryptoBull: StrategyBot = {
  key: 'crypto-bull',
  name: 'Crypto Bull',
  act(ctx) {
    desperationBet(ctx);
    const cash = ctx.portfolio.cashCents();
    buyIfAffordable(ctx, 'BTC', Math.floor(cash * 0.6));
    buyIfAffordable(ctx, 'ETH', ctx.portfolio.cashCents());
  },
};

const cashConservative: StrategyBot = {
  key: 'cash-conservative',
  name: 'Cash Conservative',
  act(ctx) {
    desperationBet(ctx);
    const nav = ctx.portfolio.navCents(ctx.market);
    const spyValue = valueIn(ctx, 'SPY');
    const target = Math.floor(nav * 0.3) - spyValue;
    if (target > 0) buyIfAffordable(ctx, 'SPY', target);
  },
};

const degen: StrategyBot = {
  key: 'degen',
  name: 'Degen',
  act(ctx) {
    // Half the wallet into parlays/longshots (as league rules allow)...
    let budget = Math.min(maxAdditionalStake(ctx), Math.floor(ctx.portfolio.cashCents() * 0.5));
    const tickets = ctx.rng.shuffle(ctx.offers.filter((o) => o.kind !== 'single')).slice(0, 3);
    for (const t of tickets) {
      const stake = Math.min(budget, Math.floor(ctx.portfolio.cashCents() * 0.25));
      if (stake >= MIN_TRADE) {
        ctx.portfolio.placeBet(ctx.week, t, stake, ctx.market);
        budget -= stake;
      }
    }
    // ...and the rest into the most volatile assets on the board.
    buyIfAffordable(ctx, 'SOL', Math.floor(ctx.portfolio.cashCents() * 0.5));
    buyIfAffordable(ctx, 'MEME', ctx.portfolio.cashCents());
  },
};

const playerScout: StrategyBot = {
  key: 'player-scout',
  name: 'Player Scout',
  act(ctx) {
    desperationBet(ctx);
    const pm = ctx.market.playerMarket;
    // Recycle out of player shares before they decay to zero at season end.
    if (pm.weeksLeft() <= 1) {
      for (const pos of ctx.portfolio.positionList()) {
        if (ctx.market.isPlayerAsset(pos.assetId))
          ctx.portfolio.sell(ctx.week, pos.assetId, 'all', ctx.market);
      }
      buyIfAffordable(ctx, 'SPY', ctx.portfolio.cashCents());
      return;
    }
    // Sell holdings the market has bid well above consensus fair value.
    for (const pos of ctx.portfolio.positionList()) {
      if (!ctx.market.isPlayerAsset(pos.assetId)) continue;
      const fair = pm.fairValueOf(pos.assetId);
      if (fair > 0 && ctx.market.quote(pos.assetId) > fair * 1.2) {
        ctx.portfolio.sell(ctx.week, pos.assetId, 'all', ctx.market);
      }
    }
    // Buy the three cheapest players relative to consensus fair value.
    const candidates = pm
      .assets()
      .map((a) => ({ id: a.id, ratio: ctx.market.quote(a.id) / Math.max(1, pm.fairValueOf(a.id)) }))
      .sort((x, y) => x.ratio - y.ratio)
      .slice(0, 3);
    const per = Math.floor(ctx.portfolio.cashCents() / 3);
    for (const c of candidates) buyIfAffordable(ctx, c.id, per);
  },
};

const momentum: StrategyBot = {
  key: 'momentum',
  name: 'Momentum Trader',
  act(ctx) {
    desperationBet(ctx);
    rotateByTrailingReturn(ctx, 'best');
  },
};

const contrarian: StrategyBot = {
  key: 'contrarian',
  name: 'Contrarian',
  act(ctx) {
    desperationBet(ctx);
    rotateByTrailingReturn(ctx, 'worst');
  },
};

const randomBot: StrategyBot = {
  key: 'random',
  name: 'Random',
  act(ctx) {
    desperationBet(ctx);
    if (ctx.rng.chance(0.3) && ctx.offers.length > 0) {
      const stake = Math.min(maxAdditionalStake(ctx), Math.floor(ctx.portfolio.cashCents() * 0.15));
      if (stake >= MIN_TRADE)
        ctx.portfolio.placeBet(ctx.week, ctx.rng.pick(ctx.offers), stake, ctx.market);
    }
    if (ctx.rng.chance(0.3)) {
      const positions = ctx.portfolio.positionList();
      if (positions.length > 0)
        ctx.portfolio.sell(ctx.week, ctx.rng.pick(positions).assetId, 'all', ctx.market);
    }
    if (ctx.rng.chance(0.8)) {
      const assets = ctx.market.allAssets();
      const spend = Math.floor(ctx.portfolio.cashCents() * ctx.rng.uniform(0.2, 0.8));
      buyIfAffordable(ctx, ctx.rng.pick(assets).id, spend);
    }
  },
};

const skilled: StrategyBot = {
  key: 'skilled',
  name: 'Skilled',
  act(ctx) {
    desperationBet(ctx);
    const nav = ctx.portfolio.navCents(ctx.market);
    // Information edge: sees true probabilities, bets only +EV lines at
    // quarter-Kelly, never more than 10% of NAV in open tickets.
    let budget = Math.min(maxAdditionalStake(ctx), Math.floor(nav * 0.1));
    for (const o of ctx.offers) {
      const ev = o.trueProb * o.decimalOdds - 1;
      if (ev < 0.02) continue;
      const b = o.decimalOdds - 1;
      const kelly = (o.trueProb * b - (1 - o.trueProb)) / b;
      const stake = Math.min(
        budget,
        Math.floor(nav * Math.max(0, kelly) * 0.25),
        ctx.portfolio.cashCents(),
      );
      if (stake >= MIN_TRADE) {
        ctx.portfolio.placeBet(ctx.week, o, stake, ctx.market);
        budget -= stake;
      }
    }
    const cash = ctx.portfolio.cashCents();
    buyIfAffordable(ctx, 'SPY', Math.floor(cash * 0.7));
    buyIfAffordable(ctx, 'BTC', ctx.portfolio.cashCents());
  },
};

function valueIn(ctx: BotContext, assetId: string): Cents {
  const pos = ctx.portfolio.position(assetId);
  if (!pos) return 0;
  return Math.round((pos.qtyMicro * ctx.market.quote(assetId)) / 1_000_000);
}

function rotateByTrailingReturn(ctx: BotContext, mode: 'best' | 'worst'): void {
  const lookback = 4;
  const scored = ctx.market.priceEngine.assets().map((a) => {
    const hist = ctx.market.priceEngine.priceHistory(a.id);
    const now = hist[hist.length - 1] as Cents;
    const then = hist[Math.max(0, hist.length - 1 - lookback)] as Cents;
    return { id: a.id, ret: now / then - 1 };
  });
  scored.sort((x, y) => (mode === 'best' ? y.ret - x.ret : x.ret - y.ret));
  const target = scored[0];
  if (!target) return;
  for (const pos of ctx.portfolio.positionList()) {
    if (pos.assetId !== target.id && ctx.market.priceEngine.has(pos.assetId)) {
      ctx.portfolio.sell(ctx.week, pos.assetId, 'all', ctx.market);
    }
  }
  buyIfAffordable(ctx, target.id, ctx.portfolio.cashCents());
}

export const ALL_BOTS: StrategyBot[] = [
  passiveIndex,
  cryptoBull,
  cashConservative,
  degen,
  playerScout,
  momentum,
  contrarian,
  randomBot,
  skilled,
];

export const BOT_BY_KEY = new Map(ALL_BOTS.map((b) => [b.key, b]));

/** Default 12-manager archetype mix used by experiments. */
export const DEFAULT_MIX_12 = [
  'passive-index',
  'crypto-bull',
  'degen',
  'player-scout',
  'cash-conservative',
  'momentum',
  'contrarian',
  'random',
  'skilled',
  'passive-index',
  'crypto-bull',
  'random',
];
