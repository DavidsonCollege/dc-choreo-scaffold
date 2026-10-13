// The Choreo server plugin, for a container app:
// - at start, one warning when the app's Entra settings are missing, so /api
//   answers 503 (the server still starts, so /health and the pages work)
// - after every /api response, one audit line: who, which request, and how
//   it ended. A request the guard or requireRole turned away already has its
//   line, with the reason, so it doesn't get a second one.
import { defineNitroPlugin, useRuntimeConfig } from '#imports'
import { isApiPath } from '../../lib/security.js'
import { writeAudit } from './utils'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default defineNitroPlugin((nitroApp) => {
  const { tenantId, clientId } = useRuntimeConfig().choreo.entra
  if (!import.meta.dev && (!GUID.test(tenantId) || !GUID.test(clientId))) {
    console.warn('[choreo] NUXT_CHOREO_ENTRA_TENANT_ID or NUXT_CHOREO_ENTRA_CLIENT_ID is missing or not a GUID, so every /api request answers 503. The platform sets them for a hosted app.')
  }

  nitroApp.hooks.hook('afterResponse', (event) => {
    const context = event.context.choreo
    if (!context || context.denied || !isApiPath(event.path)) return
    const status = event.node.res.statusCode
    const outcome = status < 400 ? 'allowed' : status === 401 || status === 403 ? 'denied' : 'failed'
    writeAudit(event, context.user ?? null, 'access', outcome, undefined, status)
  })
})
