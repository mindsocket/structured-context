import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { judgeContext } from '../../src/judge/context';
import { buildJudgeUserPrompt } from '../../src/judge/prompt';
import { JevJudgeProvider } from '../../src/judge/provider/jev';
import { definitionsFor, judgeTypeDefinitions } from '../../src/judge/type-definitions';
import { loadSchema } from '../../src/schema/schema';
import { buildSpaceGraph } from '../../src/space-graph';
import type { NodeId } from '../../src/types';
import { makeHierarchy, makeLevel, makeParentRef, makeSpaceNode } from '../test-helpers';
import { node, passFailRule } from './helpers';

const { schema, schemaRefRegistry } = loadSchema(join(import.meta.dir, '../../schemas/strict_ost.json'));
const definitions = judgeTypeDefinitions(schema, schemaRefRegistry);

describe('judge type definitions', () => {
  it('gives each entity type its field descriptions, enum values and hierarchy neighbours', () => {
    const opportunity = definitions.get('opportunity');
    expect(opportunity?.fields?.source?.description).toContain('Customer research source');
    expect(opportunity?.fields?.status?.values).toContain('exploring');
    expect(opportunity).toMatchObject({ parentType: 'outcome', childType: 'solution' });
    expect(definitions.get('outcome')?.parentType).toBeUndefined();
    expect(definitions.get('assumption_test')?.childType).toBeUndefined();
  });

  it('leaves out the fields every node has', () => {
    for (const definition of definitions.values()) {
      expect(Object.keys(definition.fields ?? {})).not.toContain('title');
      expect(Object.keys(definition.fields ?? {})).not.toContain('content');
      expect(Object.keys(definition.fields ?? {})).not.toContain('type');
    }
  });

  it('picks only the types an input mentions', () => {
    expect(Object.keys(definitionsFor(definitions, ['outcome', 'unknown']) ?? {})).toEqual(['outcome']);
    expect(definitionsFor(definitions, ['unknown'])).toBeUndefined();
    expect(definitionsFor(undefined, ['outcome'])).toBeUndefined();
  });

  it('adds the evaluated and related nodes’ types to the judge context', () => {
    const hierarchy = makeHierarchy([makeLevel('outcome'), makeLevel('opportunity'), makeLevel('solution')]);
    const outcome = makeSpaceNode('Outcome', 'outcome', {});
    const opp = makeSpaceNode('Opp', 'opportunity', {}, undefined, [makeParentRef('Outcome')]);
    const graph = buildSpaceGraph([outcome, opp], hierarchy);
    const alone = judgeContext(graph, opp, { scope: [], content: 'none' }, definitions);
    expect(Object.keys(alone.types ?? {})).toEqual(['opportunity']);
    const withParent = judgeContext(graph, opp, { scope: ['parent'], content: 'none' }, definitions);
    expect(Object.keys(withParent.types ?? {}).sort()).toEqual(['opportunity', 'outcome']);
    expect(judgeContext(graph, opp, { scope: [], content: 'none' }).types).toBeUndefined();
  });

  it('puts the definitions in the chat prompt, and nothing when there are none', () => {
    const types = definitionsFor(definitions, ['opportunity']);
    const prompt = buildJudgeUserPrompt({ node, types }, passFailRule);
    expect(prompt).toContain('# Type Definitions');
    expect(prompt).toContain('Customer research source');
    expect(buildJudgeUserPrompt({ node }, passFailRule)).not.toContain('# Type Definitions');
  });

  it('sends the definitions to Jev beside the node state', async () => {
    const realFetch = globalThis.fetch;
    const bodies: Array<{ state: Record<string, unknown> }> = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ answers: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const types = definitionsFor(definitions, ['opportunity']);
      const jev = new JevJudgeProvider({ api: 'openrouter-decisions', apiKey: 'k' });
      await jev.evaluate({ node, types, rules: [passFailRule] });
      await jev.evaluateNodes([
        { node, types, rules: [passFailRule] },
        { node: { ...node, id: 'other' as NodeId }, types, rules: [passFailRule] },
      ]);
      expect(bodies[0]?.state.typeDefinitions).toEqual(types);
      expect(bodies[1]?.state.typeDefinitions).toEqual(types);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
