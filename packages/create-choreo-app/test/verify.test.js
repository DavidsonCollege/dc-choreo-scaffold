// Tests for src/verify.js: drift from what the package ships, and anything
// that looks like a credential.
//
// The fake credentials are put together at run time, so this file never holds
// a string shaped like a real one for secret scanners to stop on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { governance } from '../src/governance.js';
import { verify } from '../src/verify.js';
import { buildPassport, toYaml } from '../src/passport.js';
import { MANIFEST, PACKAGE_VERSION } from '../src/files.js';
import { answers, fixture, put, read, tmpApp } from './helpers.js';

const today = new Date(2026, 9, 12);
const status = (result, id) => result.checks.find((c) => c.id === id)?.status;
const message = (result, id) => result.checks.find((c) => c.id === id)?.message ?? '';

/** A freshly governed app off the paved road. */
function governed() {
  const dir = tmpApp();
  governance({ dir, answers: answers(), tier: 'container', today });
  return dir;
}

/** A paved-road app with a package.json that matches the manifest. */
function paved(tier = 'container') {
  const dir = governed();
  const file = tier === 'pages' ? 'answers-pages.json' : 'answers-container.json';
  const built = buildPassport({ answers: answers(file), app: 'example-app', tier, road: 'paved', version: PACKAGE_VERSION, today });
  put(dir, 'PASSPORT.yml', toYaml(built.passport));
  put(dir, 'package.json', JSON.stringify({
    name: 'example-app',
    private: true,
    scripts: { build: tier === 'pages' ? 'nuxt generate' : 'nuxt build' },
    engines: { node: MANIFEST.node.engines },
    dependencies: MANIFEST.dependencies,
    devDependencies: MANIFEST.devDependencies,
  }, null, 2));
  put(dir, 'package-lock.json', '{}\n');
  put(dir, '.npmrc', 'save-exact=true\nengine-strict=true\n');
  return dir;
}

test('a freshly governed app passes', () => {
  const result = verify({ dir: governed() });
  assert.equal(result.ok, true, JSON.stringify(result.checks.filter((c) => c.status !== 'pass')));
  assert.ok(result.checks.every((c) => c.status === 'pass'));
});

test('a paved-road app that matches the manifest passes', () => {
  const result = verify({ dir: paved() });
  assert.ok(result.checks.every((c) => c.status === 'pass'), JSON.stringify(result.checks.filter((c) => c.status !== 'pass')));
});

test('an edited AGENTS.md fails', () => {
  const dir = governed();
  put(dir, 'AGENTS.md', `${read(dir, 'AGENTS.md')}\nOne more rule.\n`);
  const result = verify({ dir });
  assert.equal(result.ok, false);
  assert.equal(status(result, 'agents'), 'fail');
});

test('an earlier release of AGENTS.md is a warning, not a failure', () => {
  const dir = governed();
  put(dir, 'AGENTS.md', fixture('AGENTS-v1.md'));
  const result = verify({ dir });
  assert.equal(result.ok, true);
  assert.equal(status(result, 'agents'), 'warn');
});

test('a CRLF copy of AGENTS.md is not an edit', () => {
  const dir = governed();
  put(dir, 'AGENTS.md', read(dir, 'AGENTS.md').replaceAll('\n', '\r\n'));
  assert.equal(status(verify({ dir }), 'agents'), 'pass');
});

test("a catch-all CODEOWNERS line after PE's block fails", () => {
  const dir = governed();
  put(dir, '.github/CODEOWNERS', `${read(dir, '.github/CODEOWNERS')}* @example-builder\n`);
  const result = verify({ dir });
  assert.equal(status(result, 'codeowners'), 'fail');
  assert.match(message(result, 'codeowners'), /PASSPORT\.yml, AGENTS\.md, CLAUDE\.md/);
});

test('an .env file fails the credentials check; .env.example is fine', () => {
  const dir = governed();
  put(dir, '.env.example', 'API_URL=\n');
  assert.equal(status(verify({ dir }), 'credentials'), 'pass');
  put(dir, '.env', 'API_URL=\n');
  assert.equal(status(verify({ dir }), 'credentials'), 'fail');
});

test('a token in the code fails, and the report never repeats it', () => {
  const dir = governed();
  const token = ['gh', 'p_', 'A1b2C3d4'.repeat(5)].join('');
  put(dir, 'src/client.js', `const headers = {\n  authorization: '${token}',\n};\n`);
  const result = verify({ dir });
  assert.equal(result.ok, false);
  assert.match(message(result, 'credentials'), /src\/client\.js:2 \(a GitHub token\)/);
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('a private key and a client secret are both found', () => {
  const dir = governed();
  put(dir, 'config/key.txt', `-----BEGIN ${'PRIVATE'} KEY-----\nnot a real key\n`);
  put(dir, 'config/auth.json', `{ "client_secret": "${'x'.repeat(12)}" }\n`);
  const text = message(verify({ dir }), 'credentials');
  assert.match(text, /config\/key\.txt:1 \(a private key\)/);
  assert.match(text, /config\/auth\.json:1 \(a client secret\)/);
});

test('installed folders are not scanned', () => {
  const dir = governed();
  put(dir, 'node_modules/some-package/.env', 'X=1\n');
  assert.equal(status(verify({ dir }), 'credentials'), 'pass');
});

test('a version range fails the exact-dependencies check', () => {
  const dir = paved();
  const pkg = JSON.parse(read(dir, 'package.json'));
  pkg.dependencies.nuxt = '^4.6.1';
  pkg.dependencies.extra = 'latest';
  put(dir, 'package.json', JSON.stringify(pkg));
  const result = verify({ dir });
  assert.equal(status(result, 'exact-dependencies'), 'fail');
  assert.match(message(result, 'exact-dependencies'), /nuxt \^4\.6\.1, extra latest/);
});

test("the layer's release URL counts as pinned", () => {
  const dir = paved();
  const pkg = JSON.parse(read(dir, 'package.json'));
  pkg.dependencies['@davidson/choreo-layer'] = 'https://github.com/DavidsonCollege/dc-choreo-scaffold/releases/download/v0.1.0/davidson-choreo-layer-0.1.0.tgz';
  put(dir, 'package.json', JSON.stringify(pkg));
  assert.equal(status(verify({ dir }), 'exact-dependencies'), 'pass');
});

test('a dependency PE has since upgraded is a warning', () => {
  const dir = paved();
  const pkg = JSON.parse(read(dir, 'package.json'));
  pkg.dependencies.nuxt = '4.6.2';
  put(dir, 'package.json', JSON.stringify(pkg));
  const result = verify({ dir });
  assert.equal(result.ok, true);
  assert.equal(status(result, 'manifest'), 'warn');
});

test('a missing lockfile and .npmrc settings fail', () => {
  const dir = paved();
  put(dir, '.npmrc', 'save-exact=true\n');
  put(dir, 'package-lock.json', '');
  const noLock = paved();
  rmSync(`${noLock}/package-lock.json`);
  assert.equal(status(verify({ dir }), 'npmrc'), 'fail');
  assert.equal(status(verify({ dir: noLock }), 'lockfile'), 'fail');
});

test('a build script that does not match the tier fails', () => {
  const dir = paved('pages');
  const pkg = JSON.parse(read(dir, 'package.json'));
  pkg.scripts.build = 'nuxt build';
  put(dir, 'package.json', JSON.stringify(pkg));
  const result = verify({ dir });
  assert.equal(status(result, 'build-script'), 'fail');
  assert.match(message(result, 'build-script'), /nuxt generate/);
});

test('a container app marked indexable is a warning', () => {
  const dir = paved();
  put(dir, 'PASSPORT.yml', read(dir, 'PASSPORT.yml').replace('indexable: false', 'indexable: true'));
  assert.equal(status(verify({ dir }), 'indexable'), 'warn');
});

test('a missing passport fails', () => {
  const dir = governed();
  rmSync(`${dir}/PASSPORT.yml`);
  assert.equal(status(verify({ dir }), 'passport'), 'fail');
});

test("a container app's deploy stub: missing and edited fail, the builder's own is a warning", () => {
  const dir = governed();
  assert.equal(status(verify({ dir }), 'deploy-stub'), 'pass');

  put(dir, '.github/workflows/deploy.yml', read(dir, '.github/workflows/deploy.yml').replaceAll('\n', '\r\n'));
  assert.equal(status(verify({ dir }), 'deploy-stub'), 'pass');

  put(dir, '.github/workflows/deploy.yml', `${read(dir, '.github/workflows/deploy.yml')}      extra: true\n`);
  assert.equal(status(verify({ dir }), 'deploy-stub'), 'fail');

  put(dir, '.github/workflows/deploy.yml', 'name: deploy\non: push\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ./deploy.sh\n');
  const own = verify({ dir });
  assert.equal(own.ok, true);
  assert.equal(status(own, 'deploy-stub'), 'warn');
  assert.match(message(own, 'deploy-stub'), /publish request/);

  rmSync(join(dir, '.github/workflows/deploy.yml'));
  assert.equal(status(verify({ dir }), 'deploy-stub'), 'fail');
});

test('a Pages site has no deploy stub check', () => {
  const dir = paved('pages');
  rmSync(join(dir, '.github/workflows/deploy.yml'));
  assert.equal(status(verify({ dir }), 'deploy-stub'), undefined);
});
