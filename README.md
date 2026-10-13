# dc-choreo-scaffold

The Choreo paved road for Davidson College builders, run by Technology & Innovation's Platform Engineering team. It holds two packages:

- `@davidson/create-choreo-app`, the command line that starts a hosted app and keeps Platform Engineering's files in it current
- `@davidson/choreo-layer`, the shared Nuxt layer every paved-road app extends

Both are released together, with one version, as GitHub Releases in this repository: the packed packages are attached, and each is attested, so anyone can check it was built by this repository's release workflow. There's no npm registry. The repository is public so builders can download them without signing in.

## The command line

The Choreo plugin runs it for the builder. It never asks a question, `--json` prints one result object, and the exit code is 0 when everything passed, 1 when a check failed or the command was refused, and 2 for a usage mistake.

| Command | What it does |
|---|---|
| `governance [dir] --tier pages\|container --answers answers.json` | Writes Platform Engineering's files and the passport into an app built some other way |
| `update [dir]` | Brings Platform Engineering's files to this version, without touching the builder's own |
| `verify [dir]` | Reports drift from this version, and anything that looks like a credential |
| `doctor` | Checks the laptop: Node, npm, git, the GitHub CLI and its sign-in, and reaching npm and GitHub |
| `create <name> --tier pages\|container --answers answers.json` | Starts a paved-road Nuxt app: the template, the passport and Platform Engineering's files |

To run it yourself, download a release, check it was built here, and run it with `npx` (replace `0.1.0` with the version you want):

```
gh release download v0.1.0 -R DavidsonCollege/dc-choreo-scaffold -p 'davidson-create-choreo-app-*.tgz'
gh attestation verify davidson-create-choreo-app-0.1.0.tgz --repo DavidsonCollege/dc-choreo-scaffold
npx --yes --package ./davidson-create-choreo-app-0.1.0.tgz create-choreo-app doctor
```

Name the file with `--package` and the command after it. The shorter `npx <file> doctor` silently does nothing when run inside a folder that has its own `package.json`.

To work on the package itself, run it from a clone: `node packages/create-choreo-app/bin/create-choreo-app.js doctor`.

## The lockfile new apps start from

A released command line carries the lockfile its own release installed and tested (`scripts/template-lockfile.mjs`). `create` writes it into the new app as `package-lock.json`, and the first install is `npm ci`, so every app starts from exactly the set of packages Platform Engineering tested, rather than whatever npm resolves that day. Run from a clone, there's no lockfile and the first install is `npm install`. Releasing regularly keeps that tested set current.

## Releasing

Set the same new version in both packages' `package.json`, merge that to `main`, then push a tag `v<version>` on the merged commit. `.github/workflows/release.yml` checks the tag matches both versions, runs the tests, packs the layer, makes and tests the lockfile new apps start from, packs the command line with it, attests both, and creates the release. The layer's release URL in `packages/create-choreo-app/src/manifest.json` follows the same version, so apps made with a version install that version's layer.

## The layer

`packages/choreo-layer` reads the app's `PASSPORT.yml` when the app builds:

- Every page gets `lang="en"`, a title, and `noindex` when the passport says the app isn't indexable.
- A Pages site without a custom domain is built for `https://davidsonchoreo.github.io/<app>/`.
- `robots.txt` always allows crawling; an indexable site also gets `sitemap.xml`.
- A container app gets `/health`, answered without sign-in, and an `X-Robots-Tag: noindex` header when it isn't indexable.
- A container app gets the security guard on `/api`, and `requireUser`, `requireRole` and `auditLog` for its handlers. How to use them: [packages/choreo-layer/README.md](packages/choreo-layer/README.md).
- Tailwind, the brand tokens, and the shared header and footer. The brand colors are placeholders until College Communications' values are in.

## The governance files

The package writes these into every app, from `packages/create-choreo-app/templates/_base/`:

| File | Who edits it | What it holds |
|---|---|---|
| `AGENTS.md` | Platform Engineering only, through the package's update command | The rules every coding agent follows in a Choreo app |
| `CLAUDE.md` | Platform Engineering only, the same way | One line that imports `AGENTS.md`, so Claude Code loads it in every session |
| `BUILDER.md` | The builder, and Claude on their behalf | The app's own building notes. `AGENTS.md` imports it |
| `.github/CODEOWNERS` | The builder above Platform Engineering's block; PE's block is PE's | Makes PE's approval required for changes to the passport, `AGENTS.md` and `CLAUDE.md` |

`AGENTS.md` and `CLAUDE.md` are identical in every app, so CI compares each copy with the canonical one, and an edited copy fails. `BUILDER.md` starts from this template and then belongs to the app.
