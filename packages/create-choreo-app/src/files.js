// @ts-check
// File helpers shared by the subcommands: the package's templates, the
// governance files and their hashes, the deploy stub, CODEOWNERS, the license,
// and the package's own version.
//
// Governance files are read and written with LF line endings whatever the
// checkout, because every app's CI compares them by hash after converting line
// endings to LF.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATES_DIR = fileURLToPath(new URL('../templates/', import.meta.url));
export const BASE_DIR = join(TEMPLATES_DIR, '_base');

/** The files Platform Engineering owns in every app, compared by hash. */
export const GOVERNED_FILES = ['AGENTS.md', 'CLAUDE.md'];

/**
 * Where a container app keeps the deploy stub, PE's file that hands every
 * deploy to the shared workflow. The template keeps it as `_base/deploy.yml`.
 * A Pages site has none.
 */
export const DEPLOY_STUB = '.github/workflows/deploy.yml';

// Every version of PE's stub calls the shared workflow. A deploy.yml that
// doesn't is the builder's own deploy: it keeps working until PE swaps it at
// the publish request, so no command here replaces it.
const SHARED_DEPLOY = /^\s*uses:\s*DavidsonChoreo\/dc-choreo-workflows\/\.github\/workflows\/deploy\.yml@/m;

/**
 * Whether a deploy.yml is PE's stub, current, older or edited, rather than the
 * builder's own deploy.
 *
 * @param {string} text The file's text.
 * @returns {boolean} True when it calls PE's shared deploy workflow.
 */
export function isDeployStub(text) {
  return SHARED_DEPLOY.test(text);
}

/** The first line of the block Platform Engineering manages in CODEOWNERS. */
export const CODEOWNERS_MARKER = '# Managed by Platform Engineering.';

/** Where GitHub looks for CODEOWNERS, in the order it looks. */
export const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

/** The file names the license check accepts. */
export const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'];

const APACHE_SIGNATURE = /Apache License,?\s+Version 2\.0/i;

/** This package's version, from its package.json. */
export const PACKAGE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/** The exact versions a paved-road app starts with. */
export const MANIFEST = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));

/** Hashes of earlier releases of the governance files. */
export const RELEASED = JSON.parse(readFileSync(new URL('./released.json', import.meta.url), 'utf8'));

/**
 * Converts CRLF line endings to LF.
 *
 * @param {string} text Any text.
 * @returns {string} The same text with LF line endings.
 */
export function toLf(text) {
  return text.replaceAll('\r\n', '\n');
}

/**
 * The SHA-256 of a text after converting its line endings to LF, the same way
 * the files check in dc-choreo-workflows hashes it.
 *
 * @param {string} text The file's text.
 * @returns {string} The hash, as 64 hex characters.
 */
export function hashOf(text) {
  return createHash('sha256').update(toLf(text)).digest('hex');
}

/**
 * Reads a file from the package's `_base` template with LF line endings.
 *
 * @param {string} name The file's name inside `templates/_base`.
 * @returns {string} Its text.
 */
export function readTemplate(name) {
  return toLf(readFileSync(join(BASE_DIR, name), 'utf8'));
}

/**
 * Reads a file in the app if it exists.
 *
 * @param {string} dir The app's folder.
 * @param {string} path The file's path inside the app.
 * @returns {string | null} Its text, or null when it doesn't exist.
 */
export function readIfExists(dir, path) {
  const full = join(dir, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

/**
 * Writes a text file with LF line endings, creating folders as needed.
 *
 * @param {string} dir The app's folder.
 * @param {string} path The file's path inside the app.
 * @param {string} text The text to write.
 * @returns {void}
 */
export function writeText(dir, path, text) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, toLf(text));
}

/**
 * Finds the app's CODEOWNERS, in the order GitHub looks for it.
 *
 * @param {string} dir The app's folder.
 * @returns {string | null} The path of the first one found, or null.
 */
export function findCodeowners(dir) {
  return CODEOWNERS_PATHS.find((path) => existsSync(join(dir, path))) ?? null;
}

/**
 * Puts Platform Engineering's block at the end of a CODEOWNERS file. Lines
 * above the block are the builder's and stay as they are. Everything from the
 * marker down is replaced. The block goes last because the last matching line
 * wins.
 *
 * @param {string | null} existing The current CODEOWNERS text, or null.
 * @param {string} block Platform Engineering's block, from the template.
 * @returns {string} The new CODEOWNERS text.
 */
export function mergeCodeowners(existing, block) {
  if (existing === null) return block;
  const lines = toLf(existing).split('\n');
  const start = lines.findIndex((line) => line.startsWith(CODEOWNERS_MARKER));
  const kept = (start === -1 ? lines : lines.slice(0, start)).join('\n').trimEnd();
  return kept ? `${kept}\n\n${block}` : block;
}

/**
 * Finds the app's license file.
 *
 * @param {string} dir The app's folder.
 * @returns {string | null} The path of the first license file found, or null.
 */
export function findLicense(dir) {
  return LICENSE_FILES.find((path) => existsSync(join(dir, path))) ?? null;
}

/**
 * Whether a license text is the Apache License 2.0, by the same signature the
 * license check uses.
 *
 * @param {string} text The license text.
 * @returns {boolean} True for Apache-2.0.
 */
export function isApache(text) {
  return APACHE_SIGNATURE.test(text);
}
