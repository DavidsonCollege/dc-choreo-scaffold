// @ts-check
// The verify subcommand: reports how far an app has drifted from what this
// package ships, and anything that looks like a credential.
//
// It's a fast local check for the builder and the agent, not the gate. The
// checks in dc-choreo-workflows decide at the publish request; verify tells you
// sooner, on the laptop, in plain words.
//
// Each check is pass, warn or fail. A warning is worth knowing but not wrong
// (a dependency PE has since upgraded, an older governance file that update
// brings current). Any failure makes ok false and the exit code 1.
//
// It reads only the few passport fields it needs (road, tier, indexable,
// scaffolded_with) with simple line matching. The passport check validates the
// whole passport.
//
// Input: the app's folder.
// Output: { ok, command, checks: [{ id, status, message }] }.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  GOVERNED_FILES, MANIFEST, PACKAGE_VERSION, RELEASED, findCodeowners, findLicense,
  hashOf, isApache, readIfExists, readTemplate,
} from './files.js';
import { compareVersions } from './update.js';

/** @typedef {'pass' | 'warn' | 'fail'} Status */
/** @typedef {{ id: string, status: Status, message: string }} Check */

const PE_TEAM = '@DavidsonChoreo/platform-engineering';
const CODEOWNED = ['PASSPORT.yml', 'AGENTS.md', 'CLAUDE.md'];
const CATCH_ALL = new Set(['*', '/*', '**', '/**']);

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const LAYER_RELEASE = /^https:\/\/github\.com\/DavidsonCollege\/dc-choreo-scaffold\/releases\/download\//;
const BUILD_SCRIPT = { pages: 'nuxt generate', container: 'nuxt build' };

// Folders that hold installed or built files, not the app's own source.
const SKIP_DIRS = new Set(['node_modules', '.git', '.output', '.nuxt', '.data', 'dist']);
const MAX_SCAN_BYTES = 512 * 1024;

// File names that hold credentials. `.env.example` is the one allowed .env file.
const CREDENTIAL_FILE = /^(\.env(\..+)?|.+\.(pem|key|pfx|p12))$/i;
const ALLOWED_FILE = /^\.env\.example$/i;

// Text that looks like a credential. Each has a plain name for the report; the
// matched text itself is never printed.
const CREDENTIAL_PATTERNS = [
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['an Azure storage account key', /AccountKey=[A-Za-z0-9+/=]{20,}/],
  ['a shared access signature', /[?&]sig=[A-Za-z0-9%+/=]{20,}/],
  ['a GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['an Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['an OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/],
  ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a client secret', /client_?secret["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i],
];

/**
 * Checks an app against this package.
 *
 * @param {object} options
 * @param {string} options.dir The app's folder.
 * @returns {{ ok: boolean, command: string, checks: Check[] }} Every check's result.
 */
export function verify({ dir }) {
  const root = resolve(dir);
  /** @type {Check[]} */
  const checks = [];
  const add = (/** @type {string} */ id, /** @type {Status} */ status, /** @type {string} */ message) => checks.push({ id, status, message });

  const passport = readIfExists(root, 'PASSPORT.yml');
  if (passport === null) {
    add('passport', 'fail', 'PASSPORT.yml is missing. Every hosted app has one; create or governance writes it.');
  } else {
    add('passport', 'pass', 'PASSPORT.yml is present.');
    checks.push(scaffoldedWith(passport));
  }
  const field = (/** @type {RegExp} */ pattern) => (passport ? pattern.exec(passport)?.[1] : undefined);
  const road = field(/^road:[ \t]*"?([a-z-]+)"?/m);
  const tier = /** @type {'pages' | 'container' | undefined} */ (field(/^[ \t]+tier:[ \t]*"?(pages|container)"?/m));
  const indexable = field(/^indexable:[ \t]*(true|false)/m);

  checks.push(...GOVERNED_FILES.map((name) => governedFile(root, name)));
  checks.push(codeowners(root));
  checks.push(license(root));
  checks.push(credentials(root));

  const pkgText = readIfExists(root, 'package.json');
  if (pkgText !== null) {
    let pkg;
    try {
      pkg = JSON.parse(pkgText);
    } catch {
      add('package-json', 'fail', "package.json isn't valid JSON.");
    }
    if (pkg) {
      checks.push(exactDependencies(pkg));
      add('lockfile', existsSync(join(root, 'package-lock.json')) ? 'pass' : 'fail',
        existsSync(join(root, 'package-lock.json'))
          ? 'package-lock.json is present.'
          : 'package-lock.json is missing. Run npm install and commit it; CI installs with npm ci.');
      checks.push(npmrc(root));
      if (road === 'paved') checks.push(...pavedRoad(pkg, tier));
    }
  }

  if (tier === 'container' && indexable === 'true') {
    add('indexable', 'warn', 'The passport says indexable: true, but a container app is behind Davidson sign-in, so search engines can never reach it. Set it to false.');
  }

  return { ok: !checks.some((c) => c.status === 'fail'), command: 'verify', checks };
}

/**
 * The passport's scaffolded_with line against this package's version.
 *
 * @param {string} passport The passport text.
 * @returns {Check} The result.
 */
function scaffoldedWith(passport) {
  const lines = [...passport.matchAll(/^scaffolded_with:[ \t]*"?@davidson\/create-choreo-app@(\d+\.\d+\.\d+)"?[ \t]*\r?$/gm)];
  if (lines.length !== 1) {
    return { id: 'scaffolded-with', status: 'fail', message: 'PASSPORT.yml needs exactly one line `scaffolded_with: "@davidson/create-choreo-app@X.Y.Z"`.' };
  }
  const version = lines[0][1];
  const order = compareVersions(version, PACKAGE_VERSION);
  if (order < 0) return { id: 'scaffolded-with', status: 'warn', message: `Scaffolded with ${version}; this package is ${PACKAGE_VERSION}. Run update to bring PE's files current.` };
  if (order > 0) return { id: 'scaffolded-with', status: 'warn', message: `Scaffolded with ${version}, which is newer than this package (${PACKAGE_VERSION}). Verify with the newer package.` };
  return { id: 'scaffolded-with', status: 'pass', message: `Scaffolded with ${version}, this package's version.` };
}

/**
 * One governance file against this release and the earlier ones.
 *
 * @param {string} root The app's folder.
 * @param {string} name AGENTS.md or CLAUDE.md.
 * @returns {Check} The result.
 */
function governedFile(root, name) {
  const id = name.toLowerCase().replace('.md', '');
  const text = readIfExists(root, name);
  if (text === null) return { id, status: 'fail', message: `${name} is missing. Run update to restore it.` };
  const hash = hashOf(text);
  if (hash === hashOf(readTemplate(name))) return { id, status: 'pass', message: `${name} is PE's current copy.` };
  if ((RELEASED[name] ?? []).some((/** @type {{ sha256: string }} */ r) => r.sha256 === hash)) {
    return { id, status: 'warn', message: `${name} is an earlier release of PE's copy. Run update to bring it current.` };
  }
  return { id, status: 'fail', message: `${name} has been edited. PE owns it; run update to restore it, and put this repository's own notes in BUILDER.md.` };
}

/**
 * CODEOWNERS gives the passport and the governance files to PE, judged by the
 * last matching line, the same way GitHub and the files check read it.
 *
 * @param {string} root The app's folder.
 * @returns {Check} The result.
 */
function codeowners(root) {
  const path = findCodeowners(root);
  if (path === null) return { id: 'codeowners', status: 'fail', message: 'There is no CODEOWNERS file. Run update to restore it.' };
  const rules = /** @type {string} */ (readIfExists(root, path)).split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const [pattern, ...owners] = line.split(/\s+/);
      return { pattern, owners };
    });
  const missing = CODEOWNED.filter((file) => {
    const last = rules.filter(({ pattern }) => CATCH_ALL.has(pattern) || pattern.replace(/^\//, '') === file).at(-1);
    return !last || !last.owners.includes(PE_TEAM);
  });
  return missing.length === 0
    ? { id: 'codeowners', status: 'pass', message: `${path} gives the passport and governance files to ${PE_TEAM}.` }
    : { id: 'codeowners', status: 'fail', message: `In ${path}, the last line matching ${missing.join(', ')} leaves out ${PE_TEAM}. Run update to restore PE's block at the end.` };
}

/**
 * A license file is present and is Apache-2.0.
 *
 * @param {string} root The app's folder.
 * @returns {Check} The result.
 */
function license(root) {
  const path = findLicense(root);
  if (path === null) return { id: 'license', status: 'fail', message: 'There is no LICENSE file. The repository goes public when the app is hosted, so it needs one.' };
  return isApache(/** @type {string} */ (readIfExists(root, path)))
    ? { id: 'license', status: 'pass', message: `${path} is Apache-2.0.` }
    : { id: 'license', status: 'warn', message: `${path} isn't Apache-2.0. Make sure the passport's license names it; PE reviews anything other than Apache-2.0, MIT or BSD-3-Clause.` };
}

/**
 * Files and text that look like credentials. A quick local warning before a
 * push; the secrets check in CI scans the full history.
 *
 * @param {string} root The app's folder.
 * @returns {Check} The result, naming where, never what.
 */
function credentials(root) {
  /** @type {string[]} */
  const findings = [];
  for (const file of walk(root)) {
    const path = relative(root, file).replaceAll('\\', '/');
    const name = path.split('/').pop() ?? '';
    if (CREDENTIAL_FILE.test(name) && !ALLOWED_FILE.test(name)) {
      findings.push(`${path} (a credential file)`);
      continue;
    }
    if (statSync(file).size > MAX_SCAN_BYTES) continue;
    const text = readFileSync(file, 'utf8');
    if (text.includes('\0')) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      for (const [what, pattern] of CREDENTIAL_PATTERNS) {
        if (/** @type {RegExp} */ (pattern).test(line)) findings.push(`${path}:${i + 1} (${what})`);
      }
    });
  }
  return findings.length === 0
    ? { id: 'credentials', status: 'pass', message: 'Nothing that looks like a credential.' }
    : {
      id: 'credentials',
      status: 'fail',
      message: `Something that looks like a credential is in: ${findings.join(', ')}. Remove it, and if it's real, have it rotated, because it has left the one place it belonged. The app reads secrets from its key vault at runtime; ask PE.`,
    };
}

/**
 * Every dependency is pinned to an exact version, or to the layer's release.
 *
 * @param {Record<string, any>} pkg The app's package.json.
 * @returns {Check} The result.
 */
function exactDependencies(pkg) {
  const loose = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter(([, spec]) => !EXACT_VERSION.test(spec) && !LAYER_RELEASE.test(spec) && !String(spec).startsWith('file:'))
    .map(([name, spec]) => `${name} ${spec}`);
  return loose.length === 0
    ? { id: 'exact-dependencies', status: 'pass', message: 'Every dependency is pinned to an exact version.' }
    : { id: 'exact-dependencies', status: 'fail', message: `Not pinned to an exact version: ${loose.join(', ')}. Use exact versions only, never a range or latest.` };
}

/**
 * The app's .npmrc keeps installs exact and the Node version enforced.
 *
 * @param {string} root The app's folder.
 * @returns {Check} The result.
 */
function npmrc(root) {
  const text = readIfExists(root, '.npmrc') ?? '';
  const settings = new Set(text.split(/\r?\n/).map((line) => line.replace(/\s+/g, '')));
  const missing = ['save-exact=true', 'engine-strict=true'].filter((s) => !settings.has(s));
  return missing.length === 0
    ? { id: 'npmrc', status: 'pass', message: '.npmrc keeps installs exact and enforces the Node version.' }
    : { id: 'npmrc', status: 'fail', message: `.npmrc is missing ${missing.join(' and ')}.` };
}

/**
 * Paved-road checks: dependencies against the manifest, the build script for
 * the tier, and the Node version range.
 *
 * @param {Record<string, any>} pkg The app's package.json.
 * @param {'pages' | 'container' | undefined} tier The passport's tier.
 * @returns {Check[]} The results.
 */
function pavedRoad(pkg, tier) {
  /** @type {Check[]} */
  const checks = [];
  const drift = [];
  for (const group of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(MANIFEST[group])) {
      const actual = pkg[group]?.[name];
      if (actual !== version) drift.push(`${name} ${actual ?? '(missing)'}, manifest ${version}`);
    }
  }
  checks.push(drift.length === 0
    ? { id: 'manifest', status: 'pass', message: `Dependencies match this package's manifest (${PACKAGE_VERSION}).` }
    : { id: 'manifest', status: 'warn', message: `Differs from this package's manifest: ${drift.join('; ')}. Fine if PE approved the change; otherwise run update or ask PE.` });

  if (tier) {
    const expected = BUILD_SCRIPT[tier];
    checks.push(pkg.scripts?.build === expected
      ? { id: 'build-script', status: 'pass', message: `The build script is \`${expected}\`, right for the ${tier} tier.` }
      : { id: 'build-script', status: 'fail', message: `The build script is \`${pkg.scripts?.build ?? '(none)'}\`, but a ${tier} app builds with \`${expected}\`.` });
  }

  checks.push(pkg.engines?.node === MANIFEST.node.engines
    ? { id: 'engines', status: 'pass', message: `engines.node is ${MANIFEST.node.engines}.` }
    : { id: 'engines', status: 'warn', message: `engines.node is ${pkg.engines?.node ?? '(none)'}; this package uses ${MANIFEST.node.engines}.` });
  return checks;
}

/**
 * Every file under a folder, skipping installed and built folders.
 *
 * @param {string} dir The folder.
 * @returns {Generator<string>} Full paths.
 */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (entry.isFile()) {
      yield join(dir, entry.name);
    }
  }
}
