# dc-choreo-scaffold

The Choreo paved road for Davidson College builders, run by Technology & Innovation's Platform Engineering team. It holds two packages:

- `@davidson/create-choreo-app`, the command line that starts a hosted app and keeps Platform Engineering's files in it current
- `@davidson/choreo-layer`, the shared Nuxt layer every paved-road app extends

Neither is released yet. Releases will be GitHub Releases in this repository, with the packed packages attached; there's no npm registry. The repository is public so builders can download them without signing in.

## The command line

The Choreo plugin runs it for the builder. It never asks a question, `--json` prints one result object, and the exit code is 0 when everything passed, 1 when a check failed or the command was refused, and 2 for a usage mistake.

| Command | What it does |
|---|---|
| `governance [dir] --tier pages\|container --answers answers.json` | Writes Platform Engineering's files and the passport into an app built some other way |
| `update [dir]` | Brings Platform Engineering's files to this version, without touching the builder's own |
| `verify [dir]` | Reports drift from this version, and anything that looks like a credential |
| `doctor` | Checks the laptop: Node, npm, git, the GitHub CLI and its sign-in, and reaching npm and GitHub |
| `create <name> --tier pages\|container --answers answers.json` | Starts a paved-road Nuxt app: the template, the passport and Platform Engineering's files |

Until the first release, run it from a clone:

```
node packages/create-choreo-app/bin/create-choreo-app.js doctor
```

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
