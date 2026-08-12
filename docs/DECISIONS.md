# Architecture Decision Log

Short, dated records of decisions that shape the codebase. Newest last.

## ADR-001 — Simulated money only; engines are pure and I/O-free (2026-08-12)

All value in the system is simulated. No custody, brokerage, sportsbook, or chain integration
in the MVP or V1. Engine packages (`@fc/*`) perform no I/O, read no clocks, and take a seeded
RNG — future real-money adapters would live behind the (future) API server and cannot
contaminate engine logic because engines have no place to put a network call.

## ADR-002 — Integer money and quantities; no floats in ledgers (2026-08-12)

Money is integer cents (`Cents`), quantities are integer micro-shares (1e-6). All rounding goes
through `roundToInt` (half away from zero). ESLint bans `Math.random` and `Date.now`
repo-wide. **Safety-critical.**

## ADR-003 — Deterministic seeded RNG with labeled child streams (2026-08-12)

`Rng.child(label)` derives decorrelated streams whose values do not depend on parent consumption
order. Consequence: paired-seed experiments produce IDENTICAL fantasy scores and market paths
across rule variants, isolating the effect of the rule change (variance reduction), and any
season is exactly reproducible from its seed.

## ADR-004 — Append-only ledger; balances are derived state (2026-08-12)

`Portfolio` appends `DEPOSIT/TRADE/DIVIDEND/BET_PLACED/BET_SETTLED` entries; cash/positions are
derived and re-verified against ledger replay by `checkInvariants`, which also asserts the exact
integer identity `NAV = deposits + realizedPnL + unrealizedPnL`. The season runner calls it for
every portfolio every week. **Safety-critical.**

## ADR-005 — Weekly ordering contract prevents lookahead (2026-08-12)

Within a simulated week: slate opens → managers act (with prior weeks' capital) → games play and
capital deposits (investable next week) → markets realize (prices, dividends, bet settlement) →
snapshot. No participant can trade on information from a later step. The reward moment in UX
corresponds to the deposit landing after settlement.

## ADR-006 — Trades are preview-validate-apply (2026-08-12)

`Market.previewExec` quotes without mutating; `Portfolio` validates the fill (quantity > 0,
sufficient cash) and only then `applyFlow`s the ACTUAL cents exchanged. A rejected trade leaves
zero footprint in the AMM. This is the in-engine template for the production rule: order
execution and recording must be one atomic transaction. **Safety-critical.**
(Origin: adversarial review found the original execute-then-validate order left phantom AMM
flow on failed buys, and sells moved flow by the spot estimate instead of actual proceeds.)

## ADR-007 — Player holdings mark at liquidation value, not spot (2026-08-12)

NAV values player-share positions at what selling the whole stack through the AMM curve would
fetch (`liquidationValue`), while executions quote at spot ± impact ± fee. Marking at post-trade
spot made self-pumping NAV-accretive ("marking the close") — a season-winning exploit found by
adversarial review of this very codebase. With liquidation marking + the 1% per-side fee,
pump-and-dump is strictly unprofitable (tested).

## ADR-008 — Betting rules are enforced in the Portfolio, never in bots/clients (2026-08-12)

`BettingRules` (open-stake fraction of NAV) lives on the `Portfolio` and `placeBet` rejects
violations; the odds cap is enforced upstream by not listing offers above it
(`Market.maxDecimalOdds`). Bots additionally self-limit for planning, but nothing depends on
client-side compliance. In production these checks sit on the server ledger boundary.

## ADR-009 — Bet offers settle once, globally (2026-08-12)

A `BetOffer` has one outcome per week shared by every manager holding the ticket; portfolios
settle idempotently (double settlement throws). Betting the same ticket again adds to the
position at the same odds. Open bets are carried at stake (book value) in NAV until settlement.

## ADR-010 — Player-share economics: dividends on actual scoring; price = decaying claim (2026-08-12)

Shares pay $0.10/fantasy-point/share on the player's ACTUAL weekly scoring (never
"points in your lineup" — that would let one league's lineup decisions manipulate a global
market). Fair value = consensus expected remaining-season production × dividend rate, so prices
decay to zero at season end and alpha comes from beating consensus, not memes. Consensus updates
as an EWMA of realized production (momentum surface). Experimental; re-tune by simulation.

## ADR-011 — Monorepo with source-as-entry internal packages; no build step for engines (2026-08-12)

pnpm workspaces; each package's `main`/`types` point at `src/index.ts`. `tsx` runs apps, vitest
transforms workspace sources directly, `tsc --noEmit` typechecks the whole repo. Build
orchestration (tsup/turbo) is deferred until something ships to users.

## ADR-012 — Ties go to the home team (2026-08-12)

With 0.1-point scoring, ties are ~1-in-1000. Deterministic and documented beats a coin flip in
an economy where a win changes the paycheck. Revisit when real scoring data arrives.

## ADR-013 — Default league preset from experiment results (2026-08-12)

Standard preset: $500 starting bankroll, $1/point, 1.5× win multiplier (loss 1.0×, base capital
never zero), betting cap 30% of NAV open stakes, listed odds capped at +200, no weekly capital
cap, Capital Champion by highest NAV at week 14 alongside the traditional Fantasy Champion.
Rationale and data in DESIGN.md §B/§E. Every change to these numbers re-runs `pnpm experiments`.

## ADR-014 — Aggregates reject unsafe integers before mutating (2026-08-12)

Adversarial verification constructed real (if absurd-scale, ~$90T) sequences where IEEE-754
addition past 2^53 silently lost cents from cash/deposits while `checkInvariants` replayed the
same lossy math and passed. Every aggregate mutation (cash, deposits, realized, cost basis,
position quantity) now asserts the post-mutation value is a safe integer and throws BEFORE
committing; `buy` also validates the ACTUAL rounded cost against cash, not the requested spend.
Loud rejection beats silent corruption. **Safety-critical.**
