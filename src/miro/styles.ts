import type { OstNode } from '../types.js';

const TYPE_COLORS: Record<string, string> = {
  vision: '#ff9999',
  mission: '#99ccff',
  goal: '#99ff99',
  opportunity: '#ffcc99',
  solution: '#cc99ff',
};

const STATUS_ICONS: Record<string, string> = {
  active: '*',
  identified: '?',
  wondering: '~',
  exploring: '...',
  paused: '||',
  completed: 'ok',
  archived: 'x',
};

export function getCardColor(type: string): string {
  return TYPE_COLORS[type] ?? '#e0e0e0';
}

export function buildCardTitle(node: OstNode): string {
  const title = node.data.title as string;
  const status = node.data.status as string | undefined;
  const priority = node.data.priority as string | undefined;

  const icon = status ? STATUS_ICONS[status] ?? status : '';
  const prefix = icon ? `[${icon}] ` : '';
  const suffix = priority ? ` (${priority})` : '';

  return `${prefix}${title}${suffix}`;
}

export function buildCardDescription(node: OstNode): string {
  const parts: string[] = [];

  const type = node.data.type as string;
  const status = node.data.status as string | undefined;
  parts.push(`Type: ${type}`);
  if (status) parts.push(`Status: ${status}`);

  const summary = node.data.summary as string | undefined;
  if (summary) parts.push(`\n${summary}`);

  const content = node.data.content as string | undefined;
  if (content) parts.push(`\n${content}`);

  return parts.join('\n');
}
