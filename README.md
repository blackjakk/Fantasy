# Fantasy Capital

_Draft. Score. Invest. Win._

A fantasy football game where your team's weekly fantasy performance generates investable
capital, and the manager with the strongest portfolio (NAV) at season's end wins the league.
Sleeper meets a brokerage: the fantasy team is the capital engine, the portfolio is the second
half of the game. **Simulated money only** — no real funds, custody, sportsbooks, or blockchain.

## Status

Engine-and-simulation stage. The full gameplay loop is implemented as pure TypeScript engines,
playable end-to-end in the terminal, with a Monte Carlo experiment harness that tunes the
economy. There is no web UI yet — on purpose: we're proving the loop is fun and fair first.

- **Design doc (start here):** [docs/DESIGN.md](docs/DESIGN.md)
- **Decision log:** [docs/DECISIONS.md](docs/DECISIONS.md)
- **Backlog:** [docs/BACKLOG.md](docs/BACKLOG.md)
- **Experiment results:** [docs/generated/experiment-results.md](docs/generated/experiment-results.md)

## Quickstart

Requires Node ≥ 22 and pnpm ≥ 10.

```bash
pnpm install

# Play a full deterministic season in the terminal (draft → weekly reward
# moments → markets → NAV leaderboard → trophies)
pnpm slice

# Take seat 1 yourself: buy/sell/bet against 11 strategy bots
pnpm slice:interactive

# League settings as flags
pnpm slice -- --seed 7 --formula win2x --bankroll 500 --cap 0.3 --max-odds 3

# Run the economy experiments (writes docs/generated/)
pnpm experiments            # 400 seasons per config, ~1 min
pnpm experiments:smoke      # quick sanity pass

# Toolchain
pnpm test
pnpm typecheck
pnpm lint
pnpm format
```

## Repository layout

```text
packages/
  core/        Money (integer cents), seeded deterministic RNG, stats
  fantasy/     Player pool, snake draft, schedule, lineups, scoring, capital formula
  markets/     Price engine (GBM), player-share AMM + dividends, sportsbook
  portfolio/   Append-only ledger, positions, NAV, betting rules (safety-critical)
  sim/         Strategy bots, season runner, metric battery, experiment harness
apps/
  slice/       The vertical slice: a playable season in the terminal
docs/          Design doc, ADRs, backlog, generated experiment results
```

## Engineering rules of the road

- **No floats in ledgers.** Money is integer cents; quantities are integer micro-shares.
- **Determinism everywhere.** No `Math.random`, no `Date.now` (lint-enforced); all randomness
  flows through a seeded RNG, so any season or bug reproduces from its seed.
- **Append-only accounting.** Balances are derived; `checkInvariants` replays the ledger and
  asserts `NAV = deposits + realized P&L + unrealized P&L` exactly, every simulated week.
- **Rules live on the ledger boundary.** Betting caps and market integrity are enforced in the
  portfolio/market engines, never in bots or (future) clients.
- **Simulate before arguing.** Every formula/cap/asset change re-runs `pnpm experiments`.
