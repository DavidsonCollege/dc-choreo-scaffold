// Tests for src/doctor.js, with stand-ins for commands and the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doctor, satisfies } from '../src/doctor.js';

const allGood = (command, args) => ({ status: 0, stdout: `${command} ${args.join(' ')} 1.0.0\n` });
const online = async () => ({ ok: true, status: 200 });
const status = (result, id) => result.checks.find((c) => c.id === id)?.status;

test('a ready computer passes every check', async () => {
  const result = await doctor({ run: allGood, fetch: online, nodeVersion: '22.22.3' });
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.deepEqual(result.checks.map((c) => c.id), ['node', 'npm', 'git', 'gh', 'gh-auth', 'registry', 'github']);
});

test('Node 24 passes; Node 20 and an old 22 fail', async () => {
  assert.equal(status(await doctor({ run: allGood, fetch: online, nodeVersion: '24.18.0' }), 'node'), 'pass');
  assert.equal(status(await doctor({ run: allGood, fetch: online, nodeVersion: '20.19.0' }), 'node'), 'fail');
  assert.equal(status(await doctor({ run: allGood, fetch: online, nodeVersion: '22.21.0' }), 'node'), 'fail');
});

test('a missing GitHub CLI fails, and its sign-in is not checked', async () => {
  const noGh = (command, args) => (command === 'gh' ? { status: 1, stdout: '' } : allGood(command, args));
  const result = await doctor({ run: noGh, fetch: online, nodeVersion: '22.22.3' });
  assert.equal(status(result, 'gh'), 'fail');
  assert.equal(status(result, 'gh-auth'), undefined);
});

const message = (result, id) => result.checks.find((c) => c.id === id)?.message;

// Every install message names Make Me Admin, and asks T&I only when it isn't there.
function assertSelfInstall(text) {
  assert.match(text, /Make Me Admin/);
  assert.match(text, /30 minutes/);
  assert.match(text, /Self Service on a Mac/);
  assert.match(text, /Make Me Admin app on Windows/);
  assert.match(text, /If Make Me Admin isn't on the laptop, ask T&I\.$/);
  assert.doesNotMatch(text, /Ask T&I (to install|for the managed)/);
  assert.doesNotMatch(text, /\u2014/);
}

test('an old Node says to install the right version from nodejs.org with Make Me Admin', async () => {
  const text = message(await doctor({ run: allGood, fetch: online, nodeVersion: '20.19.0' }), 'node');
  assert.match(text, /Install Node 22 from nodejs\.org; npm comes with it\./);
  assertSelfInstall(text);
});

test('missing npm, git and GitHub CLI each name their official installer and Make Me Admin', async () => {
  const nothing = () => ({ status: 1, stdout: '' });
  const result = await doctor({ run: nothing, fetch: online, nodeVersion: '22.22.3' });
  assert.match(message(result, 'npm'), /npm comes with Node: install Node 22 from nodejs\.org\./);
  assert.match(message(result, 'git'), /On a Mac, run `xcode-select --install`; on Windows, install it from git-scm\.com\./);
  assert.match(message(result, 'gh'), /^The GitHub CLI isn't installed.*Install it from cli\.github\.com\./);
  for (const id of ['npm', 'git', 'gh']) assertSelfInstall(message(result, id));
});

test('a signed-out GitHub CLI warns with how to sign in, and the computer is still ready', async () => {
  const signedOut = (command, args) => (args[0] === 'auth' ? { status: 1, stdout: 'not logged in' } : allGood(command, args));
  const result = await doctor({ run: signedOut, fetch: online, nodeVersion: '22.22.3' });
  assert.equal(status(result, 'gh-auth'), 'warn');
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.match(result.checks.find((c) => c.id === 'gh-auth').message, /gh auth login/);
});

test('an untrusted certificate is explained as network inspection', async () => {
  const intercepted = async () => {
    const error = new TypeError('fetch failed');
    error.cause = { code: 'SELF_SIGNED_CERT_IN_CHAIN' };
    throw error;
  };
  const result = await doctor({ run: allGood, fetch: intercepted, nodeVersion: '22.22.3' });
  assert.equal(result.ok, false);
  const message = result.checks.find((c) => c.id === 'registry').message;
  assert.match(message, /inspecting encrypted traffic/);
  assert.match(message, /don't turn certificate checks off/);
});

test('an unreachable endpoint fails', async () => {
  const offline = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
  const result = await doctor({ run: allGood, fetch: offline, nodeVersion: '22.22.3' });
  assert.equal(status(result, 'github'), 'fail');
});

test('version ranges read the same major and at least the minor and patch', () => {
  const range = '^22.22.3 || ^24.15.0';
  assert.equal(satisfies('22.22.3', range), true);
  assert.equal(satisfies('22.30.0', range), true);
  assert.equal(satisfies('24.15.0', range), true);
  assert.equal(satisfies('23.0.0', range), false);
  assert.equal(satisfies('24.14.9', range), false);
  assert.throws(() => satisfies('22.0.0', '>=22'), /only reads ranges like/);
});
