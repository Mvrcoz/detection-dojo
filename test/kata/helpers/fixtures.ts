/**
 * Shared test support for the kata engine: temp directories, copies of the one
 * valid fixture kata, and in-memory katas for grading tests.
 *
 * Broken katas are never stored in the repository. Each test copies the valid
 * fixture into a temp folder and damages exactly one thing.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CompiledRule } from '../../../src/sigma/types.ts';
import type { GradeResult, Kata, KataMeta, LabeledEvent } from '../../../src/kata/types.ts';

export const FIXTURE_KATAS_ROOT = fileURLToPath(new URL('../../fixtures/katas', import.meta.url));
export const VALID_KATA_NAME = '01-fixture-basic';
export const VALID_KATA_DIR = path.join(FIXTURE_KATAS_ROOT, VALID_KATA_NAME);

/**
 * Create a temp root that is deleted when the test file finishes; call `dir()`
 * for a fresh empty folder inside it. Call once at the top level of a test file.
 */
export function createSandbox(): { dir(): string } {
  const root = mkdtempSync(path.join(tmpdir(), 'dojo-test-'));
  after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return { dir: () => mkdtempSync(path.join(root, 'case-')) };
}

/** Copy the valid fixture kata into `parent` and return the copy's path. */
export function copyValidKata(parent: string, name: string = VALID_KATA_NAME): string {
  const target = path.join(parent, name);
  cpSync(VALID_KATA_DIR, target, { recursive: true });
  return target;
}

export function readKataFile(kataDir: string, relativePath: string): string {
  return readFileSync(path.join(kataDir, relativePath), 'utf8');
}

export function writeKataFile(kataDir: string, relativePath: string, content: string | Buffer): void {
  const target = path.join(kataDir, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/** Replace `search` with `replacement` in a kata file, failing loudly if the text is not there. */
export function replaceInKataFile(
  kataDir: string,
  relativePath: string,
  search: string,
  replacement: string,
): void {
  const text = readKataFile(kataDir, relativePath);
  if (!text.includes(search)) {
    throw new Error(`test setup: ${JSON.stringify(search)} not found in ${relativePath}`);
  }
  writeKataFile(kataDir, relativePath, text.replace(search, replacement));
}

/** Append raw lines to an events file of a kata. */
export function appendEventLines(kataDir: string, file: string, ...lines: string[]): void {
  const current = readKataFile(kataDir, `events/${file}`);
  writeKataFile(kataDir, `events/${file}`, `${current}${lines.join('\n')}\n`);
}

/** Run `fn` with an environment variable set, restoring the previous value afterwards. */
export function withEnv<T>(name: string, value: string | undefined, fn: () => T): T {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

const BASE_META: KataMeta = {
  number: 1,
  id: 'synthetic',
  title: 'Synthetic kata',
  tier: 2,
  kind: 'write',
  attack: ['T1105'],
  tags: [],
  logsource: { product: 'test' },
  scenario: 'scenario',
  objective: 'objective',
  hints: ['one', 'two'],
  thresholds: { min_tpr: 1, max_fpr: 0, min_variants_caught: 0 },
  estimated_minutes: 5,
  author: 'tests',
};

/**
 * An in-memory kata whose events carry a `hit` flag and their own line number:
 * events with `hit: true` are the ones a stub rule (see `stubRule`) matches.
 * `positives: [true, false]` builds two positive events of which only the first
 * is matched.
 */
export function syntheticKata(
  shape: { positives?: boolean[]; benign?: boolean[]; variants?: boolean[] },
  meta: Partial<KataMeta> = {},
): Kata {
  const events = (flags: boolean[] = []): LabeledEvent[] =>
    flags.map((hit, index) => ({ event: { hit, line: index + 1 }, line: index + 1 }));
  return {
    dir: path.join(tmpdir(), 'synthetic-kata'),
    meta: { ...BASE_META, ...meta },
    positives: events(shape.positives),
    benign: events(shape.benign),
    variants: events(shape.variants),
    starter: '',
    solution: '',
    explain: '',
  };
}

/** A compiled rule that matches events whose `hit` field is true, and optionally throws on chosen events. */
export function stubRule(options: { warnings?: string[]; throwOnLine?: (line: number) => boolean } = {}): CompiledRule {
  return {
    rule: { title: 'stub', logsource: {}, detection: { condition: 'selection' } },
    selectionNames: ['selection'],
    usedFields: ['hit'],
    warnings: options.warnings ?? [],
    match(event) {
      const line = event.line;
      if (options.throwOnLine?.(typeof line === 'number' ? line : -1) === true) {
        throw new Error('stub failure');
      }
      return { matched: event.hit === true, selections: { selection: event.hit === true } };
    },
  };
}

/** A grade result with sensible defaults for progress tests. */
export function fakeResult(overrides: Partial<GradeResult> = {}): GradeResult {
  return {
    kataId: 'synthetic',
    tp: 3,
    fn: 0,
    fp: 0,
    tn: 7,
    tpr: 1,
    fpr: 0,
    precision: 1,
    variantsCaught: 3,
    variantsTotal: 3,
    passed: true,
    checks: { tpr: true, fpr: true, variants: true },
    failures: { missedPositives: [], falsePositives: [], missedVariants: [] },
    warnings: [],
    ...overrides,
  };
}
