/**
 * Where katas live and how a learner's query ("4", "schtasks-persistence",
 * "04-schtasks-persistence") becomes exactly one directory under the katas root.
 *
 * Queries are matched against the directory listing, never joined onto a path,
 * so there is no input that can reach outside the root: a query that is not a
 * plain slug or number cannot match anything and is simply "not found".
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KataFormatError, KataNotFoundError } from '../errors.ts';

/** Lowercase slug used as a kata id. */
export const KATA_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,50}$/;

/** `<NN>-<id>`; NN is zero-padded to at least two digits. */
const KATA_DIR_PATTERN = /^(\d{2,3})-([a-z0-9][a-z0-9-]{1,50})$/;

/** The only shapes a query can have. Anything else (dots, slashes, colons, NUL, ...) is not a kata. */
const QUERY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidKataId(id: string): boolean {
  return KATA_ID_PATTERN.test(id);
}

/** The directory name a kata must have, e.g. `kataDirName(4, 'schtasks-persistence')`. */
export function kataDirName(number: number, id: string): string {
  return `${String(number).padStart(2, '0')}-${id}`;
}

export function parseKataDirName(name: string): { number: number; id: string } | undefined {
  const match = KATA_DIR_PATTERN.exec(name);
  if (match === null) return undefined;
  return { number: Number(match[1]), id: match[2] as string };
}

/**
 * The bundled curriculum, unless `DOJO_KATAS_DIR` points somewhere else (used by
 * tests and by authors working on a kata collection). The relative hop is the
 * same from `src/kata/` and from `dist/kata/`.
 */
export function katasRoot(): string {
  const override = process.env.DOJO_KATAS_DIR;
  if (override !== undefined && override.trim() !== '') return path.resolve(override);
  return fileURLToPath(new URL('../../katas', import.meta.url));
}

/**
 * Names of the real directories under `root` that look like kata folders (they
 * start with a digit). Symbolic links are skipped. Not sorted.
 */
export function findKataDirNames(root: string): string[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown error';
    const hint =
      process.env.DOJO_KATAS_DIR !== undefined && process.env.DOJO_KATAS_DIR !== ''
        ? ' DOJO_KATAS_DIR is set; check that it points at a folder of katas.'
        : '';
    throw new KataFormatError(`Cannot read the katas folder "${root}" (${code}).${hint}`, {
      cause: err,
    });
  }
  return entries.filter((e) => e.isDirectory() && /^\d/.test(e.name)).map((e) => e.name);
}

function byNumber(a: string, b: string): number {
  const na = parseKataDirName(a)?.number ?? Number.MAX_SAFE_INTEGER;
  const nb = parseKataDirName(b)?.number ?? Number.MAX_SAFE_INTEGER;
  return na - nb || (a < b ? -1 : a > b ? 1 : 0);
}

/** Strip control characters and cap the length so an odd query cannot garble the terminal. */
function printable(query: string): string {
  return query.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 80);
}

function pickOne(matches: string[], what: string): string | undefined {
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    throw new KataFormatError(
      `${what} is used by more than one kata folder (${matches.join(', ')}). Rename one of them.`,
    );
  }
  return matches[0];
}

/**
 * Turn a query into a kata directory name found under `root`.
 * Accepts the full name, the number (`4` or `04`) or the id; throws
 * `KataNotFoundError` for everything else, including anything that looks like a path.
 */
export function resolveKataDirName(query: string, root: string): string {
  const names = findKataDirNames(root)
    .filter((name) => parseKataDirName(name) !== undefined)
    .sort(byNumber);
  const wanted = query.trim().toLowerCase();

  if (QUERY_PATTERN.test(wanted)) {
    const byFullName = names.find((name) => name === wanted);
    if (byFullName !== undefined) return byFullName;

    if (/^\d{1,3}$/.test(wanted)) {
      const number = Number(wanted);
      const byNum = pickOne(
        names.filter((name) => parseKataDirName(name)?.number === number),
        `Kata number ${number}`,
      );
      if (byNum !== undefined) return byNum;
    }

    const byId = pickOne(
      names.filter((name) => parseKataDirName(name)?.id === wanted),
      `Kata id "${wanted}"`,
    );
    if (byId !== undefined) return byId;
  }

  throw new KataNotFoundError(printable(query), names);
}
