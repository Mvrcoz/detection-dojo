/**
 * Loading katas from disk: one kata (`loadKata`, `loadKataFromDir`) or the
 * whole curriculum listing (`listKatas`).
 *
 * `inspectKataDir` does the real work and never throws for kata problems; it
 * returns every problem it finds. Loading turns "any problem" into a
 * `KataFormatError`, while `validateKata` reports the full list to the author.
 */

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { KataFormatError } from '../errors.ts';
import { parseEventsJsonl } from './jsonl.ts';
import {
  MAX_EVENTS_FILE_BYTES,
  MAX_PROSE_FILE_BYTES,
  MAX_RULE_FILE_BYTES,
} from './limits.ts';
import {
  findKataDirNames,
  kataDirName,
  katasRoot,
  parseKataDirName,
  resolveKataDirName,
} from './resolve.ts';
import { readKataText, realDirectoryProblem } from './safe-read.ts';
import { parseKataMeta } from './schema.ts';
import type { Kata, KataMeta, KataSummary, LabeledEvent } from './types.ts';

/** Files a kata directory may contain; anything else earns a warning in validate-kata. */
const KATA_ENTRIES: ReadonlySet<string> = new Set([
  'kata.yml',
  'starter.yml',
  'solution.yml',
  'explain.md',
  'events',
]);

const EVENT_FILES = [
  { field: 'positives', file: 'positive.jsonl', required: true },
  { field: 'benign', file: 'benign.jsonl', required: true },
  { field: 'variants', file: 'variants.jsonl', required: false },
] as const;
const EVENT_FILE_NAMES: ReadonlySet<string> = new Set(EVENT_FILES.map((e) => e.file));

/** How many problems an error message lists before pointing at `dojo validate-kata`. */
const MAX_LISTED_PROBLEMS = 6;

export interface KataInspection {
  /** Present only when `errors` is empty. */
  kata: Kata | undefined;
  errors: string[];
  warnings: string[];
}

function readMeta(dir: string): { meta: KataMeta | undefined; errors: string[] } {
  const text = readKataText(dir, ['kata.yml'], MAX_PROSE_FILE_BYTES);
  if (!text.ok) return { meta: undefined, errors: [text.error] };
  return parseKataMeta(text.text);
}

function dirNameProblem(dir: string, meta: KataMeta): string | undefined {
  const expected = kataDirName(meta.number, meta.id);
  const actual = path.basename(dir);
  if (actual === expected) return undefined;
  return `the folder is named "${actual}" but kata.yml says number ${meta.number} and id "${meta.id}", so it must be named "${expected}"`;
}

function unexpectedEntries(dir: string, allowed: ReadonlySet<string>, label: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return []; // an unreadable folder is already reported as an error by the caller
  }
  return names
    .filter((name) => !name.startsWith('.') && !allowed.has(name))
    .sort()
    .map((name) => `${label}${name} is not part of the kata format and is ignored`);
}

/** Read and check everything a kata is made of, collecting every problem instead of stopping at the first. */
export function inspectKataDir(dirInput: string): KataInspection {
  const dir = path.resolve(dirInput);
  const errors: string[] = [];
  const warnings: string[] = [];

  // The folder the caller named is followed as given; entries inside it are not (see readKataText).
  try {
    if (!statSync(dir).isDirectory()) {
      return { kata: undefined, errors: [`"${dir}" is not a folder`], warnings };
    }
  } catch {
    return { kata: undefined, errors: [`The folder "${dir}" does not exist or cannot be read`], warnings };
  }

  const { meta, errors: metaErrors } = readMeta(dir);
  errors.push(...metaErrors);
  if (meta !== undefined) {
    const mismatch = dirNameProblem(dir, meta);
    if (mismatch !== undefined) errors.push(mismatch);
  }

  const readText = (name: string, maxBytes: number): string => {
    const result = readKataText(dir, [name], maxBytes);
    if (result.ok) return result.text;
    errors.push(result.error);
    return '';
  };
  const starter = readText('starter.yml', MAX_RULE_FILE_BYTES);
  const solution = readText('solution.yml', MAX_RULE_FILE_BYTES);
  const explain = readText('explain.md', MAX_PROSE_FILE_BYTES);

  const events: Record<(typeof EVENT_FILES)[number]['field'], LabeledEvent[]> = {
    positives: [],
    benign: [],
    variants: [],
  };
  const eventsProblem = realDirectoryProblem(path.join(dir, 'events'), 'events/');
  if (eventsProblem !== undefined) {
    errors.push(eventsProblem);
  } else {
    for (const { field, file, required } of EVENT_FILES) {
      const label = `events/${file}`;
      const result = readKataText(dir, ['events', file], MAX_EVENTS_FILE_BYTES);
      if (!result.ok) {
        if (required || !result.missing) errors.push(result.error);
        continue;
      }
      const parsed = parseEventsJsonl(result.text, label);
      errors.push(...parsed.problems);
      events[field] = parsed.events;
    }
    warnings.push(...unexpectedEntries(path.join(dir, 'events'), EVENT_FILE_NAMES, 'events/'));
  }
  warnings.push(...unexpectedEntries(dir, KATA_ENTRIES, ''));

  if (errors.length > 0 || meta === undefined) return { kata: undefined, errors, warnings };
  return {
    kata: {
      dir,
      meta,
      positives: events.positives,
      benign: events.benign,
      variants: events.variants,
      starter,
      solution,
      explain,
    },
    errors,
    warnings,
  };
}

function problemsMessage(dir: string, errors: string[]): string {
  const name = path.basename(path.resolve(dir));
  if (errors.length === 1) return `Kata "${name}" is not valid: ${errors[0]}`;
  const listed = errors.slice(0, MAX_LISTED_PROBLEMS).map((e) => `  - ${e}`);
  const hidden = errors.length - listed.length;
  if (hidden > 0) listed.push(`  - ...and ${hidden} more; run "dojo validate-kata ${dir}" to see them all`);
  return `Kata "${name}" is not valid:\n${listed.join('\n')}`;
}

/** Load the kata in `dir` (a path the caller chose explicitly, e.g. for validate-kata). */
export function loadKataFromDir(dir: string): Kata {
  const { kata, errors } = inspectKataDir(dir);
  if (kata === undefined) throw new KataFormatError(problemsMessage(dir, errors));
  return kata;
}

/**
 * Load a kata by name, number or id from the katas root. The query is only ever
 * matched against the folder listing, so it cannot name a path.
 */
export function loadKata(query: string, root: string = katasRoot()): Kata {
  return loadKataFromDir(path.join(root, resolveKataDirName(query, root)));
}

/** The curriculum in order. Reads only kata.yml of each kata, and names the kata that is broken. */
export function listKatas(root: string = katasRoot()): KataSummary[] {
  const summaries: KataSummary[] = [];

  for (const dirName of findKataDirNames(root)) {
    if (parseKataDirName(dirName) === undefined) {
      throw new KataFormatError(
        `"${dirName}" in ${root} is not a valid kata folder name. Folders are named <NN>-<id>, for example 04-schtasks-persistence.`,
      );
    }
    const dir = path.join(root, dirName);
    const { meta, errors } = readMeta(dir);
    const mismatch = meta === undefined ? undefined : dirNameProblem(dir, meta);
    if (meta === undefined || mismatch !== undefined) {
      throw new KataFormatError(problemsMessage(dir, mismatch === undefined ? errors : [mismatch]));
    }
    summaries.push({
      number: meta.number,
      id: meta.id,
      dirName,
      title: meta.title,
      tier: meta.tier,
      kind: meta.kind,
      attack: meta.attack,
      tags: meta.tags,
      estimated_minutes: meta.estimated_minutes,
    });
  }

  summaries.sort((a, b) => a.number - b.number);
  for (const [i, summary] of summaries.entries()) {
    const previous = summaries[i - 1];
    if (previous !== undefined && previous.number === summary.number) {
      throw new KataFormatError(
        `Kata number ${summary.number} is used by both "${previous.dirName}" and "${summary.dirName}". Every kata needs its own number.`,
      );
    }
  }
  const byId = new Map<string, string>();
  for (const summary of summaries) {
    const other = byId.get(summary.id);
    if (other !== undefined) {
      throw new KataFormatError(
        `Kata id "${summary.id}" is used by both "${other}" and "${summary.dirName}". Every kata needs its own id.`,
      );
    }
    byId.set(summary.id, summary.dirName);
  }
  return summaries;
}
