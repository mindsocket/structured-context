import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import plugin from 'sctx-map-views';
import { mapViewsPlugin } from '../../src/plugins/map-views';
import { executeRender } from '../../src/render/render';
import { makeSpaceContext } from '../helpers/context';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sctx-map-views-'));
  mkdirSync(join(dir, 'space'));
  writeFileSync(join(dir, 'space', 'Vision.md'), '---\ntype: vision\n---\n# Vision\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('built-in map-views plugin', () => {
  it('offers the formats of the package it imports on render', () => {
    expect(mapViewsPlugin.render!.formats).toEqual(plugin.render!.formats);
  });

  it('renders a space to one HTML page', async () => {
    const page = (await executeRender('map-views.html', makeSpaceContext(join(dir, 'space')), {})) as string;
    const snapshots = JSON.parse(/id="sctx-snapshots">(.*?)<\/script>/s.exec(page)![1]!);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].graph.nodes).toHaveLength(1);
    expect(snapshots[0].definitions.map((d: { id: string }) => d.id)).toContain('sctx-map-view://core/strategy-tree');
  });
});
