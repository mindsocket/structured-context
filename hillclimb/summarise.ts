/** Summarise `evals/run.ts --json` output: pooled agreement and p(expected) over the pilot rules, per provider. */
import { readFileSync } from 'node:fs';

type Row = {
  eval: string;
  provider: string;
  scores: Array<{ ruleId: string; cases: number; agreement: number; expectedProbability?: number }>;
};
const [file, mode] = process.argv.slice(2);
if (!file) throw new Error('usage: bun hillclimb/summarise.ts <run.json> [--aggregate-only]');
const rows = JSON.parse(readFileSync(file, 'utf8')) as Row[];
const byProvider = new Map<string, Row['scores']>();
for (const r of rows) byProvider.set(r.provider, [...(byProvider.get(r.provider) ?? []), ...r.scores]);
for (const [provider, scores] of byProvider) {
  const cases = scores.reduce((n, s) => n + s.cases, 0);
  const agree = scores.reduce((n, s) => n + s.agreement * s.cases, 0) / cases;
  const withP = scores.filter((s) => s.expectedProbability !== undefined);
  const p = withP.length
    ? withP.reduce((n, s) => n + s.expectedProbability! * s.cases, 0) / withP.reduce((n, s) => n + s.cases, 0)
    : undefined;
  const pct = (x: number) => (x * 100).toFixed(1);
  console.log(
    `${provider}\tcases=${cases}\tagreement=${pct(agree)}\tp_expected=${p === undefined ? '-' : p.toFixed(3)}`,
  );
  if (mode !== '--aggregate-only') {
    for (const s of scores)
      console.log(`  ${s.ruleId}\t${s.cases}\t${pct(s.agreement)}\t${s.expectedProbability?.toFixed(3) ?? '-'}`);
  }
}
