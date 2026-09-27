import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { buildDump, dump } from '../../src/commands/dump';
import { bundledSchemasDir } from '../../src/schema/schema';
import { makeSpaceContext } from '../helpers/context';

const VALID_DIR = join(import.meta.dir, '../fixtures/general/valid-ost');
const SCHEMA_PATH = join(bundledSchemasDir, 'strategy_general.json');

describe('buildDump', () => {
  it('returns all parsed nodes when unfiltered', async () => {
    const context = makeSpaceContext(VALID_DIR, SCHEMA_PATH);
    const { nodes } = await buildDump(context);
    expect(nodes.length).toBeGreaterThan(0);
  });

  it('returns only nodes matching --filter', async () => {
    const context = makeSpaceContext(VALID_DIR, SCHEMA_PATH);
    const all = await buildDump(context);
    const { nodes } = await buildDump(context, { filter: "resolvedType='goal'" });
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.length).toBeLessThan(all.nodes.length);
    for (const node of nodes) expect(node.resolvedType).toBe('goal');
  });
});

describe('dump', () => {
  it('prints strict JSON with node identity fields', async () => {
    const context = makeSpaceContext(VALID_DIR, SCHEMA_PATH);
    const lines: string[] = [];
    const original = console.log;
    console.log = (msg: string) => lines.push(msg);
    try {
      await dump(context);
    } finally {
      console.log = original;
    }
    const parsed = JSON.parse(lines.join('\n'));
    expect(parsed.nodes.length).toBeGreaterThan(0);
    for (const node of parsed.nodes) {
      expect(typeof node.label).toBe('string');
      expect(typeof node.title).toBe('string');
      expect(typeof node.resolvedType).toBe('string');
    }
  });
});
