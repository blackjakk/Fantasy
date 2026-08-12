# Backlog

Ordered within sections. (S) = safety-critical when touched.

## Next — finish proving the loop

1. **Casual/inattentive bot archetype** — never opens the market; capital auto-sweeps to index
   after 48h. Verify the design target: finishes 40th–60th NAV percentile. (Red-team finding:
   current bots are all rational agents, so every chaos metric is a lower bound.)
2. **Max-weekly-profit betting cap** (stake × (odds−1) ≤ X% of NAV) as a single elegant knob;
   sweep X ∈ {15%, 25%, 40%} against the odds-cap baseline. (S)
3. **Paycheck-denominated stake cap** variant (stake ≤ 50% of that week's generated capital) —
   the review panel's convergent rule; needs weekly-capital plumbing into `BettingRules`. (S)
4. **Escalating point value** ($1 → $1.50 → $2 by season phase) as an implicit catch-up
   mechanic; measure early-lock-in correlation (week-4 rank vs final) against flat pricing.
5. **Median-beat bonus** (+$50 for beating the weekly league median regardless of matchup)
   to soften schedule luck; sweep.
6. **Playoff capital multipliers** (weeks 15–17 pay 2×/3×/4×) + bracket support in the
   schedule/runner; measure how often the title "runs through the bracket."
7. **Player-share depth sweep** — how much can 12 coordinated managers move a mark at
   $50k/$100k/$250k depth; set default so a plausible all-in moves any player < 5%.
8. **Turn-based interactive slice polish** — waiver-free roster edits, week summaries,
   `--replay` of a saved season.

## MVP product layer (after the loop is validated)

- Thin API server (Node/Postgres/Drizzle) persisting engine events; auth; one hosted league.
- Reward-moment screen, market screen, portfolio screen (Next.js). 3-tap deploy presets:
  Repeat last week / Auto-index / Open market.
- Auto-sweep undeployed capital → index (opt-out), 48h after settlement.
- Weekly settle job mirroring the runner's ordering contract. (S)
- Wire-shape test: `trueProb` and AMM internals never serialize to clients. (S)
- League presets: Standard / No Sportsbook / Degen (see DESIGN §B).

## V1

- Real NFL data provider behind the existing scoring interface; real market data feeds
  ("real feeds before the first season anyone cares about winning").
- Sleeper/ESPN/Yahoo **overlay-mode import** — the league-adoption wedge.
- Injury-news trading halts + gap repricing for player markets. (S)
- Per-manager weekly AMM flow caps; wash-trade pattern report. (S)
- Sealed bets (hidden placement → public at kickoff), no in-play betting.
- Live "pending capital" ticker during games; Tuesday settlement push.
- League chat/feed events (trade/bet/milestone surfacing), weekly awards.
- Waivers (FAAB), fantasy trades — with the note that roster trades now move economic value:
  commissioner veto + audit log. (S)
- Portfolio charts, allocation views, advanced analytics tab (Sharpe etc. live here, never in
  the main scoreboard).

## V2+

- Dynasty (persistent rosters/portfolios), rookie IPOs, global cross-league player market.
- Shared league treasury + governance + top-scorer treasury parlay.
- Prediction markets — only under the same payout-cap regime as the sportsbook.
- Order types / hybrid AMM+order-book player markets.

## Explicitly parked (V3/research)

Real money, real crypto, onchain settlement, embedded wallets, regulated betting integrations,
jurisdiction-aware features. Architectural rule: these arrive as adapters behind the API server;
engine packages stay pure. (S)

## Known open questions

- Fantasy playoffs weeks 15–17: do eliminated teams keep earning? (Currently: capital race ends
  at week 14; playoffs are fantasy-trophy-only. Revisit with playoff multipliers.)
- Business model (subscriptions/cosmetics — must not sell competitive advantage; NAV scoreboard
  credibility is the product).
- NFLPA/data licensing for real player names & stats when leaving synthetic data.
- Abandoned-manager policy: auto-pilot portfolios, replacement rules.
