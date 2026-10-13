// The Choreo guard, for a container app. Runs on every request:
// - gives the request an id, returned as X-Request-Id
// - adds X-Robots-Tag: noindex when the app isn't indexable
// - for /api/**, checks where the request came from, the token and the role,
//   and turns the request away with 401, 403 or 503 when it fails
//
// Pages aren't checked here: the platform's sign-in protects them, and the
// app's checks open / without signing in. The decisions are in
// lib/security.js; utils.ts shares the result with requireUser.
import { createError, defineEventHandler, setResponseHeader } from 'h3'
import security from '#choreo/security'
import { isApiPath } from '../../lib/security.js'
import { DENIED, checkRequest, requestIdOf } from './utils'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'X-Request-Id', requestIdOf(event))
  if (!security.indexable) setResponseHeader(event, 'X-Robots-Tag', 'noindex')

  if (!isApiPath(event.path)) return
  const result = await checkRequest(event)
  if (result.outcome === 'deny') throw createError({ statusCode: result.status, message: DENIED[result.reason] ?? '' })
})
