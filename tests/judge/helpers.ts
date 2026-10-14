import type { SemanticJudgeInput, SemanticRuleSpec } from '../../src/judge/types';

export const node: SemanticJudgeInput['node'] = {
  label: 'opp1.md',
  title: 'I cannot find my receipts',
  type: 'opportunity',
  resolvedType: 'opportunity',
  schemaData: { title: 'I cannot find my receipts', type: 'opportunity', source: 'User interview with Alice' },
  resolvedParents: [
    { title: 'Faster Tax Filing', field: 'parent', source: 'hierarchy', selfRef: false, fieldOn: 'child' },
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
