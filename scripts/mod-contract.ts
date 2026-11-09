import type { ValidationIssue } from '../src/types';

/** The part of `validate --json` the pane reads, as validate gives it */
export type PaneValidation = {
  issues: ValidationIssue[];
};
