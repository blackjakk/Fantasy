import type { Cents } from '@fc/core';
import { positionValue, Rng } from '@fc/core';
import type { NflPlayer } from '@fc/fantasy';
import type { Asset, PriceModel } from './assets.js';
import { DEFAULT_UNIVERSE } from './assets.js';
import { PriceEngine } from './priceEngine.js';
import { PlayerMarket, type PlayerMarketConfig } from './playerMarket.js';
import {
  makeWeeklyOffers,
  settleOffers,
  type BetOffer,
  type SportsbookConfig,
  DEFAULT_SPORTSBOOK_CONFIG,
} from './sportsbook.js';

/**
 * Facade over the three market subsystems (classic assets, player shares,
 * sportsbook) exposing a single quote/execute surface to portfolios and bots.
 *
 * Weekly ordering contract (enforced by the season runner):
 *   1. fantasy games resolve, capital is deposited
 *   2. managers trade / place bets at CURRENT prices
 *   3. `stepWeek` realizes the week's returns, dividends, and bet outcomes
 * No manager can trade on information from step 3 before it happens.
 */
export interface MarketWeekOutcome {
  /** Dividends per share (cents) by player asset id. */
  dividendsPerShare: Map<string, Cents>;
  /** Outcome by bet offer id (shared across all managers). */
  betOutcomes: Map<string, boolean>;
}

export class Market {
  readonly priceEngine: PriceEngine;
  readonly playerMarket: PlayerMarket;
  readonly sportsbookConfig: SportsbookConfig;
  /** League rule: offers above these decimal odds are simply not listed (null = no cap). */
  readonly maxDecimalOdds: number | null;
  private offers: BetOffer[] = [];
  private week = 0;

  constructor(opts: {
    universe?: PriceModel[];
    listedPlayers: NflPlayer[];
    totalWeeks: number;
    playerMarketConfig?: Partial<PlayerMarketConfig>;
    sportsbookConfig?: SportsbookConfig;
    maxDecimalOdds?: number | null;
  }) {
    this.priceEngine = new PriceEngine(opts.universe ?? DEFAULT_UNIVERSE);
    this.playerMarket = new PlayerMarket(
      opts.listedPlayers,
      opts.totalWeeks,
      opts.playerMarketConfig,
    );
    this.sportsbookConfig = opts.sportsbookConfig ?? DEFAULT_SPORTSBOOK_CONFIG;
    this.maxDecimalOdds = opts.maxDecimalOdds ?? null;
  }

  allAssets(): Asset[] {
    return [...this.priceEngine.assets(), ...this.playerMarket.assets()];
  }

  isPlayerAsset(assetId: string): boolean {
    return assetId.startsWith('PLAYER:');
  }

  quote(assetId: string): Cents {
    if (this.isPlayerAsset(assetId)) return this.playerMarket.quote(assetId);
    return this.priceEngine.quote(assetId);
  }

  /**
   * Preview the execution price for a notional trade (positive cents = buy,
   * negative = sell) without mutating anything. Player assets incur AMM
   * impact + fee; deep global assets fill at spot.
   */
  previewExec(assetId: string, grossCents: Cents): Cents {
    if (this.isPlayerAsset(assetId)) return this.playerMarket.previewExec(assetId, grossCents);
    return this.priceEngine.quote(assetId);
  }

  /** Commit a validated trade's market impact (no-op for deep global assets). */
  applyFlow(assetId: string, grossCents: Cents): void {
    if (this.isPlayerAsset(assetId)) this.playerMarket.applyFlow(assetId, grossCents);
  }

  /**
   * Value of a holding for NAV purposes. Player shares mark at liquidation
   * value (see PlayerMarket.liquidationValue); everything else marks at spot.
   */
  holdingValue(assetId: string, qtyMicro: number): Cents {
    if (this.isPlayerAsset(assetId)) return this.playerMarket.liquidationValue(assetId, qtyMicro);
    return positionValue(qtyMicro, this.priceEngine.quote(assetId));
  }

  /** Open this week's betting slate, applying the league's odds cap. */
  openWeek(week: number, rng: Rng): BetOffer[] {
    this.week = week;
    const all = makeWeeklyOffers(week, rng.child(`offers-${week}`), this.sportsbookConfig);
    this.offers =
      this.maxDecimalOdds === null ? all : all.filter((o) => o.decimalOdds <= this.maxDecimalOdds!);
    return this.offers;
  }

  currentOffers(): BetOffer[] {
    return this.offers;
  }

  offerById(id: string): BetOffer {
    const o = this.offers.find((x) => x.id === id);
    if (!o) throw new Error(`unknown bet offer: ${id}`);
    return o;
  }

  /** Realize the week: prices move, dividends accrue, bets settle. */
  stepWeek(playerWeekPoints: Map<string, number>, rng: Rng): MarketWeekOutcome {
    this.priceEngine.stepWeek(rng.child(`prices-${this.week}`));
    const dividendsPerShare = this.playerMarket.stepWeek(
      playerWeekPoints,
      rng.child(`players-${this.week}`),
    );
    const betOutcomes = settleOffers(this.offers, rng.child(`bets-${this.week}`));
    return { dividendsPerShare, betOutcomes };
  }
}
