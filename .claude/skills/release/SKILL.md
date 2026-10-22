---
name: release
description: Cut an npm release for the structured-context project. Use when the user asks to cut a release, publish a new version, or run /release <major|minor|patch>.
---

## Task

Cut a **$ARGUMENTS** release (major, minor, or patch).

1. Verify the branch is `main` and working tree is clean. If not, stop and tell the user. `bun pm version` also refuses untracked files: if there are any, run `git stash push --include-untracked` before step 2 and `git stash pop` after it, whether step 2 passes or fails.

2. Bump the version — this automatically runs lint, tests and the packed-package test (`test:package`), commits, and pushes with tags:
   ```
   bun pm version $ARGUMENTS
   ```
   If any check fails, stop and report the errors.

3. Tell the user to run these commands in their terminal to complete the release (npm requires browser-based authentication that Claude cannot handle):
   ```
   npm login && npm publish
   ```

4. Once the user confirms publish succeeded, wait for the registry to serve the new version (it can take a few minutes), polling for up to 5 minutes:
   ```
   v=$(jq -r .version package.json)
   for i in $(seq 20); do [ "$(npm view structured-context@$v version 2>/dev/null)" = "$v" ] && break; sleep 15; done
   npm view structured-context dist-tags
   ```
   If `latest` is not the new version after 5 minutes, stop and tell the user.

5. Update the global install and smoke test it:
   ```
   bun add -g structured-context@latest
   sctx --version
   sctx plugins >/dev/null && sctx docs concepts >/dev/null && echo ok
   ```
   `sctx --version` must print the new version. Report the results to the user. If the installed CLI fails, tell the user to deprecate the version (`npm deprecate structured-context@<version> "<reason>"`) and fix forward with a patch release.
