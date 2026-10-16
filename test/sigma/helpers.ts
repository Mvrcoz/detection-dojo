/**
 * Shared builders for the black-box Sigma conformance suite.
 *
 * The suite is an oracle written from the Sigma specification and the
 * subset described in docs/ARCHITECTURE.md section 3. It deliberately talks to
 * the evaluator only through its public API (`parseRuleYaml`, `compileRule`,
 * `loadRule`) so a test can never depend on how the implementation is built.
 *
 * Conventions used by the test files:
 *   - `fieldRule` / `hit` build a one-selection rule for a single field and
 *     serialize the value with JSON quoting, so a test states the value the
 *     evaluator must *see* after YAML parsing (use String.raw for backslashes).
 *   - `ruleWith` wraps a hand-written YAML fragment for tests that need to
 *     exercise raw YAML syntax (quoting styles, anchors, duplicate keys).
 *   - The `expect*Error` helpers pin the error class and, where the contract
 *     names one, the `path` / `feature` and a keyword the message must contain.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { DojoError, RuleParseError, UnsupportedFeatureError } from '../../src/errors.ts';
import { compileRule, loadRule, parseRuleYaml } from '../../src/sigma/index.ts';
import type { CompiledRule, MatchResult, SigmaEvent } from '../../src/sigma/types.ts';

export { compileRule, loadRule, parseRuleYaml };
export { DojoError, RuleParseError, UnsupportedFeatureError };
export type { CompiledRule, MatchResult, SigmaEvent };

// ---------------------------------------------------------------------------
// Rule text builders
// ---------------------------------------------------------------------------

/** The mandatory non-detection sections every fixture rule carries. */
export const RULE_HEADER = [
  'title: Conformance fixture',
  'logsource:',
  '    product: windows',
  '    category: process_creation',
].join('\n');

/** Strip the common leading indentation of a template literal and trim blank edge lines. */
export function dedent(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => /^ */.exec(line)![0].length);
  const common = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(common)).join('\n');
}

/** Wrap the lines that belong under `detection:` into a complete, valid rule. */
export function ruleWith(detectionFragment: string): string {
  const body = dedent(detectionFragment)
    .split('\n')
    .map((line) => (line === '' ? line : `    ${line}`))
    .join('\n');
  return `${RULE_HEADER}\ndetection:\n${body}\n`;
}

/**
 * Accept either a complete rule (anything with a top-level `detection:` key) or a
 * detection-body fragment, and always return complete rule text.
 */
export function toRuleText(ruleOrFragment: string): string {
  const text = dedent(ruleOrFragment);
  return /^detection:/m.test(text) ? `${text}\n` : ruleWith(text);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlockValue(value: unknown): boolean {
  return (
    (Array.isArray(value) && value.length > 0) ||
    (isPlainObject(value) && Object.keys(value).length > 0)
  );
}

/**
 * Render JS data as block-style YAML. Every scalar and every key is JSON-quoted,
 * which is valid YAML and removes any ambiguity about type inference: a test that
 * passes the string "yes" or "007" gets exactly that string.
 */
function blockLines(value: unknown, indent: number): string[] {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value) && value.length > 0) {
    return value.flatMap((item): string[] => {
      if (isBlockValue(item)) {
        const inner = blockLines(item, indent + 2);
        return [`${pad}- ${inner[0]!.slice(indent + 2)}`, ...inner.slice(1)];
      }
      return [`${pad}- ${JSON.stringify(item)}`];
    });
  }
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    return Object.entries(value).flatMap(([key, item]): string[] => {
      if (isBlockValue(item)) {
        return [`${pad}${JSON.stringify(key)}:`, ...blockLines(item, indent + 4)];
      }
      return [`${pad}${JSON.stringify(key)}: ${JSON.stringify(item)}`];
    });
  }
  return [`${pad}${JSON.stringify(value)}`];
}

/** Build a full rule from named selections and a condition (string, or list = OR of entries). */
export function rule(
  selections: Record<string, unknown>,
  condition: string | readonly string[],
): string {
  const detection = { ...selections, condition };
  return `${RULE_HEADER}\ndetection:\n${blockLines(detection, 4).join('\n')}\n`;
}

/** A rule with exactly one selection named `selection` that holds one field constraint. */
export function fieldRule(fieldKey: string, value: unknown): string {
  return rule({ selection: { [fieldKey]: value } }, 'selection');
}

// ---------------------------------------------------------------------------
// Compile / match shorthands
// ---------------------------------------------------------------------------

export function compile(ruleOrFragment: string): CompiledRule {
  return loadRule(toRuleText(ruleOrFragment));
}

export function evaluate(ruleOrFragment: string, event: SigmaEvent): MatchResult {
  return compile(ruleOrFragment).match(event);
}

export function matches(ruleOrFragment: string, event: SigmaEvent): boolean {
  return evaluate(ruleOrFragment, event).matched;
}

/** Does `{ [fieldKey]: value }` match `event`? The workhorse of the table-driven tests. */
export function hit(fieldKey: string, value: unknown, event: SigmaEvent): boolean {
  return matches(fieldRule(fieldKey, value), event);
}

function show(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return String(value);
    return text.length > 160 ? `${text.slice(0, 160)}...` : text;
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Table-driven test registration
// ---------------------------------------------------------------------------

/** [behavior in plain English, rule value, event, should it match?] */
export type FieldRow = readonly [name: string, value: unknown, event: SigmaEvent, expected: boolean];

/** Register one test per row for the selection `{ [fieldKey]: value }`. */
export function fieldCases(fieldKey: string, rows: readonly FieldRow[]): void {
  for (const [name, value, event, expected] of rows) {
    test(`${fieldKey}: ${name}`, () => {
      assert.equal(
        hit(fieldKey, value, event),
        expected,
        `${fieldKey}: ${show(value)} should ${expected ? '' : 'not '}match ${show(event)}`,
      );
    });
  }
}

/** [behavior in plain English, rule or detection fragment, event, should it match?] */
export type RuleRow = readonly [
  name: string,
  ruleOrFragment: string,
  event: SigmaEvent,
  expected: boolean,
];

/** Register one test per row for a hand-written rule or detection fragment. */
export function ruleCases(rows: readonly RuleRow[]): void {
  for (const [name, ruleOrFragment, event, expected] of rows) {
    test(name, () => {
      assert.equal(
        matches(ruleOrFragment, event),
        expected,
        `rule should ${expected ? '' : 'not '}match ${show(event)}`,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Error assertions
// ---------------------------------------------------------------------------

export interface ErrorExpectation {
  /** The error message must match (a learner-facing message that names the problem). */
  message?: RegExp;
  /** `RuleParseError.path` must match. */
  path?: RegExp;
  /** `UnsupportedFeatureError.feature` plus the message must match. */
  feature?: RegExp;
}

function describeThrown(thrown: unknown): string {
  if (thrown === undefined) return 'nothing was thrown';
  if (thrown instanceof Error) return `${thrown.name}: ${thrown.message}`;
  return `non-Error value ${show(thrown)}`;
}

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

function assertNoLeakedInternals(error: Error): void {
  assert.ok(error.message.trim().length > 0, 'error message must not be empty');
  assert.doesNotMatch(
    error.message,
    /undefined|\[object Object\]|NaN/,
    `error message leaks an internal value: ${error.message}`,
  );
}

/** Assert that `fn` throws a RuleParseError (optionally with a path and message pattern). */
export function expectRuleParseError(
  fn: () => unknown,
  expectation: ErrorExpectation = {},
): RuleParseError {
  const thrown = capture(fn);
  assert.ok(thrown instanceof RuleParseError, `expected RuleParseError but ${describeThrown(thrown)}`);
  assert.equal(thrown.code, 'RULE_PARSE');
  assertNoLeakedInternals(thrown);
  if (expectation.message) assert.match(thrown.message, expectation.message);
  if (expectation.path) {
    assert.ok(thrown.path !== undefined, `RuleParseError should carry a path; message: ${thrown.message}`);
    assert.match(thrown.path, expectation.path);
  }
  return thrown;
}

/** Assert that `fn` throws an UnsupportedFeatureError that names the feature. */
export function expectUnsupported(
  fn: () => unknown,
  expectation: ErrorExpectation = {},
): UnsupportedFeatureError {
  const thrown = capture(fn);
  assert.ok(
    thrown instanceof UnsupportedFeatureError,
    `expected UnsupportedFeatureError but ${describeThrown(thrown)}`,
  );
  assert.equal(thrown.code, 'UNSUPPORTED_FEATURE');
  assert.ok(thrown.feature.trim().length > 0, 'UnsupportedFeatureError.feature must name the feature');
  assertNoLeakedInternals(thrown);
  const text = `${thrown.feature}\n${thrown.message}`;
  if (expectation.feature) assert.match(text, expectation.feature);
  if (expectation.message) assert.match(thrown.message, expectation.message);
  return thrown;
}

/**
 * For cases where the contract allows either class ("UnsupportedFeatureError or
 * RuleParseError naming the modifier"): the rule must be rejected with a DojoError
 * of one of the two user-facing kinds, never a TypeError or a silent success.
 */
export function expectRejected(fn: () => unknown, expectation: { message?: RegExp } = {}): DojoError {
  const thrown = capture(fn);
  assert.ok(
    thrown instanceof RuleParseError || thrown instanceof UnsupportedFeatureError,
    `expected RuleParseError or UnsupportedFeatureError but ${describeThrown(thrown)}`,
  );
  assertNoLeakedInternals(thrown);
  const text = thrown instanceof UnsupportedFeatureError ? `${thrown.feature}\n${thrown.message}` : thrown.message;
  if (expectation.message) assert.match(text, expectation.message);
  return thrown;
}

// ---------------------------------------------------------------------------
// Encoding oracles (derived from the Sigma modifiers appendix, not the implementation)
// ---------------------------------------------------------------------------

export function utf8(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

export function utf16le(text: string): Buffer {
  return Buffer.from(text, 'utf16le');
}

export function utf16be(text: string): Buffer {
  return Buffer.from(Buffer.from(text, 'utf16le')).swap16();
}

/** `utf16` in the spec: a byte order mark followed by little-endian code units (cmd -> FF FE 63 00 6d 00 64 00). */
export function utf16WithBom(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), utf16le(text)]);
}

/**
 * The three `base64offset` spellings of a byte string: the value may start at any
 * alignment inside a longer base64 stream, so skip the characters that depend on the
 * (unknown) preceding bytes and the (unknown) following bytes.
 */
export function base64OffsetVariants(bytes: Uint8Array): string[] {
  const startOffsets = [0, 2, 3];
  const endOffsets = [undefined, -3, -2];
  return [0, 1, 2].map((shift) => {
    const padded = Buffer.concat([Buffer.alloc(shift, 0x20), bytes]);
    const encoded = padded.toString('base64');
    return encoded.slice(startOffsets[shift], endOffsets[(bytes.length + shift) % 3]);
  });
}

// ---------------------------------------------------------------------------
// Timing and isolation (pathological inputs must neither hang nor crash the suite)
// ---------------------------------------------------------------------------

export function elapsedMs<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

export interface IsolatedRun {
  /** The child process was killed because it exceeded the deadline. */
  timedOut: boolean;
  /** Match verdicts in the order of the events passed in (empty when the run failed). */
  results: boolean[];
  compileMs: number;
  matchMs: number;
  stderr: string;
}

const SIGMA_INDEX_URL = pathToFileURL(resolve(import.meta.dirname, '../../src/sigma/index.ts')).href;

const ISOLATED_RUNNER = `
import { readFileSync } from 'node:fs';
const { loadRule } = await import(${JSON.stringify(SIGMA_INDEX_URL)});
const job = JSON.parse(readFileSync(process.env.DOJO_CONFORMANCE_JOB, 'utf8'));
const compileStart = performance.now();
const compiled = loadRule(job.rule);
const matchStart = performance.now();
const results = job.events.map((event) => compiled.match(event).matched);
const end = performance.now();
process.stdout.write(JSON.stringify({ results, compileMs: matchStart - compileStart, matchMs: end - matchStart }));
`;

/**
 * Compile `ruleText` and match every event in a separate Node process with a hard
 * deadline. A synchronous infinite loop cannot be interrupted inside the test
 * process, so pathological-input tests run here: a hang becomes a failed assertion
 * instead of a frozen suite.
 */
export function runIsolated(
  ruleText: string,
  events: readonly unknown[],
  timeoutMs = 30_000,
): IsolatedRun {
  const dir = mkdtempSync(join(tmpdir(), 'dojo-conformance-'));
  try {
    const jobFile = join(dir, 'job.json');
    writeFileSync(jobFile, JSON.stringify({ rule: ruleText, events }));
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', ISOLATED_RUNNER],
      {
        encoding: 'utf8',
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, DOJO_CONFORMANCE_JOB: jobFile },
      },
    );
    const timedOut = child.error !== undefined && 'code' in child.error && child.error.code === 'ETIMEDOUT';
    if (timedOut || child.status !== 0) {
      return { timedOut, results: [], compileMs: NaN, matchMs: NaN, stderr: child.stderr ?? '' };
    }
    const parsed = JSON.parse(child.stdout) as { results: boolean[]; compileMs: number; matchMs: number };
    return { timedOut: false, results: parsed.results, compileMs: parsed.compileMs, matchMs: parsed.matchMs, stderr: child.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
