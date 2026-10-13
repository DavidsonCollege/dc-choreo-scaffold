// @ts-check
// The governance subcommand: Platform Engineering's files for an app off the
// paved road, which brings its own stack.
//
// It writes AGENTS.md, CLAUDE.md, CODEOWNERS, a LICENSE when there's none, a
// starter BUILDER.md when there's none, and PASSPORT.yml from the builder's
// answers (road: non-paved, stack: other). Nothing is written until every check
// passes, so a refused run leaves the folder as it was.
//
// An existing AGENTS.md or CLAUDE.md that isn't PE's is the repository's own
// notes. Its text moves into BUILDER.md under a heading, so nothing is lost.
//
// Input: the app's folder, the parsed answers, the tier, the app name, today.
// Output: { ok, command, written, moved, problems }.

import { existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  GOVERNED_FILES, PACKAGE_VERSION, findCodeowners, findLicense, hashOf, isApache,
  mergeCodeowners, readIfExists, readTemplate, writeText,
} from './files.js';
import { buildPassport, toYaml } from './passport.js';

/** @typedef {import('./validate.js').Problem} Problem */
/** @typedef {import('./passport.js').Tier} Tier */
/** @typedef {import('./passport.js').Road} Road */

/**
 * @typedef {object} GovernanceResult
 * @property {boolean} ok True when the files were written.
 * @property {string} command Always "governance".
 * @property {string[]} written Paths written, relative to the app's folder.
 * @property {string[]} moved Files whose old text moved into BUILDER.md.
 * @property {Problem[]} problems Why nothing was written, when ok is false.
 */

/**
 * Writes the governance files and the passport into an existing app.
 *
 * @param {object} options
 * @param {string} options.dir The app's folder.
 * @param {unknown} options.answers The parsed answers file.
 * @param {Tier} options.tier The hosting tier.
 * @param {string} [options.app] The app's name. Defaults to the folder's name.
 * @param {Date} [options.today] The day the passport is written.
 * @returns {GovernanceResult} What was written, or why nothing was.
 */
export function governance({ dir, answers, tier, app, today = new Date() }) {
  const root = resolve(dir);
  /** @type {Problem[]} */
  const problems = [];

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return refuse([{ field: '(the folder)', message: `${root} isn't a folder. Run governance inside the app's repository.` }]);
  }
  if (readIfExists(root, 'PASSPORT.yml') !== null) {
    problems.push({ field: 'PASSPORT.yml', message: 'already exists. governance writes a new passport only; change an existing one in a pull request PE approves.' });
  }
  const licensePath = findLicense(root);
  const licenseText = licensePath ? readIfExists(root, licensePath) : null;
  if (licenseText !== null && !isApache(licenseText)) {
    problems.push({ field: licensePath ?? 'LICENSE', message: "isn't Apache-2.0, and this version of the package writes Apache-2.0 passports only. Ask Platform Engineering before going further." });
  }

  const built = buildPassport({ answers, app: app ?? basename(root), tier, road: 'non-paved', version: PACKAGE_VERSION, today });
  problems.push(...built.problems);
  if (problems.length > 0) return refuse(problems);

  const { written, moved } = writeGovernedFiles(root, { keepOldText: true });
  if (licenseText === null) {
    writeText(root, 'LICENSE', readTemplate('LICENSE'));
    written.push('LICENSE');
  }
  writeText(root, 'PASSPORT.yml', toYaml(built.passport));
  written.push('PASSPORT.yml');

  return { ok: true, command: 'governance', written, moved, problems: [] };
}

/**
 * Writes AGENTS.md, CLAUDE.md and PE's CODEOWNERS block, and a starter
 * BUILDER.md when there's none. Shared by create, governance and update.
 *
 * @param {string} root The app's folder.
 * @param {object} options
 * @param {boolean} options.keepOldText Move an existing AGENTS.md or CLAUDE.md
 *   that isn't PE's into BUILDER.md (governance), or replace it (update, where
 *   the file is already PE's and an edit is just drift).
 * @param {boolean} [options.writeBuilder] Write a starter BUILDER.md when
 *   there's none. Default true; update passes false.
 * @returns {{ written: string[], moved: string[] }} What was written and moved.
 */
export function writeGovernedFiles(root, { keepOldText, writeBuilder = true }) {
  /** @type {string[]} */
  const written = [];
  /** @type {string[]} */
  const moved = [];
  /** @type {string[]} */
  const movedSections = [];

  for (const name of GOVERNED_FILES) {
    const canonical = readTemplate(name);
    const current = readIfExists(root, name);
    if (current !== null && hashOf(current) === hashOf(canonical)) continue;
    if (current !== null && keepOldText && current.trim()) {
      movedSections.push(`## Moved from the old ${name}\n\n${current.trim()}\n`);
      moved.push(name);
    }
    writeText(root, name, canonical);
    written.push(name);
  }

  const builder = readIfExists(root, 'BUILDER.md');
  if (builder === null && (writeBuilder || movedSections.length > 0)) {
    writeText(root, 'BUILDER.md', [readTemplate('BUILDER.md').trimEnd(), ...movedSections].join('\n\n') + '\n');
    written.push('BUILDER.md');
  } else if (builder !== null && movedSections.length > 0) {
    writeText(root, 'BUILDER.md', [builder.trimEnd(), ...movedSections].join('\n\n') + '\n');
    written.push('BUILDER.md');
  }

  const codeownersPath = findCodeowners(root) ?? '.github/CODEOWNERS';
  const codeowners = readIfExists(root, codeownersPath);
  const merged = mergeCodeowners(codeowners, readTemplate('CODEOWNERS'));
  if (codeowners === null || merged !== codeowners.replaceAll('\r\n', '\n')) {
    writeText(root, codeownersPath, merged);
    written.push(codeownersPath);
  }

  return { written, moved };
}

/**
 * A refused run: nothing written.
 *
 * @param {Problem[]} problems Why.
 * @returns {GovernanceResult} The result.
 */
function refuse(problems) {
  return { ok: false, command: 'governance', written: [], moved: [], problems };
}
