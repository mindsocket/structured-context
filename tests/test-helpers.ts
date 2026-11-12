export {
  makeHierarchy,
  makeLevel,
  makeNode,
  makeParentRef,
  makeRelationship,
  makeSpaceNode,
  withHierarchy,
} from './helpers/builders';

import { evaluateRules, type RuleEvaluationOptions } from '../src/rule/gating';
import type { Rule } from '../src/schema/metadata-contract';
import { buildSpaceGraph } from '../src/space-graph';
import type { SpaceNode, ValidationIssue } from '../src/types';

/** The fields every rule issue carries. */
export type RuleIssue = Extract<ValidationIssue, { kind: 'rule' }>;

/** Rule issues for nodes of a schema without a hierarchy, where nothing is gated. */
export async function evaluateFlat(
  nodes: SpaceNode[],
  rules: Rule[],
  options?: RuleEvaluationOptions,
): Promise<RuleIssue[]> {
  return (await evaluateRules(nodes, rules, buildSpaceGraph(nodes, undefined), undefined, options)).issues.filter(
    (issue): issue is RuleIssue => issue.kind === 'rule',
  );
}
