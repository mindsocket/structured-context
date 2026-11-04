import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, loadConfig, setConfigPath } from '../src/config';
import { assembleSpaceGraph, loadSpaceGraph } from '../src/load-space-graph';
import { readSpace } from '../src/read/read-space';
import { bundledSchemasDir } from '../src/schema/schema';
import { createSpaceContext } from '../src/space-context';
import { validateSpace } from '../src/validate';
import { makeSpaceContext } from './helpers/context';

const VALID_DIR = join(import.meta.dir, 'fixtures/general/valid-ost');
const SCHEMA_PATH = join(bundledSchemasDir, 'strategy_general.json');

describe('createSpaceContext', () => {
  it('throws E_SPACE_NOT_FOUND for an unknown space', () => {
    const config: Config = { spaces: [{ name: 'known', path: VALID_DIR, schema: SCHEMA_PATH }] };
    expect(() => createSpaceContext('missing', config)).toThrow(expect.objectContaining({ code: 'E_SPACE_NOT_FOUND' }));
  });
});

describe('assembleSpaceGraph', () => {
  it('builds a graph of schema-valid nodes from a context', async () => {
    const context = makeSpaceContext(VALID_DIR, SCHEMA_PATH);
    const graph = await assembleSpaceGraph(context);
    expect(graph.nodes.size).toBeGreaterThan(0);
    for (const node of graph.nodes.values()) {
      expect(context.schemaValidator(node.schemaData)).toBe(true);
    }
  });

  describe('node with a schema field error', () => {
    const dir = join(import.meta.dir, 'tmp-field-error-space');
    beforeEach(() => {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'Vision.md'), '---\ntype: vision\n---\n');
      writeFileSync(join(dir, 'Mission.md'), '---\ntype: mission\nparent: "[[Vision]]"\nstatus: exploding\n---\n');
      writeFileSync(join(dir, 'Goal.md'), '---\ntype: goal\nparent: "[[Mission]]"\n---\n');
      writeFileSync(join(dir, 'Odd.md'), '---\ntype: not_a_type\n---\n');
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('reports one issue for the node', async () => {
      const result = await validateSpace(makeSpaceContext(dir, SCHEMA_PATH));
      const mission = result.nodeErrors.find((e) => e.nodeId === 'Mission.md');
      expect(mission?.issues).toHaveLength(1);
      expect(mission?.issues[0]?.message).toStartWith('status: "exploding" is not valid');
    });

    it('keeps the node in the graph, with its children beneath it', async () => {
      const graph = await assembleSpaceGraph(makeSpaceContext(dir, SCHEMA_PATH));
      expect(graph.nodes.has('Mission.md' as never)).toBe(true);
      expect(graph.hierarchyRoots.map((n) => n.id)).toEqual(['Vision.md' as never]);
      expect(graph.orphans).toEqual([]);
      expect(graph.hierarchyChildren.get('Mission.md' as never)?.map((n) => n.id)).toEqual(['Goal.md' as never]);
    });

    it('leaves out a node whose type the schema does not define', async () => {
      const graph = await assembleSpaceGraph(makeSpaceContext(dir, SCHEMA_PATH));
      expect(graph.nodes.has('Odd.md' as never)).toBe(false);
    });
  });

  it('applies a raw filter expression', async () => {
    const context = makeSpaceContext(VALID_DIR, SCHEMA_PATH);
    const all = await assembleSpaceGraph(context);
    const filtered = await assembleSpaceGraph(context, { filter: "resolvedType='goal'" });
    expect(filtered.nodes.size).toBeGreaterThan(0);
    expect(filtered.nodes.size).toBeLessThan(all.nodes.size);
    for (const node of filtered.nodes.values()) {
      expect(node.resolvedType).toBe('goal');
    }
  });

  it('reuses a pre-loaded readResult instead of re-reading', async () => {
    const context = makeSpaceContext(VALID_DIR, SCHEMA_PATH);
    const readResult = await readSpace(context);
    const fromShared = await assembleSpaceGraph(context, { readResult });
    const fromRead = await assembleSpaceGraph(context);
    expect([...fromShared.nodes.keys()]).toEqual([...fromRead.nodes.keys()]);
  });
});

describe('validateSpace with shared readResult', () => {
  it('produces the same result whether or not the read is shared', async () => {
    const context = makeSpaceContext(VALID_DIR, SCHEMA_PATH);
    const readResult = await readSpace(context);
    const shared = await validateSpace(context, { readResult });
    const fresh = await validateSpace(context);
    expect(shared.validCount).toBe(fresh.validCount);
    expect(shared.nodeErrorCount).toBe(fresh.nodeErrorCount);
  });
});

describe('loadSpaceGraph (end-to-end via config)', () => {
  const testDir = join(process.cwd(), 'tmp-load-space-graph-test');
  const configPath = join(testDir, 'config.json');

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ spaces: [{ name: 'general', path: VALID_DIR, schema: SCHEMA_PATH }] }, null, 2),
    );
    setConfigPath(configPath);
  });

  afterAll(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    setConfigPath(undefined);
  });

  it('resolves a named space and returns its assembled graph', async () => {
    const config = loadConfig();
    const graph = await loadSpaceGraph('general', config);
    expect(graph.nodes.size).toBeGreaterThan(0);
  });
});

describe('loadSpaceGraph with a hand-assembled config (no config file)', () => {
  it('requires an explicit configDir rather than silently anchoring to cwd', () => {
    const config: Config = { spaces: [{ name: 'standalone', path: VALID_DIR, schema: SCHEMA_PATH }] };
    expect(() => createSpaceContext('standalone', config)).toThrow(/configDir/);
  });

  it('works with an explicit configDir', async () => {
    const config: Config = { spaces: [{ name: 'standalone', path: VALID_DIR, schema: SCHEMA_PATH }] };
    const context = createSpaceContext('standalone', config, { configDir: process.cwd() });
    expect(context.configDir).toBe(process.cwd());
    const graph = await loadSpaceGraph('standalone', config, { configDir: process.cwd() });
    expect(graph.nodes.size).toBeGreaterThan(0);
  });
});
