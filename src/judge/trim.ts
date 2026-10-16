import type { SemanticJudgeInput } from './types';

/** The per-node input cap: estimated tokens of one node's input (the node and its related nodes), the same for every provider. */
export const PER_NODE_INPUT_CAP_TOKENS = 32_000;

/** Estimated tokens of a value: its JSON length divided by 4. Provider-independent, and roughly right is enough. */
export const estimateTokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4);

/** The placeholder that ends a body cut to fit the per-node input cap. `removed` is the number of characters cut. */
export const trimMarker = (removed: number) => `[RULE_EVALUATION_CONTENT_TRIMMED ${removed} chars]`;

/** The part of a judge input that the per-node input cap measures. */
export type NodeInput = Pick<SemanticJudgeInput, 'node' | 'related'>;

/**
 * Cut `body` to at most `limit` characters, ending at the last whitespace before the limit, and end it with the
 * trim marker. A body within the limit is returned whole.
 */
export function cutBody(body: string, limit: number): string {
  if (body.length <= limit) return body;
  let head = body.slice(0, limit);
  if (!/\s/.test(body.charAt(limit))) {
    const lastSpace = head.search(/\s\S*$/);
    head = lastSpace < 0 ? '' : head.slice(0, lastSpace);
  }
  head = head.trimEnd();
  const marker = trimMarker(body.length - head.length);
  return head ? `${head} ${marker}` : marker;
}

function limitBodies(input: NodeInput, relatedLimit: number, nodeLimit: number): NodeInput {
  const cut = <T extends Record<string, unknown>>(data: T, limit: number): T =>
    typeof data.content === 'string' ? { ...data, content: cutBody(data.content, limit) } : data;
  return {
    node: { ...input.node, schemaData: cut(input.node.schemaData, nodeLimit) },
    ...(input.related && { related: input.related.map((r) => ({ ...r, data: cut(r.data, relatedLimit) })) }),
  };
}

const bodyLength = (data: Record<string, unknown>) => (typeof data.content === 'string' ? data.content.length : 0);

/** The largest limit in `[0, max]` for which `fits` holds, or -1 when even 0 does not fit. `fits` shrinks as the limit falls. */
function largestFitting(max: number, fits: (limit: number) => boolean): number {
  if (!fits(0)) return -1;
  let low = 0;
  let high = max;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  return low;
}

export interface TrimResult {
  input: NodeInput;
  /** True when any body was cut. */
  trimmed: boolean;
  /** True when the input is still over the cap with every body cut to nothing. */
  overCap: boolean;
}

/**
 * Bring a node's input under the per-node input cap by cutting bodies only: never fields, never a whole node.
 * Related bodies are cut first, with one ceiling for all of them (longer bodies are cut to it, shorter ones stay
 * whole) set as high as the cap allows. If that reaches zero and the input is still over, the evaluated node's
 * body is cut the same way. Every cut body ends with the trim marker.
 */
export function trimToCap(input: NodeInput, cap = PER_NODE_INPUT_CAP_TOKENS): TrimResult {
  if (estimateTokens(input) <= cap) return { input, trimmed: false, overCap: false };

  const nodeLength = bodyLength(input.node.schemaData);
  const relatedMax = Math.max(0, ...(input.related ?? []).map((r) => bodyLength(r.data)));
  const fitsRelated = (limit: number) => estimateTokens(limitBodies(input, limit, nodeLength)) <= cap;
  const relatedLimit = largestFitting(relatedMax, fitsRelated);
  if (relatedLimit >= 0) return { input: limitBodies(input, relatedLimit, nodeLength), trimmed: true, overCap: false };

  const fitsNode = (limit: number) => estimateTokens(limitBodies(input, 0, limit)) <= cap;
  const nodeLimit = largestFitting(nodeLength, fitsNode);
  if (nodeLimit >= 0) return { input: limitBodies(input, 0, nodeLimit), trimmed: true, overCap: false };
  return { input: limitBodies(input, 0, 0), trimmed: true, overCap: true };
}

/** What a run trimmed: the nodes (by label) and the rules whose input had a body cut. */
export interface TrimReport {
  nodes: Set<string>;
  ruleIds: Set<string>;
}
