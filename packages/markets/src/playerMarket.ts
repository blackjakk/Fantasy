import type { Cents, MicroShares } from '@fc/core';
import { MICRO, Rng, roundToInt } from '@fc/core';
import type { NflPlayer } from '@fc/fantasy';
import type { Asset } from './assets.js';

/**
 * Player-share market: one market per listed NFL player, quoted by a simulated
 * global AMM.
 *
 * Economic model (v1 experiment):
 *   - Holding a share pays a weekly dividend of `dividendPerPointCents` per
 *     fantasy point the player scores.
 *   - The fair value of a share is therefore the expected remaining-season
 *     production: consensusMean x remainingWeeks x dividendPerPoint.
 *   - Market price = fair value x demand factor (net AMM flow) x sentiment noise.
 *   - Prices decay to zero at season end; you profit by buying players who
 *     outperform the consensus, or by riding demand, not by memes alone.
 *
 * The AMM always quotes. Buys push the demand factor up, sells push it down,
 * with executions filled at the midpoint impact price so round-tripping costs
 * slippage (this is what makes pump-and-dump unprofitable for the pumper).
 */
export interface PlayerMarketConfig {
  dividendPerPointCents: number;
  /** Net flow (cents) that moves the demand factor by e^1 (~2.7x). Models global liquidity. */
  depthCents: Cents;
  /** Weekly sd of the sentiment noise log-factor. */
  sentimentSigma: number;
  /** EWMA weight of the newest week when updating consensus production. */
  consensusAlpha: number;
  /** AMM fee in basis points, charged against the trader on both sides. */
  tradeFeeBps: number;
}

export const DEFAULT_PLAYER_MARKET_CONFIG: PlayerMarketConfig = {
  dividendPerPointCents: 10,
  depthCents: 5_000_000, // $50k of net flow ≈ e^1 move; a $500 buy moves price ~1%
  sentimentSigma: 0.05,
  consensusAlpha: 0.3,
  tradeFeeBps: 100, // 1% each way — makes pump-and-dump strictly unprofitable
};

interface PlayerMarketState {
  player: NflPlayer;
  asset: Asset;
  consensusMean: number;
  netFlowCents: number;
  sentiment: number; // log-factor
  lastWeekPoints: number;
}

export class PlayerMarket {
  readonly config: PlayerMarketConfig;
  private readonly states = new Map<string, PlayerMarketState>();
  private remainingWeeks: number;

  constructor(
    listedPlayers: NflPlayer[],
    totalWeeks: number,
    config?: Partial<PlayerMarketConfig>,
  ) {
    this.config = { ...DEFAULT_PLAYER_MARKET_CONFIG, ...config };
    this.remainingWeeks = totalWeeks;
    for (const p of listedPlayers) {
      this.states.set(assetIdFor(p), {
        player: p,
        asset: { id: assetIdFor(p), symbol: shortSymbol(p), name: p.name, type: 'PLAYER' },
        consensusMean: p.projection,
        netFlowCents: 0,
        sentiment: 0,
        lastWeekPoints: 0,
      });
    }
  }

  assets(): Asset[] {
    return [...this.states.values()].map((s) => s.asset);
  }

  listedPlayerIds(): string[] {
    return [...this.states.values()].map((s) => s.player.id);
  }

  /** Spot quote in cents per share (minimum 1 cent while the season is live). */
  quote(assetId: string): Cents {
    const s = this.mustGet(assetId);
    const fair = this.fairValue(s);
    const price = fair * Math.exp(s.netFlowCents / this.config.depthCents + s.sentiment);
    return Math.max(this.remainingWeeks > 0 ? 1 : 0, roundToInt(price));
  }

  /** Consensus-implied fair value, before demand/sentiment. */
  fairValue(s: PlayerMarketState): number {
    return s.consensusMean * this.remainingWeeks * this.config.dividendPerPointCents;
  }

  fairValueOf(assetId: string): Cents {
    return roundToInt(this.fairValue(this.mustGet(assetId)));
  }

  /**
   * Quote the execution price for a trade of `grossCents` notional (positive =
   * buy, negative = sell) WITHOUT mutating market state. Callers validate the
   * fill first, then commit it with applyFlow — this ordering means a rejected
   * trade can never leave phantom flow in the AMM.
   */
  previewExec(assetId: string, grossCents: Cents): Cents {
    this.mustGet(assetId);
    if (this.remainingWeeks <= 0)
      throw new Error(`player market ${assetId} is closed (season over)`);
    const spot = this.quote(assetId);
    const impact = grossCents / (2 * this.config.depthCents);
    // The fee works against the trader in both directions: buys fill above the
    // impact price, sells below it. Without this, a buy/sell round-trip at the
    // midpoint impact price would be exactly free and pumping would cost nothing.
    const fee = 1 + Math.sign(grossCents) * (this.config.tradeFeeBps / 10_000);
    return Math.max(1, roundToInt(spot * Math.exp(impact) * fee));
  }

  /** Commit a validated trade's demand-factor move. Pass the ACTUAL cents exchanged. */
  applyFlow(assetId: string, grossCents: Cents): void {
    const s = this.mustGet(assetId);
    s.netFlowCents += grossCents;
  }

  /** Preview + commit in one call (test/tooling convenience). */
  execute(assetId: string, grossCents: Cents): Cents {
    const price = this.previewExec(assetId, grossCents);
    this.applyFlow(assetId, grossCents);
    return price;
  }

  /**
   * What selling the whole stack through the curve would fetch right now.
   * NAV marks player holdings at THIS value, not at spot: marking at post-trade
   * spot would make pumping your own largest holding instantly NAV-accretive
   * ("marking the close"). At liquidation value, self-pumping is NAV-neutral
   * at best and fee-negative in practice.
   */
  liquidationValue(assetId: string, qtyMicro: MicroShares): Cents {
    if (qtyMicro <= 0) return 0;
    const spot = this.quote(assetId);
    const notional = (qtyMicro * spot) / MICRO;
    const impact = Math.exp(-notional / (2 * this.config.depthCents));
    const fee = 1 - this.config.tradeFeeBps / 10_000;
    return roundToInt(notional * impact * fee);
  }

  /**
   * Advance one week: record realized production, update consensus, decay the
   * demand factor slightly (traders take profits), evolve sentiment, tick the
   * remaining-week clock down.
   *
   * Returns dividends per share (cents) keyed by asset id for the week just played.
   */
  stepWeek(weekPoints: Map<string, number>, rng: Rng): Map<string, Cents> {
    const dividends = new Map<string, Cents>();
    for (const [assetId, s] of this.states) {
      const pts = weekPoints.get(s.player.id) ?? 0;
      s.lastWeekPoints = pts;
      dividends.set(assetId, roundToInt(pts * this.config.dividendPerPointCents));
      s.consensusMean =
        (1 - this.config.consensusAlpha) * s.consensusMean + this.config.consensusAlpha * pts;
      s.netFlowCents = roundToInt(s.netFlowCents * 0.9);
      s.sentiment = s.sentiment * 0.8 + rng.normal(0, this.config.sentimentSigma);
    }
    this.remainingWeeks -= 1;
    return dividends;
  }

  consensusOf(assetId: string): number {
    return this.mustGet(assetId).consensusMean;
  }

  lastWeekPointsOf(assetId: string): number {
    return this.mustGet(assetId).lastWeekPoints;
  }

  weeksLeft(): number {
    return this.remainingWeeks;
  }

  /** Value of a holding at spot (used for NAV). */
  holdingValue(assetId: string, qtyMicro: MicroShares): Cents {
    return roundToInt((qtyMicro * this.quote(assetId)) / MICRO);
  }

  private mustGet(assetId: string): PlayerMarketState {
    const s = this.states.get(assetId);
    if (!s) throw new Error(`unknown player market: ${assetId}`);
    return s;
  }
}

export function assetIdFor(player: NflPlayer): string {
  return `PLAYER:${player.id}`;
}

function shortSymbol(player: NflPlayer): string {
  const parts = player.name.split(' ');
  const last = (parts[parts.length - 1] ?? player.name).toUpperCase().slice(0, 4);
  return `${last}.${player.id}`;
}
