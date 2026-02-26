import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type { OstNode } from '../types.js';

export interface CachedNode {
  miroCardId: string;
  contentHash: string;
}

export interface CachedConnector {
  miroConnectorId: string;
}

export interface SyncCache {
  boardId: string;
  frameId: string;
  spaceAlias?: string;
  lastSync: string;
  nodes: Record<string, CachedNode>;       // keyed by node title
  connectors: Record<string, CachedConnector>; // keyed by "parent→child"
}

const CACHE_DIR = '.miro-cache';

function cachePath(boardId: string, frameId: string): string {
  return join(CACHE_DIR, `${boardId}-${frameId}.json`);
}

export function loadCache(boardId: string, frameId: string): SyncCache {
  const path = cachePath(boardId, frameId);
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf-8'));
  }
  return {
    boardId,
    frameId,
    lastSync: '',
    nodes: {},
    connectors: {},
  };
}

export function saveCache(cache: SyncCache): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = cachePath(cache.boardId, cache.frameId);
  writeFileSync(path, JSON.stringify(cache, null, 2) + '\n');
}

export function computeNodeHash(node: OstNode): string {
  const relevant = {
    title: node.data.title,
    type: node.data.type,
    status: node.data.status,
    summary: node.data.summary,
    priority: node.data.priority,
    parent: node.data.parent,
  };
  return createHash('sha256').update(JSON.stringify(relevant)).digest('hex').slice(0, 16);
}

/** Normalize HTML entities in text (e.g., &amp; → &) */
function normalizeHtmlEntities(text: string): string {
  return text.replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Compute hash from Miro card data (title + description) to compare against markdown hash */
export function computeMiroCardHash(title: string, description: string): string {
  const normalized = {
    title: normalizeHtmlEntities(title),
    description: normalizeHtmlEntities(description),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 16);
}
