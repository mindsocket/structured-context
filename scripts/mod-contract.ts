import type { FileValidationIssue, ParseIssue, RuleViolation } from '../src/types';

/** The parts of `validate --json` the pane reads, as validate gives them */
export type PaneValidation = {
  issues: Record<string, Record<string, FileValidationIssue>>;
  ruleViolations: RuleViolation[];
  parseIssues: ParseIssue[];
};
