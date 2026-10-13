#!/usr/bin/env node
// @ts-check
// The create-choreo-app command line. Reads the subcommand and flags, runs the
// subcommand, and prints its result: plain lines by default, or one JSON object
// with --json, which is what the plugin reads.
//
// It never asks a question, so an agent can run it start to finish. --yes is
// accepted for that reason and changes nothing.
//
// Exit codes: 0 when everything passed, 1 when a check failed or the command
// was refused, 2 for a usage mistake (an unknown command, a missing flag, an
// answers file that can't be read).

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { create } from '../src/create.js';
import { doctor } from '../src/doctor.js';
import { PACKAGE_VERSION } from '../src/files.js';
import { governance } from '../src/governance.js';
import { update } from '../src/update.js';
import { verify } from '../src/verify.js';

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const TIERS = ['pages', 'container'];

const USAGE = `create-choreo-app ${PACKAGE_VERSION}

Usage:
  create-choreo-app create <name> --tier pages|container --answers answers.json [--force]
  create-choreo-app governance [dir] --tier pages|container --answers answers.json [--app name]
  create-choreo-app update [dir]
  create-choreo-app verify [dir]
  create-choreo-app doctor

Flags:
  --json     Print one JSON object instead of plain lines.
  --force    create: write into a folder that isn't empty.
  --yes      Accepted and ignored; the command never asks a question.
  --help     Show this.

dir defaults to the current folder. The answers file is the JSON the Choreo
plugin writes from discovery.`;

/**
 * Runs the command line.
 *
 * @param {string[]} argv The arguments after the program name.
 * @returns {Promise<number>} The exit code.
 */
async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        tier: { type: 'string' },
        answers: { type: 'string' },
        app: { type: 'string' },
        json: { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        yes: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    return usage(`${/** @type {Error} */ (error).message}`, false);
  }

  const { values, positionals } = parsed;
  const [command, dir = '.'] = positionals;
  const json = Boolean(values.json);
  if (values.version) return print({ ok: true, command: 'version', version: PACKAGE_VERSION }, json, () => [PACKAGE_VERSION]);
  if (values.help || !command) {
    process.stdout.write(`${USAGE}\n`);
    return values.help ? EXIT_OK : EXIT_USAGE;
  }

  switch (command) {
    case 'governance': {
      const tier = values.tier ?? '';
      if (!TIERS.includes(tier)) return usage('governance needs --tier pages or --tier container.', json);
      if (!values.answers) return usage('governance needs --answers, the answers file the plugin writes.', json);
      const answers = readAnswers(values.answers);
      if (answers instanceof Error) return usage(answers.message, json);
      const result = governance({ dir, answers, tier: /** @type {'pages' | 'container'} */ (tier), app: values.app });
      return print(result, json, () => writtenLines(result));
    }
    case 'update': {
      const result = update({ dir });
      return print(result, json, () => (result.ok ? [`Updated from ${result.from} to ${result.to}.`] : []).concat(writtenLines(result)));
    }
    case 'verify': {
      const result = verify({ dir });
      return print(result, json, () => checkLines(result.checks));
    }
    case 'doctor': {
      const result = await doctor();
      return print(result, json, () => checkLines(result.checks));
    }
    case 'create': {
      const name = positionals[1];
      if (!name) return usage("create needs the app's name, such as `create advising-bookings`.", json);
      const tier = values.tier ?? '';
      if (!TIERS.includes(tier)) return usage('create needs --tier pages or --tier container.', json);
      if (!values.answers) return usage('create needs --answers, the answers file the plugin writes.', json);
      const answers = readAnswers(values.answers);
      if (answers instanceof Error) return usage(answers.message, json);
      const result = create({ name, tier: /** @type {'pages' | 'container'} */ (tier), answers, force: Boolean(values.force) });
      return print(result, json, () => [...writtenLines(result), ...(result.ok ? ['', 'Next:', ...result.next.map((step) => `  ${step}`)] : [])]);
    }
    default:
      return usage(`${command} isn't a command.`, json);
  }
}

/**
 * Reads and parses the answers file.
 *
 * @param {string} path The file's path.
 * @returns {unknown} The parsed answers, or an Error explaining why it couldn't be read.
 */
function readAnswers(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return new Error(`Couldn't read the answers file ${path}: ${/** @type {Error} */ (error).message}`);
  }
}

/**
 * Prints a result and picks the exit code.
 *
 * @param {{ ok: boolean, problems?: { field: string, message: string }[] }} result The result.
 * @param {boolean} json Print JSON.
 * @param {() => string[]} lines The plain lines for a successful result.
 * @returns {number} The exit code.
 */
function print(result, json, lines) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const problems = (result.problems ?? []).map((p) => `problem: ${p.field} ${p.message}`);
    process.stdout.write(`${[...lines(), ...problems].join('\n')}\n`);
  }
  return result.ok ? EXIT_OK : EXIT_FAILED;
}

/**
 * Prints a usage mistake.
 *
 * @param {string} message What was wrong.
 * @param {boolean} json Print JSON.
 * @returns {number} The usage exit code.
 */
function usage(message, json) {
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, command: 'usage', problems: [{ field: '(the command)', message }] }, null, 2)}\n`);
  else process.stderr.write(`${message}\n\n${USAGE}\n`);
  return EXIT_USAGE;
}

/**
 * Plain lines for the files a command wrote or moved.
 *
 * @param {{ written: string[], moved?: string[] }} result The result.
 * @returns {string[]} The lines.
 */
function writtenLines(result) {
  return [
    ...result.written.map((path) => `wrote ${path}`),
    ...(result.moved ?? []).map((path) => `moved the old ${path} into BUILDER.md`),
  ];
}

/**
 * Plain lines for a list of checks.
 *
 * @param {{ id: string, status: string, message: string }[]} checks The checks.
 * @returns {string[]} One line per check.
 */
function checkLines(checks) {
  return checks.map((c) => `${c.status.toUpperCase().padEnd(4)} ${c.id}: ${c.message}`);
}

process.exitCode = await main(process.argv.slice(2));
