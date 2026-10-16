import { isAbsolute, relative, resolve } from 'node:path';
import type { ErrorObject } from 'ajv';
import type { Config, SpaceConfig } from './config';
import type { SemanticJudgeProvider } from './judge/types';
import { readSpace } from './read/read-space';
import { computeHierarchyDepths, evaluateRulesWithGating, type GatingSeed } from './schema/gating';
import { filterRules, type RuleFilter } from './schema/rule-filter';
import { extractEntityInfo } from './schema/schema';
import { validateGraph } from './schema/validate-graph';
import { validateRules } from './schema/validate-rules';
import { createSpaceContext } from './space-context';
import { buildSpaceGraph } from './space-graph';
import type {
  CoverageGate,
  FileNotInSpaceResult,
  FileValidationIssue,
  FileValidationResult,
  GraphViolation,
  ParseIssue,
  ReadSpaceResult,
  RuleViolation,
  SchemaMetadata,
  SchemaWithMetadata,
  SpaceContext,
  SpaceNode,
  ValidateFileOutput,
} from './types';

export interface FormattedError {
  message: string;
  dedupeKey: string;
}

export interface ValidationResult {
  validCount: number;
  nodeErrorCount: number;
  nodeErrors: Array<{ file: string; line?: number; errors: ErrorObject[]; nodeData: Record<string, unknown> }>;
  refErrors: Array<{ file: string; line?: number; parent: string; error: string }>;
  duplicateErrors: Array<{ title: string; files: string[] }>;
  /** All rule violations with their effective severity. Only `error` severity fails validation. */
  ruleViolations: RuleViolation[];
  hierarchyViolations: GraphViolation[];
  orphans: SpaceNode[];
  parseIssues: ParseIssue[];
  /** Content links that could not be resolved to a space node. Warning only — not counted in errors. */
  unresolvedContentLinks: Array<{ file: string; target: string }>;
  /**
   * Cascade gates: nodes whose schema/hierarchy failure or blocking rule violation
   * suppressed rule evaluation for themselves and/or their hierarchy subtree.
   * See docs/rules.md for gating semantics.
   */
  coverageGates: CoverageGate[];
  /** Nodes excluded from validation entirely by a `depth` limit (breadth-first from hierarchy roots). */
  skippedByDepth: Array<{ file: string; title: string }>;
  /** The depth limit applied, if any (undefined means the full space was validated). */
  depthLimit?: number;
}

/**
 * Format AJV errors for better readability.
 * Groups related errors and extracts helpful context like allowed values.
 */
export function formatErrors(
  errors: ErrorObject[],
  schema: SchemaWithMetadata,
  schemaRefRegistry: Parameters<typeof extractEntityInfo>[1],
  nodeData: Record<string, unknown>,
): FormattedError[] {
  const formatted: FormattedError[] = [];
  const seen = new Set<string>();

  // Group errors by instancePath
  const byPath = new Map<string, ErrorObject[]>();
  for (const err of errors) {
    const path = err.instancePath || 'root';
    if (!byPath.has(path)) {
      byPath.set(path, []);
    }
    byPath.get(path)!.push(err);
  }

  for (const [path, pathErrors] of byPath) {
    // Check if this is a oneOf failure at root - extract valid types from schema
    const isRootOneOf = path === 'root' || path === '/type';
    let hasOneOfContext = false;
    if (isRootOneOf && pathErrors.length > 1) {
      hasOneOfContext = Array.isArray(schema.oneOf);

      if (hasOneOfContext) {
        const entities = extractEntityInfo(schema, schemaRefRegistry);
        const validTypes = entities.map((e) => e.type).sort();

        if (validTypes.length > 0) {
          const actualValue = nodeData.type;
          // Only show type error if the actual type is NOT in the valid types list
          if (actualValue !== undefined && !validTypes.includes(String(actualValue))) {
            const message = `Invalid type "${actualValue}". Valid types are: ${validTypes.join(', ')}`;
            const key = `type:${validTypes.join(',')}`;
            if (!seen.has(key)) {
              seen.add(key);
              formatted.push({ message, dedupeKey: key });
            }
          }
        }
      }
    }

    // Handle individual errors
    for (const err of pathErrors) {
      // Skip individual type const/enum errors when in oneOf context (we handle it above)
      if (
        hasOneOfContext &&
        (err.keyword === 'const' || err.keyword === 'enum') &&
        (err.instancePath === '' || err.instancePath === '/type')
      ) {
        continue;
      }

      const parts = err.instancePath.split('/').filter(Boolean);
      const fieldName = parts.length > 0 ? parts[parts.length - 1]! : 'root';

      let message = err.message;
      let key = `${err.instancePath}:${err.keyword}`;

      // Enhance const errors
      if (err.keyword === 'const' && err.params?.allowedValue !== undefined) {
        const actual = err.data !== undefined ? `"${err.data}"` : 'missing value';
        const expected = `"${err.params.allowedValue}"`;
        message = `${fieldName}: expected ${expected}, got ${actual}`;
        key = `${err.instancePath}:const:${err.params.allowedValue}`;
      }
      // Enhance enum errors
      else if (err.keyword === 'enum' && err.params?.allowedValues && Array.isArray(err.params.allowedValues)) {
        let actual = err.data !== undefined ? `"${err.data}"` : null;
        // If err.data is undefined, try to get the value from nodeData using the field name
        if (actual === null && fieldName !== 'root') {
          const actualValue = nodeData[fieldName];
          if (actualValue !== undefined) {
            actual = `"${actualValue}"`;
          }
        }
        if (actual === null) {
          actual = 'missing value';
        }
        const allowed = err.params.allowedValues.map((v: unknown) => `"${v}"`).join(', ');
        message = `${fieldName}: ${actual} is not valid. Allowed: ${allowed}`;
        key = `${err.instancePath}:enum:${err.params.allowedValues.join(',')}`;
      }
      // Generic message with path
      else {
        message = `${fieldName}: ${err.message}`;
      }

      if (!seen.has(key)) {
        seen.add(key);
        formatted.push({ message, dedupeKey: key });
      }
    }
  }

  return formatted;
}

export interface ValidateSpaceOptions {
  readResult?: ReadSpaceResult;
  /** Limit validation to hierarchy nodes within N breadth-first levels from the top. */
  depth?: number;
  /** Evaluate rules on gated nodes anyway (gates are still reported). */
  includeGated?: boolean;
  /** Evaluate only rules matching this filter (see `parseRuleFilter`). */
  ruleFilter?: RuleFilter;
  /** Judge for `mode: semantic` rules. Without one, semantic rules are not evaluated. */
  judge?: SemanticJudgeProvider;
}

/** One-line text for a rule violation: rule, description, and any judge evidence and verdict guidance. */
export function ruleViolationMessage(v: RuleViolation): string {
  const evidence = v.evidence ? ` (Evidence: ${v.evidence})` : '';
  const guidance = v.guidance ? ` Guidance: ${v.guidance}` : '';
  return `[${v.ruleId}] ${v.description}${evidence}${guidance}`;
}

type SpaceRuleEvaluation = {
  violations: RuleViolation[];
  gates: CoverageGate[];
};

/**
 * Evaluate a space's rules. With a main hierarchy, evaluation cascades: schema, hierarchy
 * and gating-rule failures (the `seeds`) suppress rule evaluation for the failing node's subtree.
 * Called by `validateNodes`, the core behind `validateSpace` and `validateFile`, so both report identical rule results for a node.
 * Semantic rules run only when a `judge` is supplied.
 */
async function evaluateSpaceRules(
  nodes: SpaceNode[],
  metadata: SchemaMetadata,
  seeds: GatingSeed[],
  options: {
    includeGated?: boolean;
    judge?: SemanticJudgeProvider;
    judgeTarget?: string;
    ruleFilter?: RuleFilter;
  } = {},
): Promise<SpaceRuleEvaluation> {
  const rules = metadata.rules && filterRules(metadata.rules, options.ruleFilter);
  if (!rules) return { violations: [], gates: [] };
  const provider = options.judge;
  if (!metadata.hierarchy) {
    const result = await validateRules(nodes, rules, {
      judge: provider,
      judgeTarget: options.judgeTarget,
    });
    return { violations: result, gates: [] };
  }
  const graph = buildSpaceGraph(nodes, metadata.hierarchy);
  return evaluateRulesWithGating(nodes, rules, graph, seeds, {
    includeGated: options.includeGated,
    provider,
    judgeTarget: options.judgeTarget,
  });
}

/** A node that failed type or schema validation. */
interface NodeValidationFailure {
  node: SpaceNode;
  errors: ErrorObject[];
  /** Set when the node's `type` is not one the schema allows (checked before full schema validation). */
  invalidType?: { validTypes: string[] };
}

/** The outcome of validating a set of nodes, before either view shapes it. */
interface SpaceValidationResult {
  validCount: number;
  nodeFailures: NodeValidationFailure[];
  refErrors: ValidationResult['refErrors'];
  duplicateErrors: ValidationResult['duplicateErrors'];
  ruleViolations: RuleViolation[];
  hierarchyViolations: GraphViolation[];
  orphans: SpaceNode[];
  unresolvedContentLinks: ValidationResult['unresolvedContentLinks'];
  coverageGates: CoverageGate[];
}

/**
 * The one validation pipeline: type and schema checks, duplicate titles, reference and hierarchy
 * checks, cascade-gated rules, and unresolved content links. Returns every entry; `validateSpace`
 * and `validateFile` are views over it, so a file's results match its entry in a full run.
 * `judgeTarget` limits judging to one file (and the ancestors that can gate it).
 */
async function validateNodes(
  context: SpaceContext,
  nodes: SpaceNode[],
  unresolvedRefs: ReadSpaceResult['unresolvedRefs'],
  options: {
    includeGated?: boolean;
    ruleFilter?: RuleFilter;
    judge?: SemanticJudgeProvider;
    judgeTarget?: string;
  } = {},
): Promise<SpaceValidationResult> {
  const { schema, schemaRefRegistry, schemaValidator } = context;
  const metadata = schema.metadata;

  // Pre-extract valid types for early type validation
  const validTypes = Array.isArray(schema.oneOf) ? extractEntityInfo(schema, schemaRefRegistry).map((e) => e.type) : [];

  const result: SpaceValidationResult = {
    validCount: 0,
    nodeFailures: [],
    refErrors: [],
    duplicateErrors: [],
    ruleViolations: [],
    hierarchyViolations: [],
    orphans: [],
    unresolvedContentLinks: [],
    coverageGates: [],
  };

  for (const node of nodes) {
    // Early type validation - check before full AJV validation to prevent cascading errors
    const nodeType = (node.schemaData as Record<string, unknown>).type as string | undefined;
    if (nodeType !== undefined && validTypes.length > 0 && !validTypes.includes(nodeType)) {
      const sortedTypes = [...validTypes].sort();
      result.nodeFailures.push({
        node,
        invalidType: { validTypes },
        errors: [
          {
            instancePath: '/type',
            keyword: 'enum',
            message: `Invalid type "${nodeType}". Valid types are: ${sortedTypes.join(', ')}`,
            params: { allowedValues: sortedTypes },
            schemaPath: '#/oneOf',
            data: nodeType,
          } as ErrorObject,
        ],
      });
      continue;
    }

    if (schemaValidator(node.schemaData)) {
      result.validCount++;
    } else {
      result.nodeFailures.push({ node, errors: schemaValidator.errors || [] });
    }
  }

  // Detect duplicate node keys (titles)
  const titleToFiles = new Map<string, string[]>();
  for (const node of nodes) {
    if (!titleToFiles.has(node.title)) {
      titleToFiles.set(node.title, []);
    }
    titleToFiles.get(node.title)!.push(node.label);
  }
  for (const [title, files] of titleToFiles) {
    if (files.length > 1) {
      result.duplicateErrors.push({ title, files });
    }
  }

  // Validate all hierarchy constraints (field references and structure)
  const hierarchyValidation = validateGraph(nodes, metadata, unresolvedRefs);
  result.refErrors.push(...hierarchyValidation.refErrors);
  result.hierarchyViolations = [...hierarchyValidation.violations];

  // Calculate orphans across every hierarchy (informational, not a validation error)
  for (const hierarchy of metadata.hierarchies ?? []) {
    result.orphans.push(...buildSpaceGraph(nodes, hierarchy).orphans);
  }

  // Load and execute rules validation if schema defines rules (with cascade gating, see docs/rules.md).
  if (metadata.rules) {
    const seeds: GatingSeed[] = [
      ...result.nodeFailures.map(({ node }): GatingSeed => {
        const file = node.source?.file ?? node.label;
        return { file, title: String(node.schemaData.title ?? file), reason: 'schema' };
      }),
      ...result.hierarchyViolations.map((v): GatingSeed => ({ file: v.file, title: v.nodeTitle, reason: 'hierarchy' })),
    ];
    const { violations, gates } = await evaluateSpaceRules(nodes, metadata, seeds, options);
    result.ruleViolations = violations;
    result.coverageGates = gates;
  }

  // Collect unresolved content links (warnings — not errors)
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const link of node.resolvedLinks) {
      if (link.location === 'internal') {
        const key = `${node.label}::${link.target}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.unresolvedContentLinks.push({ file: node.label, target: link.target });
        }
      }
    }
  }

  return result;
}

/**
 * Run full validation on a space and return a structured result.
 * Does not output to console or call process.exit.
 */
export async function validateSpace(
  context: SpaceContext,
  options: ValidateSpaceOptions = {},
): Promise<ValidationResult> {
  const metadata = context.schema.metadata;

  const readResult = options.readResult ?? (await readSpace(context));
  let nodes = readResult.nodes;

  // Depth limiting: evaluate only hierarchy nodes within N breadth-first levels from the
  // top. Non-hierarchy nodes are unaffected — depth scoping only applies to the hierarchy DAG.
  const skippedByDepth: Array<{ file: string; title: string }> = [];
  if (options.depth !== undefined && metadata.hierarchy) {
    const fullGraph = buildSpaceGraph(nodes, metadata.hierarchy);
    const depths = computeHierarchyDepths(fullGraph);
    const included: SpaceNode[] = [];
    for (const node of nodes) {
      const nodeDepth = depths.get(node.title);
      if (nodeDepth !== undefined && nodeDepth > options.depth) {
        skippedByDepth.push({ file: node.label, title: node.title });
      } else {
        included.push(node);
      }
    }
    nodes = included;
  }

  const result = await validateNodes(context, nodes, readResult.unresolvedRefs, {
    includeGated: options.includeGated,
    ruleFilter: options.ruleFilter,
    judge: options.judge,
  });

  return {
    validCount: result.validCount,
    nodeErrorCount: result.nodeFailures.length,
    nodeErrors: result.nodeFailures.map(({ node, errors }) => ({
      file: node.source?.file ?? node.label,
      ...(node.source?.line !== undefined ? { line: node.source.line } : {}),
      errors,
      nodeData: node.schemaData as Record<string, unknown>,
    })),
    refErrors: result.refErrors,
    duplicateErrors: result.duplicateErrors,
    ruleViolations: result.ruleViolations,
    hierarchyViolations: result.hierarchyViolations,
    orphans: result.orphans,
    parseIssues: readResult.parseIssues,
    unresolvedContentLinks: result.unresolvedContentLinks,
    coverageGates: result.coverageGates,
    skippedByDepth,
    depthLimit: options.depth,
  };
}

/** Find which space a file belongs to by checking directory containment. */
export function resolveFileSpace(filePath: string, config: Config): { space: SpaceConfig; label: string } | null {
  const absFile = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);

  for (const space of config.spaces) {
    const absSpace = isAbsolute(space.path) ? space.path : resolve(process.cwd(), space.path);
    // Trailing slash prevents prefix-match false positives (e.g. /foo matching /foobar/)
    const spaceDir = absSpace.endsWith('/') ? absSpace : `${absSpace}/`;
    if (absFile.startsWith(spaceDir) || absFile === absSpace) {
      return { space, label: relative(absSpace, absFile) };
    }
  }
  return null;
}

export interface ValidateFileOptions {
  configDir?: string;
  /** Evaluate rules on gated nodes anyway (gates are still reported). */
  includeGated?: boolean;
  /** Evaluate only rules matching this filter (see `parseRuleFilter`). */
  ruleFilter?: RuleFilter;
  /** Judge for `mode: semantic` rules. Without one, semantic rules are not evaluated. */
  judge?: SemanticJudgeProvider;
}

/**
 * Select one file's entries from a space's validation result: issues keyed and formatted, errors split from warnings.
 * Pure — a file's entries are exactly its slice of the result.
 */
function issuesForFile(
  result: SpaceValidationResult,
  label: string,
  context: SpaceContext,
  includeGated: boolean | undefined,
): { errors: Record<string, FileValidationIssue>; warnings: Record<string, FileValidationIssue> } {
  const { schema, schemaRefRegistry } = context;
  const errors: Record<string, FileValidationIssue> = {};
  const warnings: Record<string, FileValidationIssue> = {};

  for (const { node, errors: ajvErrors, invalidType } of result.nodeFailures) {
    if (node.label !== label) continue;
    const position = {
      ...(node.source?.line !== undefined ? { line: node.source.line } : {}),
      ...(node.source?.column !== undefined ? { column: node.source.column } : {}),
    };
    if (invalidType) {
      errors[`schema:type:${invalidType.validTypes.join(',')}`] = {
        kind: 'schema',
        message: ajvErrors[0]!.message!,
        ...position,
      };
      continue;
    }
    const formatted = formatErrors(ajvErrors, schema, schemaRefRegistry, node.schemaData as Record<string, unknown>);
    for (const { message, dedupeKey } of formatted) {
      errors[`schema:${dedupeKey}`] = { kind: 'schema', message, ...position };
    }
  }

  // Duplicate key errors — include if this file is one of the duplicates
  for (const { title, files } of result.duplicateErrors) {
    if (!files.includes(label)) continue;
    const others = files.filter((f) => f !== label);
    errors[`duplicate:${title}`] = {
      kind: 'duplicate',
      message: `Duplicate title "${title}" also exists in: ${others.join(', ')}`,
    };
  }

  // Broken links and hierarchy violations from this file
  for (const { file, parent, error } of result.refErrors) {
    if (file === label) {
      errors[`broken-link:${parent}`] = { kind: 'broken-link', message: `${parent} → ${error}` };
    }
  }
  for (const v of result.hierarchyViolations) {
    if (v.file === label) {
      errors[`hierarchy:${v.description}`] = { kind: 'hierarchy', message: v.description };
    }
  }

  // Rule violations — only error severity counts as an error.
  for (const v of result.ruleViolations) {
    if (v.file === label) {
      const target = v.severity === 'error' ? errors : warnings;
      target[`rule:${v.ruleId}`] = {
        kind: 'rule',
        message: ruleViolationMessage(v),
        severity: v.severity,
      };
    }
  }
  // A gated file with no violations would otherwise look clean — say that its rules were not checked.
  for (const gate of result.coverageGates) {
    if (!gate.gatedFiles.includes(label)) continue;
    const cause = gate.reason === 'rule' ? `blocking rule "${gate.ruleId}"` : `${gate.reason} failure`;
    warnings[`gated:${gate.file}`] = {
      kind: 'gated',
      message: `Rule checks ${includeGated ? 'evaluated anyway' : 'not evaluated'}: gated by ${cause} on ${gate.file}`,
      severity: 'info',
    };
  }

  // Unresolved content links (warnings — do not affect errorCount)
  for (const link of result.unresolvedContentLinks) {
    if (link.file === label) {
      warnings[`content-link:${link.target}`] = {
        kind: 'content-link',
        message: `Unresolved content link: ${link.target}`,
      };
    }
  }

  return { errors, warnings };
}

/** The result for a file that belongs to no configured space. */
export function fileNotInSpace(filePath: string): FileNotInSpaceResult {
  return {
    file: filePath,
    inSpace: false,
    message: 'File does not belong to any configured space.',
  };
}

/**
 * Validate a file in an already-resolved space. Checks the whole space (required for graph
 * correctness), judging only the file, then selects the file's issues from the result.
 */
export async function validateResolvedFile(
  filePath: string,
  label: string,
  context: SpaceContext,
  options: Omit<ValidateFileOptions, 'configDir'> = {},
): Promise<FileValidationResult> {
  const readResult = await readSpace(context);
  const result = await validateNodes(context, readResult.nodes, readResult.unresolvedRefs, {
    includeGated: options.includeGated,
    ruleFilter: options.ruleFilter,
    judge: options.judge,
    judgeTarget: label,
  });
  const { errors, warnings } = issuesForFile(result, label, context, options.includeGated);

  return {
    file: isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath),
    label,
    space: context.space.name,
    errors,
    errorCount: Object.keys(errors).length,
    warnings,
    warningCount: Object.keys(warnings).length,
    inSpace: true,
  };
}

/**
 * Validate a single file within its space.
 *
 * Reads the full space (required for graph correctness) but filters all reported
 * errors to only those attributable to the target file.
 *
 * Returns a result object — does not output to console or call process.exit.
 * If the file is not in any configured space, returns a result with `inSpace: false`.
 */
export async function validateFile(
  filePath: string,
  config: Config,
  options: ValidateFileOptions = {},
): Promise<ValidateFileOutput> {
  const resolved = resolveFileSpace(filePath, config);
  if (!resolved) return fileNotInSpace(filePath);

  const context = createSpaceContext(resolved.space.name, config, { configDir: options.configDir });
  return validateResolvedFile(filePath, resolved.label, context, options);
}
