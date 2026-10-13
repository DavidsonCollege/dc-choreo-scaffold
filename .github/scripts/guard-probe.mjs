// CI probe for the Choreo layer's /api guard, run against the container test
// app's built server (see .github/workflows/ci.yml, test-app).
//
// Usage: node guard-probe.mjs <base-url> configured|unconfigured
// - configured: the server has made-up Entra ids. Checks that requests
//   without a valid token, from another site, or with forged platform
//   headers are refused with a clean JSON body, and that /health and /
//   answer without sign-in.
// - unconfigured: the server has no Entra ids. /api answers 503; /health 200.
//
// Exits 1 with a line per failed check. No real tokens or secrets are used.

const [base, mode] = process.argv.slice(2);
const failures = [];

function check(name, condition, detail = '') {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}${condition || !detail ? '' : ` (${detail})`}`);
  if (!condition) failures.push(name);
}

const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

async function get(path, init = {}) {
  const response = await fetch(new URL(path, base), { redirect: 'manual', ...init });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

// A refusal: the expected status, exactly { statusCode, message, requestId },
// the request id echoed in X-Request-Id, never cached, and nothing about the
// code, path or stack in the body.
function refused(name, response, status) {
  let body = null;
  try {
    body = JSON.parse(response.text);
  } catch {
    // checked below
  }
  check(`${name}: ${status}`, response.status === status, `got ${response.status}`);
  check(`${name}: body is statusCode, message and requestId only`, body !== null && Object.keys(body).sort().join() === 'message,requestId,statusCode', response.text.slice(0, 200));
  check(`${name}: X-Request-Id matches the body`, body !== null && response.headers.get('x-request-id') === body.requestId);
  check(`${name}: not cached`, response.headers.get('cache-control') === 'no-store');
  check(`${name}: X-Robots-Tag noindex`, response.headers.get('x-robots-tag') === 'noindex');
  check(`${name}: no path, URL or stack in the body`, !/ci-probe|stack|https?:/i.test(response.text), response.text.slice(0, 200));
}

if (mode === 'configured') {
  refused('no token', await get('/api/ci-probe'), 401);
  refused('forged platform headers only', await get('/api/ci-probe', {
    headers: { 'x-ms-client-principal': part({ claims: [] }), 'x-ms-client-principal-id': 'x', 'x-ms-client-principal-name': 'admin@davidson.edu' },
  }), 401);
  const none = `${part({ alg: 'none', kid: 'k' })}.${part({ oid: 'x', tid: process.env.NUXT_CHOREO_ENTRA_TENANT_ID })}.`;
  refused('alg none token', await get('/api/ci-probe', { headers: { 'x-ms-token-aad-id-token': none } }), 401);
  refused('cross-origin POST', await get('/api/ci-probe', { method: 'POST', headers: { origin: 'https://evil.example' } }), 403);
  refused('POST with neither Origin nor Sec-Fetch-Site', await get('/api/ci-probe', { method: 'POST' }), 403);
  check('/health: 200 without sign-in', (await get('/health')).status === 200);
  check('/: 200 without sign-in', (await get('/')).status === 200);
} else if (mode === 'unconfigured') {
  const api = await get('/api/ci-probe');
  check('no Entra ids: /api answers 503', api.status === 503, `got ${api.status}`);
  check('no Entra ids: /health still 200', (await get('/health')).status === 200);
} else {
  console.log('Usage: node guard-probe.mjs <base-url> configured|unconfigured');
  process.exit(2);
}

if (failures.length > 0) {
  console.log(`::error::The guard probe failed: ${failures.join('; ')}`);
  process.exit(1);
}
