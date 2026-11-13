import { describe, expect, it } from 'bun:test';
import type { DeclaredPlugin } from '../../src/plugins/loader';
import type { StructuredContextPlugin } from '../../src/plugins/util';
import { buildFormatRegistry } from '../../src/render/registry';

function makePlugin(name: string, formats: { name: string; description: string }[]): DeclaredPlugin {
  const plugin: StructuredContextPlugin = {
    name,
    configSchema: { type: 'object' },
    render: {
      formats,
      render: () => '',
    },
  };
  return { plugin, rawConfig: {} };
}

describe('buildFormatRegistry', () => {
  it('returns empty registry for plugins with no render hook', () => {
    const loaded: DeclaredPlugin[] = [
      { plugin: { name: 'sctx-foo', configSchema: { type: 'object' } }, rawConfig: {} },
    ];
    expect(buildFormatRegistry(loaded)).toEqual([]);
  });

  it('builds qualified names stripping the sctx- prefix', () => {
    const loaded = [makePlugin('sctx-markdown', [{ name: 'bullets', description: 'Bullet list' }])];
    const registry = buildFormatRegistry(loaded);
    expect(registry).toHaveLength(1);
    expect(registry[0]!.qualifiedName).toBe('markdown.bullets');
    expect(registry[0]!.format.name).toBe('bullets');
    expect(registry[0]!.format.description).toBe('Bullet list');
  });

  it('collects formats from multiple plugins', () => {
    const loaded = [
      makePlugin('sctx-markdown', [
        { name: 'bullets', description: 'Bullet list' },
        { name: 'mermaid', description: 'Mermaid diagram' },
      ]),
      makePlugin('sctx-slides', [{ name: 'reveal', description: 'Reveal.js slides' }]),
    ];
    const registry = buildFormatRegistry(loaded);
    expect(registry).toHaveLength(3);
    expect(registry.map((r) => r.qualifiedName)).toEqual(['markdown.bullets', 'markdown.mermaid', 'slides.reveal']);
  });

  it('skips plugins without a render hook and includes those with one', () => {
    const loaded: DeclaredPlugin[] = [
      { plugin: { name: 'sctx-norender', configSchema: { type: 'object' } }, rawConfig: {} },
      ...[makePlugin('sctx-markdown', [{ name: 'bullets', description: 'Bullets' }])],
    ];
    const registry = buildFormatRegistry(loaded);
    expect(registry).toHaveLength(1);
    expect(registry[0]!.qualifiedName).toBe('markdown.bullets');
  });
});
