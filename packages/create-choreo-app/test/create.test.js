// Tests for src/create.js: a new paved-road app for each tier, what it holds,
// and what create refuses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create, layerRelease } from '../src/create.js';
import { verify } from '../src/verify.js';
import { MANIFEST, PACKAGE_VERSION } from '../src/files.js';
import { answers, listFiles, read } from './helpers.js';

const today = new Date(2026, 9, 12);
const parent = () => mkdtempSync(join(tmpdir(), 'choreo-create-'));
const make = (tier, extra = {}) => {
  const where = parent();
  const file = tier === 'pages' ? 'answers-pages.json' : 'answers-container.json';
  const result = create({ name: 'example-app', tier, answers: answers(file), parent: where, today, ...extra });
  return { result, dir: join(where, 'example-app') };
};

const COMMON = [
  '.gitattributes', '.github/CODEOWNERS', '.github/dependabot.yml', '.gitignore', '.npmrc', '.nvmrc',
  'AGENTS.md', 'BUILDER.md', 'CLAUDE.md', 'LICENSE', 'PASSPORT.yml',
  'app/app.vue', 'app/pages/index.vue', 'eslint.config.mjs', 'knip.jsonc', 'nuxt.config.ts', 'package.json', 'tsconfig.json',
];

test('a container app gets the template, the Containerfile and every governance file', () => {
  const { result, dir } = make('container');
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.deepEqual(listFiles(dir), [...COMMON, '.dockerignore', 'Containerfile'].sort());
  assert.deepEqual(result.written, listFiles(dir));
});

test('a Pages site gets no Containerfile and no server folder', () => {
  const { result, dir } = make('pages');
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.deepEqual(listFiles(dir), [...COMMON].sort());
  assert.equal(listFiles(dir).some((path) => path.startsWith('server/')), false);
});

test('package.json has the tier build script, exact versions and the layer release', () => {
  const container = JSON.parse(read(make('container').dir, 'package.json'));
  const pages = JSON.parse(read(make('pages').dir, 'package.json'));
  assert.equal(container.scripts.build, 'nuxt build');
  assert.equal(pages.scripts.build, 'nuxt generate');
  assert.equal(container.engines.node, MANIFEST.node.engines);
  assert.equal(container.dependencies['@davidson/choreo-layer'], layerRelease(PACKAGE_VERSION));
  assert.match(layerRelease('1.2.3'), /\/releases\/download\/v1\.2\.3\/davidson-choreo-layer-1\.2\.3\.tgz$/);
  assert.deepEqual(container.overrides, MANIFEST.overrides);
  assert.equal('vue-router' in container.dependencies, false);
  for (const [name, version] of Object.entries({ ...MANIFEST.dependencies, ...MANIFEST.devDependencies })) {
    assert.equal(container.dependencies[name] ?? container.devDependencies[name], version, name);
  }
});

test('the passport is on the paved road with the right tier', () => {
  const text = read(make('container').dir, 'PASSPORT.yml');
  assert.match(text, /^road: "paved"$/m);
  assert.match(text, /^stack: "nuxt"$/m);
  assert.match(text, /^ {2}tier: "container"$/m);
  assert.match(text, /^app: "example-app"$/m);
});

test('Dependabot watches the base image only for a container app', () => {
  assert.match(read(make('container').dir, '.github/dependabot.yml'), /package-ecosystem: docker/);
  assert.doesNotMatch(read(make('pages').dir, '.github/dependabot.yml'), /package-ecosystem: docker/);
});

test('the Containerfile meets the tier check: pinned images, a non-root user, a health check', () => {
  const text = read(make('container').dir, 'Containerfile');
  const froms = text.split('\n').filter((line) => line.startsWith('FROM '));
  assert.equal(froms.length, 2);
  for (const line of froms) assert.match(line.split(/\s+/)[1], /@sha256:[a-f0-9]{64}$/);
  const final = text.slice(text.lastIndexOf('FROM '));
  assert.match(final, /^USER node$/m);
  assert.match(final, /^HEALTHCHECK .*localhost:3000\/health/m);
  assert.match(final, /^EXPOSE 3000$/m);
});

test('.gitignore keeps credentials out', () => {
  const text = read(make('pages').dir, '.gitignore');
  for (const pattern of ['.env', '.env.*', '!.env.example', '*.pem', '*.key', '*.pfx', '*.p12']) {
    assert.ok(text.split('\n').includes(pattern), pattern);
  }
});

test('every file is written with LF line endings', () => {
  const { dir } = make('container');
  for (const path of listFiles(dir)) assert.equal(read(dir, path).includes('\r'), false, path);
});

test('verify passes on a new app once the lockfile exists', () => {
  for (const tier of ['pages', 'container']) {
    const { dir } = make(tier);
    assert.equal(verify({ dir }).checks.find((c) => c.id === 'lockfile').status, 'fail');
    writeFileSync(join(dir, 'package-lock.json'), '{}\n');
    const result = verify({ dir });
    assert.ok(result.checks.every((c) => c.status === 'pass'), JSON.stringify(result.checks.filter((c) => c.status !== 'pass')));
  }
});

test('a folder that is not empty is refused unless --force', () => {
  const where = parent();
  mkdirSync(join(where, 'example-app'));
  writeFileSync(join(where, 'example-app', 'notes.txt'), 'x');
  const refused = create({ name: 'example-app', tier: 'container', answers: answers(), parent: where, today });
  assert.equal(refused.ok, false);
  assert.deepEqual(listFiles(join(where, 'example-app')), ['notes.txt']);
  const forced = create({ name: 'example-app', tier: 'container', answers: answers(), parent: where, today, force: true });
  assert.equal(forced.ok, true);
  assert.ok(listFiles(join(where, 'example-app')).includes('notes.txt'));
});

test("a name that can't be a repository name is refused", () => {
  const where = parent();
  const result = create({ name: 'Example App', tier: 'container', answers: answers(), parent: where, today });
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].field, 'app');
  assert.deepEqual(listFiles(where), []);
});

test('bad answers write nothing, not even the folder', () => {
  const where = parent();
  const result = create({ name: 'example-app', tier: 'pages', answers: answers('answers-container.json'), parent: where, today });
  assert.equal(result.ok, false);
  assert.equal(existsSync(join(where, 'example-app')), false);
});

test('the next steps install, start git and run the app', () => {
  const { result } = make('pages');
  assert.deepEqual(result.next.slice(0, 3), ['cd example-app', 'npm install', 'git init']);
});
