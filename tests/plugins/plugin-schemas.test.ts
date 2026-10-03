import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, resolveSchemaPath } from '../../src/config';
import { buildFullRegistry } from '../../src/schema/schema';
import { createSpaceContext } from '../../src/space-context';

const FIXTURES_DIR = join(import.meta.dir, '../fixtures');
const PLUGIN_SCHEMAS_DIR = join(FIXTURES_DIR, 'plugins/schemas');

describe('Plugin-contributed schemas', () => {
  describe('buildFullRegistry with pluginSchemas', () => {
    it('registers partials from plugin schemasDir into registry', () => {
      const targetPath = join(PLUGIN_SCHEMAS_DIR, 'plugin_schema.json');
      const registry = buildFullRegistry(targetPath, [
        { pluginName: 'sctx-schema-plugin', schemasDir: PLUGIN_SCHEMAS_DIR },
      ]);

      expect(registry.has('sctx://schema-plugin/_test_partial')).toBe(true);
      expect(registry.has('sctx://schema-plugin/plugin_schema')).toBe(true);
      expect(registry.has('sctx://_sctx_base')).toBe(true);
    });

    it('throws error when plugin schema collides with bundled schema $id', () => {
      const tempDir = join(import.meta.dir, '../fixtures/tmp-collision-bundled');
      mkdirSync(tempDir, { recursive: true });
      try {
        writeFileSync(
          join(tempDir, '_colliding.json'),
          JSON.stringify({
            $schema: 'https://json-schema.org/draft-07/schema#',
            $id: 'sctx://_sctx_base',
          }),
        );
        const targetPath = join(PLUGIN_SCHEMAS_DIR, 'plugin_schema.json');
        expect(() => buildFullRegistry(targetPath, [{ pluginName: 'sctx-bad-plugin', schemasDir: tempDir }])).toThrow(
          /Schema collision: schema in plugin "sctx-bad-plugin".*reserved by a default schema/,
        );
      } finally {
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('throws error when two plugins define the same $id', () => {
      const tempDir1 = join(import.meta.dir, '../fixtures/tmp-collision-p1');
      const tempDir2 = join(import.meta.dir, '../fixtures/tmp-collision-p2');
      mkdirSync(tempDir1, { recursive: true });
      mkdirSync(tempDir2, { recursive: true });
      try {
        writeFileSync(
          join(tempDir1, '_shared.json'),
          JSON.stringify({
            $schema: 'https://json-schema.org/draft-07/schema#',
            $id: 'sctx://custom/_shared',
          }),
        );
        writeFileSync(
          join(tempDir2, '_shared.json'),
          JSON.stringify({
            $schema: 'https://json-schema.org/draft-07/schema#',
            $id: 'sctx://custom/_shared',
          }),
        );
        const targetPath = join(PLUGIN_SCHEMAS_DIR, 'plugin_schema.json');
        expect(() =>
          buildFullRegistry(targetPath, [
            { pluginName: 'sctx-custom', schemasDir: tempDir1 },
            { pluginName: 'sctx-other', schemasDir: tempDir2 },
          ]),
        ).toThrow(/already defined by plugin "sctx-custom"/);
      } finally {
        if (existsSync(tempDir1)) rmSync(tempDir1, { recursive: true, force: true });
        if (existsSync(tempDir2)) rmSync(tempDir2, { recursive: true, force: true });
      }
    });

    it('enforces sctx:// namespace matches plugin short name', () => {
      const tempDir = join(import.meta.dir, '../fixtures/tmp-ns-violation');
      mkdirSync(tempDir, { recursive: true });
      try {
        writeFileSync(
          join(tempDir, '_invalid_ns.json'),
          JSON.stringify({
            $schema: 'https://json-schema.org/draft-07/schema#',
            $id: 'sctx://different-name/_invalid',
          }),
        );
        const targetPath = join(PLUGIN_SCHEMAS_DIR, 'plugin_schema.json');
        expect(() => buildFullRegistry(targetPath, [{ pluginName: 'sctx-my-plugin', schemasDir: tempDir }])).toThrow(
          /Schema namespace violation: schema in plugin "sctx-my-plugin".*sctx:\/\/my-plugin\//,
        );
      } finally {
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('rejects local schema trying to declare an sctx:// $id', () => {
      const tempDir = join(import.meta.dir, '../fixtures/tmp-local-sctx-ns');
      mkdirSync(tempDir, { recursive: true });
      try {
        const localTarget = join(tempDir, 'custom.json');
        writeFileSync(
          localTarget,
          JSON.stringify({
            $schema: 'https://json-schema.org/draft-07/schema#',
            $id: 'sctx://my-custom/custom',
          }),
        );
        expect(() => buildFullRegistry(localTarget)).toThrow(
          /Schema namespace violation: local schema in ".*" uses \$id "sctx:\/\/my-custom\/custom"/,
        );
      } finally {
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('resolveSchemaPath', () => {
    it('resolves prefixed plugin schema with full plugin name synchronously', () => {
      const resolved = resolveSchemaPath('sctx-schema-plugin/plugin_schema.json', FIXTURES_DIR);
      expect(resolved).toBe(join(PLUGIN_SCHEMAS_DIR, 'plugin_schema.json'));
    });

    it('resolves prefixed plugin schema with short plugin name synchronously', () => {
      const resolved = resolveSchemaPath('schema-plugin/plugin_schema.json', FIXTURES_DIR);
      expect(resolved).toBe(join(PLUGIN_SCHEMAS_DIR, 'plugin_schema.json'));
    });

    it('resolves unprefixed schema name when provided by declared plugin', () => {
      const space = { name: 'test', path: FIXTURES_DIR, plugins: { 'sctx-schema-plugin': {} } };
      const resolved = resolveSchemaPath('plugin_schema.json', FIXTURES_DIR, space);
      expect(resolved).toBe(join(PLUGIN_SCHEMAS_DIR, 'plugin_schema.json'));
    });

    it('resolves bundled schema when no plugin matches', () => {
      const resolved = resolveSchemaPath('strategy_general.json', FIXTURES_DIR);
      expect(resolved).toContain('strategy_general.json');
      expect(existsSync(resolved)).toBe(true);
    });

    it('resolves explicit relative path relative to configDir', () => {
      const resolved = resolveSchemaPath('./test-schema.json', FIXTURES_DIR);
      expect(resolved).toBe(join(FIXTURES_DIR, 'test-schema.json'));
    });
  });

  describe('createSpaceContext with plugin schema', () => {
    it('resolves schema and compiles validator synchronously with plugin types', () => {
      const config: Config = {
        spaces: [
          {
            name: 'plugin-space',
            path: FIXTURES_DIR,
            schema: 'sctx-schema-plugin/plugin_schema.json',
          },
        ],
      };

      const context = createSpaceContext('plugin-space', config, { configDir: FIXTURES_DIR });

      expect(context.resolvedSchemaPath).toBe(join(PLUGIN_SCHEMAS_DIR, 'plugin_schema.json'));
      expect(context.schemaRefRegistry.has('sctx://schema-plugin/_test_partial')).toBe(true);
      expect(context.schema.metadata.hierarchy?.name).toBe('plugin_hierarchy');
      expect(context.schema.metadata.hierarchy?.levels.map((l) => l.type)).toEqual(['plugin_root', 'plugin_leaf']);

      // Validate node data with pluginField
      const validNode = {
        title: 'Root Node',
        type: 'plugin_root',
        pluginField: 'custom value',
      };
      expect(context.schemaValidator(validNode)).toBe(true);

      const invalidType = {
        title: 'Bad Node',
        type: 'nonexistent_type',
      };
      expect(context.schemaValidator(invalidType)).toBe(false);
    });

    it('works with short plugin prefix in schema path', () => {
      const config: Config = {
        spaces: [
          {
            name: 'plugin-space-short',
            path: FIXTURES_DIR,
            schema: 'schema-plugin/plugin_schema.json',
          },
        ],
      };

      const context = createSpaceContext('plugin-space-short', config, { configDir: FIXTURES_DIR });
      expect(context.resolvedSchemaPath).toBe(join(PLUGIN_SCHEMAS_DIR, 'plugin_schema.json'));
      expect(context.schemaRefRegistry.has('sctx://schema-plugin/_test_partial')).toBe(true);
    });
  });
});
