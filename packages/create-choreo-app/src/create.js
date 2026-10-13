// @ts-check
// The create subcommand: starts a paved-road Choreo app, a Nuxt app that uses
// the Choreo layer.
//
// It writes the app template (templates/app), the tier's extra files
// (templates/tiers/<tier>, such as the Containerfile), a package.json with the
// manifest's exact versions, the Dependabot config, PE's governance files, the
// license and PASSPORT.yml. It doesn't install anything, start git or create a
// repository; it returns the next steps for the plugin to run. Nothing is
// written until every check passes.
//
// Template files that start with a dot are stored without it (gitignore,
// npmrc), because npm leaves some dotfiles out of a package. create adds the
// dot back.
//
// Input: the app's name, tier, parsed answers, where to create it, today.
// Output: { ok, command, dir, written, next, problems }.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MANIFEST, PACKAGE_VERSION, TEMPLATES_DIR, readTemplate, writeText } from './files.js';
import { writeGovernedFiles } from './governance.js';
import { buildPassport, toYaml } from './passport.js';

/** @typedef {import('./validate.js').Problem} Problem */
/** @typedef {import('./passport.js').Tier} Tier */

// Template files stored without their leading dot.
const DOTFILES = new Set(['gitignore', 'npmrc', 'gitattributes', 'dockerignore']);

const BUILD_SCRIPT = { pages: 'nuxt generate', container: 'nuxt build' };
const APP_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * @typedef {object} CreateResult
 * @property {boolean} ok True when the app was written.
 * @property {string} command Always "create".
 * @property {string} dir The app's folder.
 * @property {string[]} written Paths written, relative to the app's folder.
 * @property {string[]} next The commands to run next, in order.
 * @property {Problem[]} problems Why nothing was written, when ok is false.
 */

/**
 * Starts a paved-road app in a new folder.
 *
 * @param {object} options
 * @param {string} options.name The app's name, which is also its folder and repository name.
 * @param {Tier} options.tier The hosting tier.
 * @param {unknown} options.answers The parsed answers file.
 * @param {string} [options.parent] The folder to create the app in. Defaults to the current one.
 * @param {boolean} [options.force] Write into a folder that isn't empty.
 * @param {Date} [options.today] The day the passport is written.
 * @returns {CreateResult} What was written, or why nothing was.
 */
export function create({ name, tier, answers, parent = '.', force = false, today = new Date() }) {
  const dir = resolve(parent, name);
  const refuse = (/** @type {Problem[]} */ problems) => ({ ok: false, command: 'create', dir, written: [], next: [], problems });

  if (!APP_NAME.test(name)) {
    return refuse([{ field: 'app', message: `"${name}" can't be a repository name. Use lowercase letters, digits and hyphens, such as advising-bookings.` }]);
  }
  if (existsSync(dir) && (!statSync(dir).isDirectory() || (readdirSync(dir).length > 0 && !force))) {
    return refuse([{ field: '(the folder)', message: `${dir} already exists and isn't empty. Pick another name, or pass --force to write into it.` }]);
  }

  const built = buildPassport({ answers, app: name, tier, road: 'paved', version: PACKAGE_VERSION, today });
  if (!built.ok) return refuse(built.problems);

  /** @type {string[]} */
  const written = [];
  for (const source of [join(TEMPLATES_DIR, 'app'), join(TEMPLATES_DIR, 'tiers', tier)]) {
    if (existsSync(source)) written.push(...copyTemplate(source, dir, ''));
  }

  writeText(dir, 'package.json', `${JSON.stringify(packageJson(name, tier), null, 2)}\n`);
  writeText(dir, '.nvmrc', `${MANIFEST.node.nvmrc}\n`);
  writeText(dir, '.github/dependabot.yml', dependabot(tier));
  written.push('package.json', '.nvmrc', '.github/dependabot.yml');

  written.push(...writeGovernedFiles(dir, { keepOldText: false }).written);
  writeText(dir, 'LICENSE', readTemplate('LICENSE'));
  writeText(dir, 'PASSPORT.yml', toYaml(built.passport));
  written.push('LICENSE', 'PASSPORT.yml');

  return {
    ok: true,
    command: 'create',
    dir,
    written: [...new Set(written)].sort(),
    next: [
      `cd ${name}`,
      'npm install',
      'git init',
      'git add -A',
      'git commit -m "Start the app from @davidson/create-choreo-app"',
      'npm run dev',
    ],
    problems: [],
  };
}

/**
 * The app's package.json: the tier's build script, the Node range, the
 * manifest's exact versions with the layer from its release, and the
 * manifest's overrides, which force fixed versions of packages deep in Nuxt's
 * tree (the reason for each is in manifest.json).
 *
 * @param {string} name The app's name.
 * @param {Tier} tier The hosting tier.
 * @returns {Record<string, unknown>} The package.json contents.
 */
export function packageJson(name, tier) {
  return {
    name,
    private: true,
    type: 'module',
    scripts: {
      build: BUILD_SCRIPT[tier],
      dev: 'nuxt dev',
      preview: 'nuxt preview',
      postinstall: 'nuxt prepare',
      lint: 'eslint .',
      typecheck: 'nuxt typecheck',
    },
    engines: { node: MANIFEST.node.engines },
    dependencies: {
      [MANIFEST.layer.name]: layerRelease(PACKAGE_VERSION),
      ...MANIFEST.dependencies,
    },
    devDependencies: { ...MANIFEST.devDependencies },
    overrides: { ...MANIFEST.overrides },
  };
}

/**
 * The layer's GitHub Release URL for a version. The layer is released with the
 * same version as this package.
 *
 * @param {string} version The version.
 * @returns {string} The URL of the layer's packed file.
 */
export function layerRelease(version) {
  return MANIFEST.layer.release.replaceAll('{version}', version);
}

/**
 * The Dependabot config: npm for every app, plus the container's base image
 * for a container app. Updates are grouped, and nothing merges automatically.
 *
 * @param {Tier} tier The hosting tier.
 * @returns {string} The text of .github/dependabot.yml.
 */
function dependabot(tier) {
  const lines = [
    '# Dependabot proposes updates. A person reviews and merges each one; nothing',
    '# merges automatically. Major versions of Node and TypeScript are left to',
    "# Platform Engineering's fleet updates.",
    'version: 2',
    'updates:',
    '  - package-ecosystem: npm',
    '    directory: /',
    '    schedule:',
    '      interval: weekly',
    '    groups:',
    '      dependencies:',
    '        patterns: ["*"]',
    '    ignore:',
    '      - dependency-name: typescript',
    '        update-types: ["version-update:semver-major"]',
  ];
  if (tier === 'container') {
    lines.push(
      '  - package-ecosystem: docker',
      '    directory: /',
      '    schedule:',
      '      interval: weekly',
      '    ignore:',
      '      - dependency-name: node',
      '        update-types: ["version-update:semver-major"]',
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Copies a template folder into the app, adding the dot back to dotfiles.
 *
 * @param {string} source The template folder.
 * @param {string} dir The app's folder.
 * @param {string} prefix The path so far, inside the app.
 * @returns {string[]} The paths written, relative to the app's folder.
 */
function copyTemplate(source, dir, prefix) {
  /** @type {string[]} */
  const written = [];
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const target = `${prefix}${DOTFILES.has(entry.name) ? `.${entry.name}` : entry.name}`;
    if (entry.isDirectory()) {
      written.push(...copyTemplate(join(source, entry.name), dir, `${target}/`));
    } else {
      // writeText makes every file LF, whatever the checkout's line endings.
      writeText(dir, target, readFileSync(join(source, entry.name), 'utf8'));
      written.push(target);
    }
  }
  return written;
}
