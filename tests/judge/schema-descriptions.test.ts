import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { describeSchema, judgeContext, schemaDescriptionsFor } from '../../src/judge/context';
import { buildJudgeUserPrompt } from '../../src/judge/prompt';
import { JevJudgeProvider } from '../../src/judge/provider/jev';
import { loadSchema } from '../../src/schema/schema';
import { buildSpaceGraph } from '../../src/space-graph';
import type { NodeId } from '../../src/types';
import { makeHierarchy, makeLevel, makeParentRef, makeSpaceNode } from '../test-helpers';
import { node, passFailRule } from './helpers';

const descriptions = describeSchema(loadSchema(join(import.meta.dir, '../../schemas/strict_ost.json')));

describe('schema descriptions for the judge', () => {
  it("describes each node type's fields, with enum values", () => {
    expect(descriptions.opportunity?.fields?.source).toContain('Customer research source');
    expect(descriptions.opportunity?.fields?.status).toStartWith('one of: identified, wondering');
    expect(descriptions.assumption_test?.fields?.category).toBe(
      'Assumption type categories (one of: desirability, viability, feasibility, usability, ethical)',
    );
  });

  it('leaves out the fields every node has', () => {
    for (const { fields = {} } of Object.values(descriptions)) {
      expect(Object.keys(fields)).not.toContain('title');
      expect(Object.keys(fields)).not.toContain('content');
      expect(Object.keys(fields)).not.toContain('type');
    }
  });

  it('picks the descriptions of the evaluated and related node types', () => {
    const hierarchy = makeHierarchy([makeLevel('outcome'), makeLevel('opportunity')]);
    const outcome = makeSpaceNode('Outcome', 'outcome', {});
    const opp = makeSpaceNode('Opp', 'opportunity', {}, undefined, [makeParentRef('Outcome')]);
    const graph = buildSpaceGraph([outcome, opp], hierarchy);
    const pick = (scope: Parameters<typeof judgeContext>[2]['scope']) =>
      Object.keys(
        schemaDescriptionsFor(descriptions, judgeContext(graph, opp, { scope, content: 'none' })).schemaDescriptions ??
          {},
      ).sort();
    expect(pick([])).toEqual(['opportunity']);
    expect(pick(['parent'])).toEqual(['opportunity', 'outcome']);
    expect(schemaDescriptionsFor({}, judgeContext(graph, opp, { scope: [], content: 'none' }))).toEqual({});
  });

  it('puts the descriptions in the chat prompt, and nothing when there are none', () => {
    const schemaDescriptions = { opportunity: descriptions.opportunity! };
    expect(buildJudgeUserPrompt({ node, schemaDescriptions }, passFailRule)).toContain('Customer research source');
    expect(buildJudgeUserPrompt({ node }, passFailRule)).not.toContain('<item_types>');
  });

  it('sends the descriptions to Jev beside the node state', async () => {
    const realFetch = globalThis.fetch;
    const bodies: Array<{ state: Record<string, unknown> }> = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ answers: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const schemaDescriptions = { opportunity: descriptions.opportunity! };
      const jev = new JevJudgeProvider({ api: 'openrouter-decisions', apiKey: 'k' });
      await jev.evaluate({ node, schemaDescriptions, rules: [passFailRule] });
      await jev.evaluateNodes([
        { node, schemaDescriptions, rules: [passFailRule] },
        { node: { ...node, id: 'other' as NodeId }, schemaDescriptions, rules: [passFailRule] },
      ]);
      expect(bodies[0]?.state.schemaDescriptions).toEqual(schemaDescriptions);
      expect(bodies[1]?.state.schemaDescriptions).toEqual(schemaDescriptions);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
