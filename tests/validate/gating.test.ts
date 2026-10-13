import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../../src/config';
import { bundledSchemasDir } from '../../src/schema/schema';
import { validateFile, validateSpace } from '../../src/validate';
import { makeSpaceContext } from '../helpers/context';

const SCHEMA_PATH = join(bundledSchemasDir, 'strict_ost.json');
const VALID_DIR = join(import.meta.dir, '../fixtures/strict_ost/valid-directory');
const GATING_DIR = join(import.meta.dir, '../fixtures/strict_ost/gating-directory');

describe('validateSpace cascade gating', () => {
  it('gates rule evaluation on the subtree beneath a schema-failing node by default', async () => {
    const context = makeSpaceContext(GATING_DIR, SCHEMA_PATH);
    const result = await validateSpace(context);

    // Bad Outcome fails schema validation (missing required "metric").
    expect(result.nodeErrors.some((e) => e.file === 'Bad Outcome.md')).toBe(true);

    // Child Opportunity would otherwise violate solution-quantity (only one solution below),
    // but its rule evaluation is gated by the ancestor's schema failure.
    expect(result.ruleViolations.some((v) => v.file === 'Child Opportunity.md')).toBe(false);

    const gate = result.coverageGates.find((g) => g.file === 'Bad Outcome.md');
    expect(gate).toBeDefined();
    expect(gate!.reason).toBe('schema');
    expect(gate!.gatedFiles).toEqual(
      expect.arrayContaining(['Bad Outcome.md', 'Child Opportunity.md', 'Only Solution.md']),
    );
  });

  it('evaluates gated rules anyway when includeGated is set, while still reporting the gate', async () => {
    const context = makeSpaceContext(GATING_DIR, SCHEMA_PATH);
    const result = await validateSpace(context, { includeGated: true });

    expect(
      result.ruleViolations.some((v) => v.file === 'Child Opportunity.md' && v.ruleId === 'solution-quantity'),
    ).toBe(true);

    const gate = result.coverageGates.find((g) => g.file === 'Bad Outcome.md');
    expect(gate).toBeDefined();
    expect(gate!.gatedFiles).toContain('Child Opportunity.md');
  });

  it('does not gate on a non-error rule violation by default (solution-quantity is best-practice)', async () => {
    // The fixture opportunity has only one solution below it, violating solution-quantity.
    // That rule is info severity, so it doesn't block and the solution's own rules still run.
    const context = makeSpaceContext(VALID_DIR, SCHEMA_PATH);
    const result = await validateSpace(context);

    expect(result.nodeErrorCount).toBe(0);
    expect(result.ruleViolations.some((v) => v.ruleId === 'solution-quantity')).toBe(true);
    expect(result.coverageGates).toEqual([]);
  });
});

describe('validateSpace depth limiting', () => {
  it('excludes nodes beyond the requested breadth-first depth', async () => {
    const context = makeSpaceContext(VALID_DIR, SCHEMA_PATH);
    const full = await validateSpace(context);
    const shallow = await validateSpace(context, { depth: 1 });

    expect(shallow.skippedByDepth.length).toBeGreaterThan(0);
    expect(shallow.skippedByDepth.length + shallow.validCount + shallow.nodeErrorCount).toBe(
      full.validCount + full.nodeErrorCount,
    );
    expect(shallow.depthLimit).toBe(1);
    // Only the outcome (root) node remains.
    expect(shallow.skippedByDepth.map((s) => s.title)).toEqual(
      expect.arrayContaining(['Sign-up is too complex', 'Simplify sign-up flow', 'Usability test']),
    );
  });

  it('does not report broken links for relationship children of a depth-excluded hierarchy node', async () => {
    // Assume A is a relationship child (non-hierarchy) of Opp A, which depth 1 excludes.
    const context = makeSpaceContext(
      join(import.meta.dir, '../fixtures/depth-relationship'),
      join(bundledSchemasDir, 'strategy_general.json'),
    );
    const result = await validateSpace(context, { depth: 1 });
    expect(result.skippedByDepth.map((s) => s.title)).toEqual(['Opp A']);
    expect(result.refErrors).toEqual([]);
    expect(result.hierarchyViolations).toEqual([]);
  });

  it('does not affect validation when depth is unset', async () => {
    const context = makeSpaceContext(VALID_DIR, SCHEMA_PATH);
    const result = await validateSpace(context);
    expect(result.depthLimit).toBeUndefined();
    expect(result.skippedByDepth).toEqual([]);
  });
});

describe('validateFile matches validateSpace', () => {
  for (const [name, dir] of [
    ['gating-directory', GATING_DIR],
    ['valid-directory', VALID_DIR],
  ] as const) {
    for (const includeGated of [false, true]) {
      it(`reports each file's rule results and gating as the full run does (${name}, includeGated=${includeGated})`, async () => {
        const config: Config = { spaces: [{ name: 'space', path: dir, schema: SCHEMA_PATH }] };
        const space = await validateSpace(makeSpaceContext(dir, SCHEMA_PATH), { includeGated });

        for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
          const result = await validateFile(join(dir, file), config, { includeGated, configDir: import.meta.dir });
          if (!result.inSpace) throw new Error(`expected ${file} to be in space`);

          const fileRules = Object.keys({ ...result.errors, ...result.warnings })
            .filter((k) => k.startsWith('rule:'))
            .map((k) => k.slice('rule:'.length))
            .sort();
          const spaceRules = space.ruleViolations
            .filter((v) => v.file === file)
            .map((v) => v.ruleId)
            .sort();
          expect(fileRules).toEqual(spaceRules);

          const fileGated = Object.keys(result.warnings).some((k) => k.startsWith('gated:'));
          const spaceGated = space.coverageGates.some((g) => g.gatedFiles.includes(file));
          expect(fileGated).toBe(spaceGated);
        }
      });
    }
  }

  it('reports a gated file as not evaluated rather than clean', async () => {
    const config: Config = { spaces: [{ name: 'space', path: GATING_DIR, schema: SCHEMA_PATH }] };
    const result = await validateFile(join(GATING_DIR, 'Child Opportunity.md'), config, { configDir: import.meta.dir });
    if (!result.inSpace) throw new Error('expected file to be in space');
    expect(result.warnings['gated:Bad Outcome.md']?.message).toContain('not evaluated');
    expect(result.warnings['rule:solution-quantity']).toBeUndefined();

    const forced = await validateFile(join(GATING_DIR, 'Child Opportunity.md'), config, {
      includeGated: true,
      configDir: import.meta.dir,
    });
    if (!forced.inSpace) throw new Error('expected file to be in space');
    expect(forced.warnings['gated:Bad Outcome.md']?.message).toContain('evaluated anyway');
    expect(forced.warnings['rule:solution-quantity']).toBeDefined();
  });
});
