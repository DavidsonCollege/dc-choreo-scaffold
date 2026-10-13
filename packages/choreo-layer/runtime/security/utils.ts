// The security helpers a container app's /api handlers call, auto-imported:
// requireUser, requireRole and auditLog. Also the shared request check the
// guard middleware uses, so the token is verified once per request and the
// result reused.
//
// requireUser and requireRole check the request themselves the first time
// they're called. So a handler that calls them is safe even when app server
// middleware answered first or the route sits outside /api.
import type { H3Event } from 'h3'
import { createError, getRequestHeader, getRequestHeaders } from 'h3'
import { useRuntimeConfig } from '#imports'
import security from '#choreo/security'
import { auditRecord, devUserFrom, guard, microsoftKeys, requestIdFrom } from '../../lib/security.js'
import type { GuardResult, User } from '../../lib/security.js'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// What a caller is told when the guard turns them away. 503s are replaced by
// the error handler's generic message anyway.
export const DENIED: Record<string, string> = {
  'cross-origin': "This request has to come from the app's own pages.",
  'no-token': 'Sign in to continue.',
  'bad-token': 'Sign in to continue.',
  'no-role': "You don't have access to this.",
}

// Microsoft's keys, fetched once per tenant and cached by jose.
let keys: { tenantId: string, set: ReturnType<typeof microsoftKeys> } | null = null

function keysFor(tenantId: string) {
  if (!GUID.test(tenantId)) return null
  if (keys?.tenantId !== tenantId) keys = { tenantId, set: microsoftKeys(tenantId) }
  return keys.set
}

/**
 * The request's id, given the first time it's asked for: by the guard
 * middleware, or earlier by app middleware that calls requireUser.
 */
export function requestIdOf(event: H3Event): string {
  const context = event.context.choreo ??= { requestId: '' }
  context.requestId ||= requestIdFrom(getRequestHeader(event, 'x-request-id'))
  return context.requestId
}

/**
 * Checks the request once, whatever its path, and keeps the result on the
 * event for the rest of the request.
 */
export function checkRequest(event: H3Event): Promise<GuardResult> {
  requestIdOf(event)
  const context = event.context.choreo!
  context.check ??= (async () => {
    const entra = useRuntimeConfig(event).choreo.entra
    const headers = getRequestHeaders(event)
    const result = await guard(
      { method: event.method, path: event.path, headers },
      {
        entra,
        roles: security.roles,
        customDomain: security.customDomain,
        keys: keysFor(entra.tenantId),
        devUser: import.meta.dev ? devUserFrom(security.roles, process.env.NUXT_CHOREO_DEV_ROLES) : undefined,
      },
      { anyPath: true },
    )
    if (result.outcome === 'allow') context.user = result.user
    if (result.outcome === 'deny') {
      context.denied = true
      writeAudit(event, null, 'access', 'denied', result.detail ? `${result.reason}: ${result.detail}` : result.reason, result.status)
    }
    return result
  })()
  return context.check
}

/** The signed-in user, or a 401, 403 or 503 error. */
export async function requireUser(event: H3Event): Promise<User> {
  const result = await checkRequest(event)
  if (result.outcome === 'allow') return result.user
  if (result.outcome === 'deny') throw createError({ statusCode: result.status, message: DENIED[result.reason] ?? '' })
  throw createError({ statusCode: 500 })
}

/** The signed-in user when they hold at least one of these roles, or a 403 error. */
export async function requireRole(event: H3Event, ...roles: ChoreoRole[]): Promise<User> {
  const user = await requireUser(event)
  if (!roles.some((role) => user.roles.includes(role))) {
    event.context.choreo!.denied = true
    writeAudit(event, user, 'access', 'denied', `missing role: ${roles.join(' or ')}`, 403)
    throw createError({ statusCode: 403, message: DENIED['no-role'] })
  }
  return user
}

/**
 * Writes one audit line for something the app did, such as a grade changed.
 * Name the action and the resource; never put personal data, tokens or
 * request bodies in either.
 */
export function auditLog(event: H3Event, entry: { action: string, resource: string, outcome?: 'allowed' | 'denied' | 'failed' }): void {
  writeAudit(event, event.context.choreo?.user ?? null, entry.action, entry.outcome ?? 'allowed', undefined, undefined, entry.resource)
}

/** Writes an audit line to stdout as JSON, where the platform's log collection picks it up. */
export function writeAudit(
  event: H3Event,
  user: User | null,
  action: string,
  outcome: 'allowed' | 'denied' | 'failed',
  reason?: string,
  status?: number,
  resource = `${event.method} ${event.path.split('?')[0]}`,
): void {
  console.log(JSON.stringify(auditRecord({ app: security.app, requestId: requestIdOf(event), user, action, resource, outcome, reason, status })))
}
