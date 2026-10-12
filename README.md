# dc-choreo-scaffold

The Choreo paved road for Davidson College builders, run by Technology & Innovation's Platform Engineering team. It will publish two packages: `@davidson/create-choreo-app`, which scaffolds a hosted app, and `@davidson/choreo-layer`, the shared Nuxt layer.

The packages are being built. What's here now are the governance files the package writes into every app, in `packages/create-choreo-app/templates/_base/`:

| File | Who edits it | What it holds |
|---|---|---|
| `AGENTS.md` | Platform Engineering only, through the package's update command | The rules every coding agent follows in a Choreo app |
| `CLAUDE.md` | Platform Engineering only, the same way | One line that imports `AGENTS.md`, so Claude Code loads it in every session |
| `BUILDER.md` | The builder, and Claude on their behalf | The app's own building notes. `AGENTS.md` imports it |

`AGENTS.md` and `CLAUDE.md` are identical in every app, so CI compares each copy with the canonical one, and an edited copy fails. `BUILDER.md` starts from this template and then belongs to the app.

The repository is public so npm can publish the packages with provenance.
