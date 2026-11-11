export {
  makeHierarchy,
  makeLevel,
  makeNode,
  makeParentRef,
  makeRelationship,
  makeSpaceNode,
  withHierarchy,
} from '../src/testing';

import { evaluateRules, type RuleEvaluationOptions } from '../src/rule/gating';
import { buildSpaceGraph } from '../src/space-graph';
import type { Rule, RuleViolation, SpaceNode } from '../src/types';

/** Rule violations for nodes of a schema without a hierarchy, where nothing is gated. */
export async function evaluateFlat(
  nodes: SpaceNode[],
  rules: Rule[],
  options?: RuleEvaluationOptions,
): Promise<RuleViolation[]> {
  return (await evaluateRules(nodes, rules, buildSpaceGraph(nodes, undefined), [], options)).violations;
}
