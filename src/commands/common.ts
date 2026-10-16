/** Helpers shared by every command: argument parsing, safe file reads, JSON output. */

import { readFileSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { UsageError } from '../errors.ts';
import { MAX_RULE_FILE_BYTES } from '../kata/limits.ts';
import type { KataSummary, Progress } from '../kata/types.ts';

export type OptionSpec = Record<string, { type: 'boolean' | 'string'; short?: string }>;

export interface ParsedArgs {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

const COMMON_OPTIONS: OptionSpec = {
  json: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

/** Parse a command's arguments strictly; unknown flags become friendly usage errors. */
export function parseCommandArgs(args: string[], options: OptionSpec): ParsedArgs {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: { ...COMMON_OPTIONS, ...options },
      allowPositionals: true,
      strict: true,
    });
    return { values: values as ParsedArgs['values'], positionals };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(message.replace(/\.?\s*To specify a positional.*$/s, '.'));
  }
}

export function flag(parsed: ParsedArgs, name: string): boolean {
  return parsed.values[name] === true;
}

export function text(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.values[name];
  return typeof value === 'string' ? value : undefined;
}

export function requirePositional(parsed: ParsedArgs, index: number, name: string, usage: string): string {
  const value = parsed.positionals[index];
  if (value === undefined) throw new UsageError(`Missing <${name}>. Usage: ${usage}`);
  return value;
}

export function rejectExtraPositionals(parsed: ParsedArgs, max: number, usage: string): void {
  if (parsed.positionals.length > max) {
    throw new UsageError(`Unexpected argument '${parsed.positionals[max]}'. Usage: ${usage}`);
  }
}

/** Print one JSON document and nothing else (machine-readable mode). */
export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function print(line = ''): void {
  process.stdout.write(`${line}\n`);
}

/** Read a rule file with the same size limit the evaluator enforces, tolerating a BOM. */
export function readRuleFile(path: string): string {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new UsageError(`Cannot read rule file '${path}': it does not exist.`);
  }
  if (!stats.isFile()) throw new UsageError(`'${path}' is not a file.`);
  if (stats.size > MAX_RULE_FILE_BYTES) {
    throw new UsageError(
      `Rule file '${path}' is ${stats.size} bytes; the limit is ${MAX_RULE_FILE_BYTES} bytes. Real Sigma rules are far smaller.`,
    );
  }
  try {
    return readFileSync(path, 'utf8').replace(/^﻿/, '');
  } catch (error) {
    throw new UsageError(`Cannot read rule file '${path}': ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** First kata in curriculum order the learner has not passed yet, formatted for display. */
export function nextUnfinished(katas: KataSummary[], progress: Progress, exceptId?: string): KataSummary | undefined {
  return katas.find((kata) => kata.id !== exceptId && progress.katas[kata.id]?.passed !== true);
}

export function attackUrl(id: string): string {
  return `https://attack.mitre.org/techniques/${id.replace('.', '/')}/`;
}
