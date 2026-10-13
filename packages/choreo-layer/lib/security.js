// @ts-check
// The layer's security decisions for a container app: who is calling, whether
// they may, and what goes in the error response and the audit log. Plain
// JavaScript with no Nuxt in it, so the tests can check it directly; the
// server middleware (runtime/security/) applies it.
//
// Only /api/** is guarded. Pages are protected by the platform's sign-in
// (Easy Auth), which stops anyone who isn't signed in before the app sees the
// request. The layer still checks Microsoft's signed ID token itself on every
// /api call, so it trusts the signature, not the platform's word.
//
// Nothing here logs or returns a token, a header or a request body. Text that
// could hold a credential goes through redact() first.
//
// Input: the request's method, path and headers; the app's Entra settings;
// the passport's roles and custom domain.
// Output: allow or deny, the signed-in user, error bodies, audit records.

import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';

/** Every /api route starts with this. */
const API_ROOT = '/api';

/** Methods that only read. Anything else needs a same-site origin. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** An incoming request id the layer will reuse; anything else is replaced. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** An Entra tenant or client id. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The longest app error message passed to the caller. */
const MAX_MESSAGE = 200;

/** Allowed clock difference with Microsoft, in seconds. */
const CLOCK_TOLERANCE = 60;

// jose's codes for Microsoft's key service failing, as opposed to a bad token.
// A thrown error with no jose code (a network failure) counts as one too.
const KEYS_UNAVAILABLE = new Set(['ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID', 'ERR_JOSE_GENERIC']);

// Text that holds a credential, and what replaces it.
const REDACTIONS = /** @type {const} */ ([
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[redacted]'],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]'],
  [/\b(AccountKey=)[^;\s"']+/gi, '$1[redacted]'],
  [/\b(Password=)[^;\s"']+/gi, '$1[redacted]'],
  [/([?&]sig=)[^&\s"']+/gi, '$1[redacted]'],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[redacted]@'],
]);

// What a caller sees for each 4xx when the app gave no message.
const DEFAULT_MESSAGES = /** @type {Record<number, string>} */ ({
  400: 'The request was not valid.',
  401: 'Sign in to continue.',
  403: "You don't have access to this.",
  404: 'Not found.',
});

/**
 * @typedef {object} User
 * @property {string} id The person's Entra object id.
 * @property {string | null} email Their sign-in address, lowercased.
 * @property {string | null} name Their display name.
 * @property {string[]} roles The passport's roles they hold.
 */

/**
 * @typedef {'not-configured' | 'cross-origin' | 'no-token' | 'bad-token' | 'keys-unavailable' | 'no-role'} DenyReason
 */

/**
 * @typedef {{ outcome: 'skip' }
 *   | { outcome: 'allow', user: User }
 *   | { outcome: 'deny', status: 401 | 403 | 503, reason: DenyReason, detail?: string }} GuardResult
 * A deny's detail says what failed in a refused token, for the server log
 * only. It never holds the token.
 */

/** A token the layer refused, and whether the token or the key service was at fault. */
export class TokenRejected extends Error {
  /**
   * @param {'bad-token' | 'keys-unavailable'} reason Why.
   * @param {string} detail What failed, for the server log. Never the token.
   */
  constructor(reason, detail) {
    super(detail);
    this.name = 'TokenRejected';
    this.reason = reason;
  }
}

/**
 * Microsoft's signing keys for a tenant. The address is built from the tenant
 * id alone, so no setting can point the layer at someone else's keys.
 *
 * @param {string} tenantId The Entra tenant id.
 * @returns {ReturnType<typeof createRemoteJWKSet>} The key set jose fetches and caches.
 * @throws {Error} When the tenant id isn't a GUID.
 */
export function microsoftKeys(tenantId) {
  if (!GUID.test(tenantId)) throw new Error('The Entra tenant id is not a GUID.');
  return createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
}

/**
 * Checks a Microsoft ID token: signature, issuer, audience, lifetime, tenant
 * and object id. A token that isn't RS256 or has no key id is refused before
 * any key is fetched, so junk tokens never cause a call to Microsoft.
 *
 * @param {string} token The ID token from the x-ms-token-aad-id-token header.
 * @param {object} options
 * @param {string} options.tenantId The Entra tenant id.
 * @param {string} options.clientId The app registration's client id.
 * @param {Parameters<typeof jwtVerify>[1]} options.keys Microsoft's keys (microsoftKeys), or local ones in tests.
 * @returns {Promise<Record<string, any>>} The token's claims.
 * @throws {TokenRejected} When the token is refused or the keys can't be fetched.
 */
export async function verifyIdToken(token, { tenantId, clientId, keys }) {
  let header;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw new TokenRejected('bad-token', 'The token is not a signed JWT.');
  }
  if (header.alg !== 'RS256') throw new TokenRejected('bad-token', `The token's algorithm is ${String(header.alg)}, not RS256.`);
  if (typeof header.kid !== 'string' || !header.kid) throw new TokenRejected('bad-token', 'The token names no signing key.');

  let payload;
  try {
    ({ payload } = await jwtVerify(token, keys, {
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      audience: clientId,
      algorithms: ['RS256'],
      clockTolerance: CLOCK_TOLERANCE,
    }));
  } catch (error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    const unavailable = typeof code !== 'string' || !code.startsWith('ERR_') || KEYS_UNAVAILABLE.has(code);
    throw new TokenRejected(unavailable ? 'keys-unavailable' : 'bad-token', `${typeof code === 'string' ? code : 'error'}: ${redact(String(/** @type {Error} */ (error)?.message ?? error))}`);
  }

  if (payload.tid !== tenantId) throw new TokenRejected('bad-token', "The token's tenant is not this app's tenant.");
  if (typeof payload.oid !== 'string' || !payload.oid) throw new TokenRejected('bad-token', 'The token has no object id.');
  return payload;
}

/**
 * The signed-in user from a verified token. Only the roles the passport names
 * count; any other role in the token is ignored.
 *
 * @param {Record<string, any>} claims The verified token's claims.
 * @param {string[]} passportRoles The passport's roles.
 * @returns {User} The user.
 */
export function userFrom(claims, passportRoles) {
  const email = [claims.preferred_username, claims.email, claims.upn]
    .find((value) => typeof value === 'string' && value.includes('@'));
  const roles = Array.isArray(claims.roles) ? claims.roles : [];
  return {
    id: claims.oid,
    email: email ? email.trim().toLowerCase() : null,
    name: typeof claims.name === 'string' ? claims.name : null,
    roles: passportRoles.filter((role) => roles.includes(role)),
  };
}

/**
 * The made-up user `nuxt dev` signs in as, so builders can work without Entra.
 * Never used in a production build.
 *
 * @param {string[]} passportRoles The passport's roles.
 * @param {string | undefined} setting NUXT_CHOREO_DEV_ROLES: unset for every
 *   passport role, "none" for no roles, or a comma-separated list.
 * @returns {User} The dev user.
 */
export function devUserFrom(passportRoles, setting) {
  let roles = passportRoles;
  if (setting !== undefined && setting.trim() !== '') {
    const wanted = setting.trim().toLowerCase() === 'none' ? [] : setting.split(',').map((role) => role.trim());
    roles = passportRoles.filter((role) => wanted.includes(role));
  }
  return { id: '00000000-0000-0000-0000-000000000000', email: 'dana.example@example.invalid', name: 'Dana Example', roles: [...roles] };
}

/**
 * Whether a request path is under /api, and so guarded. The path is decoded
 * and normalized first, so /%61pi/x or //api/x can't slip past. A path that
 * can't be decoded counts as /api: when in doubt, guard it.
 *
 * @param {string} path The request path, query included or not.
 * @returns {boolean} True when the guard applies.
 */
export function isApiPath(path) {
  let decoded;
  try {
    decoded = decodeURIComponent(path.split('?')[0].split('#')[0]);
  } catch {
    return true;
  }
  const segments = [];
  for (const segment of decoded.replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  const normalized = `/${segments.join('/')}`.toLowerCase();
  return normalized === API_ROOT || normalized.startsWith(`${API_ROOT}/`);
}

/**
 * Whether a request came from the app's own pages. Reads never need to; a
 * change (POST, PUT, PATCH, DELETE and the rest) does, so another website
 * can't make a signed-in person's browser change data.
 *
 * @param {object} request
 * @param {string} request.method The HTTP method.
 * @param {string | undefined} request.origin The Origin header.
 * @param {string | undefined} request.secFetchSite The Sec-Fetch-Site header.
 * @param {string | undefined} request.host The Host header.
 * @param {string | undefined} request.forwardedHost The X-Forwarded-Host header.
 * @param {string | null} customDomain The passport's custom domain.
 * @returns {boolean} True when the request may go on.
 */
export function checkOrigin({ method, origin, secFetchSite, host, forwardedHost }, customDomain) {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  if (origin === undefined || origin === '') return secFetchSite === 'same-origin';
  if (origin === 'null') return false;
  let originHost;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const allowed = [host, forwardedHost?.split(',')[0], customDomain]
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .map((value) => /** @type {string} */ (value).trim().toLowerCase());
  return allowed.includes(originHost);
}

/**
 * The request's id: the caller's x-request-id when it's safe to repeat in
 * logs and headers, otherwise a new one.
 *
 * @param {string | undefined} incoming The x-request-id header.
 * @param {() => string} [newId] Makes a new id.
 * @returns {string} The id.
 */
export function requestIdFrom(incoming, newId = () => crypto.randomUUID()) {
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : newId();
}

/**
 * Hides anything in a text that looks like a credential: tokens, Bearer
 * values, storage keys, passwords in connection strings, shared access
 * signatures, and user:password in addresses.
 *
 * @param {unknown} value Any value; non-text is turned into text first.
 * @returns {string} The text with credentials replaced by [redacted].
 */
export function redact(value) {
  let text = typeof value === 'string' ? value : String(value);
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text;
}

/**
 * One audit line: who did what to which resource, when, and how it ended.
 * Never headers, bodies or tokens; the resource and reason are redacted.
 *
 * @param {object} entry
 * @param {string} entry.app The app's name.
 * @param {string} entry.requestId The request's id.
 * @param {User | null} entry.user The signed-in user, or null.
 * @param {string} entry.action What happened, such as `access` or `grade.update`.
 * @param {string} entry.resource What it happened to, such as `GET /api/grades`.
 * @param {'allowed' | 'denied' | 'failed'} entry.outcome How it ended.
 * @param {string} [entry.reason] Why it was denied or failed.
 * @param {number} [entry.status] The HTTP status.
 * @param {Date} [entry.at] When. Defaults to now.
 * @returns {Record<string, unknown>} The record, ready for JSON.
 */
export function auditRecord({ app, requestId, user, action, resource, outcome, reason, status, at = new Date() }) {
  return {
    type: 'audit',
    at: at.toISOString(),
    requestId,
    app,
    actor: user ? { id: user.id, email: user.email } : null,
    action,
    resource: redact(resource),
    outcome,
    ...(reason === undefined ? {} : { reason: redact(reason) }),
    ...(status === undefined ? {} : { status }),
  };
}

/**
 * What an /api caller gets back for an error. A server error always gets a
 * plain message with the reference id, so nothing about the code leaks. A
 * client error keeps the app's message, redacted and shortened. No URL, data
 * or stack, ever.
 *
 * @param {object} error
 * @param {number | undefined} error.statusCode The status the app set.
 * @param {string | undefined} error.message The app's message.
 * @param {string} requestId The request's id.
 * @param {boolean} indexable Whether search engines may index the app.
 * @returns {{ status: number, headers: Record<string, string>, body: { statusCode: number, message: string, requestId: string } }} The response.
 */
export function errorResponse({ statusCode, message }, requestId, indexable) {
  const status = Number.isInteger(statusCode) && /** @type {number} */ (statusCode) >= 400 && /** @type {number} */ (statusCode) <= 599
    ? /** @type {number} */ (statusCode)
    : 500;
  let text;
  if (status >= 500) {
    text = `Something went wrong on our side. Reference: ${requestId}.`;
  } else {
    const own = typeof message === 'string' && message.trim() ? redact(message.trim()) : DEFAULT_MESSAGES[status] ?? 'The request could not be completed.';
    text = own.length > MAX_MESSAGE ? `${own.slice(0, MAX_MESSAGE - 1)}…` : own;
  }
  /** @type {Record<string, string>} */
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!indexable) headers['X-Robots-Tag'] = 'noindex';
  return { status, headers, body: { statusCode: status, message: text, requestId } };
}

/**
 * The whole guard decision for one request, in order: the path, the app's
 * Entra settings, where the request came from, the token, then the role.
 *
 * @param {object} request
 * @param {string} request.method The HTTP method.
 * @param {string} request.path The request path.
 * @param {Record<string, string | undefined>} request.headers Lowercased header names.
 * @param {object} deps
 * @param {{ tenantId: string, clientId: string }} deps.entra The app's Entra settings.
 * @param {string[]} deps.roles The passport's roles.
 * @param {string | null} deps.customDomain The passport's custom domain.
 * @param {Parameters<typeof jwtVerify>[1] | null} deps.keys Microsoft's keys, or null when Entra isn't set up.
 * @param {User} [deps.devUser] The dev user, only ever passed in `nuxt dev`.
 * @param {object} [options]
 * @param {boolean} [options.anyPath] Check the request whatever its path, for
 *   requireUser called from a route outside /api.
 * @returns {Promise<GuardResult>} Skip (not /api), allow with the user, or deny with a status and reason.
 */
export async function guard({ method, path, headers }, { entra, roles, customDomain, keys, devUser }, { anyPath = false } = {}) {
  if (!anyPath && !isApiPath(path)) return { outcome: 'skip' };

  const configured = GUID.test(entra.tenantId) && GUID.test(entra.clientId) && keys !== null;
  if (!devUser && !configured) return { outcome: 'deny', status: 503, reason: 'not-configured' };

  const sameSite = checkOrigin({
    method,
    origin: headers.origin,
    secFetchSite: headers['sec-fetch-site'],
    host: headers.host,
    forwardedHost: headers['x-forwarded-host'],
  }, customDomain);
  if (!sameSite) return { outcome: 'deny', status: 403, reason: 'cross-origin' };

  let user;
  if (devUser) {
    user = devUser;
  } else {
    const token = headers['x-ms-token-aad-id-token'];
    if (!token) return { outcome: 'deny', status: 401, reason: 'no-token' };
    try {
      user = userFrom(await verifyIdToken(token, { ...entra, keys: /** @type {Parameters<typeof jwtVerify>[1]} */ (keys) }), roles);
    } catch (error) {
      const detail = error instanceof TokenRejected ? error.message : 'The token could not be checked.';
      if (error instanceof TokenRejected && error.reason === 'keys-unavailable') return { outcome: 'deny', status: 503, reason: 'keys-unavailable', detail };
      return { outcome: 'deny', status: 401, reason: 'bad-token', detail };
    }
  }

  if (user.roles.length === 0) return { outcome: 'deny', status: 403, reason: 'no-role' };
  return { outcome: 'allow', user };
}

// Where a warning says the code will be looked at.
const REVIEW_NOTE = 'It will be flagged for review at the publish request.';

// A dev-only file, which Nitro leaves out of production builds.
const DEV_ONLY = /\.dev\.[A-Za-z]+$/;

/**
 * Warnings for a container app's server code that sits outside the layer's
 * /api guard: routes outside /api, app server middleware, and server
 * components. They never stop a build: the app is still incubating, and the
 * code is reviewed at the publish request.
 *
 * @param {object} found
 * @param {{ route?: string, middleware?: boolean, handler: string, env?: string | string[] }[]} found.handlers
 *   The app's server files as Nitro scanned them.
 * @param {string[]} found.serverComponents Paths of the app's server components and server pages.
 * @param {string} found.rootDir The app's folder.
 * @returns {string[]} One plain-language warning per file.
 */
export function outsideGuard({ handlers, serverComponents, rootDir }) {
  const root = `${rootDir.replaceAll('\\', '/').replace(/\/$/, '')}/`;
  const local = (/** @type {string} */ path) => {
    const forward = path.replaceAll('\\', '/');
    return forward.startsWith(root) ? forward.slice(root.length) : forward;
  };
  /** @type {string[]} */
  const warnings = [];
  for (const handler of handlers) {
    if ([handler.env].flat().includes('dev') || DEV_ONLY.test(handler.handler)) continue;
    const file = local(handler.handler);
    if (handler.middleware || !handler.route) {
      warnings.push(`${file} is server middleware, which runs before the layer's sign-in check on every request. It must not return data or answer requests itself; put data behind server/api/ routes that call requireUser or requireRole. ${REVIEW_NOTE}`);
    } else if (!isApiPath(handler.route)) {
      warnings.push(`${file} answers ${handler.route}, outside /api, so the layer's sign-in check doesn't cover it. Move it under server/api/, or call requireUser or requireRole in it, or ask Platform Engineering. ${REVIEW_NOTE}`);
    }
  }
  for (const component of serverComponents) {
    warnings.push(`${local(component)} is a server component, which Nuxt serves outside /api and the layer's sign-in check. Fetch data through server/api/ instead. ${REVIEW_NOTE}`);
  }
  return warnings;
}

/**
 * Warnings for route rules that open the app to other websites (CORS). A
 * Choreo app answers only its own pages, and the layer never sets CORS headers.
 *
 * @param {Record<string, { cors?: boolean, headers?: Record<string, string> }>} routeRules The app's route rules.
 * @returns {string[]} One warning per rule that turns CORS on.
 */
export function corsProblems(routeRules) {
  /** @type {string[]} */
  const warnings = [];
  for (const [pattern, rule] of Object.entries(routeRules ?? {})) {
    const header = Object.keys(rule?.headers ?? {}).some((name) => name.toLowerCase() === 'access-control-allow-origin');
    if (rule?.cors === true || header) {
      warnings.push(`The route rule for ${pattern} turns on CORS, so other websites could call the app from a signed-in person's browser. A Choreo app answers only its own pages; remove it, or ask Platform Engineering.`);
    }
  }
  return warnings;
}
