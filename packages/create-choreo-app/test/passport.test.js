// Tests for src/passport.js: building a passport from answers, the fields the
// package owns, what it refuses, and YAML that reads back exactly under the
// YAML 1.1 parser the passport check uses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buildPassport, toYaml, formatDate } from '../src/passport.js';

const schema = JSON.parse(readFileSync(new URL('../src/schema/passport-v1.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
addFormats(ajv);
ajv.addKeyword('x-ready-call-fields');
const ajvValidate = ajv.compile(schema);

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const today = new Date(2026, 9, 12);
const container = (answers, extra = {}) => buildPassport({
  answers, app: 'practice-booking', tier: 'container', road: 'paved', version: '0.1.0', today, ...extra,
});

/** Reads YAML the way the passport check does. */
function readBack(text) {
  const doc = parseDocument(text, { schema: 'yaml-1.1' });
  assert.deepEqual(doc.errors, []);
  return doc.toJS();
}

test('a container passport is built with the fields the package owns', () => {
  const result = container(load('answers-container.json'));
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const p = result.passport;
  assert.equal(p.passport, 1);
  assert.equal(p.app, 'practice-booking');
  assert.equal(p.created, '2026-10-12');
  assert.equal(p.review, '2027-10-12');
  assert.equal(p.license, 'Apache-2.0');
  assert.equal(p.road, 'paved');
  assert.equal(p.stack, 'nuxt');
  assert.equal(p.scaffolded_with, '@davidson/create-choreo-app@0.1.0');
  assert.equal(p.profile.tier, 'container');
  assert.equal(p.profile.driver, 'person');
  assert.equal('incident_contact' in p, false);
});

test('fields come out in the schema order', () => {
  const p = container(load('answers-container.json')).passport;
  const expected = Object.keys(schema.properties).filter((key) => key !== 'incident_contact');
  assert.deepEqual(Object.keys(p), expected);
  assert.deepEqual(Object.keys(p.profile), Object.keys(schema.properties.profile.properties));
});

for (const [tier, file] of [['container', 'answers-container.json'], ['pages', 'answers-pages.json']]) {
  test(`a ${tier} passport reads back exactly and passes ajv`, () => {
    const result = buildPassport({ answers: load(file), app: 'example-app', tier, road: 'paved', version: '0.1.0', today });
    assert.equal(result.ok, true, JSON.stringify(result.problems));
    const back = readBack(toYaml(result.passport));
    assert.deepEqual(back, result.passport);
    assert.equal(ajvValidate(back), true, JSON.stringify(ajvValidate.errors));
  });
}

test('governance writes the non-paved road', () => {
  const result = container(load('answers-container.json'), { road: 'non-paved' });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.passport.road, 'non-paved');
  assert.equal(result.passport.stack, 'other');
});

test('awkward text survives the round trip', () => {
  const answers = load('answers-container.json');
  answers.purpose = 'Quotes "like this", a colon: here, # not a comment, yes, no, null, a tab\tand\na newline, \u2028 a line separator and caf\u00e9.';
  answers.department = 'yes';
  const result = container(answers);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const back = readBack(toYaml(result.passport));
  assert.equal(back.purpose, answers.purpose);
  assert.equal(back.department, 'yes');
});

test('dates are quoted, so YAML 1.1 reads them as text', () => {
  const text = toYaml(container(load('answers-container.json')).passport);
  assert.match(text, /^created: "2026-10-12"$/m);
  assert.match(text, /^review: "2027-10-12"$/m);
  assert.equal(typeof readBack(text).created, 'string');
});

test('small objects are written on one line, the profile as a block', () => {
  const text = toYaml(container(load('answers-container.json')).passport);
  assert.match(text, /^business_owner: \{ name: "Morgan Example", email: "moexample@davidson\.edu" \}$/m);
  assert.match(text, /^profile:\n {2}door: "interact"\n/m);
  assert.match(text, /^regulations: \[\]$/m);
  assert.match(text, /^roles:\n {2}- "viewer"$/m);
});

test('the date is the local day, not the UTC one', () => {
  assert.equal(formatDate(new Date(2026, 9, 12, 23, 30)), '2026-10-12');
});

test('a leap-day passport is reviewed on February 28', () => {
  const result = container(load('answers-container.json'), { today: new Date(2028, 1, 29) });
  assert.equal(result.passport.created, '2028-02-29');
  assert.equal(result.passport.review, '2029-02-28');
});

test('an unknown answer is named', () => {
  const answers = { ...load('answers-container.json'), colour: 'blue' };
  const result = container(answers);
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.map((p) => p.field), ['colour']);
});

test('an incident contact in the answers is refused with the reason', () => {
  const answers = { ...load('answers-container.json'), incident_contact: { name: 'Dana Example', email: 'daexample@davidson.edu' } };
  const result = container(answers);
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].field, 'incident_contact');
  assert.match(result.problems[0].message, /every app's incident contact/);
  assert.equal('incident_contact' in result.passport, false);
});

test('answers can not change a field the package owns', () => {
  const answers = { ...load('answers-container.json'), created: '2020-01-01', license: 'MIT' };
  answers.profile = { ...answers.profile, tier: 'pages' };
  const fields = container(answers).problems.map((p) => p.field);
  assert.ok(fields.includes('created'));
  assert.ok(fields.includes('license'));
  assert.ok(fields.includes('profile.tier'));
});

test('answers may repeat a package-owned value unchanged', () => {
  const answers = { ...load('answers-container.json'), app: 'practice-booking', license: 'Apache-2.0' };
  assert.equal(container(answers).ok, true);
});

test('an app name that differs from the repository name is refused', () => {
  const answers = { ...load('answers-container.json'), app: 'something-else' };
  assert.deepEqual(container(answers).problems.map((p) => p.field), ['app']);
});

test('the business owner can not be an app owner', () => {
  const answers = load('answers-container.json');
  answers.business_owner = { ...answers.app_owners[0] };
  const result = container(answers);
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.map((p) => p.field), ['business_owner']);
});

test('a prerelease package version can not write a passport', () => {
  const result = container(load('answers-container.json'), { version: '0.1.0-beta.1' });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.field === 'scaffolded_with'));
});

test('Pages answers on the container tier fail the role rule', () => {
  const result = container(load('answers-pages.json'));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.field === 'roles'));
});

test('answers that are not an object are refused', () => {
  const result = container(['not', 'an', 'object']);
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].field, '(the answers)');
});
