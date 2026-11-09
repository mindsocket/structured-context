import type { Config } from '../../src/config';
import { readSpace } from '../../src/read/read-space';
import { createSpaceContext } from '../../src/space-context';
import type { SpaceContext } from '../../src/types';
import {
  fileNotInSpace,
  type RunOptions,
  resolveFileSpace,
  validateNodes,
  validateResolvedFileWith,
} from '../../src/validate';

/**
 * `validateSpace` with the judge and rule filter already built, so a test can supply its own
 * `FakeJudgeProvider` (and read its call history). The public options only accept config-derived ones.
 */
export async function validateSpaceWith(context: SpaceContext, runOptions: RunOptions = {}) {
  const read = await readSpace(context);
  return validateNodes(context, read.nodes, read, runOptions);
}

/** `validateFile` with the options already built; see {@link validateSpaceWith}. */
export async function validateFileWith(filePath: string, config: Config, options: RunOptions & { configDir?: string }) {
  const { configDir, ...runOptions } = options;
  const resolved = resolveFileSpace(filePath, config);
  if (!resolved) return fileNotInSpace(filePath);
  const context = createSpaceContext(resolved.space.name, config, { configDir });
  return validateResolvedFileWith(filePath, resolved.label, context, runOptions);
}
