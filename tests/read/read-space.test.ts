import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setConfigPath } from '../../src/config';
import { readSpace } from '../../src/read/read-space';
import { makeSpaceContext } from '../helpers/context';

const VALID_DIR = join(import.meta.dir, '../fixtures/general/valid-ost');
const VALID_PAGE = join(import.meta.dir, '../fixtures/general/on-a-page-valid.md');
// Config written here so configDir = tests/fixtures/, resolving plugins from tests/fixtures/plugins/
const FIXTURES_DIR = join(import.meta.dir, '../fixtures');
const TMP_CONFIG = join(FIXTURES_DIR, '_tmp-orchestrate-config.json');

describe('readSpace', () => {
  beforeEach(() => {
    setConfigPath(undefined);
    if (existsSync(TMP_CONFIG)) rmSync(TMP_CONFIG);
  });

  afterAll(() => {
    if (existsSync(TMP_CONFIG)) rmSync(TMP_CONFIG);
    setConfigPath(undefined);
  });

  describe('default behaviour (markdown plugin)', () => {
    it('reads a directory space and returns source: ost-tools-markdown', async () => {
      const result = await readSpace(makeSpaceContext(VALID_DIR));
      expect(result.source).toBe('ost-tools-markdown');
      expect(result.nodes.length).toBeGreaterThan(0);
    });

    it('returns kind:directory diagnostics for directory spaces', async () => {
      const result = await readSpace(makeSpaceContext(VALID_DIR));
      expect(result.diagnostics?.kind).toBe('directory');
    });

    it('reads a space_on_a_page file and returns source: ost-tools-markdown', async () => {
      const result = await readSpace(makeSpaceContext(VALID_PAGE));
      expect(result.source).toBe('ost-tools-markdown');
      expect(result.nodes.length).toBeGreaterThan(0);
    });

    it('returns kind:page diagnostics for page spaces', async () => {
      const result = await readSpace(makeSpaceContext(VALID_PAGE));
      expect(result.diagnostics?.kind).toBe('page');
    });

    it('resolves graph edges (nodes have resolvedParents populated)', async () => {
      const result = await readSpace(makeSpaceContext(VALID_DIR));
      const nodesWithParents = result.nodes.filter((n) => n.resolvedParents.length > 0);
      expect(nodesWithParents.length).toBeGreaterThan(0);
    });
  });

  describe('plugin fallthrough (null plugin before markdown)', () => {
    it('falls through to markdown when first plugin returns null', async () => {
      const ctx = makeSpaceContext(VALID_DIR, undefined, { 'ost-tools-null-plugin': {} });
      ctx.configDir = FIXTURES_DIR;
      const result = await readSpace(ctx);
      expect(result.source).toBe('ost-tools-markdown');
      expect(result.nodes.length).toBeGreaterThan(0);
    });
  });

  describe('first-match-wins', () => {
    it('uses first plugin that returns non-null, skips markdown', async () => {
      const ctx = makeSpaceContext(VALID_DIR, undefined, { 'ost-tools-custom-plugin': {} });
      ctx.configDir = FIXTURES_DIR;
      const result = await readSpace(ctx);
      expect(result.source).toBe('ost-tools-custom-plugin');
      expect(result.diagnostics?.source).toBe('custom');
    });
  });

  describe('space-level plugins', () => {
    it('uses custom plugin configured on the space', async () => {
      const ctx = makeSpaceContext(VALID_DIR, undefined, { 'ost-tools-custom-plugin': {} });
      ctx.configDir = FIXTURES_DIR;
      const result = await readSpace(ctx);
      expect(result.source).toBe('ost-tools-custom-plugin');
    });
  });
});
