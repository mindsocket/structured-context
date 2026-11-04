import { isAbsolute, relative, resolve } from 'node:path';
import type { ErrorObject } from 'ajv';
import type { Config, SpaceConfig } from './config';
import type { TrimReport } from './judge/trim';
import type { SemanticJudgeProvider } from './judge/types';
import { readSpace } from './read/read-space';
import { computeHierarchyDepths, evaluateRulesWithGating, type GatingSeed } from './schema/gating';
import { filterRules, type RuleFilter } from './schema/rule-filter';
import { extractEntityInfo, typeValidatorFor } from './schema/schema';
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
  NodeId,
  ParseIssue,
  ReadSpaceResult,
  RuleViolation,
  SchemaMetadata,
  SchemaWithMetadata,
  SourceLocation,
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
  nodeErrors: Array<{
    nodeId: NodeId;
    source?: SourceLocation;
    /** Formatted, deduplicated schema problems for the node, one per field problem. */
    issues: FormattedError[];
  }>;
  refErrors: Array<{ nodeId: NodeId; source?: SourceLocation; parent: string; error: string }>;
  /** Nodes that share an id; `sources` lists where each is defined (a node without a source adds no entry). */
  duplicateErrors: Array<{ id: NodeId; sources: SourceLocation[] }>;
  /** All rule violations with their effective severity. Only `error` severity fails validation. */
  ruleViolations: RuleViolation[];
  hierarchyViolations: GraphViolation[];
  orphans: SpaceNode[];
  parseIssues: ParseIssue[];
  /** Content links that could not be resolved to a space node. Warning only — not counted in errors. */
  unresolvedContentLinks: Array<{ nodeId: NodeId; target: string }>;
  /**
   * Cascade gates: nodes whose schema/hierarchy failure or blocking rule violation
   * suppressed rule evaluation for themselves and/or their hierarchy subtree.
   * See docs/rules.md for gating semantics.
   */
  coverageGates: CoverageGate[];
  /** Semantic rule input that had content trimmed to fit the per-node input cap: the node count and the rule ids. */
  contextTrimmed: { nodeCount: number; ruleIds: string[] };
  /** Nodes excluded from validation entirely by a `depth` limit (breadth-first from hierarchy roots). */
  skippedByDepth: Array<{ nodeId: NodeId; title: string }>;
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
  /** Evaluates `semantic` rules. Without one, a rule runs only its `expression`, and a semantic-only rule is skipped. */
  judge?: SemanticJudgeProvider;
}

/** `file`, `file:line` or `file:line:column`, for messages. */
export function formatSource({ file, line, column }: SourceLocation): string {
  return line === undefined ? file : `${file}:${line}${column === undefined ? '' : `:${column}`}`;
}

/** One-line text for a rule violation: rule, description, and any evidence and verdict guidance. */
export function ruleViolationMessage(v: RuleViolation): string {
  const evidence = v.evidence ? ` (Evidence: ${v.evidence})` : '';
  const guidance = v.guidance ? ` Guidance: ${v.guidance}` : '';
  return `[${v.ruleId}] ${v.description}${evidence}${guidance}`;
}

type SpaceRuleEvaluation = {
  violations: RuleViolation[];
  gates: CoverageGate[];
};

const summariseTrim = (report: TrimReport): ValidationResult['contextTrimmed'] => ({
  nodeCount: report.nodes.size,
  ruleIds: [...report.ruleIds].sort(),
});

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
    trimReport?: TrimReport;
  } = {},
): Promise<SpaceRuleEvaluation> {
  const rules = metadata.rules && filterRules(metadata.rules, options.ruleFilter);
  if (!rules) return { violations: [], gates: [] };
  const provider = options.judge;
  if (!metadata.hierarchy) {
    const result = await validateRules(nodes, rules, {
      judge: provider,
      judgeTarget: options.judgeTarget,
      trimReport: options.trimReport,
    });
    return { violations: result, gates: [] };
  }
  const graph = buildSpaceGraph(nodes, metadata.hierarchy);
  return evaluateRulesWithGating(nodes, rules, graph, seeds, {
    includeGated: options.includeGated,
    provider,
    judgeTarget: options.judgeTarget,
    trimReport: options.trimReport,
  });
}

/** A node that failed type or schema validation. */
interface NodeValidationFailure {
  node: SpaceNode;
  issues: FormattedError[];
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
  contextTrimmed: ValidationResult['contextTrimmed'];
}

/**
 * Nodes that share an id, with where each is defined. A plugin should keep ids unique, so this guards that contract.
 * Display titles may repeat.
 */
export function findDuplicateIds(nodes: SpaceNode[]): ValidationResult['duplicateErrors'] {
  const idToNodes = new Map<NodeId, SpaceNode[]>();
  for (const node of nodes) {
    if (!idToNodes.has(node.id)) idToNodes.set(node.id, []);
    idToNodes.get(node.id)!.push(node);
  }
  const duplicates: ValidationResult['duplicateErrors'] = [];
  for (const [id, sameId] of idToNodes) {
    if (sameId.length > 1) duplicates.push({ id, sources: sameId.flatMap((n) => (n.source ? [n.source] : [])) });
  }
  return duplicates;
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
    contextTrimmed: { nodeCount: 0, ruleIds: [] },
  };

  for (const node of nodes) {
    // Check the type first: an unknown type reports one error instead of one per oneOf branch.
    const nodeType = (node.schemaData as Record<string, unknown>).type as string | undefined;
    if (nodeType !== undefined && validTypes.length > 0 && !validTypes.includes(nodeType)) {
      const sortedTypes = [...validTypes].sort();
      result.nodeFailures.push({
        node,
        issues: [
          {
            message: `Invalid type "${nodeType}". Valid types are: ${sortedTypes.join(', ')}`,
            dedupeKey: `type:${sortedTypes.join(',')}`,
          },
        ],
      });
      continue;
    }

    // A valid type is checked against its own branch only, so errors come from that type alone.
    const validate = (nodeType !== undefined && typeValidatorFor(schemaValidator, nodeType)) || schemaValidator;
    if (validate(node.schemaData)) {
      result.validCount++;
    } else {
      result.nodeFailures.push({
        node,
        issues: formatErrors(
          validate.errors || [],
          schema,
          schemaRefRegistry,
          node.schemaData as Record<string, unknown>,
        ),
      });
    }
  }

  result.duplicateErrors.push(...findDuplicateIds(nodes));

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
        return { id: node.id, reason: 'schema' };
      }),
      ...result.hierarchyViolations.map((v): GatingSeed => ({ id: v.nodeId, reason: 'hierarchy' })),
    ];
    const trimReport: TrimReport = { nodes: new Set(), ruleIds: new Set() };
    const { violations, gates } = await evaluateSpaceRules(nodes, metadata, seeds, { ...options, trimReport });
    result.ruleViolations = violations;
    result.coverageGates = gates;
    result.contextTrimmed = summariseTrim(trimReport);
  }

  // Collect unresolved content links (warnings — not errors)
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const link of node.resolvedLinks) {
      if (link.location === 'internal') {
        const key = `${node.id}::${link.target}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.unresolvedContentLinks.push({ nodeId: node.id, target: link.target });
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
  const skippedByDepth: ValidationResult['skippedByDepth'] = [];
  if (options.depth !== undefined && metadata.hierarchy) {
    const fullGraph = buildSpaceGraph(nodes, metadata.hierarchy);
    const depths = computeHierarchyDepths(fullGraph);
    const included: SpaceNode[] = [];
    for (const node of nodes) {
      const nodeDepth = depths.get(node.id);
      if (nodeDepth !== undefined && nodeDepth > options.depth) {
        skippedByDepth.push({ nodeId: node.id, title: node.title });
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
    nodeErrors: result.nodeFailures.map(({ node, issues }) => ({
      nodeId: node.id,
      ...(node.source !== undefined && { source: node.source }),
      issues,
    })),
    refErrors: result.refErrors,
    duplicateErrors: result.duplicateErrors,
    ruleViolations: result.ruleViolations,
    hierarchyViolations: result.hierarchyViolations,
    orphans: result.orphans,
    parseIssues: readResult.parseIssues,
    unresolvedContentLinks: result.unresolvedContentLinks,
    coverageGates: result.coverageGates,
    contextTrimmed: result.contextTrimmed,
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
  /** Evaluates `semantic` rules. Without one, a rule runs only its `expression`, and a semantic-only rule is skipped. */
  judge?: SemanticJudgeProvider;
}

/**
 * Select one file's entries from a space's validation result: issues keyed and formatted, errors split from warnings.
 * Pure — a file's entries are exactly its slice of the result.
 */
function issuesForFile(
  result: SpaceValidationResult,
  label: string,
  includeGated: boolean | undefined,
): { errors: Record<string, FileValidationIssue>; warnings: Record<string, FileValidationIssue> } {
  const errors: Record<string, FileValidationIssue> = {};
  const warnings: Record<string, FileValidationIssue> = {};

  for (const { node, issues } of result.nodeFailures) {
    if (node.id !== label) continue;
    const position = {
      ...(node.source?.line !== undefined ? { line: node.source.line } : {}),
      ...(node.source?.column !== undefined ? { column: node.source.column } : {}),
    };
    for (const { message, dedupeKey } of issues) {
      errors[`schema:${dedupeKey}`] = { kind: 'schema', message, ...position };
    }
  }

  // Duplicate id errors — include if this node's id is duplicated
  for (const { id, sources } of result.duplicateErrors) {
    if (id !== label) continue;
    errors[`duplicate:${id}`] = {
      kind: 'duplicate',
      message: `Duplicate id "${id}" is used by ${sources.length} nodes${sources.length > 0 ? `: ${sources.map(formatSource).join(', ')}` : ''}`,
    };
  }

  // Broken links and hierarchy violations from this file
  for (const { nodeId, parent, error } of result.refErrors) {
    if (nodeId === label) {
      errors[`broken-link:${parent}`] = { kind: 'broken-link', message: `${parent} → ${error}` };
    }
  }
  for (const v of result.hierarchyViolations) {
    if (v.nodeId === label) {
      errors[`hierarchy:${v.description}`] = { kind: 'hierarchy', message: v.description };
    }
  }

  // Rule violations — only error severity counts as an error.
  for (const v of result.ruleViolations) {
    if (v.nodeId === label) {
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
    if (!gate.gatedNodeIds.some((id) => id === label)) continue;
    const cause = gate.reason === 'rule' ? `blocking rule "${gate.ruleId}"` : `${gate.reason} failure`;
    warnings[`gated:${gate.nodeId}`] = {
      kind: 'gated',
      message: `Rule checks ${includeGated ? 'evaluated anyway' : 'not evaluated'}: gated by ${cause} on ${gate.nodeId}`,
      severity: 'info',
    };
  }

  // Unresolved content links (warnings — do not affect errorCount)
  for (const link of result.unresolvedContentLinks) {
    if (link.nodeId === label) {
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
  const { errors, warnings } = issuesForFile(result, label, options.includeGated);

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
