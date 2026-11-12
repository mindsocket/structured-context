/**
 * Live semantic evals: judge the eval spaces with real providers and report agreement with the labels.
 * Costs money. See README.md.
 */
import { parseArgs } from 'node:util';
import { loadConfigOrEmpty } from '../../src/config';
import { createJudgeProvider } from '../../src/judge/factory';
import {
  checkEvalSpace,
  type Judgement,
  judgeEvalSpace,
  loadEvalSpaces,
  type RuleScore,
  scoreEvalSpace,
} from './harness';

const { values } = parseArgs({
  options: {
    provider: { type: 'string', multiple: true },
    space: { type: 'string', multiple: true },
    runs: { type: 'string', default: '3' },
    'per-node': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});

const providerNames = (values.provider ?? []).flatMap((p) => p.split(',')).filter(Boolean);
const runs = Number(values.runs);
if (providerNames.length === 0) throw new Error('Name at least one model provider with --provider <name>.');
if (!Number.isInteger(runs) || runs < 1) {
  throw new Error(`--runs must be a positive whole number, not "${values.runs}".`);
}

// Build every provider and check every space before the first paid call.
const config = loadConfigOrEmpty();
const providers = providerNames.map((name) => createJudgeProvider(config, {}, name)!);
const spaces = loadEvalSpaces(undefined, values.space);
const problems = (await Promise.all(spaces.map(checkEvalSpace))).flat();
if (problems.length > 0) throw new Error(`Eval spaces have problems:\n${problems.join('\n')}`);

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
      if (s.unlabelled.length > 0)
        notes.push(`- ${space} · ${provider} · ${s.ruleId}: judged with no label: ${s.unlabelled.join(', ')}`);
    }
  }
  if (notes.length > 0) lines.push('', 'Misses:', ...notes);
  console.log(lines.join('\n'));
}
