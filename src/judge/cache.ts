import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PACKAGE_NAME } from '../constants';
import type { SpaceContext } from '../types';
import type {
  JudgeProviderIdentity,
  SemanticJudgeInput,
  SemanticJudgeProvider,
  SemanticJudgeResult,
  SemanticJudgeVerdict,
  SemanticRuleSpec,
} from './types';
import { isJudgeError } from './verdicts';

const CACHE_FORMAT_VERSION = 1 as const;

type Entry = {
  key: string;
  verdict: SemanticJudgeVerdict;
  coreVersion: string;
  schemaHash: string;
};

type CacheFile = { formatVersion: typeof CACHE_FORMAT_VERSION; entries: Record<string, Entry> };

let _coreVersion: string | undefined;

function coreVersion(): string {
  if (_coreVersion !== undefined) return _coreVersion;
  try {
    const pkg = createRequire(import.meta.url)('../../package.json') as { version?: string };
    _coreVersion = typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    _coreVersion = 'unknown';
  }
  return _coreVersion;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object' || value instanceof Date) return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Partition file path for one space under a config root. */
export function verdictCachePath(cacheRoot: string, configDir: string, spaceName: string): string {
  return join(cacheRoot, `${spaceName}-${sha256(resolve(configDir)).slice(0, 12)}`, 'verdicts.json');
}

function loadEntries(filePath: string): Record<string, Entry> {
  if (!existsSync(filePath)) return {};
  let parsed: Partial<CacheFile>;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<CacheFile>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid verdict cache at ${filePath}: ${msg}. Delete the file to rebuild it.`);
  }
  if (parsed.formatVersion !== CACHE_FORMAT_VERSION || !parsed.entries || typeof parsed.entries !== 'object') {
    throw new Error(
      `Unsupported verdict cache format at ${filePath} (formatVersion: ${String(parsed.formatVersion)}). Delete the file to rebuild it.`,
    );
  }
  return { ...parsed.entries };
}

function saveEntries(filePath: string, entries: Record<string, Entry>): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.verdicts.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tmpPath, `${JSON.stringify({ formatVersion: CACHE_FORMAT_VERSION, entries }, null, 2)}\n`, 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Wrap a judge provider with a disk-backed verdict cache partitioned by config root and space name.
 * Keys per `(node context, single rule)` + provider identity. Errors and judge inputs are never persisted.
 */
export function withVerdictCache(
  inner: SemanticJudgeProvider,
  context: Pick<SpaceContext, 'configDir' | 'space' | 'schema'>,
  options: { cacheDir?: string; rejudge?: boolean } = {},
): SemanticJudgeProvider {
  const identity: JudgeProviderIdentity = inner.identity ?? { api: inner.name, model: inner.name };
  const cacheRoot = options.cacheDir ?? join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), PACKAGE_NAME);
  const filePath = verdictCachePath(cacheRoot, context.configDir, context.space.name);
  const rejudge = options.rejudge ?? false;
  const version = coreVersion();
  const schemaHash = sha256(canonicalJson(context.schema)).slice(0, 16);
  let entries: Record<string, Entry> | undefined;

  const keyFor = (input: SemanticJudgeInput, rule: SemanticRuleSpec) =>
    sha256(
      canonicalJson({
        provider: identity,
        node: input.node,
        related: input.related,
        schemaDescriptions: input.schemaDescriptions,
        rule,
      }),
    );

  async function evaluateNodes(inputs: SemanticJudgeInput[]): Promise<Array<Record<string, SemanticJudgeResult>>> {
    entries ??= loadEntries(filePath);
    const results: Array<Record<string, SemanticJudgeResult>> = inputs.map(() => ({}));
    const misses: Array<{ index: number; input: SemanticJudgeInput; keys: Map<string, string> }> = [];

    inputs.forEach((input, index) => {
      const missedRules: SemanticRuleSpec[] = [];
      const keys = new Map<string, string>();
      for (const rule of input.rules) {
        const key = keyFor(input, rule);
        const cached = rejudge ? undefined : entries![key];
        if (cached) {
          results[index]![rule.id] = cached.verdict;
        } else {
          missedRules.push(rule);
          keys.set(rule.id, key);
        }
      }
      if (missedRules.length > 0) misses.push({ index, input: { ...input, rules: missedRules }, keys });
    });

    if (misses.length === 0) return results;

    const freshList = inner.evaluateNodes
      ? await inner.evaluateNodes(misses.map((m) => m.input))
      : await Promise.all(misses.map((m) => inner.evaluate(m.input)));

    let dirty = false;
    misses.forEach((miss, k) => {
      const fresh = freshList[k] ?? {};
      for (const rule of miss.input.rules) {
        const res = fresh[rule.id];
        if (!res) continue;
        results[miss.index]![rule.id] = res;
        if (!isJudgeError(res) && res.verdict in rule.verdicts) {
          const key = miss.keys.get(rule.id)!;
          entries![key] = {
            key,
            verdict: res,
            coreVersion: version,
            schemaHash,
          };
          dirty = true;
        }
      }
    });

    if (dirty) saveEntries(filePath, entries);
    return results;
  }

  return {
    name: inner.name,
    identity,
    evaluate: async (input) => (await evaluateNodes([input]))[0] ?? {},
    evaluateNodes,
  };
}
