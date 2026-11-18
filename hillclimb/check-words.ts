/**
 * Fails when the editable prompt text gains a word that appears in a fixture but nowhere in the schemas or judge
 * prompt at the base commit, so tuning can't name the cases it is scored on.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const base = process.argv[2];
if (!base) throw new Error('usage: bun hillclimb/check-words.ts <base-commit>');
const EDITABLE = [
  'schemas/_semantic_patterns.json',
  'schemas/_strategy_general.json',
  'src/judge/prompt.ts',
  'src/judge/provider/jev.ts',
];
const words = (text: string) => new Set(text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []);
// Plain English words that fixtures and good rubric text both use; anything else from a fixture needs to be in the schemas already.
const COMMON = new Set(
  'also away back been best both come does done down each even ever from give goes good have here into just keep know like look made make many more most much must need next only over part same seem some such take than that them then they this time very want were what when will with work your about after again against already also although among another anyone anything around because before being below between both cannot could does doing during each either enough every example first following further given however instead itself later least less likely little matter might more most much must never other others otherwise their there these thing things those though three through under until usually where whether which while whole within without would'.split(
    ' ',
  ),
);

const fixture = words(readFileSync('evals/semantic/fixtures/strategy-pilot.jsonl', 'utf8'));
const known = new Set<string>();
const schemaFiles = execSync(`git ls-tree -r --name-only ${base} -- schemas src/judge`, { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.includes('schemas/generated'));
for (const f of schemaFiles)
  for (const w of words(execSync(`git show ${base}:${f}`, { encoding: 'utf8' }))) known.add(w);

const added = execSync(`git diff -U0 ${base} -- ${EDITABLE.join(' ')}`, { encoding: 'utf8' })
  .split('\n')
  .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
  .join('\n');
const banned = [...words(added)]
  .filter((w) => w.length >= 4 && fixture.has(w) && !known.has(w) && !COMMON.has(w))
  .sort();
if (banned.length) {
  console.error(`Case words in the prompt text: ${banned.join(', ')}`);
  process.exit(1);
}
const length = EDITABLE.reduce((n, f) => n + readFileSync(f, 'utf8').length, 0);
console.log(`ok\tprompt_chars=${length}`);
