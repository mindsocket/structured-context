/**
 * Semantic evals: judge eval spaces with real providers and report agreement with the labels. Costs money,
 * except with `--check`. See README.md.
 */
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { configPath, getConfigSourceFiles, loadConfigOrEmpty } from '../../src/config';
import { createJudgeProvider } from '../../src/judge/factory';
import {
  checkEvalSpace,
  type Judgement,
  judgeEvalSpace,
  loadEvalSpaces,
  type RuleScore,
  resolveEvalSources,
  scoreEvalSpace,
} from './harness';

const { values } = parseArgs({
  options: {
    from: { type: 'string', multiple: true },
    provider: { type: 'string', multiple: true },
    space: { type: 'string', multiple: true },
    runs: { type: 'string', default: '3' },
    'per-node': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
  },
});

const list = (values: string[] | undefined) => (values ?? []).flatMap((v) => v.split(',')).filter(Boolean);
const providerNames = list(values.provider);
const runs = Number(values.runs);
if (providerNames.length === 0 && !values.check) {
  throw new Error('Name at least one model provider with --provider <name>, or pass --check.');
}
if (!Number.isInteger(runs) || runs < 1) {
  throw new Error(`--runs must be a positive whole number, not "${values.runs}".`);
}

// Build every provider and check every space before the first paid call.
const config = loadConfigOrEmpty();
// The main config file and every file it includes.
const configFiles = [configPath(), ...getConfigSourceFiles()].filter((file) => existsSync(file));
const configDirs = [...new Set(configFiles.map((file) => dirname(file)))];
const providers = providerNames.map((name) => createJudgeProvider(config, {}, name)!);
const sources = (list(values.from).length > 0 ? list(values.from) : ['core']).flatMap((source) =>
  resolveEvalSources(source, configDirs),
);
const only = list(values.space);
const spaces = loadEvalSpaces(sources, config).filter(
  (space) => only.length === 0 || only.some((name) => space.name === name || space.name.endsWith(`/${name}`)),
);
if (spaces.length === 0) throw new Error('No eval spaces found.');
const problems = (await Promise.all(spaces.map(checkEvalSpace))).flat();
if (problems.length > 0) throw new Error(`Eval spaces have problems:\n${problems.join('\n')}`);
if (values.check) {
  console.log(`Checked ${spaces.length} eval space(s): ${spaces.map((s) => s.name).join(', ')}`);
  process.exit(0);
}

const results: Array<{ space: string; provider: string; scores: RuleScore[]; runs: Judgement[][] }> = [];
for (const space of spaces) {
  for (const [i, provider] of providers.entries()) {
    const judged: Judgement[][] = [];
    for (let run = 0; run < runs; run++) {
      judged.push(await judgeEvalSpace(space, provider, { perNode: values['per-node'] }));
    }
    results.push({
      space: space.name,
      provider: providerNames[i]!,
      scores: scoreEvalSpace(space, judged),
      runs: judged,
    });
  }
}

if (values.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const pct = (n: number | undefined) => (n === undefined ? '-' : `${Math.round(n * 100)}%`);
  const lines = [
    `Semantic evals: ${runs} run(s) per provider${values['per-node'] ? ', one request per node' : ''}`,
    '',
    '| Space | Provider | Rule | Cases | Agreement | Stable | p(expected) | Reserved | Errors |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const { space, provider, scores } of results) {
    for (const s of scores) {
      lines.push(
        `| ${space} | ${provider} | ${s.ruleId} | ${s.cases} | ${pct(s.agreement)} | ${runs > 1 ? pct(s.stable) : '-'} | ${pct(s.expectedProbability)} | ${s.reserved} | ${s.errors} |`,
      );
    }
  }
  const notes: string[] = [];
  for (const { space, provider, scores } of results) {
    for (const s of scores) {
      for (const m of s.misses) {
        notes.push(
          `- ${space} · ${provider} · ${s.ruleId} · ${m.nodeId}: expected ${m.expected.join(' or ')}, got ${m.got.join(', ')}`,
        );
        if (m.evidence) notes.push(`  ${m.evidence}`);
      }
    }
  }
  if (notes.length > 0) lines.push('', 'Misses:', ...notes);
  console.log(lines.join('\n'));
}
