import { describe, expect, it } from 'vitest';
import { Rng } from '@fc/core';
import { generatePlayerPool } from '@fc/fantasy';
import {
  makeWeeklyOffers,
  Market,
  offerEv,
  payoutFor,
  PlayerMarket,
  PriceEngine,
  settleOffers,
  DEFAULT_UNIVERSE,
  assetIdFor,
} from '../src/index.js';

function listedPlayers(seed = 1, n = 5) {
  const pool = generatePlayerPool(new Rng(seed));
  return [...pool].sort((a, b) => b.projection - a.projection).slice(0, n);
}

describe('PriceEngine', () => {
  it('is deterministic per seed and keeps prices positive', () => {
    const a = new PriceEngine(DEFAULT_UNIVERSE);
    const b = new PriceEngine(DEFAULT_UNIVERSE);
    for (let w = 0; w < 30; w++) {
      a.stepWeek(new Rng(1000 + w));
      b.stepWeek(new Rng(1000 + w));
    }
    for (const m of DEFAULT_UNIVERSE) {
      expect(a.quote(m.asset.id)).toBe(b.quote(m.asset.id));
      expect(a.quote(m.asset.id)).toBeGreaterThan(0);
    }
  });
});

describe('PlayerMarket AMM', () => {
  it('buys push the price up, sells push it down', () => {
    const players = listedPlayers();
    const pm = new PlayerMarket(players, 14);
    const id = assetIdFor(players[0]!);
    const before = pm.quote(id);
    pm.execute(id, 100_000); // $1,000 buy
    const afterBuy = pm.quote(id);
    expect(afterBuy).toBeGreaterThan(before);
    pm.execute(id, -100_000);
    const afterSell = pm.quote(id);
    expect(afterSell).toBeLessThan(afterBuy);
  });

  it('a pump round-trip loses money (manipulation is self-defeating)', () => {
    const players = listedPlayers();
    const pm = new PlayerMarket(players, 14);
    const id = assetIdFor(players[0]!);
    const buyPrice = pm.execute(id, 500_000); // $5,000 pump
    const sellPrice = pm.execute(id, -500_000);
    expect(sellPrice).toBeLessThan(buyPrice);
  });

  it('pays dividends proportional to fantasy points', () => {
    const players = listedPlayers();
    const pm = new PlayerMarket(players, 14, { dividendPerPointCents: 10 });
    const id = assetIdFor(players[0]!);
    const dividends = pm.stepWeek(new Map([[players[0]!.id, 24.5]]), new Rng(9));
    expect(dividends.get(id)).toBe(245); // 24.5 pts x $0.10/pt = $2.45 per share
  });

  it('marks holdings at liquidation value so self-pumping is not NAV-accretive', () => {
    const players = listedPlayers();
    const pm = new PlayerMarket(players, 14);
    const id = assetIdFor(players[0]!);
    const spot = pm.quote(id);
    const bigStackMicro = 500 * 1_000_000; // 500 shares
    const spotValue = Math.round((bigStackMicro * spot) / 1_000_000);
    const liqValue = pm.liquidationValue(id, bigStackMicro);
    expect(liqValue).toBeLessThan(spotValue);
    // Pumping the price moves spot but the pump's cost (fee + impact on exit)
    // shows up in liquidation value, keeping the mark honest.
    expect(pm.liquidationValue(id, 0)).toBe(0);
  });

  it('prices decay toward zero as the season runs out', () => {
    const players = listedPlayers();
    const pm = new PlayerMarket(players, 14);
    const id = assetIdFor(players[0]!);
    const early = pm.quote(id);
    const rng = new Rng(11);
    for (let w = 0; w < 14; w++) {
      pm.stepWeek(new Map(players.map((p) => [p.id, p.trueMean])), rng);
    }
    expect(pm.weeksLeft()).toBe(0);
    expect(pm.quote(id)).toBeLessThan(early * 0.05);
  });
});

describe('sportsbook', () => {
  it('every offer pays more than the stake on a win', () => {
    const offers = makeWeeklyOffers(1, new Rng(21));
    for (const o of offers) {
      expect(o.decimalOdds).toBeGreaterThan(1);
      expect(payoutFor(1000, o, true)).toBeGreaterThan(1000);
      expect(payoutFor(1000, o, false)).toBe(0);
    }
  });

  it('random betting is -EV on average (the vig is real)', () => {
    const rng = new Rng(31);
    let ev = 0;
    let n = 0;
    for (let w = 0; w < 200; w++) {
      for (const o of makeWeeklyOffers(w, rng)) {
        ev += offerEv(o);
        n++;
      }
    }
    const meanEv = ev / n;
    expect(meanEv).toBeLessThan(-0.02);
    expect(meanEv).toBeGreaterThan(-0.2);
  });

  it('settles each ticket exactly once with a shared outcome', () => {
    const offers = makeWeeklyOffers(1, new Rng(41));
    const outcomes = settleOffers(offers, new Rng(42));
    expect(outcomes.size).toBe(offers.length);
    const again = settleOffers(offers, new Rng(42));
    for (const [id, won] of outcomes) expect(again.get(id)).toBe(won);
  });
});

describe('Market facade', () => {
  it('quotes every listed asset and enforces the weekly ordering', () => {
    const market = new Market({ listedPlayers: listedPlayers(), totalWeeks: 14 });
    const assets = market.allAssets();
    expect(assets.length).toBe(DEFAULT_UNIVERSE.length + 5);
    for (const a of assets) expect(market.quote(a.id)).toBeGreaterThan(0);
    const rng = new Rng(51);
    const offers = market.openWeek(1, rng);
    expect(offers.length).toBeGreaterThan(0);
    const outcome = market.stepWeek(new Map(), rng);
    expect(outcome.betOutcomes.size).toBe(offers.length);
  });
});
