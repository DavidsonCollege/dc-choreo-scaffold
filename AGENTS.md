<!-- Agent instructions for working in dc-choreo-scaffold. Platform Engineering owns this file. CLAUDE.md imports it. This is not the AGENTS.md the package writes into apps; that one is in packages/create-choreo-app/templates/_base/. -->

# Agent instructions

This repository holds `@davidson/create-choreo-app`, the command line that starts every Choreo app, and `@davidson/choreo-layer`, the shared Nuxt layer. Davidson College Technology & Innovation's Platform Engineering team (PE) runs it. Every coding agent working here follows these rules.

## 1. No real data and no credentials, ever

**This repository is public.** Never put real data or a credential in it: not in templates, fixtures, tests, docs or commit messages.

- Fixtures and examples use made-up people (`Dana Example`, `daexample@davidson.edu`) and made-up offices.
- Tests that need something shaped like a credential build it at run time from pieces, so the file never holds one.
- If you find a real credential, stop and tell the person you're working with. It has to be rotated, because deleting it doesn't remove it from the history.

## 2. What's where

| Path | What it is |
|---|---|
| `packages/create-choreo-app/bin/` | The command line: reads flags, runs a subcommand, prints the result |
| `packages/create-choreo-app/src/` | The subcommands and the passport writer |
| `packages/create-choreo-app/src/manifest.json` | The exact versions a paved-road app starts with |
| `packages/create-choreo-app/src/schema/` | A copy of the passport schema from DavidsonChoreo/dc-choreo-workflows |
| `packages/create-choreo-app/templates/_base/` | The files every app gets, including PE's `AGENTS.md`, `CLAUDE.md` and CODEOWNERS block |
| `packages/create-choreo-app/test/` | The tests, with made-up answers in `fixtures/` |

## 3. The governance files are locked by hash

Every app's CI compares its `AGENTS.md` and `CLAUDE.md` with the hashes in dc-choreo-workflows `canonical/hashes.json`. To change either template:

1. Bump the version in the file's header comment.
2. Add the new file's hash (SHA-256 after converting line endings to LF) to `canonical/hashes.json` in dc-choreo-workflows, in a pull request there. It has to merge first; this repository's CI checks for it.
3. Add the old hash to `src/released.json`, so `verify` treats the old file as an earlier release rather than an edit.

## 4. Copies of files from dc-choreo-workflows

`src/schema/passport-v1.json` and `templates/_base/CODEOWNERS` are copies. Don't edit them here; copy the new version over when dc-choreo-workflows changes. CI's `sync` job fails when they differ.

## 5. Dependencies

- The command line has no runtime dependencies. It runs with `npx` on a builder's laptop, so everything it needs is Node's own library. Test-only tools go in `devDependencies`.
- Exact versions only, everywhere: in this repository's `package.json` files and in `src/manifest.json`. Never a range or `latest`.

## 6. Before opening a pull request

Run these. CI runs the same:

```
npm ci
npm test
```
