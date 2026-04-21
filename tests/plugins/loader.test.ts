import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { loadPlugins } from '../../src/plugins/loader';

// configDir points at tests/fixtures/ so convention resolution looks in tests/fixtures/plugins/
const CONFIG_DIR = join(import.meta.dir, '../fixtures');

describe('loadPlugins', () => {
  describe('built-in plugins', () => {
    it('always includes built-in plugins when no map is given', async () => {
      const loaded = await loadPlugins({}, CONFIG_DIR);
      expect(loaded).toHaveLength(3);
      expect(loaded.map((l) => l.plugin.name)).toContain('sctx-markdown');
      expect(loaded.map((l) => l.plugin.name)).toContain('sctx-mermaid');
      expect(loaded.map((l) => l.plugin.name)).toContain('sctx-miro');
      expect(loaded.find((l) => l.plugin.name === 'sctx-markdown')!.pluginConfig).toEqual({});
      expect(loaded.find((l) => l.plugin.name === 'sctx-mermaid')!.pluginConfig).toEqual({});
      expect(loaded.find((l) => l.plugin.name === 'sctx-miro')!.pluginConfig).toEqual({});
    });

    it('built-in plugins come after external plugins', async () => {
      const loaded = await loadPlugins({ 'sctx-null-plugin': {} }, CONFIG_DIR);
      expect(loaded[0]!.plugin.name).toBe('sctx-null-plugin');
      expect(loaded.map((l) => l.plugin.name)).toContain('sctx-markdown');
      expect(loaded.map((l) => l.plugin.name)).toContain('sctx-mermaid');
    });

    it('passes config from map to built-in plugin when declared by full name', async () => {
      const mdConfig = { templateDir: '/some/dir', templatePrefix: 'tmpl-' };
      const loaded = await loadPlugins({ 'sctx-markdown': mdConfig }, CONFIG_DIR);
      expect(loaded.find((l) => l.plugin.name === 'sctx-markdown')!.pluginConfig).toMatchObject(mdConfig);
    });

    it('passes config from map to built-in plugin when declared by short name', async () => {
      const mdConfig = { templateDir: '/some/dir', templatePrefix: 'tmpl-' };
      const loaded = await loadPlugins({ markdown: mdConfig }, CONFIG_DIR);
      expect(loaded.find((l) => l.plugin.name === 'sctx-markdown')!.pluginConfig).toMatchObject(mdConfig);
    });

    it('rejects invalid built-in plugin config against configSchema', async () => {
      await expect(loadPlugins({ markdown: { templateDir: 123 as unknown as string } }, CONFIG_DIR)).rejects.toThrow(
        'Invalid config for plugin "sctx-markdown"',
      );
    });

    it('resolves format:path fields in built-in config relative to configDir', async () => {
      const loaded = await loadPlugins({ markdown: { templateDir: 'my-templates' } }, CONFIG_DIR);
      const cfg = loaded.find((l) => l.plugin.name === 'sctx-markdown')!.pluginConfig;
      expect(cfg.templateDir).toBe(join(CONFIG_DIR, 'my-templates'));
    });
  });

  describe('external plugins', () => {
    it('resolves plugin by name from config-adjacent plugins/ directory', async () => {
      const loaded = await loadPlugins({ 'sctx-null-plugin': {} }, CONFIG_DIR);
      expect(loaded.some((l) => l.plugin.name === 'sctx-null-plugin')).toBe(true);
    });

    it('also resolves short name for external plugins', async () => {
      const loaded = await loadPlugins({ 'null-plugin': {} }, CONFIG_DIR);
      expect(loaded.some((l) => l.plugin.name === 'sctx-null-plugin')).toBe(true);
    });

    it('rejects names that cannot be prefixed to a valid sctx- name and are not resolvable', async () => {
      await expect(loadPlugins({ 'sctx-nonexistent': {} }, CONFIG_DIR)).rejects.toThrow();
    });

    it('throws when plugin module lacks a name string', async () => {
      await expect(loadPlugins({ 'sctx-invalid-plugin': {} }, CONFIG_DIR)).rejects.toThrow(
        'must export a StructuredContextPlugin',
      );
    });

    it('passes pluginConfig to external plugins', async () => {
      const config = { someOption: 'value' };
      const loaded = await loadPlugins({ 'sctx-null-plugin': config }, CONFIG_DIR);
      expect(loaded[0]!.pluginConfig).toMatchObject(config);
    });
  });
});
