// Tests for src/validate.js: the CLI's small schema checker must give the same
// verdict as ajv, the validator the passport check in dc-choreo-workflows uses,
// on a valid passport and on many broken ones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { compile } from '../src/validate.js';
import { buildPassport } from '../src/passport.js';

const schema = JSON.parse(readFileSync(new URL('../src/schema/passport-v1.json', import.meta.url), 'utf8'));
const answers = JSON.parse(readFileSync(new URL('./fixtures/answers-container.json', import.meta.url), 'utf8'));

// The same ajv setup as dc-choreo-workflows' checks/passport.js.
const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
addFormats(ajv);
ajv.addKeyword('x-ready-call-fields');
const ajvValidate = ajv.compile(schema);
const ours = compile(schema);

const base = buildPassport({
  answers, app: 'practice-booking', tier: 'container', road: 'paved', version: '0.1.0', today: new Date(2026, 9, 12),
}).passport;

/** A deep copy of the valid passport with one change applied. */
function variant(change) {
  const copy = structuredClone(base);
  change(copy);
  return copy;
}

test('the valid passport passes both validators', () => {
  assert.equal(ajvValidate(base), true, JSON.stringify(ajvValidate.errors));
  assert.deepEqual(ours(base), []);
});

const broken = {
  'an unknown field': (p) => { p.colour = 'blue'; },
  'an unknown profile field': (p) => { p.profile.colour = 'blue'; },
  'passport version 2': (p) => { p.passport = 2; },
  'an app name with capitals': (p) => { p.app = 'Practice-Booking'; },
  'a short purpose': (p) => { p.purpose = 'Too short'; },
  'no app owners': (p) => { p.app_owners = []; },
  'the same app owner twice': (p) => { p.app_owners.push({ ...p.app_owners[0] }); },
  'an email outside davidson.edu': (p) => { p.business_owner.email = 'morgan@gmail.com'; },
  'a one-letter name': (p) => { p.business_owner.name = 'M'; },
  'an extra person field': (p) => { p.business_owner.phone = '000'; },
  'an incident contact with a bad email': (p) => { p.incident_contact = { name: 'Dana Example', email: 'dana@gmail.com' }; },
  'February 30': (p) => { p.created = '2026-02-30'; },
  'month 13': (p) => { p.review = '2027-13-01'; },
  'a date without dashes': (p) => { p.review = '20271012'; },
  'an unknown door': (p) => { p.profile.door = 'move'; },
  'clearance as text': (p) => { p.profile.clearance = 'true'; },
  'an unknown tier': (p) => { p.profile.tier = 'swa'; },
  'a custom domain with capitals': (p) => { p.custom_domain = 'Hours.Davidson.edu'; },
  'a custom domain that is a URL': (p) => { p.custom_domain = 'https://hours.davidson.edu'; },
  'a license with a space': (p) => { p.license = 'Apache 2.0'; },
  'the paved road on another stack': (p) => { p.stack = 'other'; },
  'a prerelease scaffold version': (p) => { p.scaffolded_with = '@davidson/create-choreo-app@1.0.0-rc.1'; },
  'another package in scaffolded_with': (p) => { p.scaffolded_with = 'create-choreo-app@1.0.0'; },
  'an empty built_with': (p) => { p.built_with = ''; },
  'an unknown regulation': (p) => { p.regulations = ['sox']; },
  'the same regulation twice': (p) => { p.regulations = ['ferpa', 'ferpa']; },
  'a role starting with a digit': (p) => { p.roles = ['1viewer']; },
  'a container app with no roles': (p) => { p.roles = []; },
  'a Pages site with roles': (p) => { p.profile.tier = 'pages'; p.profile.audience = 'public'; p.profile.data_classification = 'public'; },
  'a Pages site with Internal data': (p) => { p.profile.tier = 'pages'; p.profile.audience = 'public'; p.roles = []; },
  'an integration without a purpose': (p) => { p.integrations = [{ platform: 'Example', data_classification: 'internal' }]; },
  'an llm without live_data': (p) => { p.llm = { provider: 'anthropic' }; },
  'an llm with an extra field': (p) => { p.llm = { provider: 'anthropic', live_data: false, model: 'x' }; },
  'an llm as text': (p) => { p.llm = 'anthropic'; },
  'an app that writes with no retention': (p) => { p.retention = []; },
  'negative keep_days': (p) => { p.retention[0].keep_days = -1; },
  'fractional keep_days': (p) => { p.retention[0].keep_days = 1.5; },
  'retention without data': (p) => { p.retention = [{ keep_days: 30 }]; },
};

for (const [name, change] of Object.entries(broken)) {
  test(`both validators reject ${name}`, () => {
    const passport = variant(change);
    assert.equal(ajvValidate(passport), false, 'ajv accepted it');
    assert.notDeepEqual(ours(passport), [], 'src/validate.js accepted it');
  });
}

for (const field of schema.required) {
  test(`both validators reject a passport missing ${field}`, () => {
    const passport = variant((p) => { delete p[field]; });
    assert.equal(ajvValidate(passport), false);
    assert.ok(ours(passport).some((problem) => problem.field === field && problem.message === 'is missing'));
  });
}

const fine = {
  'a real custom domain': (p) => { p.custom_domain = 'hours.davidson.edu'; },
  'an llm with live data': (p) => { p.llm = { provider: 'anthropic', live_data: true }; },
  'an integration': (p) => { p.integrations = [{ platform: 'Example', purpose: 'reads open sessions', data_classification: 'internal' }]; },
  'a leap day': (p) => { p.created = '2028-02-29'; },
  'a deprecated incident contact': (p) => { p.incident_contact = { name: 'Dana Example', email: 'daexample@davidson.edu' }; },
  'the non-paved road': (p) => { p.road = 'non-paved'; p.stack = 'other'; },
};

for (const [name, change] of Object.entries(fine)) {
  test(`both validators accept ${name}`, () => {
    const passport = variant(change);
    assert.equal(ajvValidate(passport), true, JSON.stringify(ajvValidate.errors));
    assert.deepEqual(ours(passport), []);
  });
}

test('a problem names the field the way a builder reads it', () => {
  const problems = ours(variant((p) => { p.app_owners[0].email = 'dana@gmail.com'; }));
  assert.deepEqual(problems.map((problem) => problem.field), ['app_owners[0].email']);
});

test('a schema keyword the checker does not know stops compile', () => {
  assert.throws(() => compile({ type: 'string', maxLength: 5 }), /`maxLength`/);
  assert.throws(() => compile({ properties: { a: { dependentRequired: {} } } }), /`dependentRequired`/);
});
