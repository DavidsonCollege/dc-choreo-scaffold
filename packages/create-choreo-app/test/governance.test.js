// Tests for src/governance.js: PE's files for an app off the paved road.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { governance } from '../src/governance.js';
import { hashOf, readTemplate } from '../src/files.js';
import { answers, listFiles, put, read, tmpApp } from './helpers.js';

const today = new Date(2026, 9, 12);
const run = (dir, extra = {}) => governance({ dir, answers: answers(), tier: 'container', today, ...extra });

test('an empty folder gets every governance file and a non-paved passport', () => {
  const dir = tmpApp();
  const result = run(dir);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.deepEqual(listFiles(dir), ['.github/CODEOWNERS', 'AGENTS.md', 'BUILDER.md', 'CLAUDE.md', 'LICENSE', 'PASSPORT.yml']);
  assert.equal(hashOf(read(dir, 'AGENTS.md')), hashOf(readTemplate('AGENTS.md')));
  assert.equal(read(dir, 'CLAUDE.md'), '@AGENTS.md\n');
  assert.match(read(dir, 'PASSPORT.yml'), /^road: "non-paved"$/m);
  assert.match(read(dir, 'PASSPORT.yml'), /^stack: "other"$/m);
  assert.match(read(dir, 'PASSPORT.yml'), /^app: "example-app"$/m);
});

test('governance files are written with LF line endings', () => {
  const dir = tmpApp();
  run(dir);
  for (const path of ['AGENTS.md', 'CLAUDE.md', '.github/CODEOWNERS', 'PASSPORT.yml']) {
    assert.equal(read(dir, path).includes('\r'), false, path);
  }
});

test("an existing AGENTS.md that isn't PE's moves into BUILDER.md", () => {
  const dir = tmpApp();
  put(dir, 'AGENTS.md', '# Our notes\n\nRun the tests with make test.\n');
  const result = run(dir);
  assert.equal(result.ok, true);
  assert.deepEqual(result.moved, ['AGENTS.md']);
  assert.match(read(dir, 'BUILDER.md'), /## Moved from the old AGENTS\.md\n\n# Our notes\n\nRun the tests with make test\./);
  assert.equal(hashOf(read(dir, 'AGENTS.md')), hashOf(readTemplate('AGENTS.md')));
});

test("a builder's CODEOWNERS keeps their lines, with PE's block last, where GitHub finds it", () => {
  const dir = tmpApp();
  put(dir, 'CODEOWNERS', '/src/ @example-builder\r\n');
  const result = run(dir);
  assert.equal(result.ok, true);
  assert.ok(result.written.includes('CODEOWNERS'));
  assert.equal(listFiles(dir).includes('.github/CODEOWNERS'), false);
  const text = read(dir, 'CODEOWNERS');
  assert.ok(text.startsWith('/src/ @example-builder\n\n# Managed by Platform Engineering.'));
  assert.ok(text.trimEnd().endsWith('/CLAUDE.md @DavidsonChoreo/platform-engineering'));
});

test('an Apache-2.0 LICENSE already there is kept', () => {
  const dir = tmpApp();
  put(dir, 'LICENSE.md', 'Apache License, Version 2.0 (the existing copy)\n');
  const result = run(dir);
  assert.equal(result.ok, true);
  assert.equal(result.written.includes('LICENSE'), false);
  assert.equal(read(dir, 'LICENSE.md'), 'Apache License, Version 2.0 (the existing copy)\n');
});

test('another license stops governance before anything is written', () => {
  const dir = tmpApp();
  put(dir, 'LICENSE', 'Permission is hereby granted, free of charge, to any person obtaining a copy\n');
  const result = run(dir);
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].field, 'LICENSE');
  assert.deepEqual(listFiles(dir), ['LICENSE']);
});

test('an existing passport stops governance before anything is written', () => {
  const dir = tmpApp();
  put(dir, 'PASSPORT.yml', 'passport: 1\n');
  const result = run(dir);
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].field, 'PASSPORT.yml');
  assert.deepEqual(listFiles(dir), ['PASSPORT.yml']);
});

test('bad answers stop governance before anything is written', () => {
  const dir = tmpApp();
  const bad = { ...answers(), incident_contact: { name: 'Dana Example', email: 'daexample@davidson.edu' } };
  const result = governance({ dir, answers: bad, tier: 'container', today });
  assert.equal(result.ok, false);
  assert.deepEqual(listFiles(dir), []);
});

test("a folder name that can't be a repository name is refused", () => {
  const dir = tmpApp('Example App');
  const result = run(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.field === 'app'));
});

test('a folder that does not exist is refused', () => {
  const result = run(`${tmpApp()}-missing`);
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].field, '(the folder)');
});
