---
name: release
description: Cut an npm release for the ost-tools project. Use when the user asks to cut a release, publish a new version, or run /release <major|minor|patch>.
---

## Task

Cut a **$ARGUMENTS** release (major, minor, or patch).

1. Verify the branch is `main` and working tree is clean. If not, stop and tell the user.

2. Bump the version — this automatically runs lint, tests, commits, and pushes with tags:
   ```
   bun pm version $ARGUMENTS
   ```
   If lint or tests fail, stop and report the errors.

3. Tell the user to run these commands in their terminal to complete the release (npm requires browser-based authentication that Claude cannot handle):
   ```
   npm login && npm publish
   ```

4. Once the user confirms publish succeeded, verify it's live by running:
   ```
   npm view ost-tools version
   bunx ost-tools@latest --version
   ```
   The first confirms the registry has the new version. The second confirms the published package runs correctly. Report both results to the user.
