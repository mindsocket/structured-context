/** Semantic evals: judge labelled cases with real providers and report agreement. See README.md. */
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { configPath, loadConfigOrEmpty } from '../src/config';
import { createJudgeProvider } from '../src/judge/factory';
import { checkEval, type Judgement, judgeEval } from './judge';
import { loadEvals, resolveSuite } from './load';
import { type RuleScore, scoreEval } from './score';

const { values } = parseArgs({
  options: {
    from: { type: 'string', multiple: true },
    provider: { type: 'string', multiple: true },
    eval: { type: 'string', multiple: true },
    runs: { type: 'string', default: '3' },
    'per-node': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
  },
});

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const list = (values: string[] | undefined) => (values ?? []).flatMap((v) => v.split(',')).filter(Boolean);
const providerNames = list(values.provider);
const runs = Number(values.runs);
if (providerNames.length === 0 && !values.check) fail('Name a model provider with --provider <name>, or pass --check.');
if (!Number.isInteger(runs) || runs < 1) fail(`--runs must be a positive whole number, not "${values.runs}".`);

// Build every provider and check every eval before the first paid call.
const config = loadConfigOrEmpty();
// Plugins resolve from the main config file's directory and from each included file's.
const configDirs = [
  ...new Set([dirname(configPath()), ...config.spaces.flatMap((s) => (s.sourceDir ? [s.sourceDir] : []))]),
];
const providers = providerNames.map((name) => createJudgeProvider(config, {}, name)!);
const suites = (list(values.from).length > 0 ? list(values.from) : ['core']).map((s) => resolveSuite(s, configDirs));
const only = list(values.eval);
const evals = loadEvals(suites, config).filter(
  (e) => only.length === 0 || only.some((name) => e.name === name || e.name.endsWith(`/${name}`)),
);
if (evals.length === 0) fail('No evals found.');
const problems = (await Promise.all(evals.map(checkEval))).flat();
if (problems.length > 0) fail(`Evals have problems:\n${problems.join('\n')}`);
if (values.check) {
  console.log(`Checked ${evals.length} eval(s): ${evals.map((e) => e.name).join(', ')}`);
  process.exit(0);
}

const results: Array<{ eval: string; provider: string; scores: RuleScore[]; runs: Judgement[][] }> = [];
for (const evaluation of evals) {
  for (const [i, provider] of providers.entries()) {
    const judged: Judgement[][] = [];
    for (let run = 0; run < runs; run++) {
      judged.push(await judgeEval(evaluation, provider, { perNode: values['per-node'] }));
    }
    results.push({
      eval: evaluation.name,
      provider: providerNames[i]!,
      scores: scoreEval(evaluation, judged),
      runs: judged,
    });
  }
}

if (values.json) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

const pct = (n: number | undefined) => (n === undefined ? '-' : `${Math.round(n * 100)}%`);
const lines = [
  `Semantic evals: ${runs} run(s) per provider${values['per-node'] ? ', one request per node' : ''}`,
  '',
  '| Eval | Provider | Rule | Cases | Agreement | Stable | p(expected) | Reserved | Errors |',
  '|---|---|---|---|---|---|---|---|---|',
];
const misses: string[] = [];
const closest: string[] = [];
for (const { eval: name, provider, scores } of results) {
  for (const s of scores) {
    const stable = runs > 1 ? pct(s.stable) : '-';
    lines.push(
      `| ${name} | ${provider} | ${s.ruleId} | ${s.cases} | ${pct(s.agreement)} | ${stable} | ${pct(s.expectedProbability)} | ${s.reserved} | ${s.errors} |`,
    );
    const at = `${name} · ${provider} · ${s.ruleId}`;
    for (const m of s.misses) {
      misses.push(`- ${at} · ${m.nodeId}: expected ${m.expected.join(' or ')}, got ${m.got.join(', ')}`);
      if (m.evidence) misses.push(`  ${m.evidence}`);
    }
    for (const c of s.closest) closest.push(`- ${at} · ${c.nodeId}: ${pct(c.probability)}`);
  }
}
if (misses.length > 0) lines.push('', 'Misses:', ...misses);
if (closest.length > 0) lines.push('', 'Closest agreeing cases, by p(expected):', ...closest);
console.log(lines.join('\n'));
