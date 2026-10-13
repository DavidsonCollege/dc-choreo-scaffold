// Makes the lockfile new apps start from, so their first install is exactly a
// dependency set Platform Engineering tested, not whatever npm resolves that day.
//
// It creates a throwaway app with this repository's create-choreo-app, installs
// it against the packed layer file, and keeps the resulting lockfile. One
// lockfile serves both tiers: they share every dependency.
//
// With --check, it then proves that lockfile: a second throwaway app, of the
// other tier, installs from it with `npm ci` (which must leave it unchanged),
// type-checks and builds. Only then is the lockfile written out, so a release
// ships the exact set its own run installed and tested.
//
// The layer's entry is pointed at --layer-ref last: a release URL for a
// release, `file:../<tgz>` for CI. Only that address changes; the file, and so
// its integrity hash, is the same one that was installed and tested.
//
// Usage:
//   node scripts/template-lockfile.mjs --layer <layer .tgz> --layer-ref <spec> --out <path> [--check]
//
// Used by .github/workflows/release.yml (with --check) and ci.yml (without:
// the test apps there are the check).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'packages/create-choreo-app/bin/create-choreo-app.js');
const FIXTURES = join(ROOT, 'packages/create-choreo-app/test/fixtures');
const LAYER_NAME = '@davidson/choreo-layer';
const LAYER_ENTRY = `node_modules/${LAYER_NAME}`;
// The name the shipped lockfile carries; create replaces it with the app's.
const PLACEHOLDER_NAME = 'choreo-app';

const { values } = parseArgs({
  options: {
    layer: { type: 'string' },
    'layer-ref': { type: 'string' },
    out: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
});
if (!values.layer || !values['layer-ref'] || !values.out) {
  console.error('Usage: node scripts/template-lockfile.mjs --layer <layer .tgz> --layer-ref <spec> --out <path> [--check]');
  process.exit(2);
}

const layerFile = `file:${resolve(values.layer).replaceAll('\\', '/')}`;
const out = resolve(values.out);

/**
 * Runs a command, showing its output, and stops on failure.
 *
 * @param {string} command The program.
 * @param {string[]} args Its arguments.
 * @param {string} cwd Where to run it.
 * @returns {void}
 */
function run(command, args, cwd) {
  // npm is a .cmd script on Windows, which needs a shell; node doesn't.
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && command === 'npm' });
  if (result.status !== 0) {
    console.error(`::error::${command} ${args.join(' ')} failed in ${cwd}.`);
    process.exit(1);
  }
}

/**
 * Creates a throwaway app with this repository's CLI, its layer pointed at
 * the packed file.
 *
 * @param {string} parent The folder to create it in.
 * @param {string} name The app's name.
 * @param {'pages' | 'container'} tier The tier.
 * @returns {string} The app's folder.
 */
function createApp(parent, name, tier) {
  const answers = join(FIXTURES, tier === 'pages' ? 'answers-pages.json' : 'answers-container.json');
  run('node', [CLI, 'create', name, '--tier', tier, '--answers', answers, '--json'], parent);
  const dir = join(parent, name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  pkg.dependencies[LAYER_NAME] = layerFile;
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  return dir;
}

/**
 * The lockfile with its layer entry, and the root's layer spec, set to ref.
 *
 * @param {Record<string, any>} lock The lockfile.
 * @param {string} ref The layer reference to write.
 * @param {string} name The name to give the lockfile.
 * @returns {string} The lockfile's text.
 */
function withLayer(lock, ref, name) {
  const copy = structuredClone(lock);
  copy.name = name;
  copy.packages[''].name = name;
  copy.packages[''].dependencies[LAYER_NAME] = ref;
  copy.packages[LAYER_ENTRY].resolved = ref;
  return `${JSON.stringify(copy, null, 2)}\n`;
}

// A lockfile left from an earlier run would be written into the source app by
// create and steer the install, so start without one.
rmSync(out, { force: true });

const work = mkdtempSync(join(tmpdir(), 'choreo-lockfile-'));
try {
  const source = createApp(work, 'lockfile-source', 'container');
  run('npm', ['install', '--no-audit', '--no-fund'], source);
  const lock = JSON.parse(readFileSync(join(source, 'package-lock.json'), 'utf8'));
  if (!lock.packages?.[LAYER_ENTRY]) {
    console.error(`::error::The lockfile has no ${LAYER_ENTRY} entry.`);
    process.exit(1);
  }

  if (values.check) {
    const check = createApp(work, 'lockfile-check', 'pages');
    const tested = withLayer(lock, layerFile, 'lockfile-check');
    writeFileSync(join(check, 'package-lock.json'), tested);
    run('npm', ['ci', '--no-audit', '--no-fund'], check);
    if (readFileSync(join(check, 'package-lock.json'), 'utf8') !== tested) {
      console.error('::error::npm ci changed the lockfile, so it isn\'t a complete, consistent set.');
      process.exit(1);
    }
    run('npm', ['run', 'typecheck'], check);
    run('npm', ['run', 'build'], check);
  }

  writeFileSync(out, withLayer(lock, values['layer-ref'], PLACEHOLDER_NAME));
  console.log(`Wrote ${out}: ${Object.keys(lock.packages).length - 1} packages, layer at ${values['layer-ref']}${values.check ? ', tested' : ''}.`);
} finally {
  if (existsSync(work)) rmSync(work, { recursive: true, force: true });
}
