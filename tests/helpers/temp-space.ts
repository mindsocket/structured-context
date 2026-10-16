import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../src/config';

const META =
  'https://raw.githubusercontent.com/mindsocket/structured-context/main/schemas/generated/latest/_structured_context_schema_meta.json';

const typeSchema = (type: string, parent: boolean) => ({
  type: 'object',
  properties: { type: { const: type }, title: { type: 'string' }, ...(parent && { parent: { type: 'string' } }) },
  required: ['type', 'title'],
});

export interface TempSpace {
  dir: string;
  config: Config;
  /** Absolute path of a file in the space. */
  file: (name: string) => string;
  cleanup: () => void;
}

/**
 * A throwaway goal -> task -> step space (files G, T, S, plus an unrelated goal Other) with the given rules.
 * Each file may add frontmatter via `frontmatter`, e.g. `{ T: 'status: ready' }`.
 */
export function makeTempSpace(
  rules: object[],
  options: { frontmatter?: Record<string, string>; judging?: Pick<Config, 'modelProviders' | 'semantic'> } = {},
): TempSpace {
  const dir = mkdtempSync(join(tmpdir(), 'sctx-temp-space-'));
  const schemaPath = join(dir, 'schema.json');
  writeFileSync(
    schemaPath,
    JSON.stringify({
      $schema: META,
      $id: 'sctx://temp-space.test',
      $metadata: { hierarchy: { levels: ['goal', 'task', 'step'] }, rules },
      oneOf: [typeSchema('goal', false), typeSchema('task', true), typeSchema('step', true)],
    }),
  );
  const space = join(dir, 'space');
  mkdirSync(space);
  const extra = (name: string) => (options.frontmatter?.[name] ? `${options.frontmatter[name]}\n` : '');
  writeFileSync(join(space, 'G.md'), `---\ntype: goal\n${extra('G')}---\n`);
  writeFileSync(join(space, 'T.md'), `---\ntype: task\nparent: "[[G]]"\n${extra('T')}---\n`);
  writeFileSync(join(space, 'S.md'), `---\ntype: step\nparent: "[[T]]"\n${extra('S')}---\n`);
  writeFileSync(join(space, 'Other.md'), `---\ntype: goal\n${extra('Other')}---\n`);
  return {
    dir,
    config: {
      spaces: [{ name: 'ts', path: space, schema: schemaPath }],
      ...options.judging,
    },
    file: (name) => join(space, name),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
