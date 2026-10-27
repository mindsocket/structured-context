# Troubleshooting by error code

Error output from `sctx spaces`, the session start check and the hooks already says what is wrong and a fix.
This adds only what the message does not. After fixing, re-check with `sctx spaces --json`; `problems` should be
empty or `info` only. Hooks pick up a fixed config on the next prompt. A missing tool needs a new session.

| Code | Beyond the message |
|---|---|
| `E_NO_BUN` | `command -v bun`. Install from https://bun.sh |
| `E_SCTX_UNAVAILABLE` | Run `sctx --version` and `bunx structured-context --version` and read the error. First use of `bunx` needs the network |
| `E_SCTX_OUTDATED` | The major.minor of `sctx --version` should match the plugin's version in `plugin/.claude-plugin/plugin.json` |
| `E_CONFIG_NOT_FOUND` | At `info` level, nothing is set up: use the setup-space skill. As an error, `--config` or `$SCTX_CONFIG` points at a missing file: correct the path or unset the variable |
| `E_TARGET_REQUIRED` | Ask where the config belongs. Usually `--config <folder holding the notes>/.sctx.json`; `--global` only if the user asks |
| `E_HOOK_FAILED` | A hook crashed and was skipped. Set `SCTX_DEBUG=1` for the session, or run the same `sctx` command by hand. Usually a problem with its own code above |

Other codes (`E_CONFIG_INVALID`, `E_INCLUDE_NOT_FOUND`, `E_NO_SPACES`, `E_SPACE_PATH_MISSING`, `E_SCHEMA_*`,
`E_SPACE_EXISTS`, `E_CONFIG_NEEDS_MANUAL_EDIT`) carry their fix in the message. Do not edit the user's notes to
get around a setup problem.

If edits are not being checked and nothing says why, run `sctx spaces --json` from the session's folder. A config
that is only in a folder below it will not be found.
