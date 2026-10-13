// @ts-check
// The doctor subcommand: checks that the builder's computer can build a Choreo
// app, before anything is built. The plugin runs it first.
//
// It checks the Node version against the range apps use, that npm, git and the
// GitHub CLI are installed, that the GitHub CLI is signed in, and that the npm
// registry and GitHub can be reached over HTTPS. A certificate error on that
// last check usually means the network inspects encrypted traffic, which breaks
// npm until the computer trusts the network's certificate.
//
// Every outside call is passed in, so the tests can run it without a network.
//
// Input: optional stand-ins for running commands, fetching URLs and the Node
//        version.
// Output: { ok, command, checks: [{ id, status, message }] }.

import { spawnSync } from 'node:child_process';
import { MANIFEST } from './files.js';

/** @typedef {import('./verify.js').Check} Check */
/** @typedef {(command: string, args: string[]) => { status: number | null, stdout: string }} Runner */
/** @typedef {(url: string) => Promise<{ ok: boolean, status: number }>} Fetcher */

const ENDPOINTS = [
  ['registry', 'https://registry.npmjs.org/-/ping', 'the npm registry, where Nuxt and the other dependencies come from'],
  ['github', 'https://github.com/DavidsonCollege/dc-choreo-scaffold', "GitHub, where the layer's release files come from"],
];
const TIMEOUT_MS = 10_000;

// Node's error codes for a certificate the computer doesn't trust.
const CERTIFICATE_ERRORS = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_UNTRUSTED', 'CERT_HAS_EXPIRED',
]);

/**
 * Runs a command and captures its output. On Windows, npm and gh are scripts,
 * so the command runs through the shell as one line. Its arguments are fixed
 * values from this file, never user input.
 *
 * @type {Runner}
 */
function runCommand(command, args) {
  const options = { encoding: /** @type {const} */ ('utf8'), timeout: TIMEOUT_MS };
  const result = process.platform === 'win32'
    ? spawnSync([command, ...args].join(' '), { ...options, shell: true })
    : spawnSync(command, args, options);
  return { status: result.status, stdout: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * Fetches a URL with a timeout.
 *
 * @type {Fetcher}
 */
async function fetchUrl(url) {
  const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  return { ok: response.ok, status: response.status };
}

/**
 * Checks the builder's computer.
 *
 * @param {object} [options]
 * @param {Runner} [options.run] Runs a command.
 * @param {Fetcher} [options.fetch] Fetches a URL.
 * @param {string} [options.nodeVersion] The Node version, without the "v".
 * @returns {Promise<{ ok: boolean, command: string, checks: Check[] }>} Every check's result.
 */
export async function doctor({ run = runCommand, fetch = fetchUrl, nodeVersion = process.versions.node } = {}) {
  /** @type {Check[]} */
  const checks = [];

  const range = MANIFEST.node.engines;
  checks.push(satisfies(nodeVersion, range)
    ? { id: 'node', status: 'pass', message: `Node ${nodeVersion} is in the range apps use (${range}).` }
    : { id: 'node', status: 'fail', message: `Node ${nodeVersion} isn't in the range apps use (${range}). Ask T&I for the managed Node ${MANIFEST.node.nvmrc} install.` });

  for (const [id, command, what] of [['npm', 'npm', 'npm'], ['git', 'git', 'git'], ['gh', 'gh', 'the GitHub CLI']]) {
    const result = run(command, ['--version']);
    checks.push(result.status === 0
      ? { id, status: 'pass', message: `${what} is installed (${firstLine(result.stdout)}).` }
      : { id, status: 'fail', message: `${what} isn't installed, or can't be found. Ask T&I to install it.` });
  }

  if (checks.find((c) => c.id === 'gh')?.status === 'pass') {
    const auth = run('gh', ['auth', 'status']);
    checks.push(auth.status === 0
      ? { id: 'gh-auth', status: 'pass', message: 'The GitHub CLI is signed in.' }
      : { id: 'gh-auth', status: 'fail', message: 'The GitHub CLI isn\'t signed in. Run `gh auth login` and sign in with your Davidson GitHub account.' });
  }

  for (const [id, url, what] of ENDPOINTS) {
    checks.push(await reach(id, url, what, fetch));
  }

  return { ok: !checks.some((c) => c.status === 'fail'), command: 'doctor', checks };
}

/**
 * Whether a URL can be reached, explaining a certificate problem plainly.
 *
 * @param {string} id The check's id.
 * @param {string} url The URL.
 * @param {string} what What it is, for the message.
 * @param {Fetcher} fetch Fetches a URL.
 * @returns {Promise<Check>} The result.
 */
async function reach(id, url, what, fetch) {
  try {
    const response = await fetch(url);
    return response.ok
      ? { id, status: 'pass', message: `Reached ${what}.` }
      : { id, status: 'fail', message: `Reached ${what}, but it answered ${response.status}. Try again; if it keeps happening, ask PE.` };
  } catch (error) {
    const code = /** @type {any} */ (error)?.cause?.code ?? /** @type {any} */ (error)?.code;
    if (CERTIFICATE_ERRORS.has(code)) {
      return { id, status: 'fail', message: `Couldn't reach ${what}: the connection's certificate isn't trusted (${code}). The network is probably inspecting encrypted traffic. Ask T&I to set up the network's certificate for Node; don't turn certificate checks off.` };
    }
    return { id, status: 'fail', message: `Couldn't reach ${what} (${code ?? /** @type {any} */ (error)?.name ?? 'no answer'}). Check the network connection, then try again.` };
  }
}

/**
 * Whether a version is in a range of the form `^22.22.3 || ^24.15.0`: the same
 * major version, and at least the given minor and patch.
 *
 * @param {string} version A version such as 24.18.0.
 * @param {string} range The range.
 * @returns {boolean} True when the version is in the range.
 * @throws {Error} When the range uses anything other than `^X.Y.Z` joined by `||`.
 */
export function satisfies(version, range) {
  const [major, minor, patch] = version.split('.').map(Number);
  return range.split('||').some((part) => {
    const match = /^\s*\^(\d+)\.(\d+)\.(\d+)\s*$/.exec(part);
    if (!match) throw new Error(`doctor only reads ranges like ^22.22.3 || ^24.15.0, not ${range}`);
    const [m, n, p] = match.slice(1).map(Number);
    return major === m && (minor > n || (minor === n && patch >= p));
  });
}

/**
 * The first line of a command's output.
 *
 * @param {string} text The output.
 * @returns {string} Its first non-empty line.
 */
function firstLine(text) {
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? '';
}
