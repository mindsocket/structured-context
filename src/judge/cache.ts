import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PACKAGE_NAME } from '../constants';
import type { SchemaWithMetadata } from '../types';
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

export interface VerdictCacheEntry {
  key: string;
  verdict: SemanticJudgeVerdict;
  coreVersion: string;
  pluginVersion?: string;
  schemaHash: string;
}

interface VerdictCacheFile {
  formatVersion: typeof CACHE_FORMAT_VERSION;
  entries: Record<string, VerdictCacheEntry>;
}

export interface VerdictCacheOptions {
  configDir: string;
  spaceName: string;
  schema: SchemaWithMetadata;
  /** Override the default `$XDG_CACHE_HOME/structured-context/` cache root. */
  cacheDir?: string;
  /** Skip reading cached entries for this run, but still write fresh verdicts back to the cache. */
  rejudge?: boolean;
  /** Version of the parse plugin that produced the space's nodes, stored as metadata outside the key. */
  pluginVersion?: string;
  /** Override core version metadata (defaults to package.json version). */
  coreVersion?: string;
}

let _cachedCoreVersion: string | undefined;

/** Read structured-context's own package version once; falls back to `'unknown'` in bundled hosts without import.meta.url. */
export function corePackageVersion(): string {
  if (_cachedCoreVersion !== undefined) return _cachedCoreVersion;
  try {
    const req = createRequire(import.meta.url);
    const pkg = req('../../package.json') as { version?: string };
    _cachedCoreVersion = typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    _cachedCoreVersion = 'unknown';
  }
  return _cachedCoreVersion;
}

/** Default verdict cache root: `$XDG_CACHE_HOME/structured-context/` or `~/.cache/structured-context/`. */
export function defaultCacheDir(): string {
  const xdgBase = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(xdgBase, PACKAGE_NAME);
}

/** Deterministic JSON stringification with sorted object keys so equivalent inputs produce identical cache keys. */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalStringify(item))).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(',')}}`;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Short deterministic hash of the resolved schema, stored as entry metadata outside the cache key. */
export function schemaContentHash(schema: SchemaWithMetadata): string {
  return sha256(canonicalStringify(schema)).slice(0, 16);
}

/** Partition file path for one space under a config root: `<cacheRoot>/<spaceName>-<shortHash(configDir)>/verdicts.json`. */
export function verdictCachePath(cacheRoot: string, configDir: string, spaceName: string): string {
  const dirHash = sha256(resolve(configDir)).slice(0, 12);
  return join(cacheRoot, `${spaceName}-${dirHash}`, 'verdicts.json');
}

function providerIdentityOf(provider: SemanticJudgeProvider): JudgeProviderIdentity {
  return provider.identity ?? { api: provider.name, model: provider.name };
}

/** Cache key for one rule evaluated against one node context with a specific provider and prompt version. */
export function verdictCacheKey(
  input: Pick<SemanticJudgeInput, 'node' | 'related' | 'schemaDescriptions'>,
  rule: SemanticRuleSpec,
  identity: JudgeProviderIdentity,
): string {
  return sha256(
    canonicalStringify({
      provider: identity,
      node: input.node,
      related: input.related,
      schemaDescriptions: input.schemaDescriptions,
      rule,
    }),
  );
}

function loadCacheFile(filePath: string): Record<string, VerdictCacheEntry> {
  if (!existsSync(filePath)) return {};
  let parsed: Partial<VerdictCacheFile>;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<VerdictCacheFile>;
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

function saveCacheFile(filePath: string, entries: Record<string, VerdictCacheEntry>): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const payload: VerdictCacheFile = { formatVersion: CACHE_FORMAT_VERSION, entries };
  const tmpPath = join(dir, `.verdicts.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Wraps a `SemanticJudgeProvider` with a disk-backed verdict cache partitioned by config root and space name.
 * Keys per `(node context, single rule)` + provider identity (including its prompt hash). Errors are never
 * cached, and judge inputs are never persisted.
 */
export class CachedJudgeProvider implements SemanticJudgeProvider {
  readonly name: string;
  readonly identity: JudgeProviderIdentity;
  readonly cachePath: string;
  private readonly rejudge: boolean;
  private readonly coreVersion: string;
  private readonly pluginVersion?: string;
  private readonly schemaHash: string;
  private entries: Record<string, VerdictCacheEntry> | undefined;

  constructor(
    private readonly inner: SemanticJudgeProvider,
    options: VerdictCacheOptions,
  ) {
    this.name = inner.name;
    this.identity = providerIdentityOf(inner);
    const cacheRoot = options.cacheDir ?? defaultCacheDir();
    this.cachePath = verdictCachePath(cacheRoot, options.configDir, options.spaceName);
    this.rejudge = options.rejudge ?? false;
    this.coreVersion = options.coreVersion ?? corePackageVersion();
    this.pluginVersion = options.pluginVersion;
    this.schemaHash = schemaContentHash(options.schema);
  }

  private getEntries(): Record<string, VerdictCacheEntry> {
    if (this.entries === undefined) {
      this.entries = loadCacheFile(this.cachePath);
    }
    return this.entries;
  }

  async evaluate(input: SemanticJudgeInput): Promise<Record<string, SemanticJudgeResult>> {
    const [result] = await this.evaluateBatch([input]);
    return result ?? {};
  }

  async evaluateNodes(inputs: SemanticJudgeInput[]): Promise<Array<Record<string, SemanticJudgeResult>>> {
    return this.evaluateBatch(inputs);
  }

  private async evaluateBatch(inputs: SemanticJudgeInput[]): Promise<Array<Record<string, SemanticJudgeResult>>> {
    const entries = this.getEntries();
    const results: Array<Record<string, SemanticJudgeResult>> = inputs.map(() => ({}));
    const misses: Array<{
      index: number;
      input: SemanticJudgeInput;
      keys: Map<string, string>;
    }> = [];

    inputs.forEach((input, index) => {
      const missedRules: SemanticRuleSpec[] = [];
      const keys = new Map<string, string>();
      for (const rule of input.rules) {
        const key = verdictCacheKey(input, rule, this.identity);
        const cached = this.rejudge ? undefined : entries[key];
        if (cached) {
          results[index]![rule.id] = cached.verdict;
        } else {
          missedRules.push(rule);
          keys.set(rule.id, key);
        }
      }
      if (missedRules.length > 0) {
        misses.push({
          index,
          input: { ...input, rules: missedRules },
          keys,
        });
      }
    });

    if (misses.length === 0) return results;

    let freshList: Array<Record<string, SemanticJudgeResult>>;
    if (this.inner.evaluateNodes) {
      freshList = await this.inner.evaluateNodes(misses.map((m) => m.input));
    } else {
      freshList = [];
      for (const miss of misses) {
        freshList.push(await this.inner.evaluate(miss.input));
      }
    }

    let dirty = false;
    misses.forEach((miss, k) => {
      const fresh = freshList[k] ?? {};
      for (const rule of miss.input.rules) {
        const res = fresh[rule.id];
        if (!res) continue;
        results[miss.index]![rule.id] = res;
        // Never cache errors or unknown verdicts.
        if (!isJudgeError(res) && res.verdict in rule.verdicts) {
          const key = miss.keys.get(rule.id)!;
          entries[key] = {
            key,
            verdict: res,
            coreVersion: this.coreVersion,
            ...(this.pluginVersion !== undefined ? { pluginVersion: this.pluginVersion } : {}),
            schemaHash: this.schemaHash,
          };
          dirty = true;
        }
      }
    });

    if (dirty) {
      saveCacheFile(this.cachePath, entries);
    }

    return results;
  }
}

export function wrapWithVerdictCache(
  provider: SemanticJudgeProvider,
  options: VerdictCacheOptions,
): SemanticJudgeProvider {
  return new CachedJudgeProvider(provider, options);
}
