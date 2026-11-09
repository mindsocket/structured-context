/**
 * plugin/hooks/projection.js and the core types in plugin/types/index.d.ts are generated and committed,
 * since the plugin installs from the repository unbuilt.
 */

import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildModProjection, buildModTypes, MOD_TYPES_FILE, PROJECTION_FILE } from '../../scripts/build-mod-projection';

it('plugin/hooks/projection.js matches its sources (run `bun run build:mod-projection`)', async () => {
  expect(readFileSync(PROJECTION_FILE, 'utf-8')).toBe(await buildModProjection());
});

it('the core types in plugin/types/index.d.ts match core (run `bun run build:mod-projection`)', async () => {
  expect(readFileSync(MOD_TYPES_FILE, 'utf-8')).toBe(await buildModTypes());
});
