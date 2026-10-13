// Types for lib/security.js, which is plain JavaScript so its tests run with
// node --test. Keep these in step with the JSDoc there.
import type { createRemoteJWKSet, jwtVerify } from 'jose'

export interface User {
  id: string
  email: string | null
  name: string | null
  roles: string[]
}

export type DenyReason = 'not-configured' | 'cross-origin' | 'no-token' | 'bad-token' | 'keys-unavailable' | 'no-role'

export type GuardResult =
  | { outcome: 'skip' }
  | { outcome: 'allow', user: User }
  | { outcome: 'deny', status: 401 | 403 | 503, reason: DenyReason, detail?: string }

type Keys = Parameters<typeof jwtVerify>[1]

export class TokenRejected extends Error {
  constructor(reason: 'bad-token' | 'keys-unavailable', detail: string)
  reason: 'bad-token' | 'keys-unavailable'
}

export function microsoftKeys(tenantId: string): ReturnType<typeof createRemoteJWKSet>
export function verifyIdToken(token: string, options: { tenantId: string, clientId: string, keys: Keys }): Promise<Record<string, any>>
export function userFrom(claims: Record<string, any>, passportRoles: string[]): User
export function devUserFrom(passportRoles: string[], setting: string | undefined): User
export function isApiPath(path: string): boolean
export function checkOrigin(
  request: { method: string, origin: string | undefined, secFetchSite: string | undefined, host: string | undefined, forwardedHost: string | undefined },
  customDomain: string | null,
): boolean
export function requestIdFrom(incoming: string | undefined, newId?: () => string): string
export function redact(value: unknown): string
export function auditRecord(entry: {
  app: string
  requestId: string
  user: User | null
  action: string
  resource: string
  outcome: 'allowed' | 'denied' | 'failed'
  reason?: string
  status?: number
  at?: Date
}): Record<string, unknown>
export function errorResponse(
  error: { statusCode: number | undefined, message: string | undefined },
  requestId: string,
  indexable: boolean,
): { status: number, headers: Record<string, string>, body: { statusCode: number, message: string, requestId: string } }
export function guard(
  request: { method: string, path: string, headers: Record<string, string | undefined> },
  deps: { entra: { tenantId: string, clientId: string }, roles: string[], customDomain: string | null, keys: Keys | null, devUser?: User },
): Promise<GuardResult>
