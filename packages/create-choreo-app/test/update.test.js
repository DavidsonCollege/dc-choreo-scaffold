// Tests for src/update.js: bringing PE's files current without touching the
// builder's own text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { governance } from '../src/governance.js';
import { update, compareVersions } from '../src/update.js';
import { hashOf, readTemplate } from '../src/files.js';
import { answers, fixture, put, read, tmpApp } from './helpers.js';

const today = new Date(2026, 9, 12);

/** A governed app whose files look like an older release, edited here and there. */
function olderApp() {
  const dir = tmpApp();
  governance({ dir, answers: answers(), tier: 'container', today });
  put(dir, 'AGENTS.md', fixture('AGENTS-v1.md'));
  put(dir, 'CLAUDE.md', '@AGENTS.md\n\nAlso read the wiki.\n');
  put(dir, 'BUILDER.md', '# Building notes\n\nOur own notes.\n');
  put(dir, '.github/CODEOWNERS', '/src/ @example-builder\n\n# Managed by Platform Engineering. An old block.\n/PASSPORT.yml @someone-else\n');
  const passport = read(dir, 'PASSPORT.yml')
    .replace('scaffolded_with: "@davidson/create-choreo-app@0.1.0"', '# A builder comment.\nscaffolded_with: "@davidson/create-choreo-app@0.0.9"')
    .replaceAll('\n', '\r\n');
  put(dir, 'PASSPORT.yml', passport);
  return dir;
}

test('update brings the governance files current', () => {
  const dir = olderApp();
  const result = update({ dir });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.from, '0.0.9');
  assert.equal(result.to, '0.1.0');
  assert.equal(hashOf(read(dir, 'AGENTS.md')), hashOf(readTemplate('AGENTS.md')));
  assert.equal(read(dir, 'CLAUDE.md'), '@AGENTS.md\n');
});

test("update keeps the builder's CODEOWNERS lines and replaces PE's block", () => {
  const dir = olderApp();
  update({ dir });
  const text = read(dir, '.github/CODEOWNERS');
  assert.ok(text.startsWith('/src/ @example-builder\n\n'));
  assert.equal(text.includes('@someone-else'), false);
  assert.ok(text.endsWith(readTemplate('CODEOWNERS')));
});

test('update changes only the scaffolded_with line of the passport', () => {
  const dir = olderApp();
  const before = read(dir, 'PASSPORT.yml');
  update({ dir });
  const after = read(dir, 'PASSPORT.yml');
  assert.equal(after, before.replace('create-choreo-app@0.0.9"', 'create-choreo-app@0.1.0"'));
  assert.ok(after.includes('# A builder comment.\r\n'));
});

test('update never touches BUILDER.md', () => {
  const dir = olderApp();
  update({ dir });
  assert.equal(read(dir, 'BUILDER.md'), '# Building notes\n\nOur own notes.\n');
});

test('running update twice changes nothing the second time', () => {
  const dir = olderApp();
  update({ dir });
  const second = update({ dir });
  assert.equal(second.ok, true);
  assert.deepEqual(second.written, []);
});

test('update refuses to go backwards', () => {
  const dir = olderApp();
  const result = update({ dir, version: '0.0.1' });
  assert.equal(result.ok, false);
  assert.match(result.problems[0].message, /newer than this package/);
  assert.equal(read(dir, 'AGENTS.md'), fixture('AGENTS-v1.md'));
});

test('update refuses a passport with two scaffolded_with lines', () => {
  const dir = olderApp();
  put(dir, 'PASSPORT.yml', `${read(dir, 'PASSPORT.yml')}scaffolded_with: "@davidson/create-choreo-app@0.0.8"\n`);
  const result = update({ dir });
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].field, 'scaffolded_with');
});

test('update refuses an app without a passport', () => {
  const result = update({ dir: tmpApp() });
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].field, 'PASSPORT.yml');
});

test('versions compare by number, not by text', () => {
  assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
  assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
  assert.equal(compareVersions('2.3.4', '2.3.4'), 0);
});
