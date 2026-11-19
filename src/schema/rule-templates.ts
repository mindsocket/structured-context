import Ajv2020 from 'ajv/dist/2020';
import { type DeclaredRule, RULE_SCHEMA, type Rule } from './metadata-contract';

const validateRule = new Ajv2020().compile(RULE_SCHEMA);

type Semantic = Exclude<Rule['semantic'], true | undefined>;

const semanticObject = (semantic: Rule['semantic']): Semantic | undefined => (semantic === true ? {} : semantic);

/**
 * Resolve rule templates in merged rules. A rule with `extends` takes the template's fields, then its own: top-level
 * fields replace the template's, and `semantic` fields replace the template's one by one. Templates are dropped.
 */
export function resolveRuleTemplates(rules: DeclaredRule[]): Rule[] {
  const templates = new Map(rules.filter((rule) => 'abstract' in rule && rule.abstract).map((rule) => [rule.id, rule]));
  const resolved: Rule[] = [];
  for (const rule of rules) {
    if (templates.has(rule.id)) continue;
    if (!('extends' in rule) || rule.extends === undefined) {
      const { abstract: _, ...concrete } = rule as DeclaredRule & { abstract?: boolean };
      resolved.push(concrete as Rule);
      continue;
    }
    const template = templates.get(rule.extends);
    if (!template) {
      throw new Error(
        `Rule "${rule.id}" extends "${rule.extends}", but no rule template (a rule with "abstract": true) has that id.`,
      );
    }
    const { abstract: _, ...base } = template as Rule & { abstract?: boolean };
    const { extends: __, semantic, ...own } = rule;
    const baseSemantic = semanticObject(base.semantic);
    const ownSemantic = semanticObject(semantic);
    const result = {
      ...base,
      ...own,
      ...(baseSemantic || ownSemantic ? { semantic: { ...baseSemantic, ...ownSemantic } } : {}),
    };
    if (!validateRule(result)) {
      const errors = validateRule.errors?.map((e) => `${e.instancePath || '(root)'} ${e.message}`).join('; ');
      throw new Error(`Rule "${rule.id}" is not a valid rule once it extends "${rule.extends}": ${errors}`);
    }
    resolved.push(result as Rule);
  }
  return resolved;
}
