# @davidson/choreo-layer

The shared Nuxt layer every paved-road Choreo app extends. It reads the app's `PASSPORT.yml` when the app builds and sets the app up to match: the Davidson header and footer, brand tokens, page language and title, robots and sitemap handling, and, for a container app, `/health` and the security guard described below.

This page is for builders and the AI agents working with them.

## Security in a container app

A Pages site has no server, so this section is only about container apps.

### What protects what

- **Pages** are protected by the platform's sign-in, which Platform Engineering sets up when the app is hosted. Anyone who isn't signed in is sent to Davidson's sign-in page before they reach the app.
- **Everything under `/api/`** is also checked by the layer, on every request:
  - The request has to carry the person's signed Microsoft token. The layer checks the signature itself; it never trusts a header that just says who someone is.
  - The person has to hold at least one of the roles in the passport's `roles`.
  - A request that changes data (anything but GET, HEAD and OPTIONS) has to come from the app's own pages, so another website can't act for a signed-in person.

  A request that fails gets `401` (not signed in), `403` (no access, or from another site) or `503` (sign-in isn't set up yet).

So: **put anything that reads or changes data under `server/api/`.**

### The helpers

These are available in every server file without an import.

```ts
// server/api/grades.get.ts
export default defineEventHandler(async (event) => {
  const user = await requireRole(event, 'registrar')   // or requireUser(event) for anyone signed in
  const grades = await loadGrades(user.id)
  auditLog(event, { action: 'grades.read', resource: 'grades' })
  return grades
})
```

- `requireUser(event)` gives the signed-in person: `{ id, email, name, roles }`. `roles` holds only the passport's roles.
- `requireRole(event, ...roles)` does the same, and answers `403` unless the person holds at least one of the roles. Roles come from `PASSPORT.yml`, so a misspelled role is a type error.
- `auditLog(event, { action, resource, outcome? })` writes one audit line for something the app did, such as `grade.update` on `course HIS-101`. The layer already writes a line for every `/api` request and every refusal, so use this for the app's own actions.

Call `requireUser` or `requireRole` in every handler that reads or changes data, even though the guard has already checked the request. They check it themselves if it hasn't been checked, so the handler stays safe wherever it lives.

### Errors

- An `/api` error answers with `{ statusCode, message, requestId }` and nothing else. A server error (5xx) always says only that something went wrong, with the reference id; the full error goes to the server log, with anything that looks like a credential hidden.
- For a validation problem, throw a 422 with a message the person can act on:
  ```ts
  throw createError({ statusCode: 422, message: 'The date must be in the future.' })
  ```
  The message is kept, up to 200 characters. Don't put personal data in it.
- Errors on pages show the app's `error.vue` as usual.

### Getting data while a page renders on the server

Use `useFetch`, or `useRequestFetch()` inside `useAsyncData`. They pass the person's sign-in along. A plain `$fetch('/api/...')` while the page renders on the server doesn't, and gets `401`.

### Working locally

`nuxt dev` signs you in as a made-up person, Dana Example, so you can work without Microsoft sign-in. To test what someone without access sees, set `NUXT_CHOREO_DEV_ROLES`:

- unset: every role in the passport
- `none`: no roles, so every `/api` request answers `403`
- a comma-separated list, such as `viewer,registrar`: just those

Dana Example exists only in `nuxt dev`; a production build doesn't contain it.

Debug and test routes go in files ending in `.dev.ts`, such as `server/api/seed.dev.ts`. Nitro leaves them out of production builds.

### Warnings you might see

`nuxt dev` and `nuxt build` warn, without stopping, about server code outside the guard. Each one is flagged for review when you ask to publish:

- **A route outside `/api`** (`server/routes/`). Move it under `server/api/`, or call `requireUser` or `requireRole` in it.
- **Server middleware** (`server/middleware/`). It runs before the guard on every request, so it must never return data or answer a request itself.
- **A server component** (`*.server.vue`). Nuxt serves it outside `/api`. Fetch data through `server/api/` instead.
- **CORS turned on** in `routeRules`. A Choreo app answers only its own pages; the layer never sets CORS headers.

### Don'ts

- Never put a token, password or key in a URL, a log line, an error message or an audit entry.
- Never log request headers. On a hosted app, the `X-MS-TOKEN-*` headers carry the person's sign-in tokens, and a log of every header would copy them into the platform's logs. To debug a request, use its request id and the audit lines the layer writes.
- Don't put personal data, request bodies or tokens in `auditLog`. Name the action and the resource.
- Don't change the layer's security settings in `nuxt.config.ts`. Ask Platform Engineering if the app needs something different.

## Settings the platform provides

A hosted container app gets these from Platform Engineering; you don't set them.

| Setting | What it is |
|---|---|
| `NUXT_CHOREO_ENTRA_TENANT_ID` | Davidson's Microsoft tenant |
| `NUXT_CHOREO_ENTRA_CLIENT_ID` | The app's own registration |

Without them the app still starts, `/health` and the pages work, and every `/api` request answers `503`.
