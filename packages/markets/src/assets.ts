import type { Cents } from '@fc/core';

export type AssetType = 'CASH' | 'ETF' | 'STOCK' | 'CRYPTO' | 'PLAYER';

export interface Asset {
  id: string;
  symbol: string;
  name: string;
  type: AssetType;
}

/** Weekly geometric-Brownian price model for non-player assets. */
export interface PriceModel {
  asset: Asset;
  startPriceCents: Cents;
  /** Mean weekly log-return. */
  muWeekly: number;
  /** Weekly log-return volatility. */
  sigmaWeekly: number;
  /** Probability of an additional jump in a given week. */
  jumpProb?: number;
  /** SD of the jump's log-return. */
  jumpSigma?: number;
}

/**
 * Default MVP universe. Parameters are weekly and roughly calibrated to real
 * asset behavior (SPY ~16% annualized vol, BTC ~55%, single names in between).
 */
export const DEFAULT_UNIVERSE: PriceModel[] = [
  {
    asset: { id: 'SPY', symbol: 'SPY', name: 'S&P 500 Index Fund', type: 'ETF' },
    startPriceCents: 52_000,
    muWeekly: 0.0017,
    sigmaWeekly: 0.022,
  },
  {
    asset: { id: 'GLD', symbol: 'GLD', name: 'Gold', type: 'ETF' },
    startPriceCents: 21_500,
    muWeekly: 0.0009,
    sigmaWeekly: 0.021,
  },
  {
    asset: { id: 'NVX', symbol: 'NVX', name: 'Nova Semiconductor', type: 'STOCK' },
    startPriceCents: 13_400,
    muWeekly: 0.003,
    sigmaWeekly: 0.06,
    jumpProb: 0.04,
    jumpSigma: 0.1,
  },
  {
    asset: { id: 'BTC', symbol: 'BTC', name: 'Bitcoin', type: 'CRYPTO' },
    startPriceCents: 6_400_000,
    muWeekly: 0.004,
    sigmaWeekly: 0.075,
  },
  {
    asset: { id: 'ETH', symbol: 'ETH', name: 'Ether', type: 'CRYPTO' },
    startPriceCents: 340_000,
    muWeekly: 0.003,
    sigmaWeekly: 0.1,
  },
  {
    asset: { id: 'SOL', symbol: 'SOL', name: 'Solana', type: 'CRYPTO' },
    startPriceCents: 15_500,
    muWeekly: 0.003,
    sigmaWeekly: 0.13,
  },
  {
    asset: { id: 'MEME', symbol: 'MEME', name: 'Meme Coin Basket', type: 'CRYPTO' },
    startPriceCents: 100,
    muWeekly: -0.01,
    sigmaWeekly: 0.22,
    jumpProb: 0.06,
    jumpSigma: 0.5,
  },
];
