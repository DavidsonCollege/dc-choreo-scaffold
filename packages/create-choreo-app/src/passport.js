// @ts-check
// Builds PASSPORT.yml from a builder's answers.
//
// The plugin's scaffold skill turns the discovery summary into an answers file
// (JSON). buildPassport() merges those answers with the fields the package sets
// itself, then checks the result against the passport schema and the one rule
// the schema can't express. toYaml() writes the result in a fixed field order,
// with every string in double quotes, so the output is the same every time and
// reads back exactly under the YAML 1.1 parser the passport check uses.
//
// Input: the answers object and the package's own settings (app name, tier,
//        road, package version, today's date).
// Output: { ok, passport, problems }, and the YAML text of a passport.

import { readFileSync } from 'node:fs';
import { compile } from './validate.js';

/** @typedef {import('./validate.js').Problem} Problem */
/** @typedef {'pages' | 'container'} Tier */
/** @typedef {'paved' | 'non-paved'} Road */

const schema = JSON.parse(readFileSync(new URL('./schema/passport-v1.json', import.meta.url), 'utf8'));
const validatePassport = compile(schema);

// Fields the answers may no longer carry, with the reason the builder sees.
const RETIRED_FIELDS = {
  incident_contact: "Platform Engineering is every app's incident contact, so the passport doesn't name one. Leave it out of the answers.",
};

// The order fields appear in PASSPORT.yml: the schema's order, minus retired fields.
const FIELD_ORDER = Object.keys(schema.properties).filter((key) => !(key in RETIRED_FIELDS));
const PROFILE_ORDER = Object.keys(schema.properties.profile.properties);

const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;
const PACKAGE_NAME = '@davidson/create-choreo-app';
const LICENSE = 'Apache-2.0';
const STACK_FOR_ROAD = { paved: 'nuxt', 'non-paved': 'other' };

// Flow style (`{ name: "...", email: "..." }`) for an object with at most this
// many fields, all of them plain values; block style for anything bigger.
const FLOW_MAX_FIELDS = 3;

// Characters JSON.stringify leaves alone that YAML treats as line breaks or
// control characters, so they're written as \u escapes too.
const YAML_UNSAFE = new RegExp('[\u0085\u2028\u2029\u007f-\u009f]', 'g');

/**
 * Builds a passport from the builder's answers and the package's own settings.
 *
 * @param {object} options
 * @param {unknown} options.answers The parsed answers file.
 * @param {string} options.app The app's name, which is also its repository name.
 * @param {Tier} options.tier The hosting tier, from --tier.
 * @param {Road} options.road The road: create is paved, governance is non-paved.
 * @param {string} options.version This package's version, such as 0.1.0.
 * @param {Date} options.today The day the passport is written.
 * @returns {{ ok: boolean, passport: Record<string, unknown>, problems: Problem[] }}
 *   The passport in field order, and every problem found. ok is true only when
 *   there are none.
 */
export function buildPassport({ answers, app, tier, road, version, today }) {
  /** @type {Problem[]} */
  const problems = [];

  if (!RELEASE_VERSION.test(version)) {
    problems.push({ field: 'scaffolded_with', message: `the package version ${version} isn't a release version (X.Y.Z), so it can't go in a passport` });
  }
  if (!isPlainObject(answers)) {
    problems.push({ field: '(the answers)', message: 'have to be a JSON object of passport fields' });
    return { ok: false, passport: {}, problems };
  }
  const given = /** @type {Record<string, unknown>} */ (answers);

  const created = formatDate(today);
  /** @type {Record<string, unknown>} */
  const owned = {
    passport: 1,
    app,
    created,
    review: oneYearLater(today),
    license: LICENSE,
    road,
    stack: STACK_FOR_ROAD[road],
    scaffolded_with: `${PACKAGE_NAME}@${version}`,
  };
  /** @type {Record<string, unknown>} */
  const ownedProfile = { driver: 'person', tier };

  for (const [key, reason] of Object.entries(RETIRED_FIELDS)) {
    if (key in given) problems.push({ field: key, message: reason });
  }
  problems.push(...overrides(given, owned, ''));

  const givenProfile = isPlainObject(given.profile) ? /** @type {Record<string, unknown>} */ (given.profile) : undefined;
  if (givenProfile) problems.push(...overrides(givenProfile, ownedProfile, 'profile.'));

  /** @type {Record<string, unknown>} */
  const passport = {};
  for (const key of FIELD_ORDER) {
    if (key === 'profile') {
      if (givenProfile) passport.profile = orderProfile({ ...givenProfile, ...ownedProfile });
      else if ('profile' in given) passport.profile = given.profile;
    } else if (key in owned) {
      passport[key] = owned[key];
    } else if (key in given) {
      passport[key] = given[key];
    }
  }
  // Unknown fields stay in, after the known ones, so the schema check names them.
  for (const key of Object.keys(given)) {
    if (!(key in passport) && !(key in RETIRED_FIELDS)) passport[key] = given[key];
  }

  problems.push(...validatePassport(passport));
  problems.push(...businessOwnerRule(passport));
  return { ok: problems.length === 0, passport, problems };
}

/**
 * Writes a passport as YAML, in the field order it was built in.
 *
 * @param {Record<string, unknown>} passport A passport from buildPassport().
 * @returns {string} The text of PASSPORT.yml, ending in a newline.
 */
export function toYaml(passport) {
  const lines = [
    '# Choreo passport: what this app is, who owns it, what data it holds and where it runs.',
    "# Platform Engineering approves every change. Read AGENTS.md rules 1 and 2 before editing.",
  ];
  for (const [key, value] of Object.entries(passport)) lines.push(...yamlField(key, value, ''));
  return `${lines.join('\n')}\n`;
}

/**
 * Problems for answers that try to set a field the package sets itself. The
 * same value is allowed, since it changes nothing.
 *
 * @param {Record<string, unknown>} given The answers, or the answers' profile.
 * @param {Record<string, unknown>} owned The package's values for its fields.
 * @param {string} prefix "profile." for profile fields, otherwise "".
 * @returns {Problem[]} One problem per conflicting field.
 */
function overrides(given, owned, prefix) {
  return Object.keys(owned)
    .filter((key) => key in given && JSON.stringify(given[key]) !== JSON.stringify(owned[key]))
    .map((key) => ({
      field: `${prefix}${key}`,
      message: `is set by the package (${JSON.stringify(owned[key])}), so leave it out of the answers`,
    }));
}

/**
 * Puts profile fields in the schema's order, keeping unknown ones at the end so
 * the schema check can name them.
 *
 * @param {Record<string, unknown>} profile The merged profile.
 * @returns {Record<string, unknown>} The same fields, in order.
 */
function orderProfile(profile) {
  /** @type {Record<string, unknown>} */
  const ordered = {};
  for (const key of PROFILE_ORDER) if (key in profile) ordered[key] = profile[key];
  for (const key of Object.keys(profile)) if (!(key in ordered)) ordered[key] = profile[key];
  return ordered;
}

/**
 * The rule JSON Schema can't express: the business owner can't also be one of
 * the app owners. Same rule and wording as the passport check.
 *
 * @param {Record<string, any>} passport The passport.
 * @returns {Problem[]} One problem when the rule is broken, otherwise none.
 */
function businessOwnerRule(passport) {
  const owner = passport.business_owner?.email?.toLowerCase();
  const builders = (Array.isArray(passport.app_owners) ? passport.app_owners : [])
    .map((person) => person?.email?.toLowerCase());
  if (owner && builders.includes(owner)) {
    return [{
      field: 'business_owner',
      message: 'is also one of the app_owners. The business owner has to be someone other than the app owners: the person accountable for the app outside the build, such as a department head.',
    }];
  }
  return [];
}

/**
 * A date as YYYY-MM-DD in local time, so a passport written late in the
 * evening doesn't carry tomorrow's UTC date.
 *
 * @param {Date} date The date.
 * @returns {string} The date text.
 */
export function formatDate(date) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The same calendar day a year later. February 29 becomes February 28.
 *
 * @param {Date} date The starting date.
 * @returns {string} The date a year later, as YYYY-MM-DD.
 */
function oneYearLater(date) {
  const isLeapDay = date.getMonth() === 1 && date.getDate() === 29;
  return formatDate(new Date(date.getFullYear() + 1, date.getMonth(), isLeapDay ? 28 : date.getDate()));
}

/**
 * The YAML lines for one field.
 *
 * @param {string} key The field name.
 * @param {unknown} value Its value.
 * @param {string} indent The indentation for this level.
 * @returns {string[]} The lines.
 */
function yamlField(key, value, indent) {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}${key}: []`];
    return [`${indent}${key}:`, ...value.map((item) => `${indent}  - ${yamlInline(item)}`)];
  }
  if (isPlainObject(value) && !fitsFlow(/** @type {Record<string, unknown>} */ (value))) {
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (value));
    return [`${indent}${key}:`, ...entries.flatMap(([k, v]) => yamlField(k, v, `${indent}  `))];
  }
  return [`${indent}${key}: ${yamlInline(value)}`];
}

/**
 * A value written on one line: a plain value, or a small object in flow style.
 *
 * @param {unknown} value The value.
 * @returns {string} Its YAML text.
 */
function yamlInline(value) {
  if (isPlainObject(value)) {
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (value));
    return `{ ${entries.map(([k, v]) => `${k}: ${yamlInline(v)}`).join(', ')} }`;
  }
  if (Array.isArray(value)) return `[${value.map(yamlInline).join(', ')}]`;
  if (typeof value === 'string') return quote(value);
  if (value === null || value === undefined) return 'null';
  return String(value);
}

/**
 * Whether an object is small and flat enough for one line.
 *
 * @param {Record<string, unknown>} object The object.
 * @returns {boolean} True for flow style.
 */
function fitsFlow(object) {
  const values = Object.values(object);
  return values.length <= FLOW_MAX_FIELDS && values.every((v) => v === null || typeof v !== 'object');
}

/**
 * A string in YAML double quotes. JSON's escapes are all valid YAML escapes;
 * the few characters YAML reads as line breaks are escaped as well.
 *
 * @param {string} text The string.
 * @returns {string} The quoted string.
 */
function quote(text) {
  return JSON.stringify(text).replace(YAML_UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Whether a value is a plain object, not an array or null.
 *
 * @param {unknown} value The value.
 * @returns {boolean} True for a plain object.
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
