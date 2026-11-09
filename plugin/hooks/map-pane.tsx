// The map pane: a space's hierarchy as an indented tree beside the chat, each node with its
// validation results. The projection (graph, tree, annotations) is structured-context's and
// map-views' own code, bundled into projection.js; this file only lays the rows out.
//
// The pane loads when it opens and again after a Stop that validated its space, from the results
// the hooks kept (scripts/mod-bridge.ts pane). It never validates on a tool call.

import type { EngineInterface, On } from 'claude-code';
import { atom, read, update } from 'claude-code';

import type { FocusedNode, PaneData } from '../types';
import { annotationsFrom, buildTree, spaceGraphFrom, worstSeverity } from './projection.js';

type Graph = ReturnType<typeof spaceGraphFrom>;
type Tree = ReturnType<typeof buildTree>;
type Occurrence = Tree['roots'][number];
type Annotations = ReturnType<typeof annotationsFrom>;
type Annotation = NonNullable<ReturnType<Annotations['annotations']['get']>>[number];

export const PANE = 'structured-context-map';
const COMMAND = 'sctx-map';
const TITLE = 'Space map';
// Rows drawn at most; collapsing branches shows the rest
const ROW_LIMIT = 400;
const UNATTACHED_LIMIT = 10;

// Written by register.tsx; the same references and shapes here
const status = atom({ plugin: 'structured-context', key: 'status' } as const, null, { shape: 'status-1' });
const cwd = atom(
  { plugin: 'structured-context', key: 'cwd' } as const,
  { spaces: [], digests: [] },
  { shape: 'cwd-1' },
);
const map = atom({ plugin: 'structured-context', key: 'map' } as const, { loadedAt: 0 }, { shape: 'map-1' });
const collapsed = atom({ plugin: 'structured-context', key: 'collapsed' } as const, []);
const selected = atom({ plugin: 'structured-context', key: 'selected' } as const, null);
const focused = atom({ plugin: 'structured-context', key: 'focused' } as const, null, { shape: 'focused-1' });

const SEVERITY_COLOR = { error: 'error', warning: 'warning', info: 'suggestion' } as const;

/** Load `space` (default: the pane's space, else the directory's first) into the pane */
async function load($: EngineInterface, space?: string): Promise<void> {
  const current = await read($, map);
  const name = space ?? current.space ?? (await read($, cwd)).spaces[0];
  const loadedAt = (await read($, status))?.report?.at ?? 0;
  if (!name) {
    await update($, map, () => ({ loadedAt, error: 'No structured-context space in or around this directory.' }));
    return;
  }
  const isSameSpace = name === current.space;
  // Another space's tree stays out of sight while this one loads; the same space's stays up
  await update($, map, (view) =>
    isSameSpace ? { ...view, isLoading: true } : { space: name, loadedAt: view.loadedAt, isLoading: true },
  );
  if (!isSameSpace) await update($, selected, () => null);
  const run = await $.process.run(
    ['bun', 'run', `${$.plugin.root}/scripts/mod-bridge.ts`, 'pane', await $.session.id(), name],
    { timeoutMs: 120_000 },
  );
  if (run.exitCode !== 0) {
    const error = run.stderr.trim().split('\n')[0] || `mod-bridge exited with code ${run.exitCode}`;
    await update($, map, (view) =>
      view.space === name ? { space: name, hierarchy: view.hierarchy, loadedAt, error } : view,
    );
    return;
  }
  const data = JSON.parse(run.stdout) as PaneData;
  // A pick of another space while this one loaded wins: its load writes the pane
  await update($, map, (view) =>
    view.space === name ? { space: name, hierarchy: view.hierarchy, data, loadedAt } : view,
  );
}

async function open($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: TITLE });
  await load($);
}

/** The file a node is written in: the space's own file, or a file inside its directory */
function nodeFile(data: PaneData, node: Occurrence['node']): string | undefined {
  const file = node.source?.file;
  if (!file) return undefined;
  return data.path.endsWith('.md') ? data.path : `${data.path.replace(/\/$/, '')}/${file}`;
}

// A rule result's message starts with its rule id
const describe = (a: Annotation) => `${a.severity}: ${a.message}`;

/** The text attached to each prompt while a node is focused */
export function focusContext(node: FocusedNode): string {
  const where = node.file ? `, in ${node.file}` : '';
  const issues =
    node.issues.length > 0 ? `\nIts validation results:\n${node.issues.map((i) => `- ${i}`).join('\n')}` : '';
  return (
    `The person has focused this node in the structured-context map pane: "${node.title}" (${node.type}) ` +
    `in space \`${node.space}\`${where}. Read "this node" or "here" in their prompt as this node.${issues}`
  );
}

const MIN_TITLE = 12;

/** `text` cut to `room` cells with an ellipsis, never below MIN_TITLE */
export function fit(text: string, room: number): string {
  const width = Math.max(MIN_TITLE, room);
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

type Row = { occurrence: Occurrence; depth: number; hasHiddenChildren: boolean };

/** The tree's rows in order, leaving out what's under a collapsed row */
function rows(occurrences: Occurrence[], hidden: ReadonlySet<string>, depth = 0, into: Row[] = []): Row[] {
  for (const occurrence of occurrences) {
    const isCollapsed = hidden.has(occurrence.key);
    into.push({ occurrence, depth, hasHiddenChildren: isCollapsed && occurrence.children.length > 0 });
    if (!isCollapsed) rows(occurrence.children, hidden, depth + 1, into);
  }
  return into;
}

function findOccurrence(occurrences: Occurrence[], key: string): Occurrence | undefined {
  for (const occurrence of occurrences) {
    if (occurrence.key === key) return occurrence;
    const found = findOccurrence(occurrence.children, key);
    if (found) return found;
  }
  return undefined;
}

function project(data: PaneData, hierarchy?: string): { graph: Graph; tree: Tree; annotations: Annotations } {
  const graph = spaceGraphFrom(data.graph as Parameters<typeof spaceGraphFrom>[0], { hierarchy });
  const tree = buildTree(graph, 'pane');
  // Passed as validate gives it; only its node ids are plain strings here, not core's branded NodeId
  const input = { issues: data.validation.issues, ruleViolations: data.validation.ruleViolations };
  const annotations = annotationsFrom(input as Parameters<typeof annotationsFrom>[0], graph);
  return { graph, tree, annotations };
}

/** For register.tsx's session.start hook: the command that opens the pane */
export async function registerMapCommand($: EngineInterface): Promise<void> {
  await $.command.register({
    name: COMMAND,
    description: "Show a structured-context space's hierarchy with its validation results, beside the chat",
  });
}

/** For register.tsx's Stop hook: reload after a Stop that validated the pane's space, from the results it kept */
export async function reloadMapAfterStop($: EngineInterface): Promise<void> {
  if (!(await $.ui.panes()).some((pane) => pane.id === PANE)) return;
  const view = await read($, map);
  const report = (await read($, status))?.report;
  if (report && report.at > view.loadedAt && report.spaces.some((space) => space.name === view.space)) {
    await load($);
  }
}

export function registerMapPane(on: On): void {
  on('command.run', { command: COMMAND }, async ($) => {
    await open($);
    return { text: 'Opened the structured-context space map.' };
  });

  on('prompt.submit', async ($, e, next) => {
    const node = await read($, focused);
    if (!node) return next(e);
    return next({ ...e, context: [...(e.context ?? []), focusContext(node)] });
  }).catch((_, e, next) => next(e));

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Link, Select, Text } = $.ui.resolve(e);
    const view = await read($, map);
    const { spaces } = await read($, cwd);
    const hidden = new Set(await read($, collapsed));
    const selectedKey = await read($, selected);
    const focus = await read($, focused);

    const reload = () => load($);
    const header = (
      <Box gap={1} flexWrap="wrap">
        {spaces.length > 1 && (
          <Select
            key="space"
            label="Space"
            options={spaces.map((value) => ({ value }))}
            value={view.space}
            onSelect={(value) => load($, value)}
          />
        )}
        {view.data && view.data.graph.hierarchies.length > 1 && (
          <Select
            key="hierarchy"
            label="Hierarchy"
            options={view.data.graph.hierarchies.map(({ name }) => ({
              value: name,
              label: name === view.data?.graph.mainHierarchy ? `${name} (main)` : name,
            }))}
            value={view.hierarchy ?? view.data.graph.mainHierarchy}
            onSelect={(value) => update($, map, (current) => ({ ...current, hierarchy: value }))}
          />
        )}
        {view.isLoading ? (
          <Text dimColor>Loading…</Text>
        ) : (
          <Button key="reload" label="Reload" dimColor onPress={reload} />
        )}
      </Box>
    );
    const focusLine = focus && (
      <Box gap={1}>
        <Text>
          Focused: {focus.title} <Text dimColor>({focus.type}), sent with each prompt</Text>
        </Text>
        <Button key="unfocus" label="Unfocus" dimColor onPress={() => update($, focused, () => null)} />
      </Box>
    );

    if (view.error || !view.data) {
      return (
        <Box flexDirection="column">
          {header}
          {focusLine}
          {!view.isLoading && <Text dimColor>{view.error ?? 'Loading…'}</Text>}
        </Box>
      );
    }

    const data = view.data;
    let projected: ReturnType<typeof project>;
    try {
      projected = project(data, view.hierarchy);
    } catch (err) {
      return (
        <Box flexDirection="column">
          {header}
          <Text color="error">
            Could not lay out {data.space}: {(err as Error).message}
          </Text>
        </Box>
      );
    }
    const { tree, annotations } = projected;
    const all = [...tree.roots, ...tree.orphans];
    const list = rows(tree.roots, hidden);
    const orphanRows = rows(tree.orphans, hidden);
    const shown = [...list, ...orphanRows].slice(0, ROW_LIMIT);
    const counts = { error: 0, warning: 0, info: 0 };
    for (const results of annotations.annotations.values()) for (const a of results) counts[a.severity]++;
    for (const a of annotations.unattached) counts[a.severity]++;
    const parseIssues = data.validation.parseIssues;
    for (const issue of parseIssues) counts[issue.severity]++;

    const toggle = (key: string) =>
      update($, collapsed, (keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));

    // A row is one line: the title gives way to the indent, type and badge, which keep their width
    const row = ({ occurrence, depth, hasHiddenChildren }: Row) => {
      const { key, node, children, repeatOf } = occurrence;
      const results = annotations.annotations.get(node.id) ?? [];
      const worst = worstSeverity(results);
      const marker = repeatOf ? '↺' : children.length === 0 ? '·' : hidden.has(key) ? '▸' : '▾';
      const indent = '  '.repeat(depth);
      const type = `${node.resolvedType}${hasHiddenChildren ? ` +${children.length}` : ''}`;
      const badge = worst ? `● ${results.length}` : '';
      const room = e.props.bodyColumns - indent.length - marker.length - type.length - badge.length - 4;
      return (
        <Box key={`row:${key}`} gap={1}>
          <Text>
            {indent}
            {children.length > 0 ? '' : marker}
          </Text>
          {children.length > 0 && (
            <Button key={`toggle:${key}`} plain dimColor label={marker} onPress={() => toggle(key)} />
          )}
          <Button
            key={`select:${key}`}
            plain
            dimColor={repeatOf !== undefined}
            label={fit(node.title, room)}
            onPress={() => update($, selected, (current) => (current === key ? null : key))}
          />
          <Text dimColor wrap="truncate-end">
            {type}
          </Text>
          {worst && <Text color={SEVERITY_COLOR[worst]}>{badge}</Text>}
        </Box>
      );
    };

    const current = selectedKey ? findOccurrence(all, selectedKey) : undefined;
    const details =
      current &&
      (() => {
        const { node } = current;
        const results = annotations.annotations.get(node.id) ?? [];
        const file = nodeFile(data, node);
        const facts: FocusedNode = {
          space: data.space,
          id: node.id,
          title: node.title,
          type: node.resolvedType,
          file,
          issues: results.map(describe),
        };
        return (
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            <Text>
              {node.title} <Text dimColor>({node.resolvedType})</Text>
            </Text>
            {file && <Text dimColor>{file}</Text>}
            {results.length === 0 && <Text dimColor>No validation results.</Text>}
            {results.map((a) => (
              <Text color={SEVERITY_COLOR[a.severity]}>{describe(a)}</Text>
            ))}
            <Box gap={1} flexWrap="wrap">
              <Button
                key="focus"
                label={focus?.id === node.id && focus.space === data.space ? 'Focused' : 'Focus'}
                variant="primary"
                onPress={() => update($, focused, () => facts)}
              />
              {file && <Link href={`file://${encodeURI(file)}`} label="Open file" />}
              {file && <Link href={`obsidian://open?path=${encodeURIComponent(file)}`} label="Open in Obsidian" />}
            </Box>
          </Box>
        );
      })();

    const unattached = annotations.unattached;
    return (
      <Box flexDirection="column">
        {header}
        {focusLine}
        <Text dimColor>
          {data.space} · {counts.error} errors, {counts.warning} warnings, {counts.info} info
        </Text>
        {details}
        {list.length === 0 && orphanRows.length === 0 && <Text dimColor>No nodes of the hierarchy's types.</Text>}
        {shown.slice(0, list.length).map(row)}
        {orphanRows.length > 0 && shown.length > list.length && <Text dimColor>Not under a root:</Text>}
        {shown.slice(list.length).map(row)}
        {list.length + orphanRows.length > shown.length && (
          <Text
            dimColor
          >{`and ${list.length + orphanRows.length - shown.length} more rows; collapse branches to see them`}</Text>
        )}
        {unattached.length > 0 && <Text>Not on the map ({unattached.length}):</Text>}
        {unattached.slice(0, UNATTACHED_LIMIT).map((a) => (
          <Text color={SEVERITY_COLOR[a.severity]}>
            {'  '}
            {a.nodeId ?? 'space'}: {describe(a)}
          </Text>
        ))}
        {unattached.length > UNATTACHED_LIMIT && (
          <Text dimColor>{`  and ${unattached.length - UNATTACHED_LIMIT} more`}</Text>
        )}
        {parseIssues.length > 0 && <Text>Could not parse ({parseIssues.length}):</Text>}
        {parseIssues.slice(0, UNATTACHED_LIMIT).map((issue) => (
          <Text color={SEVERITY_COLOR[issue.severity]}>
            {'  '}
            {issue.file}: {issue.severity}: {issue.message ?? issue.type}
          </Text>
        ))}
        {parseIssues.length > UNATTACHED_LIMIT && (
          <Text dimColor>{`  and ${parseIssues.length - UNATTACHED_LIMIT} more`}</Text>
        )}
      </Box>
    );
  });
}
