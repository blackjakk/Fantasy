/**
 * The economy-tuning experiment harness. Sweeps rule knobs across many Monte
 * Carlo seasons and reports the metric battery for each configuration.
 *
 * Paired seeds: within an experiment, every config runs the same seed list,
 * and the engines draw randomness from labeled child streams, so fantasy
 * outcomes and market paths are IDENTICAL across configs — differences in the
 * metrics isolate the rule change itself.
 *
 * Usage: tsx packages/sim/src/experiments/run.ts [--seasons 400] [--exp name,name] [--quiet]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORMULAS, type CapitalFormula } from '@fc/fantasy';
import { DEFAULT_MIX_12 } from '../bots.js';
import { computeMetrics, type ConfigMetrics } from '../metrics.js';
import { runSeason, type SeasonConfig } from '../seasonRunner.js';

interface ExperimentConfig {
  label: string;
  overrides: Partial<Omit<SeasonConfig, 'seed'>>;
}

interface Experiment {
  name: string;
  question: string;
  configs: ExperimentConfig[];
}

const BASE: Omit<SeasonConfig, 'seed'> = {
  nTeams: 12,
  weeks: 14,
  formula: FORMULAS['win15x'] as CapitalFormula,
  startingBankrollCents: 100_000,
  bettingCapPct: 0.3,
  desperationEnabled: false,
  botKeys: DEFAULT_MIX_12,
  listedPlayerCount: 20,
};

const MIX_8 = [
  'passive-index',
  'crypto-bull',
  'degen',
  'player-scout',
  'cash-conservative',
  'momentum',
  'skilled',
  'random',
];
const MIX_10 = [...MIX_8, 'contrarian', 'passive-index'];
const MIX_14 = [...DEFAULT_MIX_12, 'player-scout', 'degen'];

const EXPERIMENTS: Experiment[] = [
  {
    name: 'win-reward',
    question: 'How strong should winning your matchup be? (snowball vs fantasy relevance)',
    configs: [
      { label: 'flat (no win reward)', overrides: { formula: FORMULAS['flat'] as CapitalFormula } },
      { label: 'win 1.25x', overrides: { formula: FORMULAS['win125x'] as CapitalFormula } },
      { label: 'win 1.5x', overrides: { formula: FORMULAS['win15x'] as CapitalFormula } },
      { label: 'win 2x', overrides: { formula: FORMULAS['win2x'] as CapitalFormula } },
      {
        label: 'fixed $100 win bonus',
        overrides: { formula: FORMULAS['fixedBonus'] as CapitalFormula },
      },
    ],
  },
  {
    name: 'starting-bankroll',
    question: 'Should everyone start with capital, and how much?',
    configs: [
      { label: '$0 start', overrides: { startingBankrollCents: 0 } },
      { label: '$500 start', overrides: { startingBankrollCents: 50_000 } },
      { label: '$1,000 start', overrides: { startingBankrollCents: 100_000 } },
      { label: '$2,000 start', overrides: { startingBankrollCents: 200_000 } },
    ],
  },
  {
    name: 'betting-caps',
    question: 'Does unrestricted gambling degenerate the game? (desperation mode ON)',
    configs: [
      { label: 'uncapped', overrides: { bettingCapPct: null, desperationEnabled: true } },
      { label: 'cap 50% NAV', overrides: { bettingCapPct: 0.5, desperationEnabled: true } },
      { label: 'cap 30% NAV', overrides: { bettingCapPct: 0.3, desperationEnabled: true } },
      { label: 'cap 15% NAV', overrides: { bettingCapPct: 0.15, desperationEnabled: true } },
      { label: 'no sportsbook', overrides: { bettingCapPct: 0, desperationEnabled: true } },
      {
        label: 'cap 30%, no desperation',
        overrides: { bettingCapPct: 0.3, desperationEnabled: false },
      },
    ],
  },
  {
    name: 'league-size',
    question: 'Does the economy hold up across league sizes?',
    configs: [
      { label: '8 teams', overrides: { nTeams: 8, botKeys: MIX_8 } },
      { label: '10 teams', overrides: { nTeams: 10, botKeys: MIX_10 } },
      { label: '12 teams', overrides: {} },
      { label: '14 teams', overrides: { nTeams: 14, botKeys: MIX_14 } },
    ],
  },
  {
    name: 'point-value',
    question: 'Is the $/point conversion purely cosmetic? (ranks should be invariant)',
    configs: [
      {
        label: '$0.50/pt',
        overrides: {
          formula: { ...(FORMULAS['win15x'] as CapitalFormula), pointValueCents: 50 },
          startingBankrollCents: 50_000,
        },
      },
      { label: '$1/pt', overrides: {} },
      {
        label: '$2/pt',
        overrides: {
          formula: { ...(FORMULAS['win15x'] as CapitalFormula), pointValueCents: 200 },
          startingBankrollCents: 200_000,
        },
      },
    ],
  },
  {
    name: 'odds-caps',
    question:
      'Cap the payout, not the stake: does a max-odds rule control lottery titles where %-of-NAV caps failed? (cap 30%, desperation ON)',
    configs: [
      { label: 'no odds cap', overrides: { desperationEnabled: true, maxDecimalOdds: null } },
      { label: 'max +1000 (11.0)', overrides: { desperationEnabled: true, maxDecimalOdds: 11 } },
      { label: 'max +600 (7.0)', overrides: { desperationEnabled: true, maxDecimalOdds: 7 } },
      { label: 'max +400 (5.0)', overrides: { desperationEnabled: true, maxDecimalOdds: 5 } },
      { label: 'max +200 (3.0)', overrides: { desperationEnabled: true, maxDecimalOdds: 3 } },
    ],
  },
  {
    name: 'recommended-combo',
    question:
      'Interaction of win reward x bankroll under realistic behavior (cap 30%, desperation ON): which combo best balances fantasy vs investing relevance?',
    configs: [
      {
        label: '1.5x + $500',
        overrides: {
          formula: FORMULAS['win15x'] as CapitalFormula,
          startingBankrollCents: 50_000,
          desperationEnabled: true,
        },
      },
      {
        label: '2x + $500',
        overrides: {
          formula: FORMULAS['win2x'] as CapitalFormula,
          startingBankrollCents: 50_000,
          desperationEnabled: true,
        },
      },
      {
        label: '1.5x + $1,000',
        overrides: {
          formula: FORMULAS['win15x'] as CapitalFormula,
          startingBankrollCents: 100_000,
          desperationEnabled: true,
        },
      },
      {
        label: '2x + $1,000',
        overrides: {
          formula: FORMULAS['win2x'] as CapitalFormula,
          startingBankrollCents: 100_000,
          desperationEnabled: true,
        },
      },
    ],
  },
];

function main(): void {
  const args = process.argv.slice(2);
  const seasons = intArg(args, '--seasons') ?? 400;
  const quiet = args.includes('--quiet');
  const only = strArg(args, '--exp')?.split(',');
  const outDir = strArg(args, '--out') ?? join(process.cwd(), 'docs', 'generated');

  const selected = EXPERIMENTS.filter((e) => !only || only.includes(e.name));
  const started = performance.now();
  const report: { experiment: string; question: string; results: ConfigMetrics[] }[] = [];

  selected.forEach((exp, expIdx) => {
    if (!quiet) console.log(`\n=== ${exp.name}: ${exp.question}`);
    const results: ConfigMetrics[] = [];
    for (const cfg of exp.configs) {
      const runs = [];
      for (let i = 0; i < seasons; i++) {
        // Paired seeds across configs within an experiment (variance reduction).
        runs.push(runSeason({ ...BASE, ...cfg.overrides, seed: expIdx * 1_000_000 + i }));
      }
      const m = computeMetrics(cfg.label, runs);
      results.push(m);
      if (!quiet) console.log(summaryLine(m));
    }
    report.push({ experiment: exp.name, question: exp.question, results });
  });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'experiment-results.json'),
    JSON.stringify({ seasonsPerConfig: seasons, report }, null, 2),
  );
  writeFileSync(join(outDir, 'experiment-results.md'), markdownReport(seasons, report));
  const secs = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `\nWrote ${join(outDir, 'experiment-results.md')} (${seasons} seasons/config, ${secs}s)`,
  );
}

function summaryLine(m: ConfigMetrics): string {
  return [
    `  ${m.label.padEnd(26)}`,
    `champNAV $${m.medianChampionNavUsd}`,
    `corr(pts,NAV)=${m.spearmanPointsNav.toFixed(2)}`,
    `corr(ret,NAV)=${m.spearmanReturnNav.toFixed(2)}`,
    `P(bestRosterWins)=${pct(m.pChampIsBestRoster)}`,
    `P(bestInvestorWins)=${pct(m.pChampIsReturnLeader)}`,
    `comeback=${pct(m.comebackRate)}`,
    `gamblingTitle=${pct(m.gamblingTitleRate)}`,
  ].join('  ');
}

function markdownReport(
  seasons: number,
  report: { experiment: string; question: string; results: ConfigMetrics[] }[],
): string {
  const lines: string[] = [
    '# Fantasy Capital — economy experiment results',
    '',
    `_Generated by \`pnpm experiments\` — ${seasons} Monte Carlo seasons per config, paired seeds within each experiment. Do not edit by hand._`,
    '',
  ];
  for (const exp of report) {
    lines.push(`## ${exp.experiment}`, '', `**Question:** ${exp.question}`, '');
    lines.push(
      '| config | champ NAV (med) | champ return (med) | corr(pts, NAV) | corr(return, NAV) | P(pts leader wins) | P(best roster wins) | P(best investor wins) | leader persist | comeback | late competitive | gambling title | NAV p90/p10 | skilled top-3 |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    );
    for (const m of exp.results) {
      lines.push(
        `| ${m.label} | $${m.medianChampionNavUsd.toLocaleString('en-US')} | ${pct(m.medianChampionReturn)} | ${m.spearmanPointsNav.toFixed(2)} | ${m.spearmanReturnNav.toFixed(2)} | ${pct(m.pChampIsPointsLeader)} | ${pct(m.pChampIsBestRoster)} | ${pct(m.pChampIsReturnLeader)} | ${pct(m.leaderPersistence)} | ${pct(m.comebackRate)} | ${pct(m.competitiveLateShare)} | ${pct(m.gamblingTitleRate)} | ${m.navSpreadP90P10.toFixed(2)} | ${Number.isNaN(m.skilledTop3Rate) ? '—' : pct(m.skilledTop3Rate)} |`,
      );
    }
    lines.push('', '**Championship win index by strategy (1.00 = fair share):**', '');
    const bots = Object.keys(exp.results[0]?.botWinIndex ?? {}).sort();
    lines.push(`| config | ${bots.join(' | ')} |`, `|---|${bots.map(() => '---').join('|')}|`);
    for (const m of exp.results) {
      lines.push(
        `| ${m.label} | ${bots.map((b) => (m.botWinIndex[b] ?? 0).toFixed(2)).join(' | ')} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function intArg(args: string[], name: string): number | null {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return null;
  const v = Number(args[i + 1]);
  if (!Number.isFinite(v)) throw new Error(`bad value for ${name}`);
  return v;
}

function strArg(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return null;
  return args[i + 1] as string;
}

main();
