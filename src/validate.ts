import { isAbsolute, relative, resolve } from 'node:path';
import type { ErrorObject } from 'ajv';
import type { Config, SpaceConfig } from './config';
import { judgeForRun } from './judge/factory';
import type { TrimReport } from './judge/trim';
import type { SemanticJudgeProvider } from './judge/types';
import { pathLinkTargets } from './plugins/markdown/util';
import { readSpace } from './read/read-space';
import { computeHierarchyDepths, evaluateRulesWithGating, type GatingSeed } from './schema/gating';
import { filterRules, parseRuleFilter, type RuleFilter } from './schema/rule-filter';
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
  /** Content links that could not be resolved to a space node, at `info` severity: not counted in errors. */
  unresolvedContentLinks: Array<{ nodeId: NodeId; target: string; severity: 'info' }>;
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

interface CommonValidateOptions {
  /** Evaluate rules on gated nodes anyway (gates are still reported). */
  includeGated?: boolean;
  /** Evaluate only rules matching these `dimension=values` filters (category, severity, type, id). */
  ruleFilter?: string[];
  /**
   * Evaluate `semantic` rules with the model provider named here, or with the configured one for `true`.
   * Without it, a rule runs only its `expression`, and a semantic-only rule is skipped.
   */
  semantic?: boolean | string;
}

/** What a run evaluates with: the public options after the filter is parsed and the judge is built. */
export interface RunOptions {
  includeGated?: boolean;
  ruleFilter?: RuleFilter;
  judge?: SemanticJudgeProvider;
  /** Limit judging to one file (and the ancestors that can gate it). */
  judgeTarget?: string;
}

/** Throws `SctxError` `E_MODEL_PROVIDER_INVALID` when `semantic` names a provider that cannot be built. */
function runOptionsFrom(context: SpaceContext, options: CommonValidateOptions): RunOptions {
  return {
    includeGated: options.includeGated,
    ruleFilter: options.ruleFilter && parseRuleFilter(options.ruleFilter),
    judge: judgeForRun(context.config, context.space, options.semantic),
  };
}

export interface ValidateSpaceOptions extends CommonValidateOptions {
  readResult?: ReadSpaceResult;
  /** Limit validation to hierarchy nodes within N breadth-first levels from the top. */
  depth?: number;
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
export interface SpaceValidationResult {
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

/** Link targets of the files a parse excluded but read, such as notes without a type. */
function excludedFileTargets(parseIssues: ParseIssue[]): Set<string> {
  const targets = new Set<string>();
  for (const issue of parseIssues) {
    if (issue.type !== 'no-type' && issue.type !== 'parse') continue;
    for (const target of pathLinkTargets(issue.file)) targets.add(target);
  }
  return targets;
}

/**
 * The one validation pipeline: type and schema checks, duplicate titles, reference and hierarchy
 * checks, cascade-gated rules, and unresolved content links. Returns every entry; `validateSpace`
 * and `validateFile` are views over it, so a file's results match its entry in a full run.
 * `judgeTarget` limits judging to one file (and the ancestors that can gate it).
 */
export async function validateNodes(
  context: SpaceContext,
  nodes: SpaceNode[],
  read: Pick<ReadSpaceResult, 'unresolvedRefs' | 'parseIssues'>,
  options: RunOptions = {},
): Promise<SpaceValidationResult> {
  const { unresolvedRefs } = read;
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

  // Collect unresolved content links (info — not errors). A link to a file the parser read but
  // excluded (e.g. no type) resolves; that file's own parse issue already says why it is not a node.
  const excludedTargets = excludedFileTargets(read.parseIssues);
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const link of node.resolvedLinks) {
      if (link.location === 'internal' && !excludedTargets.has(link.target)) {
        const key = `${node.id}::${link.target}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.unresolvedContentLinks.push({ nodeId: node.id, target: link.target, severity: 'info' });
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

  const runOptions = runOptionsFrom(context, options);
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

  const result = await validateNodes(context, nodes, readResult, runOptions);

  return {
    validCount: result.validCount,
    nodeErrorCount: result.nodeFailures.length,
    nodeErrors: toNodeErrors(result.nodeFailures),
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

export interface ValidateFileOptions extends CommonValidateOptions {
  configDir?: string;
}

/** The parts of a validation result that `nodeIssues` reads. */
type NodeIssueSources = Pick<
  ValidationResult,
  | 'nodeErrors'
  | 'refErrors'
  | 'duplicateErrors'
  | 'hierarchyViolations'
  | 'ruleViolations'
  | 'coverageGates'
  | 'unresolvedContentLinks'
>;

/**
 * Every result that belongs to a node, by node id, each keyed by a composite id (e.g.
 * `schema:/status:enum:active`, `rule:my-rule-id`) and carrying its severity. Rule violations without
 * a node (global scope) and parse issues are not per node, so they stay in their own parts of the result.
 * `includeGated` words the note on a gated node as it was validated.
 */
export function nodeIssues(
  result: NodeIssueSources,
  options: { includeGated?: boolean } = {},
): Record<string, Record<string, FileValidationIssue>> {
  const byNode: Record<string, Record<string, FileValidationIssue>> = {};
  const add = (nodeId: NodeId, key: string, issue: FileValidationIssue) => {
    byNode[nodeId] ??= {};
    byNode[nodeId][key] = issue;
  };

  for (const { nodeId, source, issues } of result.nodeErrors) {
    const position = {
      ...(source?.line !== undefined ? { line: source.line } : {}),
      ...(source?.column !== undefined ? { column: source.column } : {}),
    };
    for (const { message, dedupeKey } of issues) {
      add(nodeId, `schema:${dedupeKey}`, { kind: 'schema', message, severity: 'error', ...position });
    }
  }
  for (const { id, sources } of result.duplicateErrors) {
    const where = sources.length > 0 ? `: ${sources.map(formatSource).join(', ')}` : '';
    add(id, `duplicate:${id}`, {
      kind: 'duplicate',
      message: `Duplicate id "${id}" is used by ${sources.length} nodes${where}`,
      severity: 'error',
    });
  }
  for (const { nodeId, parent, error } of result.refErrors) {
    add(nodeId, `broken-link:${parent}`, { kind: 'broken-link', message: `${parent} → ${error}`, severity: 'error' });
  }
  for (const { nodeId, description } of result.hierarchyViolations) {
    add(nodeId, `hierarchy:${description}`, { kind: 'hierarchy', message: description, severity: 'error' });
  }
  for (const v of result.ruleViolations) {
    if (v.nodeId)
      add(v.nodeId, `rule:${v.ruleId}`, { kind: 'rule', message: ruleViolationMessage(v), severity: v.severity });
  }
  // A gated node with no violations would otherwise look clean: say that its rules were not checked
  for (const gate of result.coverageGates) {
    const cause = gate.reason === 'rule' ? `blocking rule "${gate.ruleId}"` : `${gate.reason} failure`;
    const message = `Rule checks ${options.includeGated ? 'evaluated anyway' : 'not evaluated'}: gated by ${cause} on ${gate.nodeId}`;
    for (const id of gate.gatedNodeIds) add(id, `gated:${gate.nodeId}`, { kind: 'gated', message, severity: 'info' });
  }
  for (const { nodeId, target, severity } of result.unresolvedContentLinks) {
    add(nodeId, `content-link:${target}`, {
      kind: 'content-link',
      message: `Unresolved content link: ${target}`,
      severity,
    });
  }
  return byNode;
}

/** `ValidationResult['nodeErrors']` from the failures `validateNodes` collects */
function toNodeErrors(failures: NodeValidationFailure[]): ValidationResult['nodeErrors'] {
  return failures.map(({ node, issues }) => ({
    nodeId: node.id,
    ...(node.source !== undefined && { source: node.source }),
    issues,
  }));
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
export function validateResolvedFile(
  filePath: string,
  label: string,
  context: SpaceContext,
  options: Omit<ValidateFileOptions, 'configDir'> = {},
): Promise<FileValidationResult> {
  return validateResolvedFileWith(filePath, label, context, runOptionsFrom(context, options));
}

/** `validateResolvedFile` with the options already resolved, so a caller can supply its own judge. */
export async function validateResolvedFileWith(
  filePath: string,
  label: string,
  context: SpaceContext,
  runOptions: RunOptions,
): Promise<FileValidationResult> {
  const readResult = await readSpace(context);
  const result = await validateNodes(context, readResult.nodes, readResult, {
    ...runOptions,
    judgeTarget: label,
  });
  const byNode = nodeIssues(
    { ...result, nodeErrors: toNodeErrors(result.nodeFailures) },
    { includeGated: runOptions.includeGated },
  );
  const issues = byNode[label] ?? {};
  const errorCount = Object.values(issues).filter((issue) => issue.severity === 'error').length;

  return {
    file: isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath),
    label,
    space: context.space.name,
    issues,
    errorCount,
    warningCount: Object.keys(issues).length - errorCount,
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
