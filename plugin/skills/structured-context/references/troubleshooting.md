# Troubleshooting by error code

Messages from `sctx spaces`, the session start check and the hooks carry a code. Find it here, run the
diagnosis, make the fix with the user, then re-check with `sctx spaces --json` (an empty `problems` list, or
only `info`, is healthy). Hooks pick up a fixed config on the next prompt; a missing tool needs a new session.

Tell the user what you found and what you changed. Do not edit the user's notes to get around a setup problem.

| Code | Meaning | Diagnose | Fix |
|---|---|---|---|
| `E_NO_BUN` | Bun is not installed or not on the PATH, so the hooks cannot run | `command -v bun` | Install from https://bun.sh, then start a new session |
| `E_SCTX_UNAVAILABLE` | The `sctx` command could not be run (not installed and `bunx` failed, or no network on first use) | `sctx --version`; `bunx structured-context --version` and read the error | Install with `bun install -g structured-context`, or restore the network. Then start a new session |
| `E_SCTX_OUTDATED` | The installed `sctx` is older than the plugin expects | `sctx --version` against the plugin version in `plugin/.claude-plugin/plugin.json` (major.minor should match) | `bun install -g structured-context@latest`, then start a new session |
| `E_CONFIG_NOT_FOUND` | No config for this folder. At `info` level this is just "not set up yet". As an error, an explicit `--config` or `$SCTX_CONFIG` points at a missing file | `sctx spaces`; `echo $SCTX_CONFIG` | Not set up: use the setup-space skill. Missing explicit file: correct the path or unset the variable |
| `E_CONFIG_INVALID` | The config file is not valid JSON, or breaks the config rules | The message names the file. Read it | Fix the syntax or the named field; `sctx docs config` describes the shape |
| `E_INCLUDE_NOT_FOUND` | `includeSpacesFrom` lists a file that does not exist | The message names the path | Correct the path, or remove the entry. A leading `~` is expanded |
| `E_NO_SPACES` | The config loads but defines no spaces | `sctx spaces` | Add one with the setup-space skill |
| `E_SPACE_PATH_MISSING` | A space's folder or file was moved or deleted | The message names the space and path; `ls` the parent | Update `path` in the config (relative to the config file), or remove the space |
| `E_SCHEMA_MISSING` | A space has no schema, and the config has no top-level `schema` | `sctx spaces` | Set `schema` on the space |
| `E_SCHEMA_NOT_FOUND` | The schema name or path does not resolve | `sctx schemas list` for bundled names; a relative path resolves against the config file | Correct the name or path |
| `E_SCHEMA_INVALID` | The schema file does not parse | Open the file named in the message | Fix the syntax; see `schema-authoring.md` |
| `E_TARGET_REQUIRED` | `sctx spaces add` found no local config, or only the global one, and will not guess where to write | Read the message | Ask where it belongs. Usually `--config <folder holding the notes>/.sctx.json`; `--global` only if the user asks |
| `E_SPACE_EXISTS` | The target config already has a space with that name | `sctx spaces` | Choose another name |
| `E_CONFIG_NEEDS_MANUAL_EDIT` | The config has comments or trailing commas that rewriting would remove | The message includes the entry to add | Add the entry by hand |
| `E_HOOK_FAILED` | A hook crashed. The step was skipped and the turn was not blocked | Re-run with `SCTX_DEBUG=1` set for the session, or run the same `sctx` command by hand | Usually a CLI or config problem that has its own code above; otherwise report it |

## Hooks are silent

If edits are not being checked and nothing says why: `sctx spaces --json` from the session's folder. A config
that is found nowhere above that folder is the usual reason, because discovery only walks up. Start the session
inside the folder that holds the config.
