import type { FromSchema } from 'json-schema-to-ts';
import { EDGE_PROPS, EMBEDDING_PROPS, SCHEMA_META_BASE_URL } from './schema/metadata-contract';
import { buildSpaceGraph, type SpaceGraph, selectHierarchy } from './space-graph';
import type { Hierarchy, NodeId, SchemaMetadata, SpaceNode } from './types';

/** Bump when the shape of SpaceGraphData changes; the generator refuses to overwrite a released version's schema. */
export const SPACE_GRAPH_FORMAT_VERSION = 1;

/** Folder under `schemas/generated/` holding the format schema: `latest.json` and one frozen file per released version. */
export const SPACE_GRAPH_SCHEMA_DIR = 'space-graph';

/** Schema `$id` for a format version file, e.g. `.../generated/space-graph/1.json`. */
export function spaceGraphSchemaId(file: string): string {
  return `${SCHEMA_META_BASE_URL}/${SPACE_GRAPH_SCHEMA_DIR}/${file}.json`;
}

const STRING = { type: 'string' } as const;

const SOURCE_LOCATION_SCHEMA = {
  type: 'object',
  properties: { file: STRING, line: { type: 'integer' }, column: { type: 'integer' } },
  required: ['file'],
  additionalProperties: false,
} as const;

const CONTENT_LINK_PROPS = {
  text: STRING,
  target: STRING,
  action: { enum: ['link', 'embed'] },
  anchor: STRING,
} as const;

const CONTENT_LINK_SCHEMA = {
  type: 'object',
  properties: { ...CONTENT_LINK_PROPS, linkSyntax: { enum: ['wikilink', 'markdown'] } },
  required: ['text', 'target', 'action', 'linkSyntax'],
  additionalProperties: false,
} as const;

const RESOLVED_CONTENT_LINK_SCHEMA = {
  type: 'object',
  properties: { ...CONTENT_LINK_PROPS, location: { enum: ['node', 'internal', 'external', 'system', 'protocol'] } },
  required: ['text', 'target', 'action', 'location'],
  additionalProperties: false,
} as const;

const RESOLVED_PARENT_REF_SCHEMA = {
  type: 'object',
  properties: {
    id: STRING,
    field: STRING,
    kind: { enum: ['hierarchy', 'relationship'] },
    hierarchy: STRING,
    selfRef: { type: 'boolean' },
    fieldOn: EDGE_PROPS.fieldOn,
  },
  required: ['id', 'field', 'kind', 'selfRef', 'fieldOn'],
  additionalProperties: false,
} as const;

const SPACE_NODE_SCHEMA = {
  type: 'object',
  properties: {
    id: STRING,
    title: STRING,
    schemaData: { type: 'object' },
    linkTargets: { type: 'array', items: STRING },
    type: STRING,
    content: STRING,
    contentLinks: { type: 'array', items: CONTENT_LINK_SCHEMA },
    source: SOURCE_LOCATION_SCHEMA,
    resolvedType: STRING,
    resolvedParents: { type: 'array', items: RESOLVED_PARENT_REF_SCHEMA },
    resolvedLinks: { type: 'array', items: RESOLVED_CONTENT_LINK_SCHEMA },
  },
  required: ['id', 'title', 'schemaData', 'linkTargets', 'type', 'resolvedType', 'resolvedParents', 'resolvedLinks'],
  additionalProperties: false,
} as const;

/** A hierarchy level after normalisation: edge fields are always present. */
const HIERARCHY_LEVEL_SCHEMA = {
  type: 'object',
  properties: {
    type: STRING,
    ...EDGE_PROPS,
    ...EMBEDDING_PROPS,
    selfRef: { type: 'boolean' },
    selfRefField: STRING,
  },
  required: ['type', 'field', 'fieldOn', 'multiple', 'selfRef'],
  additionalProperties: false,
} as const;

const HIERARCHY_SCHEMA = {
  type: 'object',
  properties: {
    name: STRING,
    levels: { type: 'array', items: HIERARCHY_LEVEL_SCHEMA },
    allowSkipLevels: { type: 'boolean' },
  },
  required: ['name', 'levels'],
  additionalProperties: false,
} as const;

/** JSON Schema for SpaceGraphData. Written to `schemas/generated/space-graph/` by `bun run generate:schema-meta`. */
export const SPACE_GRAPH_DATA_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'structured-context space graph',
  type: 'object',
  properties: {
    formatVersion: { const: SPACE_GRAPH_FORMAT_VERSION },
    hierarchies: { type: 'array', items: HIERARCHY_SCHEMA },
    mainHierarchy: STRING,
    nodes: { type: 'array', items: SPACE_NODE_SCHEMA },
  },
  required: ['formatVersion', 'hierarchies', 'nodes'],
  additionalProperties: false,
} as const;

/**
 * A space's nodes and hierarchies as plain JSON, for passing a graph across a process or network boundary.
 *
 * Edges live in each node's resolvedParents, including edges to nodes outside the set. The format names every
 * hierarchy, so the receiver picks which one structures the graph.
 */
export type SpaceGraphData = {
  formatVersion: typeof SPACE_GRAPH_FORMAT_VERSION;
  hierarchies: Hierarchy[];
  /** Name of the main hierarchy, if the schema has one. */
  mainHierarchy?: string;
  nodes: SpaceNode[];
};

/** Turn a set of nodes and its schema's hierarchies into SpaceGraphData. Pass `graph.nodes.values()` for a filtered graph. */
export function exportSpaceGraph(
  nodes: Iterable<SpaceNode>,
  metadata: Pick<SchemaMetadata, 'hierarchy' | 'hierarchies'>,
): SpaceGraphData {
  return {
    formatVersion: SPACE_GRAPH_FORMAT_VERSION,
    hierarchies: metadata.hierarchies ?? [],
    ...(metadata.hierarchy ? { mainHierarchy: metadata.hierarchy.name } : {}),
    nodes: [...nodes],
  };
}

/**
 * Build a SpaceGraph from SpaceGraphData, structured by the named hierarchy (default: the main hierarchy).
 * Throws on an unsupported format version or an unknown hierarchy name.
 */
export function spaceGraphFrom(data: SpaceGraphData, options: { hierarchy?: string } = {}): SpaceGraph {
  if (data.formatVersion !== SPACE_GRAPH_FORMAT_VERSION) {
    throw new Error(
      `Unsupported space graph format version ${data.formatVersion}; expected ${SPACE_GRAPH_FORMAT_VERSION}.`,
    );
  }
  const metadata = {
    hierarchy: data.hierarchies.find((h) => h.name === data.mainHierarchy),
    hierarchies: data.hierarchies,
  };
  return buildSpaceGraph(data.nodes, selectHierarchy(metadata, options.hierarchy));
}

/** Replaces branded ids with plain strings, the shape JSON Schema can describe. */
type Unbranded<T> = T extends NodeId
  ? string
  : T extends readonly (infer U)[]
    ? Unbranded<U>[]
    : T extends object
      ? { [K in keyof T]: Unbranded<T[K]> }
      : T;

type SchemaShape = FromSchema<typeof SPACE_GRAPH_DATA_SCHEMA>;

/** Exact type equality: optional properties and modifiers must match too, not just assignability. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// Fails typecheck when SPACE_GRAPH_DATA_SCHEMA and SpaceGraphData drift apart.
const _schemaMatchesType: Equals<SchemaShape, Unbranded<SpaceGraphData>> = true;
void _schemaMatchesType;
