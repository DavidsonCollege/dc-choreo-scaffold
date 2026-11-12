<!-- Choreo governance file, version 3. Platform Engineering owns this file, and the package's update command rewrites it. An edited copy fails CI. Put this repository's own notes in BUILDER.md. -->

# Agent instructions

This repository is a Davidson College app hosted on Choreo, the platform run by Technology & Innovation's Platform Engineering team (PE). Every coding agent working here follows these rules. PE owns this file. This repository's own notes live in `BUILDER.md`, which the builder and you keep current.

## 1. Read the passport first

`PASSPORT.yml` at the repository root says what this app is, who owns it, what data it holds and where it is hosted. Read it before you change anything. When a request contradicts it, such as adding a login to a Pages site or storing records in an app whose passport says it writes none, stop and tell the builder.

## 2. Keep the passport current

When a change makes the passport untrue, update the passport in the same change and tell the builder what you changed. PE approves every passport change. A change to any of these fields also re-runs the ready call, so Information Security and College Communications review the app again:

- `profile.data_classification` and `profile.tier`
- `audience_scope`, `brand`, `indexable` and `custom_domain`
- `integrations`, `llm`, `roles` and `regulations`

List every platform the app connects to in `integrations` by name, such as Slate or Workday, never by hostname. List any LLM provider in `llm`.

## 3. Dependencies

- Install exact versions only. Never install `latest` or a version range.
- Keep the lockfile committed. CI installs with `npm ci`.
- Add a dependency only when the builder can explain why the app needs it, and remove dependencies the app no longer uses.

## 4. The road

When the passport says `road: paved`:

- Use `@davidson/choreo-layer` for the header, footer, brand tokens and robots handling.
- Use the layer's security helpers: the server-side token and role check, the audit log helper, the CORS default and the error responses.

When it says `road: non-paved`, follow the passport and these rules in the app's own stack, and tell the builder when the stack makes a rule hard to meet.

On either road, leave PE's files alone: this file, `CLAUDE.md` and the deploy workflow in `.github/workflows/`. A changed copy fails CI.

## 5. No real data in the repository

The repository's history becomes public when the app goes live, and deleting a file doesn't remove it from the history. Never commit real data or anything derived from it: database exports, sample records, screenshots of real screens, log excerpts or internal hostnames. Use made-up data for fixtures, seeds and tests. If the builder shares real data in the conversation, use it only to understand its shape, and write made-up data in its place.

## 6. Credentials: 1Password on a laptop, the key vault in production

A credential is a password, API key, token, connection string, certificate or private key. It lives in exactly one of two places, and nowhere else.

- **In production,** the app reads its secrets at runtime from its own key vault through its managed identity, which PE sets up. Production credentials live only there.
- **On the builder's computer,** a credential for development lives only in a 1Password Environment, mounted at the app's `.env` path. 1Password fills that file when the app reads it, so the value is never written to disk. Set it up with the 1Password plugin's `1password-environments` skill: create the Environment, then mount it. The builder types the values into the 1Password app.
- **Keep the two in step.** Both hold the same secrets under the same names, listed without values in `.env.example`. A variable maps to the vault secret of the same name in lower kebab case: `CANVAS_TOKEN` is `canvas-token`. When a secret is added, renamed or removed on one side, change the other too. PE sets the key vault side, so tell the builder to ask PE.

Never ask for, accept, hold or use a credential yourself. That includes this conversation. If the builder pastes one, don't use it or repeat it, and tell them it has to be rotated, because it has left the one place it belonged. Never read the mounted `.env`; ask the 1Password skill for the names instead. Never put a secret anywhere else: code, configuration, a plaintext `.env` file, test fixtures, logs, error messages, browser storage, commit messages or `BUILDER.md`. If you find one in the repository, stop and tell the builder. It has to be rotated, because deleting it doesn't remove it from the history.

## 7. Ask before anything you can't undo

Get the builder's explicit approval before you change a database schema, delete data or deploy.

## 8. Sign-in and authorization

- Sign-in is Entra ID, enforced by the platform. Never build a login form, a password store or a session system of your own.
- Check authorization on the server for every request that reads or changes data, using the layer's token and role check. Hiding a button doesn't stop a request.
- Use the app roles listed in the passport's `roles`.

## Getting help

When the builder is stuck, or a request goes beyond these rules, offer to bring in Platform Engineering through the Choreo plugin's escalate skill.

## This repository's notes

Read `BUILDER.md` for notes specific to this app.

@BUILDER.md
