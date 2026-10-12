// Shared test helpers: throwaway app folders and the made-up answers files.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

/** A new empty folder named like an app repository, inside a temp folder. */
export function tmpApp(name = 'example-app') {
  const dir = join(mkdtempSync(join(tmpdir(), 'choreo-test-')), name);
  mkdirSync(dir);
  return dir;
}

/** One of the made-up answers files in test/fixtures. */
export function answers(file = 'answers-container.json') {
  return JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
}

/** A test fixture's text. */
export function fixture(file) {
  return readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8');
}

/** Writes a file inside an app folder, creating folders as needed. */
export function put(dir, path, text) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

/** Reads a file inside an app folder. */
export function read(dir, path) {
  return readFileSync(join(dir, path), 'utf8');
}

/** Every file in a folder, as sorted relative paths with forward slashes. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full).replaceAll('\\', '/'));
    }
  };
  walk(dir);
  return out.sort();
}
