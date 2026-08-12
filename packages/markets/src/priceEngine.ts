import type { Cents } from '@fc/core';
import { Rng, roundToInt } from '@fc/core';
import type { Asset, PriceModel } from './assets.js';

/**
 * Weekly geometric-Brownian price paths for the non-player asset universe.
 * One step = one game week. Deterministic given the Rng.
 */
export class PriceEngine {
  private readonly models: PriceModel[];
  private readonly prices = new Map<string, Cents>();
  private readonly history = new Map<string, Cents[]>();

  constructor(models: PriceModel[]) {
    this.models = models;
    for (const m of models) {
      this.prices.set(m.asset.id, m.startPriceCents);
      this.history.set(m.asset.id, [m.startPriceCents]);
    }
  }

  assets(): Asset[] {
    return this.models.map((m) => m.asset);
  }

  quote(assetId: string): Cents {
    const p = this.prices.get(assetId);
    if (p === undefined) throw new Error(`unknown asset: ${assetId}`);
    return p;
  }

  has(assetId: string): boolean {
    return this.prices.has(assetId);
  }

  priceHistory(assetId: string): readonly Cents[] {
    return this.history.get(assetId) ?? [];
  }

  stepWeek(rng: Rng): void {
    for (const m of this.models) {
      const prev = this.prices.get(m.asset.id) as Cents;
      let logReturn =
        m.muWeekly - (m.sigmaWeekly * m.sigmaWeekly) / 2 + m.sigmaWeekly * rng.normal();
      if (m.jumpProb !== undefined && rng.chance(m.jumpProb)) {
        logReturn += rng.normal(0, m.jumpSigma ?? 0.1);
      }
      const next = Math.max(1, roundToInt(prev * Math.exp(logReturn)));
      this.prices.set(m.asset.id, next);
      this.history.get(m.asset.id)?.push(next);
    }
  }
}
