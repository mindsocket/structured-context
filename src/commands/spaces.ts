import { basename, resolve } from 'node:path';
import { hasBlockingProblem, inspectConfig } from '../config/health';
import { addSpace } from '../config/write';
import { SctxError } from '../errors';

function renderConfigValue(v: unknown): string {
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return String(v);
}

export function listSpaces(options: { json?: boolean } = {}): void {
  const { health, config } = inspectConfig();
  if (options.json) {
    console.log(JSON.stringify(health));
    if (hasBlockingProblem(health)) process.exitCode = 1;
    return;
  }
  const path = resolve(health.config.path);
  if (health.problems.length > 0) {
    console.log(`Config: ${path} (${health.config.source}${health.config.exists ? '' : ', not found'})\n`);
    for (const p of health.problems) {
      console.log(`${p.severity.toUpperCase()} ${p.code}: ${p.message}`);
      if (p.fix) console.log(`  fix: ${p.fix}`);
    }
    console.log('');
    if (hasBlockingProblem(health)) process.exitCode = 1;
  }
  if (!config) return;
  if (health.problems.length === 0) console.log(`Config: ${path} (${health.config.source})\n`);
  for (const space of config.spaces) {
    console.log(`${space.name}`);
    console.log(`  path:    ${space.path}`);
    const schema = space.schema ?? config.schema;
    console.log(`  schema:  ${schema ? basename(schema) : '(none)'}`);
    const plugins = space.plugins ?? {};
    if (Object.keys(plugins).length > 0) {
      console.log('  plugins:');
      for (const [name, cfg] of Object.entries(plugins)) {
        const entries = Object.entries(cfg);
        if (entries.length === 0) {
          console.log(`    ${name}`);
        } else {
          console.log(`    ${name}:`);
          for (const [k, v] of entries) {
            console.log(`      ${k}: ${renderConfigValue(v)}`);
          }
        }
      }
    }
    console.log('');
  }
}

export function addSpaceCommand(
  name: string,
  path: string,
  options: { schema?: string; global?: boolean; json?: boolean },
): void {
  try {
    const result = addSpace({ name, path, schema: options.schema, global: options.global });
    if (options.json) {
      console.log(JSON.stringify(result));
      return;
    }
    console.log(`${result.created ? 'Created' : 'Updated'} ${result.configPath}`);
    console.log(`Added space "${result.space.name}" (path: ${result.space.path})`);
  } catch (err) {
    if (!(err instanceof SctxError)) throw err;
    const hint = err.code === 'E_TARGET_REQUIRED' ? ' Use --config <folder>/.sctx.json or --global.' : '';
    if (options.json) console.log(JSON.stringify({ error: { code: err.code, message: err.message + hint } }));
    else console.error(`${err.code}: ${err.message}${hint}`);
    process.exitCode = 1;
  }
}
