# Fantasy Capital — Design Document

_Draft. Score. Invest. Win._

Your fantasy football team is a capital-generating engine. Weekly fantasy performance produces
simulated investment capital; you allocate it across markets; the manager with the highest
portfolio value (NAV) at season's end wins.

This document covers: product critique (A), core rule recommendations (B), architecture (C),
domain model (D), simulation plan and results (E), MVP scope (F), and the first vertical
slice (G). Rule recommendations are backed by Monte Carlo simulation
(`pnpm experiments`, results in [generated/experiment-results.md](generated/experiment-results.md))
and a five-lens adversarial design review (game economy, betting variance, consumer product,
exploits/mechanism design, fantasy-purist).

---

## A. Product critique

### What is genuinely compelling

1. **Two orthogonal skill axes joined by one clean conversion.** Fantasy skill produces income;
   allocation skill compounds it. Structurally this is a poker tournament economy (accumulate
   chips, then choose variance), and the two layers verifiably share power: in simulation the
   best-drafted roster wins the capital title only ~15–20% of the time, while total fantasy
   points still correlate ~0.4 with final NAV. Neither layer is decorative.

2. **It solves fantasy's dead-team problem.** The biggest retention hole in the genre is the 2–8
   team whose season is over in November. Here that team still generates $100–300/week and holds
   a live portfolio with real decisions. Every seat has stakes in week 14. This is the single
   strongest product argument.

3. **The reward moment is behaviorally sound.** A variable-magnitude reward (your score ×
   multiplier) converts into agency (deploy capital) on a weekly cadence. Payday-then-allocate
   loops are among the most proven retention structures in games. The score → multiplier →
   capital → **[DEPLOY]** screen puts the dopamine exactly where the strategic decision is.

4. **Player shares are the thematically load-bearing asset.** They're the one asset class where
   the audience has genuine edge — fantasy knowledge IS market alpha. BTC and the index are just
   variance dials by comparison; nobody in a friend league has edge in BTC vs SPY over 14 weeks.

5. **Everything is simulated and tunable.** The economy can be balance-patched like a live game,
   and every design argument in this document is settleable by a cheap Monte Carlo run before
   shipping. The experiment harness already exists.

### Where the game can fail (ranked by severity)

1. **The terminal lottery (critical — and the obvious fix doesn't work).** Because only NAV rank
   matters, every trailing manager's payoff is convex: negative-EV max-variance play is rational
   from the moment they fall behind. Our simulations confirm the counterintuitive part: **stake
   caps denominated in % of NAV do almost nothing.** With endgame desperation behavior on,
   gambling-decided titles sit at ~24% whether the open-stake cap is 50%, 30%, or 15% of NAV,
   and even a +400 odds cap doesn't move it. The binding variable is **maximum potential profit
   (stake × odds) relative to NAV**: capping listed odds at +200 (max weekly profit ≈ 60% of
   NAV at a 30% stake cap) collapses gambling-decided titles from 24% → 9% while keeping the
   comeback rate at ~39%. Rule design must cap payout, not stake. (See §B and experiment
   `odds-caps`.)

2. **The casual third gets financial homework (critical).** Every 12-person league has 3–4
   members who set lineups Sunday 12:55pm and think about fantasy zero minutes otherwise.
   If ignoring the market means 0%-yield cash while others compound, they're visibly last by
   week 6 for not playing a game they never chose. Mitigation: auto-sweep undeployed capital
   into the index by default (opt-out), a 20-second/3-tap reward moment, and a hard sim target —
   a manager who never opens the market screen should finish 40th–60th NAV percentile.

3. **League adoption (critical, business).** Leagues switch apps as a unit, and v1 fantasy UX
   will lose to Sleeper head-on. The likely wedge is **overlay mode**: import league + weekly
   scores from Sleeper/ESPN/Yahoo APIs and run the capital game on top, so the ask is "one more
   app," not "migrate the league." Decision deferred past MVP, but it shapes V1 architecture:
   the capital engine must be able to consume external scoring feeds — which it already can,
   since `weeklyCapital(points, won, formula)` only needs a score and a result, not our
   fantasy engine.

4. **Snowballing is front-loaded, not oversized (major).** Feared: rich get richer until the
   game is decided. Measured: even at a 2× win multiplier the best roster wins the capital title
   only 18–23% of seasons — portfolio variance swamps capital differences. The real risk is
   psychological timing: early capital ranks correlate with final capital ranks, so trailing
   managers _feel_ dead by mid-season even when they aren't. Mitigations that preserve
   legitimacy: moderate multiplier (1.5×), starting bankroll, and (to test later) escalating
   point values in the back half of the season. Explicit welfare checks are rejected — they
   poison the scoreboard.

5. **Fantasy becoming irrelevant (major — this is the live tuning risk, not the reverse).**
   In every configuration tested, investment return correlates far more with final NAV (0.75–0.91)
   than fantasy points do (0.25–0.56). The knob pushing fantasy relevance UP is a stronger win
   reward and a smaller starting bankroll. This inverts the brief's stated fear: the design
   pressure is keeping _fantasy_ relevant, not investing.

6. **Asset-menu volatility is a knife-edge (major).** Too tame → NAV ranking collapses onto
   capital ranking and the market is cosmetic. Too wild → fantasy is a skin on a casino, and the
   season is decided by "which market regime happened that autumn." Keep exactly one high-vol
   class (crypto) as the legitimate comeback route; every asset listing is a balance patch and
   gets re-simulated.

7. **Player-market integrity (major — partially fixed in code already).** Three concrete
   exploits were identified by adversarial review of the actual MVP code and are now fixed:
   marking-the-close (NAV marked player holdings at post-trade spot while fills got half-impact
   pricing — self-pumping was NAV-accretive; holdings now mark at liquidation value), free wash
   trading (no fee; now 1% per side), and phantom AMM flow on rejected fills (execute-then-
   validate; now preview-validate-apply). Remaining for production: injury-news trading halts,
   per-manager weekly flow caps, one-account-per-human.

8. **Two trophies, contested legitimacy (minor for MVP, major for retention).** Fantasy diehards
   won't accept the NAV title as the only champion in year one; capital enthusiasts won't accept
   it as a sideshow. Year-one answer: two co-celebrated trophies (Capital Champion is the
   headline; Fantasy Champion keeps the bracket sacred), plus a podium structure for NAV
   (60/30/10 bragging-rights weighting) so 2nd/3rd remain worth protecting — flattening the
   convexity that motivates lottery play in the first place.

### Failure modes we measured and can stop worrying about (for now)

- **"One lucky parlay decides the season"** is real but controllable with odds caps (9% of
  seasons at the recommended settings — that residual is drama, not dysfunction).
- **Runaway snowball** does not materialize at any tested multiplier.
- **Point value ($/pt)** is confirmed cosmetic: all rank-based metrics are invariant across
  $0.50/$1/$2 per point.
- **League size 8–14** doesn't destabilize the economy.

---

## B. Core rule recommendation (the "Standard" league preset)

These are recommendations, not option lists. Every number was either swept in simulation or
follows from the adversarial review; sources noted.

| Rule               | Recommendation                                                                                                                                                                                                                                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Starting bankroll  | **$500, granted at draft close**                                                                                                                                                                                                                                                                                     | $0 leaves the deploy moment empty in week 1 (the core loop failing at first contact); $1,000+ dilutes fantasy relevance (corr 0.40 → 0.31 going $1k → $2k). $500 keeps fantasy the dominant capital source (corr 0.47 in the bankroll sweep) while giving day-one portfolio agency.                                                                                                        |
| Point conversion   | **$1.00 per fantasy point**                                                                                                                                                                                                                                                                                          | Cosmetic (verified), so choose the value with the cleanest mental math: your score IS your paycheck.                                                                                                                                                                                                                                                                                       |
| Win reward         | **1.5× multiplier on H2H win, 1.0× on loss** (base capital never zero)                                                                                                                                                                                                                                               | Unanimous across review lenses and consistent with simulation. 2× is defensible on pure balance data (it _raises_ fantasy relevance to corr 0.42–0.46 with no snowball takeover) but doubles opponent-luck dollars, doubles the value of a tanked/gifted win (collusion price), and front-loads hopelessness. Offer 2× as a "High Stakes" preset.                                          |
| Season length      | **14-week regular season** for the capital race, weeks 15–17 fantasy playoffs                                                                                                                                                                                                                                        | Matches redraft convention. Playoff-week capital multipliers (2×/3×/4×) are a promising bracket-integration mechanic — simulate before adopting.                                                                                                                                                                                                                                           |
| Winner             | **Capital Champion = highest NAV after week 14** (headline trophy), Fantasy Champion via bracket (co-celebrated), plus named honors (Best Investor, Capital Generator, Miracle Hit)                                                                                                                                  | Two-trophy structure for year one; NAV podium (1st/2nd/3rd) so mid-pack managers protect rank instead of rationally torching their stacks.                                                                                                                                                                                                                                                 |
| Betting exposure   | **Open sportsbook stakes ≤ 30% of NAV** (enforced in the ledger, not the client) **and listed odds capped at +200, max 2 legs**                                                                                                                                                                                      | The stake cap is ruin protection (keeps casuals alive); the odds cap is the actual anti-lottery knob — gambling-decided titles: 24% uncapped → 9% at +200, comebacks intact at 39%. League presets: "No Sportsbook" (0%), "Standard" (30% / +200), "Degen" (uncapped — eyes open). A max-weekly-_profit_ cap (~25% of NAV) is the more elegant single knob; implement and sweep before V1. |
| Player shares      | **Dividend $0.10 per fantasy point per share, paid on the player's actual scoring** (never "points in your lineup" — kills lineup manipulation); price anchored to consensus expected remaining-season production via AMM; 1% trade fee; holdings marked at liquidation value; single-player position cap 30% of NAV | Gives shares fundamental value that decays to zero at season end — you profit by finding players who outperform consensus, not by memes. All integrity properties are implemented and tested.                                                                                                                                                                                              |
| Weekly capital cap | **None**                                                                                                                                                                                                                                                                                                             | Monster weeks ARE the reward moment. The snowball is controlled at the multiplier/bankroll knobs; capping fantasy output attacks the product's best feeling for negligible balance gain.                                                                                                                                                                                                   |

**Also settled:** deposits are investable the week after games settle (no lookahead); sold
positions settle to cash instantly (simulated liquid assets); bet winnings settle to cash and
cannot be re-staked the same week (they land after settlement).

---

## C. Architecture

Monorepo, TypeScript end-to-end. The engines are pure, deterministic packages with **no
wall-clock time and no `Math.random`** (lint-enforced); every consumer — simulator, CLI slice,
future API server — injects a seeded RNG and drives the weekly clock. This is what makes the
economy tunable-by-experiment and every bug reproducible from a seed.

```text
                       ┌──────────────────────────────┐
                       │       apps/web (V1, later)   │
                       │  Next.js · React · Tailwind  │
                       └──────────────┬───────────────┘
                                      │ typed API (tRPC/REST, later)
                       ┌──────────────┴───────────────┐
                       │      apps/api (V1, later)    │
                       │  Node · Postgres · Drizzle   │
                       │  (owns persistence, auth,    │
                       │   settlement jobs, sockets)  │
                       └──────────────┬───────────────┘
      ────────────────────────────────┼──────────────────────────────────
      TODAY (MVP)                     │ pure engine packages
                                      │
   ┌────────────┐   scores    ┌───────┴───────┐  capital   ┌─────────────┐
   │ @fc/fantasy├────────────►│  capital calc │───────────►│@fc/portfolio│
   │ pool/draft │             │ (@fc/fantasy) │  deposits  │ append-only │
   │ schedule/  │             └───────────────┘            │ ledger, NAV │
   │ lineups/   │                                          └──────┬──────┘
   │ scoring    │             ┌───────────────┐   quotes/fills    │
   └────────────┘             │  @fc/markets  │◄──────────────────┘
                              │ price engine  │
   ┌────────────┐             │ player AMM    │            ┌─────────────┐
   │  @fc/core  │◄────────────│ sportsbook    │            │   @fc/sim   │
   │ Money(¢)   │  everyone   └───────────────┘            │ bots, season│
   │ SeededRng  │  depends on                              │ runner,     │
   │ stats      │                                          │ experiments │
   └────────────┘             ┌───────────────┐            └─────────────┘
                              │  apps/slice   │  plays a full season in
                              │  terminal CLI │  the terminal, today
                              └───────────────┘
```

Package responsibilities:

- **`@fc/core`** — integer-cents money (`Cents`), integer micro-share quantities, seeded RNG with
  labeled child streams (so paired-seed experiments isolate rule changes), stats helpers.
  No JS floats ever touch a ledger.
- **`@fc/fantasy`** — synthetic player pool (rank-decay point distributions), snake draft with
  per-team scouting error (the fantasy-skill knob), round-robin schedule, superflex lineups,
  weekly scoring, standings, and the **capital formula** (`weeklyCapital`) as a league setting.
- **`@fc/markets`** — one `Market` facade over three subsystems: GBM weekly price paths for
  index/stock/crypto; the **player-share AMM** (fundamentals-anchored: price = consensus
  remaining production × dividend rate × demand factor × sentiment, with fee, impact, and
  liquidation-value marking); the **sportsbook** (vig, noisy lines so skill can exist, globally
  shared settlement, league odds caps).
- **`@fc/portfolio`** — the safety-critical piece. Append-only ledger; derived positions/cash;
  exact integer accounting identity `NAV = deposits + realizedPnL + unrealizedPnL` enforced by
  `checkInvariants` (ledger replay) after every simulated week and in a randomized property
  test. Betting rules enforced here — the server-side boundary — never in clients/bots.
- **`@fc/sim`** — nine strategy bots (passive index, crypto bull, degen, player scout, cash
  conservative, momentum, contrarian, random, skilled-with-edge), the season runner (weekly
  ordering contract below), the metric battery, and the experiment harness.
- **`apps/slice`** — the vertical slice: a full playable season in the terminal, scripted or
  interactive.

**The weekly ordering contract** (no lookahead, enforced by the runner):

1. The week's betting slate opens.
2. Managers trade and bet using capital from _prior_ weeks only.
3. Games play: fantasy scores, matchup results, capital generation (investable next week).
4. Markets realize the week: prices move, player dividends pay to holders, bets settle against
   globally shared outcomes.
5. NAV snapshot + invariant checks.

**Deferred on purpose:** database (engines are in-memory; persistence is an API-server concern),
web UI, real data feeds (interfaces take a provider; synthetic first), sports-bet live lines,
real money/onchain anything (see brief §25–26 — future adapters must not contaminate the engine
layer, and they don't: engines have no I/O).

---

## D. Domain model

Implemented today (in the engine packages):

| Entity                                         | Package   | Notes                                                                         |
| ---------------------------------------------- | --------- | ----------------------------------------------------------------------------- |
| `NflPlayer`                                    | fantasy   | id, position, hidden true mean/sd, public projection                          |
| `FantasyTeam`                                  | fantasy   | roster of player ids; drafted via snake draft                                 |
| `Matchup` / `MatchupResult`                    | fantasy   | week, home/away, scores, winner                                               |
| `StandingsRow`                                 | fantasy   | W-L, points for/against                                                       |
| `CapitalFormula`                               | fantasy   | pointValue¢, win/loss multipliers, win bonus¢, weekly cap¢                    |
| `Asset` (`ETF`/`STOCK`/`CRYPTO`/`PLAYER`)      | markets   | one shared interface across classes                                           |
| `PriceModel` / `PriceEngine`                   | markets   | weekly GBM with optional jumps; price history                                 |
| `PlayerMarket` state                           | markets   | consensus mean, net flow, sentiment, dividends/share                          |
| `BetOffer` (`single`/`parlay`/`longshot`)      | markets   | trueProb (server-only!), decimal odds                                         |
| `Portfolio`                                    | portfolio | cash, positions, open bets, deposits, realized P&L                            |
| `LedgerEntry`                                  | portfolio | `DEPOSIT` / `TRADE` / `DIVIDEND` / `BET_PLACED` / `BET_SETTLED` — append-only |
| `Position`                                     | portfolio | qty (micro-shares), cost basis (average cost)                                 |
| `BettingRules`                                 | portfolio | league caps enforced at the ledger boundary                                   |
| `SeasonConfig` / `SeasonResult` / `TeamSeason` | sim       | one season's full config and outcome                                          |

Added at the API/persistence layer (V1, straightforward mappings of the above):
`User`, `League`, `LeagueMember`, `LeagueSetting` (frozen at draft; changes need a vote and
apply next week, with an audit log), `RosterSlot`, `FantasyWeek`, `Execution`/`Order`
(split when order types beyond market-buy/sell exist), `PriceSnapshot`, `LeaderboardSnapshot`,
`LeagueAward`. Deferred with their features: `SharedTreasury`, `GovernanceProposal`, `Vote`,
rookie IPO entities.

Two invariants worth stating as schema rules now:

- Financial history is **append-only**; balances are always derivable by replay.
- `trueProb` and AMM fair-value internals **never serialize to clients** (a wire-shape test
  should enforce this the day an API exists).

---

## E. Simulation plan and results

The simulator answers the brief's §30 questions with numbers instead of intuition. 400 Monte
Carlo seasons per configuration, **paired seeds** (labeled RNG child streams mean identical
fantasy outcomes and market paths across configs within an experiment — differences isolate the
rule change). Full tables: [generated/experiment-results.md](generated/experiment-results.md).

Headline findings:

1. **How much should a point be worth?** Cosmetic — rank metrics invariant across $0.50/$1/$2.
   Choose $1 for mental math.
2. **How strong should winning be?** Win reward is the _fantasy-relevance_ knob:
   corr(points, NAV) = 0.25 flat → 0.33 (1.25×) → 0.38 (1.5×) → 0.46 (2×). Even at 2× the best
   roster wins only 18% of capital titles — snowball fear disproved. 1.5× default on
   collusion/psychology grounds (see B).
3. **Should everyone start with capital?** Bankroll is the _investing-relevance_ knob:
   $0 → corr(points, NAV) 0.56; $2,000 → 0.31. $500 balances (0.47) and fixes the empty week-1
   deploy moment.
4. **Should gambling be limited?** Yes, but cap the payout: % -of-NAV stake caps left
   gambling-decided titles at ~24%; odds cap +200 cut them to 9% with comebacks intact (39%).
5. **Can late teams come back / does luck beat skill?** Comeback rate (champion outside NAV
   top-3 at week 8) is 33–48% across sane configs; the NAV leader at week 8 wins ~40–50% of the
   time. The skilled bot lands top-3 in ~45–50% of seasons — skill matters, doesn't lock.
6. **Behavioral caveat (from red-team review):** all bots are rational-agent models; real
   play-money populations over-gamble and go inattentive. Every number above is a lower bound on
   chaos. The bot population needs a "casual/inattentive" archetype (auto-sweep simulation) —
   backlogged.

Standing methodology: **every new asset listing, formula change, or cap change re-runs the
battery.** Tuning targets adopted from the review: capital leader wins NAV 45–60% of seasons;
best fantasy record wins 35–50%; a never-opens-the-market manager finishes 40th–60th percentile;
gambling explains ≤ ~10% of titles in Standard leagues.

---

## F. MVP scope

Everything needed to answer one question — _after a matchup settles, is receiving capital and
deploying it compelling enough to come back?_ — and nothing else.

**In (engine layer — done; playable via the slice):** 12-team synthetic league, snake draft,
superflex/half-PPR-shaped scoring, H2H matchups + standings, configurable capital formula,
starting bankroll, personal ledgered portfolio, ~27 assets (SPY, GLD, 1 stock, BTC/ETH/SOL/MEME,
20 player shares, cash), fractional buy/sell, player dividends, weekly sportsbook with league
caps, NAV leaderboard, season trophies, deterministic seeds throughout.

**Next (MVP product layer):** user accounts, one hosted league, the reward-moment screen, market

- portfolio screens, weekly settle job — a thin web app over the existing engines.

**Explicitly NOT in MVP:** real money, blockchain/wallets, real NFL data (synthetic pool),
live/in-play anything, waivers/trades/IR/keepers, dynasty, rookie IPOs, shared treasury +
governance, prediction markets (cut from asset menu until specced under the same payout-cap
regime as bets — red-team finding), player-share order books, shorting/leverage/options/limit
orders, league chat (league features ride on existing group chats initially), Sleeper import
(V1 wedge decision), multi-league accounts, and _any_ fantasy-playoffs capital mechanics.

---

## G. First vertical slice — built and playable

`pnpm slice` runs the brief's §41-G list end to end, deterministically: league creation → snake
draft → weekly scores → matchup resolution → capital generation (the boxed reward moment) →
bot/managed portfolio deployment across all asset classes → price/dividend/bet settlement →
NAV leaderboard → season trophies.

`pnpm slice:interactive` puts you in seat 1 with `buy/sell/bet/portfolio/market` commands against
11 bots. `--seed`, `--weeks`, `--formula win15x|win2x|fixedBonus|win125x|flat`, `--bankroll`,
`--cap`, `--max-odds` expose the league settings.

The demo season (seed 20260812) already produces the game's thesis unprompted: the 12-2 fantasy
juggernaut lost the Capital title to a 7-7 team running +42.5% investment returns — and both of
them have a trophy to argue about.
