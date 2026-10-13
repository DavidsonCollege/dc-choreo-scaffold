// Tests for bin/create-choreo-app.js: the command line an agent runs, its JSON
// output and its exit codes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listFiles, tmpApp } from './helpers.js';

const BIN = fileURLToPath(new URL('../bin/create-choreo-app.js', import.meta.url));
const ANSWERS = fileURLToPath(new URL('./fixtures/answers-container.json', import.meta.url));

/** Runs the command line and returns its exit code and output. */
function cli(...args) {
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('governance with --json writes the files and prints one JSON object', () => {
  const dir = tmpApp();
  const { code, stdout } = cli('governance', dir, '--tier', 'container', '--answers', ANSWERS, '--json', '--yes');
  assert.equal(code, 0);
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.command, 'governance');
  assert.ok(listFiles(dir).includes('PASSPORT.yml'));
});

test('verify after governance exits 0; an edit makes it exit 1', () => {
  const dir = tmpApp();
  cli('governance', dir, '--tier', 'container', '--answers', ANSWERS);
  assert.equal(cli('verify', dir).code, 0);
  spawnSync(process.execPath, ['-e', `require('fs').appendFileSync(${JSON.stringify(`${dir}/AGENTS.md`)}, 'x')`]);
  const { code, stdout } = cli('verify', dir);
  assert.equal(code, 1);
  assert.match(stdout, /^FAIL agents: AGENTS\.md has been edited/m);
});

test('a refused governance run exits 1 and names the problem', () => {
  const dir = tmpApp('Not A Repo Name');
  const { code, stdout } = cli('governance', dir, '--tier', 'container', '--answers', ANSWERS);
  assert.equal(code, 1);
  assert.match(stdout, /^problem: app /m);
});

test('a missing --tier is a usage mistake, exit 2', () => {
  const { code, stdout } = cli('governance', tmpApp(), '--answers', ANSWERS, '--json');
  assert.equal(code, 2);
  assert.match(JSON.parse(stdout).problems[0].message, /--tier/);
});

test('an unreadable answers file is a usage mistake, exit 2', () => {
  const { code, stderr } = cli('governance', tmpApp(), '--tier', 'pages', '--answers', 'no-such-file.json');
  assert.equal(code, 2);
  assert.match(stderr, /Couldn't read the answers file/);
});

test('an unknown command or flag is a usage mistake, exit 2', () => {
  assert.equal(cli('deploy').code, 2);
  assert.equal(cli('verify', '--colour').code, 2);
});

test('--help prints the usage and exits 0', () => {
  const { code, stdout } = cli('--help');
  assert.equal(code, 0);
  assert.match(stdout, /^Usage:/m);
});
