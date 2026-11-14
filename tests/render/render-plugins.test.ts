import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { renderList } from '../../src/commands/render';
import { executeRender } from '../../src/render/render';
import { makeSpaceContext } from '../helpers/context';

// The space's config root holds .sctx/plugins/, which no space declares.
const context = makeSpaceContext(join(import.meta.dir, '..', 'fixtures/render-plugins/space'));

describe('render with discovered plugins', () => {
  it('renders a format from a plugin the space does not declare', async () => {
    const output = JSON.parse((await executeRender('probe.callbacks', context, {})) as string);
    expect(output.nodes).toEqual(['Grow', 'Missing status']);
    expect(output.issues).toContainEqual({ severity: 'error', nodeId: 'Missing status.md' });
  });

  it('lists resource folders from config roots and plugins', async () => {
    const output = JSON.parse((await executeRender('probe.callbacks', context, {})) as string);
    expect(output.mapViews).toEqual([{ dir: '.sctx' }, { dir: 'sctx-views', plugin: 'views' }]);
  });

  it('exports the filtered graph', async () => {
    const output = JSON.parse(
      (await executeRender('probe.callbacks', context, { filter: "WHERE status = 'exploring'" })) as string,
    );
    expect(output.nodes).toEqual(['Grow']);
  });

  it("validates a plugin's config only when its format is rendered", async () => {
    await expect(executeRender('needs-config.out', context, {})).rejects.toThrow(
      'Invalid config for plugin "sctx-needs-config"',
    );
  });

  it('lists formats from discovered plugins', async () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string) => lines.push(line);
    try {
      await renderList(context);
    } finally {
      console.log = log;
    }
    expect(lines.map((l) => l.trim().split(/\s+/)[0])).toEqual(
      expect.arrayContaining(['probe.callbacks', 'needs-config.out']),
    );
  });
});
