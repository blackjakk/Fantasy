# Dynasty Treasury — design and simulation findings

The idea: a dynasty league where members lock recurring contributions into one shared fund for
~20 years, and the fund's allocation is steered by votes whose weight is **earned by fantasy
performance**. The trophy isn't a payout — it's influence over compounding money.

This document records the mechanism design, what 300 simulated 20-year league histories said
about it (`pnpm experiments:dynasty`, tables in
[generated/dynasty-results.md](generated/dynasty-results.md)), the recommended constitution
defaults, and how this becomes a product without becoming a bank.

---

## 1. The load-bearing design rule: voice, never ownership

Fantasy results must move **voting power only**. Every member's economic share stays strictly
pro-rata to their contributions, forever.

- As game design: if titles moved ownership, losing members would be rationally obliged to
  defect, and the fund becomes a slow wealth transfer that ends friendships.
- As risk posture: dollars changing hands based on fantasy outcomes is wagering; influence
  changing hands is a constitution quirk in an investment club. (Not legal advice; real counsel
  before real dollars — see §5.)

Everything below assumes this split.

## 2. What the simulation was asked, and what it answered

Setup: 12 members × 20 seasons, real fantasy engine per season (redraft, playoffs), member
skill drifting across years with occasional regime changes, $1,000/member/year contributed
($240,000 lifetime), annual allocation votes over INDEX / BONDS / GOLD / CRYPTO, member
preferences from five archetypes (4 indexers, 3 conservatives, 2 crypto bulls, 1 gold bug,
2 degens). 300 paired worlds: every governance variant faces identical fantasy history, market
returns, and preferences.

**Finding 1 — the "permanent king" fear is mostly unfounded; the real failure is saturation.**
Even the harshest structure tested (tiny floor, no cap) concentrates only 22% of voice in the
top member after 20 years — a 12-team fantasy league is too noisy to crown a tyrant. The
counter-intuitive result: with **no decay**, trophies accumulate until many members hit the
voice cap, ties dominate, and the system silently degenerates into equal voting where trophies
mean nothing (merit-vs-power correlation 0.40 but top-power-member-isn't-top-skill 73% — the
noise floor). **Decay is not primarily a fairness knob; it's what keeps voice meaningful.**
0.8–0.9/year is the band (half-life 3–7 years); 0.7 turns voice into a recency lottery
(merit correlation drops to 0.37).

**Finding 2 — the floor protects the casual, not the throne.** Dropping the guaranteed base
voice (winners-rule) doesn't much change who leads (22% vs 17% top-1); it crushes the bottom:
the least-successful member's voice falls from ~5% to ~2% of the vote. If the fund is partly
the casuals' money, a full base share for every member is non-negotiable — it's also what keeps
"all members actively participate" true in the investment-club sense.

**Finding 3 — weekly wins are a better voice currency than championships.** Earning voice from
regular-season wins (280 samples over 20 years) tracks true skill far better than trophies
(~20 samples): merit correlation 0.51 vs 0.41, and the most powerful member is a genuine top-3
skill member 61% vs 52% of the time. But championships are the _story_. The blended rule —
half-weight trophies plus a small per-win earn — keeps most of the merit signal (0.46) while
championships still visibly matter. Recommended.

**Finding 4 — governance FORM moves the portfolio far more than governance WEIGHTS.** Nothing
in decay/floor/cap/earn-basis budged the fund's allocation (~21% crypto in every variant). What
moved it was the aggregation rule. Committee-compromise voting (weighted average of everyone's
preference) imports every member's risk appetite into a standing ~21% crypto sleeve. Proposal
voting (winner-take-all on the most-supported proposal) collapses to the dominant bloc's
portfolio — ~1% crypto, because the indexer bloc wins. Twenty-year outcomes on $240k
contributed: compromise → median $402k, p10 $227k, p90 $767k, max drawdown 15%; winner-take-all
→ median $397k, p10 $254k, p90 $642k, drawdown 13%. Choose the aggregation rule deliberately;
it _is_ the risk policy.

**Finding 5 — a hard crypto cap is the best constitution guardrail tested.** Crypto ≤ 10% under
compromise voting dominated the no-cap fund on every downside measure — median $412k (higher),
p10 $270k (best anywhere), drawdown 9% (best anywhere), beat-the-index rate 47% (best) — while
giving up tail upside (p90 $641k vs $767k). For locked, decades-long friend money, trading the
right tail for the floor is correct. A 25% cap barely binds and is mostly theater.

**Honest caveats.** Preferences are static archetypes; nobody adapts, lobbies, or rage-quits.
Votes are annual. Crypto's return parameters (long-run ~10% median log-growth, 65% vol) are
contestable — the _qualitative_ ordering of the findings is robust to them; the exact dollars
are not. And across all configs the fund beats a boring 100%-index policy only ~44% of the time:
the treasury's value is social (the arguments, the record, the institution), not alpha. Say that
out loud to any league adopting this.

## 3. Recommended constitution defaults

Voice (voting power):

- Base voice **1.0 per member, always** (the floor).
- Earned voice: **championship +0.5, points title +0.25, playoff win +0.125, +0.02 per
  regular-season win**, decaying **15–20%/year**, total voice capped at **3× base**.
- Published formula, recomputed annually from league history; the ledger is the argument-settler.

Votes:

- Annual policy vote sets the allocation; quarterly amendment windows.
- Compromise-style aggregation for the core policy (know that proposal-style voting hands the
  whole book to the biggest bloc — offer it as an option with that warning).
- Quorum: if less than 50% of total voice participates, allocation stays unchanged.

Guardrails (amendable only by supermajority, e.g. 8 of 12):

- Spice sleeve (crypto + anything exotic) **≤ 10%** of the fund.
- No leverage, no single-name concentration above 10%, no sportsbook exposure in the fund.

Economics (fixed, not amendable):

- Ownership strictly pro-rata to contributions. Fantasy results never touch it.
- Exit at NAV with a 12-month notice (rolling one-year lock — a literal 20-year lock is neither
  enforceable nor kind). Death/hardship: immediate NAV exit. New members join at NAV.

## 4. Productization: the league's brain, not its bank

- **Phase 0 (done):** this simulation — `packages/sim/src/dynasty/` — governance ledger, vote
  aggregation, treasury model, experiment harness.
- **Phase 1 (buildable within Fantasy Capital, simulated money):** Dynasty Treasury as a game
  mode — real multi-season leagues, real vote-weight ledger, proposals/votes, simulated fund.
  Proves whether governance is fun before any real dollar appears.
- **Phase 2 (real money, zero custody):** the league forms its own investment-club entity with
  a standard brokerage account; Fantasy Capital ships the constitution template, computes voice
  from actual league history, runs proposals/votes with an audit trail, and gives the elected
  treasurer an execution checklist. The platform never touches funds.
- **Phase 3 (V3, maybe never):** custody or onchain vaults — only with counsel, and only after
  Phase 2 proves demand.

## 5. Safety-critical flags

- Real-money pooling implicates securities/investment-club rules, custody, money transmission,
  and state-level wagering analysis. Nothing here is legal advice; Phase 2+ requires counsel.
- Voice-not-ownership, the participation floor, and pro-rata economics are the three properties
  that keep the structure defensible — treat them as invariants, not settings.
- All treasury accounting in code follows the same rules as the game ledger: integer cents,
  append-only history, deterministic seeds.
