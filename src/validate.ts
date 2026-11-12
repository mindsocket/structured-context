import { isAbsolute, relative, resolve } from 'node:path';
import type { ErrorObject } from 'ajv';
import type { Config, SpaceConfig } from './config';
import { createJudgeProvider } from './judge/factory';
import type { JudgeSession } from './judge/judge-node';
import { readSpace } from './read/read-space';
import { evaluateRules, type FailedNodes, type RuleEvaluationResult } from './rule/gating';
import { filterRules, parseRuleFilter, type RuleFilter } from './rule/rule-filter';
import { extractEntityInfo, typeValidatorFor } from './schema/schema';
import { validateGraph } from './schema/validate-graph';
import { createSpaceContext } from './space-context';
import { buildSpaceGraph, computeHierarchyDepths } from './space-graph';
import type {
  FileNotInSpaceResult,
  FileValidationResult,
  NodeId,
  ParseIssue,
  ReadSpaceResult,
  SchemaWithMetadata,
  SourceLocation,
  SpaceContext,
  SpaceNode,
  ValidateFileOutput,
  ValidationIssue,
} from './types';

export interface FormattedError {
  message: string;
  dedupeKey: string;
}

export interface ValidationResult {
  /** Every issue the run found, of every severity. Only `error` issues fail validation. */
  issues: ValidationIssue[];
  /** Nodes that passed their type and schema checks. */
  validCount: number;
  /** Hierarchy nodes without a parent: informational, not issues. */
  orphans: Array<{ nodeId: NodeId; title: string }>;
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

/** What a validation run evaluates with: the options after the filter is parsed and the judge session is built. */
export interface ValidationOptions {
  includeGated?: boolean;
  ruleFilter?: RuleFilter;
  /** Judges `semantic` rules. Absent: a rule runs only its `expression`, and a semantic-only rule is skipped. */
  judge?: JudgeSession;
}

/** Throws `SctxError` `E_MODEL_PROVIDER_INVALID` when `semantic` names a provider that cannot be built. */
function toValidationOptions(context: SpaceContext, options: CommonValidateOptions): ValidationOptions {
  const provider = createJudgeProvider(context.config, context.space, options.semantic);
  return {
    includeGated: options.includeGated,
    ruleFilter: options.ruleFilter && parseRuleFilter(options.ruleFilter),
    ...(provider && { judge: { provider } }),
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

const summariseTrim = (
  report: NonNullable<RuleEvaluationResult['trimReport']>,
): ValidationResult['contextTrimmed'] => ({
  nodeCount: report.nodes.size,
  ruleIds: [...report.ruleIds].sort(),
});

/**
 * Evaluate a space's rules, with cascade gating when the schema has a main hierarchy: a failed node or a
 * gating violation suppresses rule evaluation for the node's subtree.
 * Called by `validateNodes`, the core behind `validateSpace` and `validateFile`, so both report identical rule results for a node.
 * Semantic rules run only when a `judge` is supplied.
 */
async function evaluateSpaceRules(
  nodes: SpaceNode[],
  schemaContext: Pick<SpaceContext, 'schema' | 'schemaRefRegistry'>,
  failedNodes: FailedNodes,
  options: ValidationOptions = {},
): Promise<RuleEvaluationResult> {
  const { metadata } = schemaContext.schema;
  const rules = metadata.rules && filterRules(metadata.rules, options.ruleFilter);
  if (!rules) return { issues: [] };
  const graph = buildSpaceGraph(nodes, metadata.hierarchy);
  return evaluateRules(nodes, rules, graph, failedNodes, {
    ...options,
    judge: options.judge && { ...options.judge, schemaContext },
  });
}

/** The nodes an issue is about, deduped by its scope: a finding repeated on its node (or file) is kept once. */
class IssueCollector {
  private readonly seen = new Set<string>();
  readonly issues: ValidationIssue[] = [];
  add(issue: ValidationIssue): void {
    const scope = issue.nodeId ?? (issue.kind === 'parse' ? issue.source.file : '');
    const dedupe = `${scope}\0${issue.key}`;
    if (this.seen.has(dedupe)) return;
    this.seen.add(dedupe);
    this.issues.push(issue);
  }
  addAll(issues: Iterable<ValidationIssue>): void {
    for (const issue of issues) this.add(issue);
  }
  /** The issues of one kind, narrowed to that kind's fields. */
  ofKind<K extends ValidationIssue['kind']>(kind: K) {
    return this.issues.filter((issue): issue is Extract<ValidationIssue, { kind: K }> => issue.kind === kind);
  }
}

/** The nodes that share an id, with where each is defined. A plugin should keep ids unique, so this guards that contract.
 * Display titles may repeat. */
export function findDuplicateIds(nodes: SpaceNode[]): Extract<ValidationIssue, { kind: 'duplicate' }>[] {
  const idToNodes = new Map<NodeId, SpaceNode[]>();
  for (const node of nodes) {
    if (!idToNodes.has(node.id)) idToNodes.set(node.id, []);
    idToNodes.get(node.id)!.push(node);
  }
  const issues: Extract<ValidationIssue, { kind: 'duplicate' }>[] = [];
  for (const [id, sameId] of idToNodes) {
    if (sameId.length < 2) continue;
    const sources = sameId.flatMap((n) => (n.source ? [n.source] : []));
    issues.push({
      kind: 'duplicate',
      key: `duplicate:${id}`,
      severity: 'error',
      message: `Duplicate id "${id}" is used by ${sameId.length} nodes${sources.length > 0 ? `: ${sources.map(formatSource).join(', ')}` : ''}`,
      nodeId: id,
      sources,
    });
  }
  return issues;
}

/**
 * The one validation pipeline: type and schema checks, duplicate titles, reference and hierarchy
 * checks, cascade-gated rules, and unresolved content links. Returns every entry; `validateSpace`
 * and `validateFile` are views over it, so a file's results match its entry in a full run.
 * `judge.target` limits judging to one file (and the ancestors that can gate it).
 */
export async function validateNodes(
  context: SpaceContext,
  nodes: SpaceNode[],
  read: Pick<ReadSpaceResult, 'unresolvedRefs' | 'unresolvedContentLinks'>,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const { unresolvedRefs } = read;
  const { schema, schemaRefRegistry, schemaValidator } = context;
  const metadata = schema.metadata;

  // Pre-extract valid types for early type validation
  const validTypes = Array.isArray(schema.oneOf) ? extractEntityInfo(schema, schemaRefRegistry).map((e) => e.type) : [];

  const collected = new IssueCollector();
  let validCount = 0;

  for (const node of nodes) {
    // Check the type first: an unknown type reports one error instead of one per oneOf branch.
    const nodeType = (node.schemaData as Record<string, unknown>).type as string | undefined;
    const at = node.source ? { source: node.source } : {};
    if (nodeType !== undefined && validTypes.length > 0 && !validTypes.includes(nodeType)) {
      const sortedTypes = [...validTypes].sort();
      collected.add({
        kind: 'schema',
        key: `schema:type:${sortedTypes.join(',')}`,
        severity: 'error',
        message: `Invalid type "${nodeType}". Valid types are: ${sortedTypes.join(', ')}`,
        nodeId: node.id,
        ...at,
      });
      continue;
    }

    // A valid type is checked against its own branch only, so errors come from that type alone.
    const validate = (nodeType !== undefined && typeValidatorFor(schemaValidator, nodeType)) || schemaValidator;
    if (validate(node.schemaData)) {
      validCount++;
    } else {
      for (const { message, dedupeKey } of formatErrors(
        validate.errors || [],
        schema,
        schemaRefRegistry,
        node.schemaData as Record<string, unknown>,
      )) {
        collected.add({
          kind: 'schema',
          key: `schema:${dedupeKey}`,
          severity: 'error',
          message,
          nodeId: node.id,
          ...at,
        });
      }
    }
  }

  collected.addAll(findDuplicateIds(nodes));

  // Validate all hierarchy constraints (field references and structure)
  const hierarchyValidation = validateGraph(nodes, metadata, unresolvedRefs);
  for (const { description, ...violation } of hierarchyValidation.violations) {
    collected.add({
      kind: 'hierarchy',
      key: `hierarchy:${description}`,
      severity: 'error',
      message: description,
      ...violation,
    });
  }
  const hierarchyFailureNodes = hierarchyValidation.violations.map((v) => v.nodeId);
  for (const { nodeId, source, parent, error } of hierarchyValidation.refErrors) {
    collected.add({
      kind: 'broken-link',
      key: `broken-link:${parent}`,
      severity: 'error',
      message: `${parent} → ${error}`,
      nodeId,
      ...(source && { source }),
      ref: parent,
      reason: error,
    });
  }

  // Calculate orphans across every hierarchy (informational, not a validation error)
  const orphans: SpaceNode[] = [];
  for (const hierarchy of metadata.hierarchies ?? []) {
    orphans.push(...buildSpaceGraph(nodes, hierarchy).orphans);
  }

  // Load and execute rules validation if schema defines rules (with cascade gating, see docs/rules.md).
  let contextTrimmed: ValidationResult['contextTrimmed'] = { nodeCount: 0, ruleIds: [] };
  if (metadata.rules) {
    const failedNodes: FailedNodes = new Map();
    for (const { nodeId } of collected.ofKind('schema')) failedNodes.set(nodeId, 'schema');
    for (const nodeId of hierarchyFailureNodes) if (!failedNodes.has(nodeId)) failedNodes.set(nodeId, 'hierarchy');
    const evaluation = await evaluateSpaceRules(nodes, context, failedNodes, options);
    collected.addAll(evaluation.issues);
    if (evaluation.trimReport) contextTrimmed = summariseTrim(evaluation.trimReport);
  }

  const ids = new Set(nodes.map((node) => node.id));
  const unresolvedContentLinks = read.unresolvedContentLinks.filter((link) => ids.has(link.nodeId));
  for (const { nodeId, target } of unresolvedContentLinks) {
    // Info: a target outside the space is often valid elsewhere
    collected.add({
      kind: 'content-link',
      key: `content-link:${target}`,
      severity: 'info',
      message: `Unresolved content link: ${target}`,
      nodeId,
      target,
    });
  }

  return {
    issues: collected.issues,
    validCount,
    orphans: orphans.map((node) => ({ nodeId: node.id, title: node.title })),
    contextTrimmed,
    skippedByDepth: [],
  };
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

  const runOptions = toValidationOptions(context, options);
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
  result.issues.unshift(...parseIssuesOf(readResult.parseIssues));
  result.skippedByDepth = skippedByDepth;
  result.depthLimit = options.depth;
  return result;
}

/** The issues for the files a plugin excluded or could not parse. */
function parseIssuesOf(parseIssues: ParseIssue[]): ValidationIssue[] {
  return parseIssues.map(({ message, source, severity, type }) => ({
    kind: 'parse' as const,
    key: `parse:${type}`,
    severity,
    message: message ?? (type === 'no-type' ? 'No type field' : `Excluded during parsing (${type})`),
    source,
    type,
  }));
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
  return validateResolvedFileWith(filePath, label, context, toValidationOptions(context, options));
}

/** `validateResolvedFile` with the options already resolved, so a caller can supply its own judge. */
export async function validateResolvedFileWith(
  filePath: string,
  label: string,
  context: SpaceContext,
  validationOptions: ValidationOptions,
): Promise<FileValidationResult> {
  const readResult = await readSpace(context);
  const result = await validateNodes(context, readResult.nodes, readResult, {
    ...validationOptions,
    judge: validationOptions.judge && { ...validationOptions.judge, target: label },
  });
  const issues = result.issues.filter((issue) => issue.nodeId === label);
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;

  return {
    file: isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath),
    label,
    space: context.space.name,
    issues,
    errorCount,
    warningCount: issues.length - errorCount,
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
