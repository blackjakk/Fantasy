import type { Cents, MicroShares } from '@fc/core';
import { affordableMicro, assertCents, positionValue, roundToInt } from '@fc/core';
import type { BetOffer, Market } from '@fc/markets';
import { payoutFor } from '@fc/markets';
import type { LedgerEntry, Position } from './ledger.js';

export interface OpenBet {
  offer: BetOffer;
  stakeCents: Cents;
  placedWeek: number;
}

/**
 * League betting rules, enforced HERE (the server-side ledger boundary), never
 * in bots or clients — a modified client must not be able to exceed them.
 */
export interface BettingRules {
  /** Max fraction of NAV in open sportsbook stakes (null = uncapped, 0 = banned). */
  maxOpenStakeFractionOfNav: number | null;
}

/**
 * A manager's simulated brokerage account.
 *
 * Accounting identity (checked by tests and checkInvariants):
 *   NAV = totalDeposits + realizedPnl + unrealizedPnl
 * where NAV = cash + market value of positions + stakes of unsettled bets
 * (open bets are carried at book value until settlement).
 */
export class Portfolio {
  readonly ownerId: string;
  readonly rules: BettingRules;
  readonly ledger: LedgerEntry[] = [];
  private cash: Cents = 0;
  private deposits: Cents = 0;
  private realized: Cents = 0;
  private readonly positions = new Map<string, Position>();
  private readonly openBets = new Map<string, OpenBet>();

  constructor(ownerId: string, rules: BettingRules = { maxOpenStakeFractionOfNav: null }) {
    this.ownerId = ownerId;
    this.rules = rules;
  }

  // ---- capital in ----

  deposit(week: number, amountCents: Cents, memo: string): void {
    assertCents(amountCents, 'deposit');
    if (amountCents < 0) throw new Error('deposit must be non-negative');
    this.cash += amountCents;
    this.deposits += amountCents;
    this.ledger.push({ kind: 'DEPOSIT', week, amountCents, memo });
  }

  // ---- trading ----

  /**
   * Spend up to `spendCents` cash on an asset. Fills at the market's execution
   * price (player assets incur AMM impact). Returns the acquired quantity.
   */
  buy(week: number, assetId: string, spendCents: Cents, market: Market): MicroShares {
    assertCents(spendCents, 'spend');
    if (spendCents <= 0) throw new Error('spend must be positive');
    if (spendCents > this.cash) {
      throw new Error(
        `insufficient funds: spend ${spendCents} > cash ${this.cash} (${this.ownerId})`,
      );
    }
    // Preview-validate-apply: a rejected fill must leave zero footprint in the AMM.
    const priceCents = market.previewExec(assetId, spendCents);
    const qtyMicro = affordableMicro(spendCents, priceCents);
    if (qtyMicro <= 0) throw new Error(`spend ${spendCents} buys zero quantity of ${assetId}`);
    const costCents = positionValue(qtyMicro, priceCents);
    market.applyFlow(assetId, costCents);
    this.cash -= costCents;
    const pos = this.positions.get(assetId) ?? { assetId, qtyMicro: 0, costBasisCents: 0 };
    pos.qtyMicro += qtyMicro;
    pos.costBasisCents += costCents;
    this.positions.set(assetId, pos);
    this.ledger.push({
      kind: 'TRADE',
      week,
      assetId,
      side: 'BUY',
      qtyMicro,
      priceCents,
      grossCents: costCents,
    });
    return qtyMicro;
  }

  /** Sell a quantity (or 'all') of a position. Returns proceeds in cents. */
  sell(week: number, assetId: string, qty: MicroShares | 'all', market: Market): Cents {
    const pos = this.positions.get(assetId);
    if (!pos || pos.qtyMicro <= 0) throw new Error(`no position in ${assetId}`);
    const qtyMicro = qty === 'all' ? pos.qtyMicro : qty;
    if (!Number.isSafeInteger(qtyMicro) || qtyMicro <= 0)
      throw new Error(`bad sell qty ${qtyMicro}`);
    if (qtyMicro > pos.qtyMicro) {
      throw new Error(`sell qty ${qtyMicro} exceeds position ${pos.qtyMicro} in ${assetId}`);
    }
    const grossEstimate = positionValue(qtyMicro, market.quote(assetId));
    const priceCents = market.previewExec(assetId, -grossEstimate);
    const proceedsCents = positionValue(qtyMicro, priceCents);
    // Flow moves by the cents that actually changed hands, not the spot estimate.
    market.applyFlow(assetId, -proceedsCents);
    // Remove proportional cost basis; selling the full position removes it exactly.
    const costRemoved =
      qtyMicro === pos.qtyMicro
        ? pos.costBasisCents
        : roundToInt((pos.costBasisCents * qtyMicro) / pos.qtyMicro);
    pos.qtyMicro -= qtyMicro;
    pos.costBasisCents -= costRemoved;
    if (pos.qtyMicro === 0) this.positions.delete(assetId);
    this.cash += proceedsCents;
    this.realized += proceedsCents - costRemoved;
    this.ledger.push({
      kind: 'TRADE',
      week,
      assetId,
      side: 'SELL',
      qtyMicro,
      priceCents,
      grossCents: proceedsCents,
    });
    return proceedsCents;
  }

  // ---- dividends ----

  applyDividend(week: number, assetId: string, perShareCents: Cents): Cents {
    const pos = this.positions.get(assetId);
    if (!pos || pos.qtyMicro <= 0) return 0;
    const amountCents = positionValue(pos.qtyMicro, perShareCents);
    if (amountCents <= 0) return 0;
    this.cash += amountCents;
    this.realized += amountCents;
    this.ledger.push({ kind: 'DIVIDEND', week, assetId, amountCents });
    return amountCents;
  }

  // ---- betting ----

  placeBet(week: number, offer: BetOffer, stakeCents: Cents, market: Market): void {
    assertCents(stakeCents, 'stake');
    if (stakeCents <= 0) throw new Error('stake must be positive');
    if (stakeCents > this.cash) {
      throw new Error(`insufficient funds for bet: ${stakeCents} > ${this.cash}`);
    }
    const cap = this.rules.maxOpenStakeFractionOfNav;
    if (cap !== null) {
      const allowed = Math.floor(this.navCents(market) * cap) - this.openBetStakesCents();
      if (stakeCents > allowed) {
        throw new Error(
          `betting cap exceeded: stake ${stakeCents} > allowed ${Math.max(0, allowed)} (${this.ownerId})`,
        );
      }
    }
    this.cash -= stakeCents;
    // Betting the same ticket again adds to the position (same odds, one settlement).
    const existing = this.openBets.get(offer.id);
    if (existing) existing.stakeCents += stakeCents;
    else this.openBets.set(offer.id, { offer, stakeCents, placedWeek: week });
    this.ledger.push({
      kind: 'BET_PLACED',
      week,
      betId: offer.id,
      stakeCents,
      description: offer.description,
    });
  }

  /** Settle one open bet. Idempotence guard: a ticket can only settle once. */
  settleBet(week: number, betId: string, won: boolean): Cents {
    const bet = this.openBets.get(betId);
    if (!bet) throw new Error(`no open bet ${betId} (double settlement?)`);
    this.openBets.delete(betId);
    const payoutCents = payoutFor(bet.stakeCents, bet.offer, won);
    this.cash += payoutCents;
    this.realized += payoutCents - bet.stakeCents;
    this.ledger.push({ kind: 'BET_SETTLED', week, betId, payoutCents, won });
    return payoutCents;
  }

  /** Settle all open bets against a week's outcome map. */
  settleWeek(week: number, outcomes: Map<string, boolean>): void {
    for (const betId of [...this.openBets.keys()]) {
      const won = outcomes.get(betId);
      if (won !== undefined) this.settleBet(week, betId, won);
    }
  }

  // ---- views ----

  cashCents(): Cents {
    return this.cash;
  }

  totalDepositsCents(): Cents {
    return this.deposits;
  }

  realizedPnlCents(): Cents {
    return this.realized;
  }

  positionList(): Position[] {
    return [...this.positions.values()].map((p) => ({ ...p }));
  }

  position(assetId: string): Position | undefined {
    const p = this.positions.get(assetId);
    return p ? { ...p } : undefined;
  }

  openBetList(): OpenBet[] {
    return [...this.openBets.values()];
  }

  openBetStakesCents(): Cents {
    let total = 0;
    for (const b of this.openBets.values()) total += b.stakeCents;
    return total;
  }

  /** Positions marked for NAV: player shares at liquidation value, others at spot. */
  marketValueCents(market: Market): Cents {
    let total = 0;
    for (const p of this.positions.values()) {
      total += market.holdingValue(p.assetId, p.qtyMicro);
    }
    return total;
  }

  unrealizedPnlCents(market: Market): Cents {
    let total = 0;
    for (const p of this.positions.values()) {
      total += market.holdingValue(p.assetId, p.qtyMicro) - p.costBasisCents;
    }
    return total;
  }

  navCents(market: Market): Cents {
    return this.cash + this.marketValueCents(market) + this.openBetStakesCents();
  }

  /** Fraction of NAV currently exposed to sportsbook tickets. */
  bettingExposure(market: Market): number {
    const nav = this.navCents(market);
    if (nav <= 0) return 0;
    return this.openBetStakesCents() / nav;
  }

  /** (NAV - deposits) / deposits; 0 when nothing has been deposited. */
  investmentReturn(market: Market): number {
    if (this.deposits <= 0) return 0;
    return (this.navCents(market) - this.deposits) / this.deposits;
  }

  /**
   * SAFETY-CRITICAL: verify the accounting identity and derived-state
   * consistency against the append-only ledger. Throws on any mismatch.
   */
  checkInvariants(market: Market): void {
    if (this.cash < 0) throw new Error(`negative cash: ${this.cash}`);
    if (!Number.isSafeInteger(this.cash)) throw new Error('cash not integer');
    const identity = this.deposits + this.realized + this.unrealizedPnlCents(market);
    const nav = this.navCents(market);
    if (identity !== nav) {
      throw new Error(`NAV identity violated: nav=${nav} identity=${identity} (${this.ownerId})`);
    }
    // Replay the ledger and reconcile cash.
    let replayCash = 0;
    for (const e of this.ledger) {
      switch (e.kind) {
        case 'DEPOSIT':
          replayCash += e.amountCents;
          break;
        case 'TRADE':
          replayCash += e.side === 'BUY' ? -e.grossCents : e.grossCents;
          break;
        case 'DIVIDEND':
          replayCash += e.amountCents;
          break;
        case 'BET_PLACED':
          replayCash -= e.stakeCents;
          break;
        case 'BET_SETTLED':
          replayCash += e.payoutCents;
          break;
      }
    }
    if (replayCash !== this.cash) {
      throw new Error(`ledger replay mismatch: replay=${replayCash} cash=${this.cash}`);
    }
  }
}
