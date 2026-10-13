import { describe, expect, it } from 'bun:test';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';
import { validateRules } from '../../src/schema/validate-rules';
import type { Rule, SpaceNode } from '../../src/types';
import { makeParentRef } from '../test-helpers';

describe('validateRules - semantic evaluation', () => {
  const sampleNodes: SpaceNode[] = [
    {
      label: 'outcome.md',
      title: 'Outcome Metric',
      type: 'outcome',
      resolvedType: 'outcome',
      schemaData: { title: 'Outcome Metric', type: 'outcome', status: 'active', metric: 'Increase conversions' },
      linkTargets: ['Outcome Metric'],
      resolvedParents: [],
      resolvedLinks: [],
    },
    {
      label: 'valid-opp.md',
      title: 'I struggle to finish signup on mobile',
      type: 'opportunity',
      resolvedType: 'opportunity',
      schemaData: {
        title: 'I struggle to finish signup on mobile',
        type: 'opportunity',
        status: 'active',
        parent: '[[Outcome Metric]]',
        source: 'User interview with Jane',
      },
      linkTargets: ['I struggle to finish signup on mobile'],
      resolvedParents: [makeParentRef('Outcome Metric')],
      resolvedLinks: [],
    },
    {
      label: 'bad-opp.md',
      title: 'Build social login integration',
      type: 'opportunity',
      resolvedType: 'opportunity',
      schemaData: {
        title: 'Build social login integration',
        type: 'opportunity',
        status: 'active',
        parent: '[[Outcome Metric]]',
        source: 'Engineering suggestion',
      },
      linkTargets: ['Build social login integration'],
      resolvedParents: [makeParentRef('Outcome Metric')],
      resolvedLinks: [],
    },
  ];

  const rules: Rule[] = [
    {
      id: 'active-opportunity-count',
      category: 'workflow',
      description: 'At most 2 active opportunities',
      check: '$count(nodes[resolvedType="opportunity" and status="active"]) <= 2',
    },
    {
      id: 'opportunity-customer-voice',
      category: 'best-practice',
      mode: 'semantic',
      type: 'opportunity',
      description: 'Opportunity must be framed in customer voice, not a solution or business goal',
      rubric: 'Must describe a customer pain point or need in customer language, not a solution to build.',
    },
  ];

  it('skips semantic rules when semantic option is false / omitted (default validate)', async () => {
    // Default validate should only run expression rules and remain deterministic & free
    const violations = await validateRules(sampleNodes, rules);
    expect(violations).toHaveLength(0);
    expect(violations.semanticEvaluations).toHaveLength(0);
    expect(violations.gatedRules).toHaveLength(0);
  });

  it('evaluates semantic rules when semantic option is true', async () => {
    const fake = new FakeJudgeProvider(
      new Map([
        [
          'opportunity-customer-voice:I struggle to finish signup on mobile',
          { pass: true, evidence: 'Clearly stated from customer perspective as a pain point' },
        ],
        [
          'opportunity-customer-voice:Build social login integration',
          { pass: false, evidence: 'Stated as a solution feature ("Build social login") rather than a customer need' },
        ],
      ]),
    );

    const violations = await validateRules(sampleNodes, rules, {
      semantic: true,
      judgeProvider: fake,
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleId).toBe('opportunity-customer-voice');
    expect(violations[0]?.file).toBe('bad-opp.md');
    expect(violations[0]?.category).toBe('best-practice');
    expect(violations[0]?.evidence).toBe(
      'Stated as a solution feature ("Build social login") rather than a customer need',
    );

    expect(violations.semanticEvaluations).toHaveLength(2);
    expect(violations.semanticEvaluations.find((e) => e.file === 'valid-opp.md')?.pass).toBe(true);
    expect(violations.semanticEvaluations.find((e) => e.file === 'bad-opp.md')?.pass).toBe(false);
  });

  it('gates semantic rules when node has upstream structural error (cascading)', async () => {
    const fake = new FakeJudgeProvider();

    // Mark bad-opp.md as having an upstream structural error via gatedNodeLabels
    const gatedNodeLabels = new Set(['bad-opp.md']);

    const violations = await validateRules(sampleNodes, rules, {
      semantic: true,
      judgeProvider: fake,
      gatedNodeLabels,
    });

    // bad-opp.md was gated; only valid-opp.md was sent to the judge
    expect(fake.callHistory).toHaveLength(1);
    expect(fake.callHistory[0]?.node.label).toBe('valid-opp.md');

    expect(violations.gatedRules).toHaveLength(1);
    expect(violations.gatedRules[0]?.file).toBe('bad-opp.md');
    expect(violations.gatedRules[0]?.ruleId).toBe('opportunity-customer-voice');
  });

  it('gates semantic rules when node fails an upstream expression rule', async () => {
    const strictRules: Rule[] = [
      {
        id: 'require-interviews-source',
        category: 'validation',
        type: 'opportunity',
        check: '$contains(current.source, "interview") = true',
        description: 'Source must mention interview',
      },
      {
        id: 'opportunity-customer-voice',
        category: 'best-practice',
        mode: 'semantic',
        type: 'opportunity',
        description: 'Must be in customer voice',
      },
    ];

    const fake = new FakeJudgeProvider();

    const violations = await validateRules(sampleNodes, strictRules, {
      semantic: true,
      judgeProvider: fake,
    });

    // bad-opp.md source is "Engineering suggestion", so it failed require-interviews-source
    // Therefore it should be gated from opportunity-customer-voice
    const badOppViolations = violations.filter((v) => v.file === 'bad-opp.md');
    expect(badOppViolations).toHaveLength(1);
    expect(badOppViolations[0]?.ruleId).toBe('require-interviews-source');

    // Only valid-opp.md was evaluated by the semantic judge
    expect(fake.callHistory).toHaveLength(1);
    expect(fake.callHistory[0]?.node.label).toBe('valid-opp.md');

    expect(violations.gatedRules.some((g) => g.file === 'bad-opp.md')).toBe(true);
  });
});
