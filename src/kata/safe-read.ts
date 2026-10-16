/**
 * Reads files inside a kata directory without trusting the directory.
 *
 * A kata may come from a contributor's pull request or a downloaded folder, so
 * every entry is checked with lstat (which does not follow links) and its size
 * is compared against the limit before a single byte is read. Symbolic links and
 * Windows junctions are refused outright: a kata is self-contained and has no
 * reason to point outside its own directory.
 */

import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describeOverLimit } from './limits.ts';

export type TextRead =
  | { ok: true; text: string }
  | {
      ok: false;
      /** True when the file simply does not exist, which is fine for optional files. */
      missing: boolean;
      error: string;
    };

/** `fatal: true` rejects invalid UTF-8; the decoder also strips a leading BOM. */
const utf8 = new TextDecoder('utf-8', { fatal: true });

function errorCode(err: unknown): string {
  return (err as NodeJS.ErrnoException)?.code ?? 'unknown error';
}

/**
 * Read `parts` (path segments relative to `kataDir`) as UTF-8 text with the BOM
 * removed and CRLF/CR normalised to LF, so the rest of the engine only ever sees
 * one line-ending style. Never throws; problems come back as `{ ok: false }`.
 */
export function readKataText(kataDir: string, parts: string[], maxBytes: number): TextRead {
  const label = parts.join('/');
  const fullPath = path.join(kataDir, ...parts);

  let stats;
  try {
    stats = lstatSync(fullPath);
  } catch (err) {
    if (errorCode(err) === 'ENOENT') {
      return { ok: false, missing: true, error: `${label} is missing` };
    }
    return { ok: false, missing: false, error: `${label} cannot be read (${errorCode(err)})` };
  }

  if (stats.isSymbolicLink()) {
    return {
      ok: false,
      missing: false,
      error: `${label} is a symbolic link; katas must contain real files so they cannot point outside their folder`,
    };
  }
  if (!stats.isFile()) {
    return { ok: false, missing: false, error: `${label} must be a regular file` };
  }
  if (stats.size > maxBytes) {
    return {
      ok: false,
      missing: false,
      error: `${label} is ${describeOverLimit(stats.size, maxBytes)}; remove content you do not need`,
    };
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(fullPath);
  } catch (err) {
    return { ok: false, missing: false, error: `${label} cannot be read (${errorCode(err)})` };
  }
  // The file may have grown between lstat and read; the limit must still hold.
  if (bytes.length > maxBytes) {
    return {
      ok: false,
      missing: false,
      error: `${label} is ${describeOverLimit(bytes.length, maxBytes)}`,
    };
  }

  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    return { ok: false, missing: false, error: `${label} is not valid UTF-8 text` };
  }
  return { ok: true, text: text.replace(/\r\n?/g, '\n') };
}

/** Why `dir` cannot be used as a directory of the kata, or undefined when it is a real directory. */
export function realDirectoryProblem(dir: string, label: string): string | undefined {
  let stats;
  try {
    stats = lstatSync(dir);
  } catch (err) {
    return errorCode(err) === 'ENOENT'
      ? `${label} is missing`
      : `${label} cannot be read (${errorCode(err)})`;
  }
  if (stats.isSymbolicLink()) {
    return `${label} is a symbolic link; katas must contain real folders so they cannot point outside themselves`;
  }
  if (!stats.isDirectory()) return `${label} must be a folder`;
  return undefined;
}
