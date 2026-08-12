/**
 * Dynasty Treasury governance experiments: 12 members lock annual
 * contributions into a shared simulated fund for 20 years; fantasy results
 * earn voting power that steers allocation. This harness answers the design
 * questions before any UI exists:
 *
 *   1. decay      — do trophies fade, or does 2026's champion rule 2045?
 *   2. floor/cap  — how much structure keeps a "permanent king" impossible
 *                   without making trophies meaningless?
 *   3. earn basis — championships vs regular-season wins as the voice currency
 *   4. aggregation— committee compromise vs winner-take-all proposals
 *   5. guardrails — does a constitution-level crypto cap protect the fund?
 *
 * Worlds (fantasy history + market returns + preferences) are generated once
 * per trial and shared across every config: differences isolate governance.
 *
 * Usage: tsx packages/sim/src/experiments/dynastyRun.ts [--trials 300] [--years 20]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mean, median, quantile } from '@fc/core';
import {
  BLENDED_EARN,
  TROPHY_EARN,
  WINS_EARN,
  type GovernanceModel,
} from '../dynasty/governance.js';
import {
  evaluateGovernance,
  generateWorld,
  type DynastyGovConfig,
  type DynastyTrialResult,
  type DynastyWorld,
} from '../dynasty/runner.js';

const NO_EARN = { CHAMPIONSHIP: 0, POINTS_TITLE: 0, PLAYOFF_WIN: 0, REG_SEASON_WIN: 0 };

function model(key: string, over: Partial<GovernanceModel>): GovernanceModel {
  return { key, base: 1, earn: TROPHY_EARN, decay: 0.8, capMultiple: 3, ...over };
}

const TUNED = model('tuned', {});
const EQUAL = model('equal-vote', { earn: NO_EARN });

interface NamedConfig {
  label: string;
  cfg: DynastyGovConfig;
}

interface Experiment {
  name: string;
  question: string;
  configs: NamedConfig[];
}

const BASE_GOV: Omit<DynastyGovConfig, 'model'> = {
  aggregation: 'weighted-average',
  cryptoCap: null,
  contributionPerYearCents: 100_000, // $1,000 per member per year
};

const EXPERIMENTS: Experiment[] = [
  {
    name: 'decay',
    question: 'Do trophies fade? (base 1, cap 3x, trophy earn, weighted-average votes)',
    configs: [
      {
        label: 'no decay (trophies forever)',
        cfg: { ...BASE_GOV, model: model('d1', { decay: 1 }) },
      },
      { label: 'decay 0.9/yr', cfg: { ...BASE_GOV, model: model('d09', { decay: 0.9 }) } },
      { label: 'decay 0.8/yr', cfg: { ...BASE_GOV, model: model('d08', { decay: 0.8 }) } },
      { label: 'decay 0.7/yr', cfg: { ...BASE_GOV, model: model('d07', { decay: 0.7 }) } },
    ],
  },
  {
    name: 'floor-cap',
    question: 'How much floor/cap structure prevents a permanent king? (decay 0.8)',
    configs: [
      { label: 'floor 1, no cap', cfg: { ...BASE_GOV, model: model('nc', { capMultiple: null }) } },
      { label: 'floor 1, cap 3x', cfg: { ...BASE_GOV, model: model('c3', { capMultiple: 3 }) } },
      { label: 'floor 1, cap 2x', cfg: { ...BASE_GOV, model: model('c2', { capMultiple: 2 }) } },
      {
        label: 'winners rule (tiny floor, no cap)',
        cfg: { ...BASE_GOV, model: model('wr', { base: 0.25, capMultiple: null }) },
      },
      { label: 'equal vote (no fantasy voice)', cfg: { ...BASE_GOV, model: EQUAL } },
    ],
  },
  {
    name: 'earn-basis',
    question: 'What should earn voice: trophies, weekly wins, or a blend? (decay 0.8, cap 3x)',
    configs: [
      {
        label: 'trophies (champ 1.0 / pts 0.5 / po-win 0.25)',
        cfg: { ...BASE_GOV, model: model('tr', {}) },
      },
      {
        label: 'wins only (0.04 per reg-season win)',
        cfg: { ...BASE_GOV, model: model('wi', { earn: WINS_EARN }) },
      },
      {
        label: 'blended (half trophies + 0.02/win)',
        cfg: { ...BASE_GOV, model: model('bl', { earn: BLENDED_EARN }) },
      },
    ],
  },
  {
    name: 'aggregation',
    question: 'Committee compromise vs winner-take-all proposals (tuned model)',
    configs: [
      { label: 'weighted-average', cfg: { ...BASE_GOV, model: TUNED } },
      {
        label: 'proposal (winner-take-all)',
        cfg: { ...BASE_GOV, model: TUNED, aggregation: 'proposal' },
      },
      {
        label: 'proposal + equal vote',
        cfg: { ...BASE_GOV, model: EQUAL, aggregation: 'proposal' },
      },
    ],
  },
  {
    name: 'guardrails',
    question: 'Does a constitution-level crypto cap protect a 20-year fund?',
    configs: [
      { label: 'no cap, weighted-average', cfg: { ...BASE_GOV, model: TUNED } },
      {
        label: 'crypto <= 25%, weighted-average',
        cfg: { ...BASE_GOV, model: TUNED, cryptoCap: 0.25 },
      },
      {
        label: 'crypto <= 10%, weighted-average',
        cfg: { ...BASE_GOV, model: TUNED, cryptoCap: 0.1 },
      },
      { label: 'no cap, proposal', cfg: { ...BASE_GOV, model: TUNED, aggregation: 'proposal' } },
      {
        label: 'crypto <= 25%, proposal',
        cfg: { ...BASE_GOV, model: TUNED, aggregation: 'proposal', cryptoCap: 0.25 },
      },
    ],
  },
];

interface ConfigSummary {
  label: string;
  top1Share: number;
  top3Share: number;
  minShare: number;
  skillPowerCorr: number;
  luckKingRate: number;
  medianTerminalUsd: number;
  p10TerminalUsd: number;
  p90TerminalUsd: number;
  meanMaxDrawdown: number;
  meanCryptoWeight: number;
  beatIndexRate: number;
}

function summarize(label: string, trials: DynastyTrialResult[]): ConfigSummary {
  return {
    label,
    top1Share: mean(trials.map((t) => t.top1Share)),
    top3Share: mean(trials.map((t) => t.top3Share)),
    minShare: mean(trials.map((t) => t.minShare)),
    skillPowerCorr: mean(trials.map((t) => t.skillPowerCorr)),
    luckKingRate: mean(trials.map((t) => (t.topPowerSkillRank > 3 ? 1 : 0))),
    medianTerminalUsd: Math.round(median(trials.map((t) => t.terminalCents)) / 100),
    p10TerminalUsd: Math.round(
      quantile(
        trials.map((t) => t.terminalCents),
        0.1,
      ) / 100,
    ),
    p90TerminalUsd: Math.round(
      quantile(
        trials.map((t) => t.terminalCents),
        0.9,
      ) / 100,
    ),
    meanMaxDrawdown: mean(trials.map((t) => t.maxDrawdown)),
    meanCryptoWeight: mean(trials.map((t) => t.meanCryptoWeight)),
    beatIndexRate: mean(trials.map((t) => (t.beatIndexOnly ? 1 : 0))),
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const trials = intArg(args, '--trials') ?? 300;
  const years = intArg(args, '--years') ?? 20;
  const nMembers = 12;
  const outDir = strArg(args, '--out') ?? join(process.cwd(), 'docs', 'generated');

  const started = performance.now();
  console.log(`Generating ${trials} worlds (${nMembers} members x ${years} seasons each)...`);
  const worlds: DynastyWorld[] = [];
  for (let i = 0; i < trials; i++) worlds.push(generateWorld(9000 + i, nMembers, years));
  console.log(`Worlds ready in ${((performance.now() - started) / 1000).toFixed(1)}s`);

  const report: { experiment: string; question: string; results: ConfigSummary[] }[] = [];
  for (const exp of EXPERIMENTS) {
    console.log(`\n=== ${exp.name}: ${exp.question}`);
    const results: ConfigSummary[] = [];
    for (const { label, cfg } of exp.configs) {
      const rs = worlds.map((w) => evaluateGovernance(w, cfg));
      const s = summarize(label, rs);
      results.push(s);
      console.log(
        `  ${label.padEnd(38)} top1=${pct(s.top1Share)} min=${pct(s.minShare)} merit=${s.skillPowerCorr.toFixed(2)} luckKing=${pct(s.luckKingRate)} crypto=${pct(s.meanCryptoWeight)} med=$${s.medianTerminalUsd.toLocaleString('en-US')} dd=${pct(s.meanMaxDrawdown)}`,
      );
    }
    report.push({ experiment: exp.name, question: exp.question, results });
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'dynasty-results.json'),
    JSON.stringify({ trials, years, nMembers, report }, null, 2),
  );
  writeFileSync(join(outDir, 'dynasty-results.md'), markdown(trials, years, report));
  console.log(
    `\nWrote ${join(outDir, 'dynasty-results.md')} (${((performance.now() - started) / 1000).toFixed(1)}s total)`,
  );
}

function markdown(
  trials: number,
  years: number,
  report: { experiment: string; question: string; results: ConfigSummary[] }[],
): string {
  const lines = [
    '# Dynasty Treasury — governance experiment results',
    '',
    `_Generated by \`pnpm experiments:dynasty\` — ${trials} paired 20-year worlds (12 members, ${years} seasons, $1,000/member/year contributions). Do not edit by hand._`,
    '',
    'Reading guide: **top1/top3/min share** describe the final-year voting-power structure (equal share would be 8.3%);',
    '**merit corr** is the rank correlation between true fantasy skill and final voting power;',
    '**luck-king** is how often the most powerful member is not actually a top-3 skill member;',
    '**median/p10/p90 terminal** value a fund that took $240,000 of lifetime contributions;',
    '**beat index** compares against the identical world invested 100% in the index.',
    '',
  ];
  for (const exp of report) {
    lines.push(`## ${exp.experiment}`, '', `**Question:** ${exp.question}`, '');
    lines.push(
      '| config | top1 share | top3 share | min share | merit corr | luck-king | mean crypto | median terminal | p10 | p90 | mean maxDD | beat index |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|',
    );
    for (const s of exp.results) {
      lines.push(
        `| ${s.label} | ${pct(s.top1Share)} | ${pct(s.top3Share)} | ${pct(s.minShare)} | ${s.skillPowerCorr.toFixed(2)} | ${pct(s.luckKingRate)} | ${pct(s.meanCryptoWeight)} | $${s.medianTerminalUsd.toLocaleString('en-US')} | $${s.p10TerminalUsd.toLocaleString('en-US')} | $${s.p90TerminalUsd.toLocaleString('en-US')} | ${pct(s.meanMaxDrawdown)} | ${pct(s.beatIndexRate)} |`,
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
  return i === -1 || i + 1 >= args.length ? null : (args[i + 1] as string);
}

main();
