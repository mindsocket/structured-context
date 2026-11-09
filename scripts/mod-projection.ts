/**
 * The projection code the plugin's Claude Code mod runs in its pane. A hooks module can't import
 * packages, so `build-mod-projection.ts` bundles this into `plugin/hooks/projection.js`.
 */
export { annotationsFrom, buildTree, worstSeverity } from 'structured-context-map-views';
export { spaceGraphFrom } from '../src/browser';
