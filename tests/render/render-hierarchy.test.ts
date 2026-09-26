import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { executeRender } from '../../src/render/render';
import { makeSpaceContext } from '../helpers/context';

const MULTI_DIR = join(import.meta.dir, '..', 'fixtures/multi-hierarchy');
const context = makeSpaceContext(join(MULTI_DIR, 'space'), join(MULTI_DIR, 'selected-root.json'));

describe('rendering a selected hierarchy', () => {
  it('renders the main hierarchy by default', async () => {
    const [tree, other] = (await executeRender('markdown.bullets', context, {})).split('\n\n');
    expect(tree).toBe(['- goal: Ship v2', '  - task: Write docs'].join('\n'));
    expect(other?.split('\n').sort()).toEqual([
      '  - skill: Testing',
      '  - skill_area: Engineering',
      'Other (not in hierarchy):',
    ]);
  });

  it('renders the hierarchy named by the hierarchy option', async () => {
    const output = await executeRender('markdown.bullets', context, { hierarchy: '_skills-pack' });
    const [tree, other] = output.split('\n\n');
    expect(tree).toBe(['- skill_area: Engineering', '  - skill: Testing'].join('\n'));
    expect(other?.split('\n').sort()).toEqual([
      '  - goal: Ship v2',
      '  - task: Write docs',
      'Other (not in hierarchy):',
    ]);
  });

  it('fails for an unknown hierarchy name', async () => {
    await expect(executeRender('markdown.bullets', context, { hierarchy: 'missing' })).rejects.toThrow(
      'Unknown hierarchy: "missing". Available: work, _skills-pack',
    );
  });
});
