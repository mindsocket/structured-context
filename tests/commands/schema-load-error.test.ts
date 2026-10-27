import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SctxError } from '../../src/errors';
import { createSpaceContext } from '../../src/space-context';

const ROOT = join(import.meta.dir, '..', '..');
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sctx-schema-error-')));
mkdirSync(join(dir, 'notes'));
// _knowledge_wiki already defines the alias source_summary, so redefining it is a duplicate
writeFileSync(
  join(dir, 'dup.json'),
  JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'sctx://dup',
    $metadata: { imports: ['sctx://core/_knowledge_wiki'], aliases: { source_summary: 'source' } },
    allOf: [{ $ref: 'sctx://core/_knowledge_wiki' }],
  }),
);
const config = { spaces: [{ name: 'dup', path: join(dir, 'notes'), schema: join(dir, 'dup.json') }] };
const configPath = join(dir, 'config.json');
writeFileSync(configPath, JSON.stringify(config));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('a schema that fails to load', () => {
  it('throws an SctxError with a code from createSpaceContext', () => {
    try {
      createSpaceContext('dup', { spaces: config.spaces.map((s) => ({ ...s, sourceDir: dir })) });
      throw new Error('expected createSpaceContext to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SctxError);
      expect((err as SctxError).code).toBe('E_SCHEMA_INVALID');
      expect((err as SctxError).message).toContain('Duplicate alias "source_summary"');
    }
  });

  for (const command of ['validate', 'show']) {
    it(`prints one line, without a stack trace, from sctx ${command}`, () => {
      const result = Bun.spawnSync(['bun', 'run', 'src/index.ts', command, 'dup'], {
        cwd: ROOT,
        env: { ...process.env, SCTX_CONFIG: configPath },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const stderr = new TextDecoder().decode(result.stderr).trim();
      expect(result.exitCode).toBe(1);
      expect(stderr).toMatch(/^E_SCHEMA_INVALID: Space "dup": Duplicate alias "source_summary"/);
      expect(stderr.split('\n')).toHaveLength(1);
    });
  }
});
