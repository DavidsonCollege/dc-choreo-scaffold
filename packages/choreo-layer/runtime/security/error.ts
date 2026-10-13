// The Choreo error handler, for a container app. Nitro runs it first, ahead
// of Nuxt's own (lib/module.ts puts it at the front of the list).
//
// - /api/**: answers with { statusCode, message, requestId } and nothing else.
//   A server error gets a generic message with the reference id; the full
//   error, redacted, goes to the server log.
// - Pages: redacts the message and stack in place, then leaves the response
//   to Nuxt, which renders error.vue as usual.
import type { NitroErrorHandler } from 'nitropack/types'
import { send, setResponseHeaders, setResponseStatus } from 'h3'
import security from '#choreo/security'
import { errorResponse, isApiPath, redact } from '../../lib/security.js'
import { requestIdOf } from './utils'

export default <NitroErrorHandler> async function choreoErrorHandler(error, event) {
  if (!isApiPath(event.path)) {
    error.message = redact(error.message)
    if (error.stack) error.stack = redact(error.stack)
    if (error.statusMessage) error.statusMessage = redact(error.statusMessage)
    return
  }

  const requestId = requestIdOf(event)
  const response = errorResponse(
    { statusCode: error.statusCode, message: error.unhandled ? undefined : error.message },
    requestId,
    security.indexable,
  )
  // A real failure gets the full error in the log. A request the guard turned
  // away (503 when Entra isn't set up) already has its audit line.
  if (response.status >= 500 && !event.context.choreo?.denied) {
    console.error(JSON.stringify({ type: 'error', requestId, status: response.status, message: redact(error.message), stack: redact(error.stack ?? '') }))
  }
  setResponseHeaders(event, { ...response.headers, 'Content-Type': 'application/json', 'X-Request-Id': requestId })
  setResponseStatus(event, response.status)
  await send(event, JSON.stringify(response.body))
}
