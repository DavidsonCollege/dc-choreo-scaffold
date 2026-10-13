// @ts-check
// The update subcommand: brings an app's Platform Engineering files to this
// package's version. Fleet update pull requests run it across hosted apps.
//
// It rewrites AGENTS.md and CLAUDE.md, replaces PE's block at the end of
// CODEOWNERS (the builder's own lines above it stay), and changes the one
// `scaffolded_with` line in PASSPORT.yml, leaving the rest of the passport,
// comments included, exactly as it was. It never touches BUILDER.md.
//
// Input: the app's folder.
// Output: { ok, command, from, to, written, problems }.

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PACKAGE_VERSION, readIfExists } from './files.js';
import { writeGovernedFiles } from './governance.js';

/** @typedef {import('./validate.js').Problem} Problem */

// A `scaffolded_with` line, quoted or not, and the version on it. The
// lookahead leaves a Windows line ending in place.
const SCAFFOLDED_LINE = /^scaffolded_with:[ \t]*"?@davidson\/create-choreo-app@(\d+\.\d+\.\d+)"?[ \t]*(?=\r?$)/gm;
const ANY_SCAFFOLDED_LINE = /^scaffolded_with:/gm;

/**
 * @typedef {object} UpdateResult
 * @property {boolean} ok True when the files were brought current.
 * @property {string} command Always "update".
 * @property {string | null} from The version the passport named before.
 * @property {string} to This package's version.
 * @property {string[]} written Paths written, relative to the app's folder.
 * @property {Problem[]} problems Why nothing was written, when ok is false.
 */

/**
 * Brings an app's PE-owned files to this package's version.
 *
 * @param {object} options
 * @param {string} options.dir The app's folder.
 * @param {string} [options.version] The version to write; defaults to this package's.
 * @returns {UpdateResult} What changed, or why nothing did.
 */
export function update({ dir, version = PACKAGE_VERSION }) {
  const root = resolve(dir);
  const refuse = (/** @type {Problem[]} */ problems, /** @type {string | null} */ from = null) => (
    { ok: false, command: 'update', from, to: version, written: [], problems }
  );

  const passport = readIfExists(root, 'PASSPORT.yml');
  if (passport === null) {
    return refuse([{ field: 'PASSPORT.yml', message: "is missing. update works on an app that already has a passport; for one that doesn't, run governance or create." }]);
  }

  const lines = [...passport.matchAll(SCAFFOLDED_LINE)];
  const anyLines = [...passport.matchAll(ANY_SCAFFOLDED_LINE)];
  if (anyLines.length !== 1 || lines.length !== 1) {
    return refuse([{
      field: 'scaffolded_with',
      message: anyLines.length === 0
        ? 'is missing from PASSPORT.yml, so update can\'t tell which version wrote this app. Ask Platform Engineering.'
        : 'has to appear exactly once in PASSPORT.yml, as `scaffolded_with: "@davidson/create-choreo-app@X.Y.Z"`. Fix the passport, then run update again.',
    }]);
  }

  const from = lines[0][1];
  if (compareVersions(from, version) > 0) {
    return refuse([{ field: 'scaffolded_with', message: `says ${from}, which is newer than this package (${version}). Run the newer package's update instead.` }], from);
  }

  const { written } = writeGovernedFiles(root, { keepOldText: false, writeBuilder: false });

  const newLine = `scaffolded_with: "@davidson/create-choreo-app@${version}"`;
  const updated = passport.replace(SCAFFOLDED_LINE, newLine);
  if (updated !== passport) {
    // Written as is, not through writeText, so its line endings stay too.
    writeFileSync(join(root, 'PASSPORT.yml'), updated);
    written.push('PASSPORT.yml');
  }

  return { ok: true, command: 'update', from, to: version, written, problems: [] };
}

/**
 * Compares two X.Y.Z versions.
 *
 * @param {string} a One version.
 * @param {string} b The other.
 * @returns {number} Negative when a is older, positive when newer, 0 when equal.
 */
export function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
