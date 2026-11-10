import type { ValidationIssue } from '../../src/types';

/** The issues of one kind, narrowed to that kind's fields */
export function ofKind<K extends ValidationIssue['kind']>(issues: readonly ValidationIssue[], kind: K) {
  return issues.filter((issue): issue is Extract<ValidationIssue, { kind: K }> => issue.kind === kind);
}

/** The issue with this key, if any */
export const withKey = (issues: readonly ValidationIssue[], key: string) => issues.find((issue) => issue.key === key);

/** How many nodes failed their type or schema */
export const schemaFailures = (issues: readonly ValidationIssue[]) =>
  new Set(ofKind(issues, 'schema').map((issue) => issue.nodeId)).size;
