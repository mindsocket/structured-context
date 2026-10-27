import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import { writeSpaceGraphSchema } from '../scripts/generate-schema-meta';
import { buildDump } from '../src/commands/dump';
import { readSpace } from '../src/read/read-space';
import { bundledSchemasDir } from '../src/schema/schema';
import { buildSpaceGraph, selectHierarchy } from '../src/space-graph';
import {
  exportSpaceGraph,
  SPACE_GRAPH_FORMAT_VERSION,
  type SpaceGraphData,
  spaceGraphFrom,
  spaceGraphSchemaId,
} from '../src/space-graph-data';
import type { SpaceContext } from '../src/types';
import { makeSpaceContext } from './helpers/context';

const MULTI_DIR = join(import.meta.dir, 'fixtures/multi-hierarchy');
const multiContext = makeSpaceContext(join(MULTI_DIR, 'space'), join(MULTI_DIR, 'selected-root.json'));
const ostContext = makeSpaceContext(
  join(import.meta.dir, 'fixtures/general/valid-ost'),
  join(bundledSchemasDir, 'strategy_general.json'),
);

/** Export through JSON text, as a server would send it. */
const overTheWire = (data: SpaceGraphData): SpaceGraphData => JSON.parse(JSON.stringify(data));

async function exported(context: SpaceContext): Promise<SpaceGraphData> {
  const { nodes } = await readSpace(context);
  return overTheWire(exportSpaceGraph(nodes, context.schema.metadata));
}

describe('exportSpaceGraph and spaceGraphFrom', () => {
  it('round-trips to the graph buildSpaceGraph builds, for every hierarchy', async () => {
    for (const context of [ostContext, multiContext]) {
      const { nodes } = await readSpace(context);
      const data = await exported(context);
      const { metadata } = context.schema;
      for (const name of [undefined, ...(metadata.hierarchies ?? []).map((h) => h.name)]) {
        expect(spaceGraphFrom(data, { hierarchy: name })).toEqual(
          buildSpaceGraph(nodes, selectHierarchy(metadata, name)),
        );
      }
    }
  });

  it('carries every hierarchy and names the main one', async () => {
    const data = await exported(multiContext);
    expect(data.formatVersion).toBe(SPACE_GRAPH_FORMAT_VERSION);
    expect(data.hierarchies.map((h) => h.name).sort()).toEqual(['_skills-pack', 'work']);
    expect(data.mainHierarchy).toBe(multiContext.schema.metadata.hierarchy?.name);
  });

  it('keeps edges to nodes outside an exported subset', async () => {
    const { nodes } = await readSpace(multiContext);
    const subset = nodes.filter((n) => n.resolvedType === 'task');
    const data = overTheWire(exportSpaceGraph(subset, multiContext.schema.metadata));
    expect(spaceGraphFrom(data)).toEqual(buildSpaceGraph(subset, multiContext.schema.metadata.hierarchy));
    const graph = spaceGraphFrom(data);
    expect([...graph.childEdges.keys()].some((id) => !graph.nodes.has(id))).toBe(true);
  });

  it('throws on an unknown hierarchy or format version', async () => {
    const data = await exported(multiContext);
    expect(() => spaceGraphFrom(data, { hierarchy: 'nope' })).toThrow('Unknown hierarchy: "nope"');
    expect(() => spaceGraphFrom({ ...data, formatVersion: 2 } as unknown as SpaceGraphData)).toThrow(
      'Unsupported space graph format version 2',
    );
  });

  it('produces data the generated schema accepts', async () => {
    const schema = JSON.parse(readFileSync(join(bundledSchemasDir, 'generated/space-graph/latest.json'), 'utf-8'));
    const validate = new Ajv2020({ strict: false }).compile(schema);
    for (const context of [ostContext, multiContext]) {
      const data = await exported(context);
      expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
    }
  });
});

describe('sctx dump --graph', () => {
  it('emits the exported nodes of a filtered dump', async () => {
    const { nodes } = await buildDump(multiContext, { filter: "resolvedType='task'" });
    const data = exportSpaceGraph(nodes, multiContext.schema.metadata);
    expect(data.nodes.map((n) => n.resolvedType)).toEqual(['task']);
  });
});

describe('browser entry point', () => {
  it('bundles for the browser without Node built-ins', async () => {
    const result = await Bun.build({ entrypoints: [join(import.meta.dir, '../src/browser.ts')], target: 'browser' });
    expect(result.success).toBe(true);
    const code = await result.outputs[0]!.text();
    expect(code).not.toMatch(/from ["']node:|require\(["']node:/);
  });
});

describe('writeSpaceGraphSchema', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sctx-graph-schema-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const generatedUrl = () => pathToFileURL(`${dir}/`);
  const version = String(SPACE_GRAPH_FORMAT_VERSION);
  const graphDir = () => join(dir, 'space-graph');

  it('writes only latest outside a release', async () => {
    expect(await writeSpaceGraphSchema(generatedUrl(), false)).toEqual(['latest']);
    expect(readdirSync(graphDir())).toEqual(['latest.json']);
    expect(JSON.parse(readFileSync(join(graphDir(), 'latest.json'), 'utf-8')).$id).toBe(spaceGraphSchemaId(version));
  });

  it('freezes the current format version on release, once', async () => {
    expect(await writeSpaceGraphSchema(generatedUrl(), true)).toEqual(['latest', version]);
    expect(await writeSpaceGraphSchema(generatedUrl(), true)).toEqual(['latest']);
  });

  it('refuses to proceed when a released version no longer matches', async () => {
    await writeSpaceGraphSchema(generatedUrl(), true);
    writeFileSync(join(graphDir(), `${version}.json`), '{"changed": true}');
    expect(writeSpaceGraphSchema(generatedUrl(), false)).rejects.toThrow('Bump SPACE_GRAPH_FORMAT_VERSION');
  });
});
