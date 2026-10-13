// Tests for lib/security.js: the token check, who the user is, the origin
// rule, the error body, the audit record, and the guard's whole decision.
//
// Key pairs are made at run time and never committed. Credential-shaped text
// is put together from pieces, so this file holds nothing a secret scanner
// would stop on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, createLocalJWKSet, errors, exportJWK, generateKeyPair } from 'jose';
import {
  TokenRejected, auditRecord, checkOrigin, corsProblems, devUserFrom, errorResponse, guard, isApiPath,
  microsoftKeys, outsideGuard, redact, requestIdFrom, userFrom, verifyIdToken,
} from '../lib/security.js';

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = '66666666-7777-8888-9999-000000000000';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const KID = 'test-key';

const signing = await generateKeyPair('RS256', { extractable: true });
const other = await generateKeyPair('RS256', { extractable: true });
const jwk = { ...(await exportJWK(signing.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
const keys = createLocalJWKSet({ keys: [jwk] });
const entra = { tenantId: TENANT, clientId: CLIENT };

const now = () => Math.floor(Date.now() / 1000);
const goodClaims = () => ({
  tid: TENANT,
  oid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  preferred_username: 'Pat.Example@Davidson.edu',
  name: 'Pat Example',
  roles: ['viewer', 'Other.Role'],
});

/** Signs a token; every part can be changed to make a bad one. */
async function sign(claims = goodClaims(), { key = signing.privateKey, kid = KID, alg = 'RS256', iss = ISSUER, aud = CLIENT, exp = now() + 600, nbf } = {}) {
  let jwt = new SignJWT(claims).setProtectedHeader(kid === null ? { alg } : { alg, kid }).setIssuedAt().setIssuer(iss).setAudience(aud).setExpirationTime(exp);
  if (nbf !== undefined) jwt = jwt.setNotBefore(nbf);
  return jwt.sign(key);
}

/** base64url of a JSON value. */
const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A key set that counts how often it's asked for a key. */
function countingKeys() {
  const calls = { count: 0 };
  const fn = (header, token) => {
    calls.count += 1;
    return keys(header, token);
  };
  return { fn, calls };
}

async function rejected(token, options = { ...entra, keys }) {
  try {
    await verifyIdToken(token, options);
  } catch (error) {
    assert.ok(error instanceof TokenRejected, `expected TokenRejected, got ${error}`);
    assert.equal(error.message.includes(token), false, 'the token itself must never be in the message');
    rejected.last = error.message;
    return error.reason;
  }
  assert.fail('the token was accepted');
}

// --- verifyIdToken ---------------------------------------------------------

test('a valid token gives its claims', async () => {
  const claims = await verifyIdToken(await sign(), { ...entra, keys });
  assert.equal(claims.oid, goodClaims().oid);
});

test('a token for another app, issuer or tenant is refused', async () => {
  assert.equal(await rejected(await sign(goodClaims(), { aud: '99999999-9999-9999-9999-999999999999' })), 'bad-token');
  assert.equal(await rejected(await sign(goodClaims(), { iss: 'https://login.microsoftonline.com/common/v2.0' })), 'bad-token');
  assert.equal(await rejected(await sign({ ...goodClaims(), tid: '99999999-9999-9999-9999-999999999999' })), 'bad-token');
});

test('an expired token, or one not yet valid, is refused beyond a minute of clock difference', async () => {
  assert.equal(await rejected(await sign(goodClaims(), { exp: now() - 120 })), 'bad-token');
  assert.equal(await rejected(await sign(goodClaims(), { nbf: now() + 120 })), 'bad-token');
  await verifyIdToken(await sign(goodClaims(), { exp: now() - 30 }), { ...entra, keys });
});

test('alg none, HS256 and a token with no key id are refused without asking for a key', async () => {
  const { fn, calls } = countingKeys();
  const none = `${part({ alg: 'none', kid: KID })}.${part({ ...goodClaims(), iss: ISSUER, aud: CLIENT, exp: now() + 600 })}.`;
  assert.equal(await rejected(none, { ...entra, keys: fn }), 'bad-token');
  assert.match(rejected.last, /not RS256/);
  const hs = await sign(goodClaims(), { alg: 'HS256', key: new TextEncoder().encode('x'.repeat(32)) });
  assert.equal(await rejected(hs, { ...entra, keys: fn }), 'bad-token');
  assert.match(rejected.last, /not RS256/);
  assert.equal(await rejected(await sign(goodClaims(), { kid: null }), { ...entra, keys: fn }), 'bad-token');
  assert.equal(await rejected('not-a-token', { ...entra, keys: fn }), 'bad-token');
  assert.equal(calls.count, 0);
});

test('a token signed by another key, or naming an unknown key, is refused', async () => {
  assert.equal(await rejected(await sign(goodClaims(), { key: other.privateKey })), 'bad-token');
  assert.equal(await rejected(await sign(goodClaims(), { kid: 'unknown-key' })), 'bad-token');
});

test('a token with no object id is refused', async () => {
  const { oid, ...claims } = goodClaims();
  assert.equal(await rejected(await sign(claims)), 'bad-token');
});

test("Microsoft's key service failing is keys-unavailable, not a bad token", async () => {
  const token = await sign();
  assert.equal(await rejected(token, { ...entra, keys: async () => { throw new TypeError('fetch failed'); } }), 'keys-unavailable');
  assert.equal(await rejected(token, { ...entra, keys: async () => { throw new errors.JWKSTimeout(); } }), 'keys-unavailable');
  assert.equal(await rejected(token, { ...entra, keys: async () => { throw new errors.JOSEError('Expected 200 OK from the JSON Web Key Set HTTP response'); } }), 'keys-unavailable');
});

test("Microsoft's key address is built from a GUID tenant id only", () => {
  assert.equal(typeof microsoftKeys(TENANT), 'function');
  assert.throws(() => microsoftKeys('evil.example/x'), /GUID/);
});

// --- userFrom and devUserFrom ----------------------------------------------

test("only the passport's roles count, and the email is lowercased", () => {
  const user = userFrom(goodClaims(), ['viewer', 'editor']);
  assert.deepEqual(user, { id: goodClaims().oid, email: 'pat.example@davidson.edu', name: 'Pat Example', roles: ['viewer'] });
  assert.deepEqual(userFrom({ oid: 'x' }, ['viewer']), { id: 'x', email: null, name: null, roles: [] });
});

test('the dev user has every passport role, none, or a chosen few', () => {
  assert.deepEqual(devUserFrom(['viewer', 'editor'], undefined).roles, ['viewer', 'editor']);
  assert.deepEqual(devUserFrom(['viewer', 'editor'], 'none').roles, []);
  assert.deepEqual(devUserFrom(['viewer', 'editor'], ' editor , made-up ').roles, ['editor']);
  assert.equal(devUserFrom(['viewer'], undefined).name, 'Dana Example');
});

// --- isApiPath -------------------------------------------------------------

test('every way of writing /api is guarded, and pages are not', () => {
  for (const path of ['/api', '/api/', '/api/grades', '/api/grades?x=1', '/API/grades', '/%61pi/grades', '//api/grades', '/./api/grades', '/pages/../api/grades', '/api%2fgrades', '\\api\\grades', '/%E0%A4%A']) {
    assert.equal(isApiPath(path), true, path);
  }
  for (const path of ['/', '/about', '/health', '/apix', '/robots.txt', '/about?next=/api/x']) {
    assert.equal(isApiPath(path), false, path);
  }
});

// --- checkOrigin -----------------------------------------------------------

test('reads pass; a change needs the app’s own origin', () => {
  const req = (extra) => ({ method: 'POST', origin: undefined, secFetchSite: undefined, host: 'app.example.edu', forwardedHost: undefined, ...extra });
  assert.equal(checkOrigin(req({ method: 'GET' }), null), true);
  assert.equal(checkOrigin(req({ method: 'OPTIONS', origin: 'https://evil.example' }), null), true);
  assert.equal(checkOrigin(req({ origin: 'https://app.example.edu' }), null), true);
  assert.equal(checkOrigin(req({ method: 'post', origin: 'https://APP.example.edu' }), null), true);
  assert.equal(checkOrigin(req({ origin: 'https://front.example.edu', forwardedHost: 'front.example.edu, inner' }), null), true);
  assert.equal(checkOrigin(req({ origin: 'https://hours.davidson.edu' }), 'hours.davidson.edu'), true);
  assert.equal(checkOrigin(req({ secFetchSite: 'same-origin' }), null), true);

  assert.equal(checkOrigin(req({ origin: 'https://evil.example' }), null), false);
  assert.equal(checkOrigin(req({ origin: 'https://app.example.edu.evil.example' }), null), false);
  assert.equal(checkOrigin(req({ origin: 'null' }), null), false);
  assert.equal(checkOrigin(req({ origin: 'not a url' }), null), false);
  assert.equal(checkOrigin(req({ secFetchSite: 'same-site' }), null), false);
  assert.equal(checkOrigin(req({ method: 'DELETE' }), null), false);
});

// --- requestIdFrom and redact ----------------------------------------------

test('a safe incoming request id is reused; anything else is replaced', () => {
  const fresh = () => 'new-id-0000';
  assert.equal(requestIdFrom('abc-123-XYZ', fresh), 'abc-123-XYZ');
  for (const bad of [undefined, 'short', 'has space here', 'line\nbreak-1234', 'x'.repeat(65)]) {
    assert.equal(requestIdFrom(bad, fresh), 'new-id-0000', String(bad));
  }
  assert.match(requestIdFrom(undefined), /^[0-9a-f-]{36}$/);
});

test('credentials are redacted; ordinary text is left alone', () => {
  const jwt = ['eyJ', 'hbGciOiJSUzI1NiJ9', '.', 'eyJzdWIiOiJ4In0', '.', 'c2lnbmF0dXJl'].join('');
  const cases = [
    [`token ${jwt} here`, 'token [redacted] here'],
    [['Authorization: Bear', 'er abc.def-123'].join(''), 'Authorization: Bearer [redacted]'],
    [['Default', 'EndpointsProtocol=https;Account', 'Key=abc123+/=;EndpointSuffix=x'].join(''), 'DefaultEndpointsProtocol=https;AccountKey=[redacted];EndpointSuffix=x'],
    [['Server=db;Pass', 'word=hunter2;'].join(''), 'Server=db;Password=[redacted];'],
    [['https://a.blob/x?sv=1&s', 'ig=abc%2B123&se=2'].join(''), 'https://a.blob/x?sv=1&sig=[redacted]&se=2'],
    [['postgres://', 'admin:', 'pw@db:5432/x'].join(''), 'postgres://[redacted]@db:5432/x'],
  ];
  for (const [input, expected] of cases) assert.equal(redact(input), expected);
  assert.equal(redact('Grade saved for course HIS-101.'), 'Grade saved for course HIS-101.');
  assert.equal(redact(42), '42');
});

// --- auditRecord -----------------------------------------------------------

test('an audit record names who, what, which resource, when and how it ended', () => {
  const user = userFrom(goodClaims(), ['viewer']);
  const at = new Date('2026-10-13T12:00:00Z');
  assert.deepEqual(auditRecord({ app: 'advising-bookings', requestId: 'req-12345678', user, action: 'access', resource: 'GET /api/grades', outcome: 'allowed', status: 200, at }), {
    type: 'audit', at: '2026-10-13T12:00:00.000Z', requestId: 'req-12345678', app: 'advising-bookings',
    actor: { id: user.id, email: 'pat.example@davidson.edu' }, action: 'access', resource: 'GET /api/grades', outcome: 'allowed', status: 200,
  });
  const denied = auditRecord({ app: 'a', requestId: 'r', user: null, action: 'access', resource: 'POST /api/x', outcome: 'denied', reason: ['Bear', 'er abc'].join(''), at });
  assert.equal(denied.actor, null);
  assert.equal(denied.reason, 'Bearer [redacted]');
  assert.equal('status' in denied, false);
});

// --- errorResponse ---------------------------------------------------------

test('a server error says only that something went wrong, with the reference', () => {
  const r = errorResponse({ statusCode: 500, message: 'connect ECONNREFUSED 10.0.0.4:5432' }, 'req-12345678', false);
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { statusCode: 500, message: 'Something went wrong on our side. Reference: req-12345678.', requestId: 'req-12345678' });
  assert.equal(errorResponse({ statusCode: 503, message: 'x' }, 'r', true).body.message.includes('x'), false);
  assert.equal(errorResponse({ statusCode: undefined, message: 'x' }, 'r', true).status, 500);
  assert.equal(errorResponse({ statusCode: 200, message: 'x' }, 'r', true).status, 500);
});

test("a client error keeps the app's message, redacted and shortened", () => {
  assert.equal(errorResponse({ statusCode: 422, message: 'The date must be in the future.' }, 'r', true).body.message, 'The date must be in the future.');
  assert.equal(errorResponse({ statusCode: 400, message: ['bad Bear', 'er abc'].join('') }, 'r', true).body.message, 'bad Bearer [redacted]');
  assert.equal(errorResponse({ statusCode: 400, message: 'x'.repeat(500) }, 'r', true).body.message.length, 200);
  assert.equal(errorResponse({ statusCode: 401, message: undefined }, 'r', true).body.message, 'Sign in to continue.');
  assert.equal(errorResponse({ statusCode: 418, message: '' }, 'r', true).body.message, 'The request could not be completed.');
});

test('error responses are never cached, and carry noindex when the app is not indexable', () => {
  const hidden = errorResponse({ statusCode: 404, message: undefined }, 'r', false);
  assert.deepEqual(hidden.headers, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' });
  assert.equal('X-Robots-Tag' in errorResponse({ statusCode: 404, message: undefined }, 'r', true).headers, false);
  assert.deepEqual(Object.keys(hidden.body).sort(), ['message', 'requestId', 'statusCode']);
});

// --- guard -----------------------------------------------------------------

const deps = (extra = {}) => ({ entra, roles: ['viewer'], customDomain: null, keys, ...extra });
const request = ({ headers = {}, ...rest } = {}) => ({ method: 'GET', path: '/api/grades', ...rest, headers: { host: 'app.example.edu', ...headers } });

test('pages are skipped; /api is guarded', async () => {
  assert.deepEqual(await guard(request({ path: '/' }), deps()), { outcome: 'skip' });
  assert.equal((await guard(request(), deps())).outcome, 'deny');
});

test('anyPath checks a route outside /api too, for requireUser', async () => {
  assert.deepEqual(await guard(request({ path: '/export' }), deps(), { anyPath: true }), { outcome: 'deny', status: 401, reason: 'no-token' });
  const allowed = await guard(request({ path: '/export', headers: { 'x-ms-token-aad-id-token': await sign() } }), deps(), { anyPath: true });
  assert.equal(allowed.outcome, 'allow');
});

test('an app with no Entra settings answers /api with 503', async () => {
  const result = await guard(request(), deps({ entra: { tenantId: '', clientId: '' }, keys: null }));
  assert.deepEqual(result, { outcome: 'deny', status: 503, reason: 'not-configured' });
});

test('a cross-origin change is 403, before the token is looked at', async () => {
  const result = await guard(request({ method: 'POST', headers: { origin: 'https://evil.example', 'x-ms-token-aad-id-token': await sign() } }), deps());
  assert.deepEqual(result, { outcome: 'deny', status: 403, reason: 'cross-origin' });
});

test('no token is 401, and forged platform headers alone change nothing', async () => {
  const forged = { 'x-ms-client-principal': part({ claims: [] }), 'x-ms-client-principal-id': 'x', 'x-ms-client-principal-name': 'admin@davidson.edu' };
  assert.deepEqual(await guard(request({ headers: forged }), deps()), { outcome: 'deny', status: 401, reason: 'no-token' });
});

test('a bad token is 401 with a detail for the log that never holds the token', async () => {
  const token = await sign(goodClaims(), { key: other.privateKey });
  const result = await guard(request({ headers: { 'x-ms-token-aad-id-token': token } }), deps());
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'bad-token');
  assert.equal(result.detail.includes(token), false);
});

test("Microsoft's keys being unreachable is 503", async () => {
  const result = await guard(request({ headers: { 'x-ms-token-aad-id-token': await sign() } }), deps({ keys: async () => { throw new TypeError('fetch failed'); } }));
  assert.equal(result.status, 503);
  assert.equal(result.reason, 'keys-unavailable');
});

test("a valid token without any of the passport's roles is 403; with one, allowed", async () => {
  const noRole = await sign({ ...goodClaims(), roles: ['Other.Role'] });
  assert.deepEqual(await guard(request({ headers: { 'x-ms-token-aad-id-token': noRole } }), deps()), { outcome: 'deny', status: 403, reason: 'no-role' });
  const allowed = await guard(request({ method: 'POST', headers: { origin: 'https://app.example.edu', 'x-ms-token-aad-id-token': await sign() } }), deps());
  assert.equal(allowed.outcome, 'allow');
  assert.deepEqual(allowed.user.roles, ['viewer']);
});

test('the dev user stands in for the token, still subject to roles and origin', async () => {
  const unconfigured = { entra: { tenantId: '', clientId: '' }, keys: null };
  const allowed = await guard(request(), deps({ ...unconfigured, devUser: devUserFrom(['viewer'], undefined) }));
  assert.equal(allowed.outcome, 'allow');
  assert.equal(allowed.user.name, 'Dana Example');
  assert.deepEqual(await guard(request(), deps({ ...unconfigured, devUser: devUserFrom(['viewer'], 'none') })), { outcome: 'deny', status: 403, reason: 'no-role' });
  assert.deepEqual(await guard(request({ method: 'POST', headers: { origin: 'https://evil.example' } }), deps({ ...unconfigured, devUser: devUserFrom(['viewer'], undefined) })), { outcome: 'deny', status: 403, reason: 'cross-origin' });
});

// --- outsideGuard and corsProblems -------------------------------------------

test('server code outside the /api guard gets one warning per file', () => {
  const root = 'C:\\apps\\example-app';
  const warnings = outsideGuard({
    rootDir: root,
    handlers: [
      { route: '/api/grades', method: 'get', handler: 'C:/apps/example-app/server/api/grades.get.ts' },
      { route: '/export', method: 'get', handler: 'C:/apps/example-app/server/routes/export.get.ts' },
      { middleware: true, handler: 'C:/apps/example-app/server/middleware/log.ts' },
      { route: '/debug', env: 'dev', handler: 'C:/apps/example-app/server/routes/debug.dev.ts' },
      { route: '/seed', env: ['dev', 'prerender'], handler: 'C:/apps/example-app/server/routes/seed.ts' },
      { middleware: true, handler: 'C:/apps/example-app/server/middleware/trace.dev.ts' },
    ],
    serverComponents: ['C:/apps/example-app/app/components/Grades.server.vue'],
  });
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /^server\/routes\/export\.get\.ts answers \/export, outside \/api/);
  assert.match(warnings[1], /^server\/middleware\/log\.ts is server middleware/);
  assert.match(warnings[2], /^app\/components\/Grades\.server\.vue is a server component/);
  for (const warning of warnings) assert.match(warning, /flagged for review at the publish request/);
});

test('an app with only /api routes gets no warnings', () => {
  assert.deepEqual(outsideGuard({ rootDir: '/app', handlers: [{ route: '/api/x', handler: '/app/server/api/x.ts' }], serverComponents: [] }), []);
});

test('route rules that turn on CORS are warned about', () => {
  const warnings = corsProblems({
    '/api/**': { cors: true },
    '/feed': { headers: { 'Access-Control-Allow-Origin': 'https://other.example' } },
    '/static/**': { headers: { 'cache-control': 'max-age=60' } },
  });
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /\/api\/\*\* turns on CORS/);
  assert.match(warnings[1], /\/feed turns on CORS/);
  assert.deepEqual(corsProblems({}), []);
});
