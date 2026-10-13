// @ts-check
// A small JSON Schema checker, just big enough for the passport schema.
//
// The CLI checks every passport it writes against its copy of the schema
// (src/schema/passport-v1.json), so it never writes one that the passport
// check in dc-choreo-workflows would reject. The CLI has no runtime
// dependencies, so this stands in for ajv. The tests run both on the same
// passports and expect the same verdict.
//
// Input: a schema object, then a value to check.
// Output: a list of problems, each { field, message }. An empty list means valid.
//
// It covers only the keywords the passport schema uses. compile() throws on any
// other keyword, so a new rule in a re-copied schema fails loudly instead of
// being skipped.

/** @typedef {{ field: string, message: string }} Problem */
/** @typedef {Record<string, any>} Schema */

// Keywords that describe a schema without constraining a value.
const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', '$defs', '$comment', 'default', 'examples']);

// Keywords this checker enforces.
const KEYWORDS = new Set([
  '$ref', 'type', 'const', 'enum', 'required', 'properties', 'additionalProperties',
  'items', 'minLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems',
  'minimum', 'oneOf', 'allOf', 'if', 'then', 'else',
]);

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Prepares a checker for one schema.
 *
 * @param {Schema} root The whole schema, used to resolve `#/$defs/...` references.
 * @returns {(value: unknown) => Problem[]} A function that checks one value.
 * @throws {Error} When the schema uses a keyword this checker doesn't enforce.
 */
export function compile(root) {
  assertKnownKeywords(root, '#');
  return (value) => {
    /** @type {Problem[]} */
    const problems = [];
    check(root, value, [], root, problems);
    return problems;
  };
}

/**
 * Walks the schema and throws on the first keyword it can't enforce.
 *
 * @param {Schema} schema The schema or subschema to walk.
 * @param {string} where Its location, for the error message.
 * @returns {void}
 */
function assertKnownKeywords(schema, where) {
  for (const [key, value] of Object.entries(schema)) {
    if (!KEYWORDS.has(key) && !ANNOTATIONS.has(key) && !key.startsWith('x-')) {
      throw new Error(`The passport schema uses \`${key}\` at ${where}, which src/validate.js doesn't check. Add it there before using this schema.`);
    }
    if (key === 'properties' || key === '$defs') {
      for (const [name, sub] of Object.entries(value)) assertKnownKeywords(sub, `${where}/${key}/${name}`);
    } else if (key === 'oneOf' || key === 'allOf') {
      value.forEach((/** @type {Schema} */ sub, /** @type {number} */ i) => assertKnownKeywords(sub, `${where}/${key}/${i}`));
    } else if (['items', 'if', 'then', 'else'].includes(key) || (key === 'additionalProperties' && typeof value === 'object')) {
      assertKnownKeywords(value, `${where}/${key}`);
    }
  }
}

/**
 * Checks one value against one schema, adding any problems to the list.
 *
 * @param {Schema} schema The schema or subschema.
 * @param {unknown} value The value at this point in the passport.
 * @param {(string|number)[]} path Keys and indexes leading to the value.
 * @param {Schema} root The whole schema, for references.
 * @param {Problem[]} problems Where problems are collected.
 * @returns {void}
 */
function check(schema, value, path, root, problems) {
  const add = (/** @type {string} */ message) => problems.push({ field: toField(path), message });

  if (schema.$ref) check(resolve(schema.$ref, root), value, path, root, problems);

  if (schema.type !== undefined) {
    const allowed = [schema.type].flat();
    const actual = typeOf(value);
    const matches = allowed.includes(actual) || (actual === 'integer' && allowed.includes('number'));
    if (!matches) {
      add(`should be ${allowed.join(' or ')}, not ${actual}`);
      return;
    }
  }

  if ('const' in schema && !deepEqual(value, schema.const)) {
    add(`has to be ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((/** @type {unknown} */ option) => deepEqual(value, option))) {
    add(`has to be one of: ${schema.enum.map((/** @type {unknown} */ o) => JSON.stringify(o)).join(', ')}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) {
      add(`is too short: at least ${schema.minLength} characters`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
      add(`isn't in the right form (${schema.pattern})`);
    }
    if (schema.format === 'date' && !isCalendarDate(value)) {
      add('has to be a real date written as YYYY-MM-DD');
    }
  }

  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    add(`has to be at least ${schema.minimum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      add(`needs at least ${schema.minItems} ${schema.minItems === 1 ? 'entry' : 'entries'}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      add(schema.maxItems === 0 ? 'has to be empty' : `can have at most ${schema.maxItems} entries`);
    }
    if (schema.uniqueItems && new Set(value.map(canonical)).size !== value.length) {
      add('lists the same entry twice');
    }
    if (schema.items) value.forEach((item, i) => check(schema.items, item, [...path, i], root, problems));
  }

  if (isPlainObject(value)) {
    const object = /** @type {Record<string, unknown>} */ (value);
    for (const key of schema.required ?? []) {
      if (!(key in object)) problems.push({ field: toField([...path, key]), message: 'is missing' });
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in object) check(sub, object[key], [...path, key], root, problems);
    }
    if (schema.additionalProperties !== undefined) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(object).filter((k) => !known.has(k))) {
        if (schema.additionalProperties === false) {
          problems.push({ field: toField([...path, key]), message: "isn't a passport field" });
        } else {
          check(schema.additionalProperties, object[key], [...path, key], root, problems);
        }
      }
    }
  }

  for (const sub of schema.allOf ?? []) check(sub, value, path, root, problems);

  if (schema.oneOf) {
    const passing = schema.oneOf.filter((/** @type {Schema} */ sub) => passes(sub, value, path, root)).length;
    if (passing !== 1) add("isn't in a form the passport accepts");
  }

  if (schema.if) {
    const branch = passes(schema.if, value, path, root) ? schema.then : schema.else;
    if (branch) check(branch, value, path, root, problems);
  }
}

/**
 * Whether a value passes a subschema, without recording its problems.
 *
 * @param {Schema} schema The subschema.
 * @param {unknown} value The value.
 * @param {(string|number)[]} path Where the value sits.
 * @param {Schema} root The whole schema.
 * @returns {boolean} True when the value has no problems against the subschema.
 */
function passes(schema, value, path, root) {
  /** @type {Problem[]} */
  const scratch = [];
  check(schema, value, path, root, scratch);
  return scratch.length === 0;
}

/**
 * Looks up a local reference such as `#/$defs/person`.
 *
 * @param {string} ref The reference.
 * @param {Schema} root The whole schema.
 * @returns {Schema} The referenced subschema.
 * @throws {Error} When the reference isn't local or doesn't exist.
 */
function resolve(ref, root) {
  if (!ref.startsWith('#/')) throw new Error(`Only local references are supported, not ${ref}`);
  /** @type {any} */
  let node = root;
  for (const part of ref.slice(2).split('/')) node = node?.[part];
  if (!node) throw new Error(`The reference ${ref} points at nothing`);
  return node;
}

/**
 * The JSON Schema type name of a value.
 *
 * @param {unknown} value The value.
 * @returns {string} null, boolean, integer, number, string, array or object.
 */
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (isPlainObject(value)) return 'object';
  return typeof value;
}

/**
 * Whether a value is a plain object, not an array, null or a Date.
 *
 * @param {unknown} value The value.
 * @returns {boolean} True for a plain object.
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Whether a YYYY-MM-DD string names a day that exists, so 2026-02-30 fails.
 *
 * @param {string} text The date text.
 * @returns {boolean} True for a real calendar date.
 */
function isCalendarDate(text) {
  const match = DATE_PATTERN.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * A key-order-independent text form of a value, for equality and uniqueness.
 *
 * @param {unknown} value The value.
 * @returns {string} The same text for any two equal values.
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) {
    const object = /** @type {Record<string, unknown>} */ (value);
    return `{${Object.keys(object).sort().map((k) => `${JSON.stringify(k)}:${canonical(object[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Whether two values are equal by content.
 *
 * @param {unknown} a One value.
 * @param {unknown} b The other.
 * @returns {boolean} True when they're equal.
 */
function deepEqual(a, b) {
  return canonical(a) === canonical(b);
}

/**
 * Turns a path into the field name a builder would recognize.
 * ["app_owners", 0, "email"] becomes "app_owners[0].email".
 *
 * @param {(string|number)[]} path Keys and indexes.
 * @returns {string} The field name, or "(the passport)" for the root.
 */
function toField(path) {
  if (path.length === 0) return '(the passport)';
  return path.map((part, i) => (typeof part === 'number' ? `[${part}]` : `${i ? '.' : ''}${part}`)).join('');
}
