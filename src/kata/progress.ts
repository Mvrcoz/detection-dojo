/**
 * Learner progress, stored as JSON in `<DOJO_HOME or ~/.detection-dojo>/progress.json`.
 *
 * Progress is a convenience, never a gate: a missing, damaged or unwritable file
 * must not stop anyone from grading a rule. Reading therefore falls back to an
 * empty record, and writing reports trouble on stderr instead of throwing.
 */

import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { MAX_PROGRESS_FILE_BYTES } from './limits.ts';
import { KATA_ID_PATTERN } from './resolve.ts';
import type { GradeResult, Progress } from './types.ts';

type KataProgress = Progress['katas'][string];

export function progressPath(): string {
  const home = process.env.DOJO_HOME;
  const directory =
    home !== undefined && home.trim() !== ''
      ? path.resolve(home)
      : path.join(homedir(), '.detection-dojo');
  return path.join(directory, 'progress.json');
}

function emptyProgress(): Progress {
  return { version: 1, katas: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** One kata's record, or undefined when it is not shaped like one (the entry is then dropped). */
function parseEntry(value: unknown): KataProgress | undefined {
  if (!isRecord(value)) return undefined;
  const { passed, attempts, bestTpr, bestFpr, bestVariantsCaught, firstPassedAt, lastAttemptAt } = value;
  if (
    typeof passed !== 'boolean' ||
    !isCount(attempts) ||
    !isRate(bestTpr) ||
    !isRate(bestFpr) ||
    !isCount(bestVariantsCaught) ||
    typeof lastAttemptAt !== 'string'
  ) {
    return undefined;
  }
  const entry: KataProgress = { passed, attempts, bestTpr, bestFpr, bestVariantsCaught, lastAttemptAt };
  if (typeof firstPassedAt === 'string') entry.firstPassedAt = firstPassedAt;
  return entry;
}

/**
 * Read the progress file. A missing, oversized, unparsable or foreign file gives
 * an empty record; entries that are individually malformed are dropped and the
 * rest are kept.
 */
export function loadProgress(): Progress {
  let text: string;
  try {
    const file = progressPath();
    if (statSync(file).size > MAX_PROGRESS_FILE_BYTES) return emptyProgress();
    text = readFileSync(file, 'utf8');
  } catch {
    return emptyProgress();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return emptyProgress();
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.katas)) return emptyProgress();

  const progress = emptyProgress();
  for (const [id, value] of Object.entries(parsed.katas)) {
    // Only slugs are accepted as keys, which also keeps names like "__proto__" out of the record.
    if (!KATA_ID_PATTERN.test(id)) continue;
    const entry = parseEntry(value);
    if (entry !== undefined) progress.katas[id] = entry;
  }
  return progress;
}

/**
 * Write `content` so that readers see either the old file or the new one, never
 * half of each: write a temporary file next to the target, flush it to disk, then
 * rename it over the target.
 */
function writeAtomically(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    const descriptor = openSync(temporary, 'w');
    try {
      writeSync(descriptor, content);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, file);
  } catch (err) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file may never have been created; the original error is the one that matters.
    }
    throw err;
  }
}

function warnNotSaved(file: string, reason: string): void {
  process.stderr.write(`warning: could not save your progress to ${file} (${reason}). Your grade is not affected.\n`);
}

/**
 * Add one graded attempt to the learner's progress and save it. Returns the
 * updated progress even when saving fails (the failure is reported on stderr,
 * never thrown), so a read-only home directory cannot break `dojo test`.
 *
 * Two terminals recording at the same instant can lose one attempt (it is a
 * read-modify-write without a lock); the file itself is never corrupted.
 */
export function recordResult(kataId: string, result: GradeResult): Progress {
  const progress = loadProgress();
  const file = progressPath();
  if (!KATA_ID_PATTERN.test(kataId)) {
    warnNotSaved(file, `${JSON.stringify(kataId)} is not a valid kata id`);
    return progress;
  }

  const now = new Date().toISOString();
  const previous = Object.hasOwn(progress.katas, kataId) ? progress.katas[kataId] : undefined;
  const entry: KataProgress = {
    // Once a kata is passed it stays passed; later failed experiments do not undo it.
    passed: (previous?.passed ?? false) || result.passed,
    attempts: (previous?.attempts ?? 0) + 1,
    bestTpr: previous === undefined ? result.tpr : Math.max(previous.bestTpr, result.tpr),
    bestFpr: previous === undefined ? result.fpr : Math.min(previous.bestFpr, result.fpr),
    bestVariantsCaught: Math.max(previous?.bestVariantsCaught ?? 0, result.variantsCaught),
    lastAttemptAt: now,
  };
  const firstPassedAt = previous?.firstPassedAt ?? (result.passed ? now : undefined);
  if (firstPassedAt !== undefined) entry.firstPassedAt = firstPassedAt;
  progress.katas[kataId] = entry;

  try {
    writeAtomically(file, `${JSON.stringify(progress, null, 2)}\n`);
  } catch (err) {
    warnNotSaved(file, (err as NodeJS.ErrnoException).code ?? (err as Error).message);
  }
  return progress;
}
