import type { SemanticJudgeInput, SemanticRuleSpec } from '../../src/judge/types';
import type { NodeId, SpaceNode } from '../../src/types';

export const node: SemanticJudgeInput['node'] & Pick<SpaceNode, 'resolvedParents'> = {
  id: 'opp1.md' as NodeId,
  title: 'I cannot find my receipts',
  type: 'opportunity',
  resolvedType: 'opportunity',
  schemaData: { title: 'I cannot find my receipts', type: 'opportunity', source: 'User interview with Alice' },
  parentTitles: ['Faster Tax Filing'],
  resolvedParents: [
    {
      id: 'Faster Tax Filing' as NodeId,
      field: 'parent',
      source: 'hierarchy',
      selfRef: false,
      fieldOn: 'child',
    },
  ],
};

export const passFailRule: SemanticRuleSpec = {
  id: 'customer-voice',
  description: 'Must be in customer voice',
  rubric: 'Needs to sound like a customer quote, not a solution or business goal',
  category: 'best-practice',
  verdicts: { pass: 'Customer voice.', fail: 'Not customer voice.' },
};

export const graded: SemanticRuleSpec = {
  id: 'framing',
  description: 'Framing quality',
  category: 'best-practice',
  verdicts: { good: 'Clear need', weak: 'Vague need', solution: 'A solution in disguise' },
};
