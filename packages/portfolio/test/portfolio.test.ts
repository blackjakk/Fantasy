import { describe, expect, it } from 'vitest';
import { Rng } from '@fc/core';
import { generatePlayerPool } from '@fc/fantasy';
import { Market } from '@fc/markets';
import { Portfolio } from '../src/index.js';

function makeMarket(seed = 1): Market {
  const pool = generatePlayerPool(new Rng(seed));
  const listed = [...pool].sort((a, b) => b.projection - a.projection).slice(0, 5);
  return new Market({ listedPlayers: listed, totalWeeks: 14 });
}

describe('Portfolio accounting', () => {
  it('deposits, buys, sells, and preserves the NAV identity exactly', () => {
    const market = makeMarket();
    const p = new Portfolio('brian');
    p.deposit(1, 100_000, 'week 1 capital');
    expect(p.navCents(market)).toBe(100_000);

    p.buy(1, 'BTC', 40_000, market);
    p.buy(1, 'SPY', 30_000, market);
    p.checkInvariants(market);
    // Buying converts cash to positions at spot with zero impact on deep assets.
    expect(p.navCents(market)).toBeGreaterThanOrEqual(99_998);
    expect(p.navCents(market)).toBeLessThanOrEqual(100_000);

    p.sell(2, 'BTC', 'all', market);
    p.checkInvariants(market);
    expect(p.position('BTC')).toBeUndefined();
  });

  it('rejects overspending and overselling', () => {
    const market = makeMarket();
    const p = new Portfolio('x');
    p.deposit(1, 10_000, 'seed');
    expect(() => p.buy(1, 'SPY', 20_000, market)).toThrow(/insufficient/);
    expect(() => p.sell(1, 'SPY', 'all', market)).toThrow(/no position/);
    p.buy(1, 'SPY', 5_000, market);
    const pos = p.position('SPY')!;
    expect(() => p.sell(1, 'SPY', pos.qtyMicro + 1, market)).toThrow(/exceeds/);
  });

  it('cash can never go negative', () => {
    const market = makeMarket();
    const p = new Portfolio('x');
    p.deposit(1, 1_000, 'seed');
    expect(() => p.placeBet(1, market.openWeek(1, new Rng(1))[0]!, 2_000, market)).toThrow(
      /insufficient/,
    );
    expect(p.cashCents()).toBe(1_000);
  });

  it('enforces the league betting cap at the ledger boundary', () => {
    const market = makeMarket();
    const offers = market.openWeek(1, new Rng(3));
    const p = new Portfolio('capped', { maxOpenStakeFractionOfNav: 0.3 });
    p.deposit(1, 100_000, 'seed');
    // 30% of $1,000 NAV = $300 max open stakes.
    p.placeBet(1, offers[0]!, 20_000, market);
    expect(() => p.placeBet(1, offers[1]!, 15_000, market)).toThrow(/betting cap/);
    p.placeBet(1, offers[1]!, 10_000, market);
    expect(p.openBetStakesCents()).toBe(30_000);
    const banned = new Portfolio('banned', { maxOpenStakeFractionOfNav: 0 });
    banned.deposit(1, 100_000, 'seed');
    expect(() => banned.placeBet(1, offers[0]!, 100, market)).toThrow(/betting cap/);
  });

  it('settles bets once and only once', () => {
    const market = makeMarket();
    const rng = new Rng(7);
    const offers = market.openWeek(1, rng);
    const p = new Portfolio('x');
    p.deposit(1, 50_000, 'seed');
    const offer = offers[0]!;
    p.placeBet(1, offer, 10_000, market);
    expect(p.navCents(market)).toBe(50_000); // open bets carried at stake
    p.settleBet(1, offer.id, true);
    expect(() => p.settleBet(1, offer.id, true)).toThrow(/double settlement/);
    const expectedPayout = Math.round(10_000 * offer.decimalOdds);
    expect(p.cashCents()).toBe(50_000 - 10_000 + expectedPayout);
    p.checkInvariants(market);
  });

  it('credits dividends only to holders', () => {
    const market = makeMarket();
    const playerAsset = market.playerMarket.assets()[0]!;
    const holder = new Portfolio('holder');
    const bystander = new Portfolio('bystander');
    holder.deposit(1, 100_000, 'seed');
    bystander.deposit(1, 100_000, 'seed');
    holder.buy(1, playerAsset.id, 20_000, market);
    expect(holder.applyDividend(1, playerAsset.id, 245)).toBeGreaterThan(0);
    expect(bystander.applyDividend(1, playerAsset.id, 245)).toBe(0);
    holder.checkInvariants(market);
  });

  it('property: random operation sequences never break the ledger', () => {
    for (let trial = 0; trial < 10; trial++) {
      const market = makeMarket(trial + 100);
      const rng = new Rng(trial);
      const p = new Portfolio(`t${trial}`);
      p.deposit(0, 200_000, 'bankroll');
      const assets = market.allAssets();
      for (let week = 1; week <= 10; week++) {
        const offers = market.openWeek(week, rng.child(`w${week}`));
        for (let op = 0; op < 8; op++) {
          const roll = rng.next();
          if (roll < 0.4) {
            const spend = Math.floor(p.cashCents() * rng.uniform(0.05, 0.5));
            if (spend >= 100) p.buy(week, rng.pick(assets).id, spend, market);
          } else if (roll < 0.6) {
            const positions = p.positionList();
            if (positions.length > 0) p.sell(week, rng.pick(positions).assetId, 'all', market);
          } else if (roll < 0.8) {
            const stake = Math.floor(p.cashCents() * rng.uniform(0.02, 0.2));
            if (stake >= 100) p.placeBet(week, rng.pick(offers), stake, market);
          } else {
            p.deposit(week, rng.int(1000, 20000), 'capital');
          }
          p.checkInvariants(market);
        }
        const outcome = market.stepWeek(new Map(), rng.child(`step${week}`));
        for (const [assetId, perShare] of outcome.dividendsPerShare) {
          p.applyDividend(week, assetId, perShare);
        }
        p.settleWeek(week, outcome.betOutcomes);
        p.checkInvariants(market);
        expect(p.cashCents()).toBeGreaterThanOrEqual(0);
        // The identity, spelled out:
        expect(p.navCents(market)).toBe(
          p.totalDepositsCents() + p.realizedPnlCents() + p.unrealizedPnlCents(market),
        );
      }
    }
  });
});
