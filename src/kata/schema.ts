/**
 * Strict, hand-written validator for kata.yml.
 *
 * Strictness is the point: a typo like `hint:` instead of `hints:` must be an
 * error that names the typo, never a silently ignored key. All problems in the
 * file are collected and reported together so an author fixes them in one pass.
 */

import YAML from 'yaml';
import type { SigmaLogsource } from '../sigma/types.ts';
import { KATA_ID_PATTERN } from './resolve.ts';
import type { KataKind, KataMeta, KataThresholds, KataTier } from './types.ts';

export const ATTACK_ID_PATTERN = /^T\d{4}(\.\d{3})?$/;

const FILE = 'kata.yml';
const MIN_HINTS = 2;
const MAX_HINTS = 4;

const THRESHOLD_KEYS = ['min_tpr', 'max_fpr', 'min_variants_caught'] as const;
/** `tags` and `thresholds` have documented defaults; every other key must be written out. */
const OPTIONAL_KEYS = ['tags', 'thresholds'] as const;
const REQUIRED_KEYS = [
  'number',
  'id',
  'title',
  'tier',
  'kind',
  'attack',
  'logsource',
  'scenario',
  'objective',
  'hints',
  'estimated_minutes',
  'author',
] as const;
const ALL_KEYS: readonly string[] = [...REQUIRED_KEYS, ...OPTIONAL_KEYS];

export interface MetaCheck {
  /** Present only when `errors` is empty. */
  meta: KataMeta | undefined;
  errors: string[];
}

type Fail = (message: string) => void;

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Short description of a wrongly typed value for error messages. */
function describe(value: unknown): string {
  if (value === null || value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  if (typeof value === 'string') {
    return `the text ${JSON.stringify(value.length > 40 ? `${value.slice(0, 37)}...` : value)}`;
  }
  return String(value);
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(substitution, (previous[j] as number) + 1, (current[j - 1] as number) + 1);
    }
    previous = current;
  }
  return previous[b.length] as number;
}

/** `unknown key "hint" (did you mean "hints"?)`, or the list of valid keys when nothing is close. */
function unknownKeyMessage(display: string, key: string, valid: readonly string[]): string {
  let closest = '';
  let closestDistance = Infinity;
  for (const candidate of valid) {
    const distance = editDistance(key, candidate);
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }
  const suggestion =
    closestDistance <= Math.max(2, Math.floor(key.length / 3))
      ? ` (did you mean "${closest}"?)`
      : `; valid keys are ${valid.join(', ')}`;
  return `unknown key "${display}"${suggestion}`;
}

function textField(raw: Record<string, unknown>, key: string, fail: Fail): string {
  const value = raw[key];
  if (value === undefined) return ''; // a missing key is reported once, up front
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`"${key}" must be non-empty text (found ${describe(value)})`);
    return '';
  }
  return value.trim();
}

function integerField(
  raw: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  fail: Fail,
): number {
  const value = raw[key];
  if (value === undefined) return min;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`"${key}" must be a whole number from ${min} to ${max} (found ${describe(value)})`);
    return min;
  }
  return value;
}

function stringList(
  raw: Record<string, unknown>,
  key: string,
  fail: Fail,
  check: (item: string, index: number) => string | undefined,
): string[] {
  const value = raw[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    fail(`"${key}" must be a list (found ${describe(value)})`);
    return [];
  }
  const items: string[] = [];
  value.forEach((item: unknown, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      fail(`"${key}[${index}]" must be non-empty text (found ${describe(item)})`);
      return;
    }
    const problem = check(item.trim(), index);
    if (problem !== undefined) fail(`"${key}[${index}]" ${problem}`);
    items.push(item.trim());
  });
  return items;
}

function logsourceField(raw: Record<string, unknown>, fail: Fail): SigmaLogsource {
  const value = raw.logsource;
  if (value === undefined) return {};
  if (!isMapping(value) || Object.keys(value).length === 0) {
    fail(`"logsource" must be a mapping such as { category: process_creation, product: windows } (found ${describe(value)})`);
    return {};
  }
  for (const key of ['product', 'category', 'service', 'definition']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      fail(`"logsource.${key}" must be text (found ${describe(value[key])})`);
    }
  }
  return value as SigmaLogsource;
}

function rateField(
  raw: Record<string, unknown>,
  key: 'min_tpr' | 'max_fpr',
  fallback: number,
  fail: Fail,
): number {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(`"thresholds.${key}" must be a number from 0 to 1 (found ${describe(value)})`);
    return fallback;
  }
  return value;
}

function thresholdsField(raw: Record<string, unknown>, fail: Fail): KataThresholds {
  const thresholds: KataThresholds = { min_tpr: 1, max_fpr: 0, min_variants_caught: 0 };
  const value = raw.thresholds;
  if (value === undefined) return thresholds;
  if (!isMapping(value)) {
    fail(`"thresholds" must be a mapping (found ${describe(value)})`);
    return thresholds;
  }
  for (const key of Object.keys(value)) {
    if (!(THRESHOLD_KEYS as readonly string[]).includes(key)) {
      fail(unknownKeyMessage(`thresholds.${key}`, key, THRESHOLD_KEYS));
    }
  }
  thresholds.min_tpr = rateField(value, 'min_tpr', thresholds.min_tpr, fail);
  thresholds.max_fpr = rateField(value, 'max_fpr', thresholds.max_fpr, fail);

  const variants = value.min_variants_caught;
  if (variants !== undefined) {
    if (variants === 'all' || (typeof variants === 'number' && Number.isInteger(variants) && variants >= 0)) {
      thresholds.min_variants_caught = variants;
    } else {
      fail(`"thresholds.min_variants_caught" must be a whole number or the word all (found ${describe(variants)})`);
    }
  }
  return thresholds;
}

/** Validate an already-parsed kata.yml document. */
export function checkKataMeta(raw: unknown): MetaCheck {
  const errors: string[] = [];
  const fail: Fail = (message) => {
    errors.push(`${FILE}: ${message}`);
  };

  if (raw === null || raw === undefined) {
    fail('the file is empty; it needs keys such as number, id, title and tier');
    return { meta: undefined, errors };
  }
  if (!isMapping(raw)) {
    fail(`the file must be a mapping of keys to values (found ${describe(raw)})`);
    return { meta: undefined, errors };
  }

  for (const key of Object.keys(raw)) {
    if (!ALL_KEYS.includes(key)) fail(unknownKeyMessage(key, key, ALL_KEYS));
  }
  for (const key of REQUIRED_KEYS) {
    if (raw[key] === undefined) fail(`missing required key "${key}"`);
  }

  const number = integerField(raw, 'number', 1, 999, fail);
  const id = textField(raw, 'id', fail);
  if (id !== '' && !KATA_ID_PATTERN.test(id)) {
    fail(
      `"id" must be a lowercase slug of a-z, 0-9 and hyphens, 2 to 51 characters, starting with a letter or digit (found ${JSON.stringify(id)})`,
    );
  }
  const title = textField(raw, 'title', fail);
  const tier = integerField(raw, 'tier', 1, 3, fail);

  let kind: KataKind = 'write';
  if (raw.kind !== undefined) {
    if (raw.kind === 'write' || raw.kind === 'tune') kind = raw.kind;
    else fail(`"kind" must be write or tune (found ${describe(raw.kind)})`);
  }

  const attack = stringList(raw, 'attack', fail, (item) =>
    ATTACK_ID_PATTERN.test(item)
      ? undefined
      : `must be a MITRE ATT&CK technique id like T1053 or T1053.005 (found ${JSON.stringify(item)})`,
  );
  const tags = stringList(raw, 'tags', fail, () => undefined);
  const logsource = logsourceField(raw, fail);
  const scenario = textField(raw, 'scenario', fail);
  const objective = textField(raw, 'objective', fail);

  const hints = stringList(raw, 'hints', fail, () => undefined);
  if (raw.hints !== undefined && Array.isArray(raw.hints) && (hints.length < MIN_HINTS || hints.length > MAX_HINTS)) {
    fail(`"hints" needs ${MIN_HINTS} to ${MAX_HINTS} entries, gentlest first (found ${hints.length})`);
  }

  const thresholds = thresholdsField(raw, fail);
  const estimatedMinutes = integerField(raw, 'estimated_minutes', 1, 480, fail);
  const author = textField(raw, 'author', fail);

  if (errors.length > 0) return { meta: undefined, errors };
  return {
    meta: {
      number,
      id,
      title,
      tier: tier as KataTier,
      kind,
      attack,
      tags,
      logsource,
      scenario,
      objective,
      hints,
      thresholds,
      estimated_minutes: estimatedMinutes,
      author,
    },
    errors,
  };
}

/** Parse and validate the text of kata.yml. */
export function parseKataMeta(text: string): MetaCheck {
  // uniqueKeys makes a duplicated key a parse error instead of "last one wins".
  const document = YAML.parseDocument(text, { uniqueKeys: true });
  if (document.errors.length > 0) {
    return {
      meta: undefined,
      errors: document.errors.map((e) => {
        const firstLine = (e.message.split('\n')[0] ?? e.message).replace(/:$/, '');
        return `${FILE}: ${firstLine}`;
      }),
    };
  }

  let value: unknown;
  try {
    value = document.toJS();
  } catch (err) {
    return { meta: undefined, errors: [`${FILE}: ${(err as Error).message}`] };
  }
  return checkKataMeta(value);
}
