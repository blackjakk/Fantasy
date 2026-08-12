import type { Cents, MicroShares } from '@fc/core';

/**
 * SAFETY-CRITICAL: the ledger is the source of truth for every portfolio.
 * Entries are append-only; balances and positions are derived state that must
 * always reconcile against the ledger (see Portfolio.checkInvariants).
 * All amounts are integer cents; all quantities are integer micro-shares.
 */
export type LedgerEntry =
  | { kind: 'DEPOSIT'; week: number; amountCents: Cents; memo: string }
  | {
      kind: 'TRADE';
      week: number;
      assetId: string;
      side: 'BUY' | 'SELL';
      qtyMicro: MicroShares;
      priceCents: Cents;
      grossCents: Cents;
    }
  | { kind: 'DIVIDEND'; week: number; assetId: string; amountCents: Cents }
  | { kind: 'BET_PLACED'; week: number; betId: string; stakeCents: Cents; description: string }
  | { kind: 'BET_SETTLED'; week: number; betId: string; payoutCents: Cents; won: boolean };

export interface Position {
  assetId: string;
  qtyMicro: MicroShares;
  /** Total cents paid for the current holding (average-cost basis). */
  costBasisCents: Cents;
}
