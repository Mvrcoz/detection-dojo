import { readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { DojoError, UsageError } from '../errors.ts';
import { loadKata } from '../kata/index.ts';
import type { Kata } from '../kata/types.ts';
import { compileRule, parseRuleYaml } from '../sigma/index.ts';
import type { SigmaRule } from '../sigma/types.ts';
import { bold, dim, green, red, symbols, yellow } from '../render/color.ts';
import { flag, parseCommandArgs, print, printJson, readRuleFile, text } from './common.ts';

export const LINT_USAGE = 'dojo lint <file-or-dir>... [--kata <id>] [--strict] [--json]';

export interface Finding {
  file: string;
  severity: 'error' | 'warning';
  id: string;
  message: string;
  /** Location inside the rule, for example `detection.selection.CommandLine|contains`. */
  path?: string;
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git']);

function collectRuleFiles(target: string): string[] {
  let stats;
  try {
    stats = statSync(target);
  } catch {
    throw new UsageError(`'${target}' does not exist.`);
  }
  if (stats.isFile()) return [target];
  if (!stats.isDirectory()) return [];
  const found: string[] = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) found.push(...collectRuleFiles(join(target, entry.name)));
    } else if (entry.isFile() && ['.yml', '.yaml'].includes(extname(entry.name).toLowerCase())) {
      found.push(join(target, entry.name));
    }
  }
  return found.sort();
}

type Scalar = string | number | boolean | null;

/** Every `field|modifiers: value` pair in the rule's selections, flattened for the static checks. */
interface Item {
  selection: string;
  key: string;
  field: string;
  modifiers: string[];
  values: unknown[];
}

function collectItems(rule: SigmaRule): Item[] {
  const items: Item[] = [];
  for (const [selection, raw] of Object.entries(rule.detection)) {
    if (selection === 'condition' || selection === 'timeframe') continue;
    const maps = Array.isArray(raw) ? raw : [raw];
    for (const map of maps) {
      if (map !== null && typeof map === 'object' && !Array.isArray(map)) {
        for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
          const [field = '', ...modifiers] = key.split('|');
          items.push({ selection, key, field, modifiers, values: Array.isArray(value) ? value : [value] });
        }
      } else {
        // keyword search: a plain value in a list of values
        items.push({ selection, key: '(keyword)', field: '', modifiers: [], values: [map] });
      }
    }
  }
  return items;
}

const isScalar = (value: unknown): value is Scalar =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

/** Heuristic for catastrophic backtracking: a group containing a quantifier that is itself quantified. */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,\d*\})/;

function staticChecks(file: string, rule: SigmaRule, kata: Kata | undefined): Finding[] {
  const findings: Finding[] = [];
  const warn = (id: string, message: string, path?: string): void => {
    findings.push({ file, severity: 'warning', id, message, ...(path === undefined ? {} : { path }) });
  };

  if (typeof rule.id !== 'string' || rule.id === '') warn('missing-id', 'Add a UUID in `id` so the rule can be referenced and deduplicated.');
  if (typeof rule.description !== 'string' || rule.description.trim() === '') warn('missing-description', 'Add a `description` saying what behavior this rule detects.');
  if (!Array.isArray(rule.falsepositives) || rule.falsepositives.length === 0) warn('missing-falsepositives', 'List known `falsepositives`; thinking about them is half of detection engineering.');
  if (rule.level === undefined) warn('missing-level', 'Add a `level` (informational, low, medium, high or critical).');
  const tags = Array.isArray(rule.tags) ? rule.tags.map(String) : [];
  if (!tags.some((tag) => /^attack\.t\d{4}(\.\d{3})?$/i.test(tag))) warn('missing-attack-tag', 'Tag the technique, for example `attack.t1105`.');

  for (const item of collectItems(rule)) {
    const path = `detection.${item.selection}.${item.key}`;
    const matchType = item.modifiers.find((m) => ['contains', 'startswith', 'endswith'].includes(m));
    const isRegex = item.modifiers.includes('re');
    for (const value of item.values) {
      if (typeof value !== 'string') continue;
      if (matchType !== undefined && /^\**$/.test(value)) {
        warn('match-everything', `'${item.key}' with an empty or all-wildcard value matches every event that has the field.`, path);
      } else if (isRegex && (value === '' || value === '.*' || value === '.+')) {
        warn('match-everything', `The regular expression '${value}' matches everything.`, path);
      } else if (item.field === '' && item.modifiers.length === 0 && /^\**$/.test(value)) {
        warn('match-everything', 'A keyword of only wildcards matches every event.', path);
      }
      if (matchType === 'contains' && !/[*?]/.test(value) && value.length > 0 && value.length < 4) {
        warn('broad-short-contains', `'${value}' is only ${value.length} character(s) long; as a substring it will match far more than you intend.`, path);
      }
      if (isRegex) {
        if (value.startsWith('.*') || /(?<!\\)\.\*$/.test(value)) {
          warn('leading-wildcard-regex', `Regexes are unanchored searches here, so a leading or trailing '.*' in '${value}' does nothing; drop it.`, path);
        }
        if (NESTED_QUANTIFIER.test(value)) {
          warn('nested-quantifier-redos', `'${value}' has a quantified group inside a quantified group, the classic shape of catastrophic backtracking (ReDoS).`, path);
        }
      }
    }
  }

  const conditions = Array.isArray(rule.detection.condition) ? rule.detection.condition : [rule.detection.condition];
  for (const condition of conditions) {
    if (typeof condition === 'string' && /^\s*not\s+[\w*]+\s*$/i.test(condition)) {
      warn('condition-only-negation', `The condition '${condition.trim()}' matches every event that is not the filter, which is almost never what you want.`, 'detection.condition');
    }
  }

  if (kata !== undefined) {
    const expected = kata.meta.logsource;
    for (const key of ['product', 'category', 'service'] as const) {
      const have = rule.logsource[key];
      const want = expected[key];
      if (want !== undefined && have !== want) {
        warn('logsource-mismatch', `This kata's events use logsource ${key}: ${want}, but the rule says ${have === undefined ? 'nothing' : have}.`, `logsource.${key}`);
      }
    }
  }
  return findings;
}

function lintFile(file: string, kata: Kata | undefined): Finding[] {
  let rule: SigmaRule;
  try {
    const yaml = readRuleFile(file);
    rule = parseRuleYaml(yaml);
    const compiled = compileRule(rule);
    const findings = compiled.warnings.map((warning): Finding => {
      const match = /^([a-z][a-z0-9-]*): (.*)$/s.exec(warning);
      return { file, severity: 'warning', id: match?.[1] ?? 'compile-warning', message: match?.[2] ?? warning };
    });
    return [...findings, ...staticChecks(file, rule, kata)];
  } catch (error) {
    if (error instanceof UsageError) return [{ file, severity: 'error', id: 'unreadable', message: error.message }];
    if (!(error instanceof DojoError)) throw error;
    const id = error.code === 'UNSUPPORTED_FEATURE' ? 'unsupported-feature' : 'invalid-rule';
    const path = 'path' in error && typeof error.path === 'string' ? error.path : undefined;
    return [{ file, severity: 'error', id, message: error.message, ...(path === undefined ? {} : { path }) }];
  }
}

export async function lintCommand(args: string[]): Promise<number> {
  const parsed = parseCommandArgs(args, { kata: { type: 'string' }, strict: { type: 'boolean' } });
  if (parsed.positionals.length === 0) throw new UsageError(`Missing <file-or-dir>. Usage: ${LINT_USAGE}`);
  const kataQuery = text(parsed, 'kata');
  const kata = kataQuery === undefined ? undefined : loadKata(kataQuery);

  const files = parsed.positionals.flatMap((target) => collectRuleFiles(resolve(target)));
  if (files.length === 0) throw new UsageError('No .yml or .yaml rule files were found there.');

  const findings = files.flatMap((file) => lintFile(file, kata));
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;
  const failed = errors > 0 || (flag(parsed, 'strict') && warnings > 0);

  if (flag(parsed, 'json')) {
    printJson({ files: files.length, errors, warnings, findings });
    return failed ? 1 : 0;
  }

  const sym = symbols();
  print();
  for (const file of files) {
    const own = findings.filter((f) => f.file === file);
    if (own.length === 0) {
      print(`  ${green(sym.ok)} ${file}`);
      continue;
    }
    print(`  ${bold(file)}`);
    for (const finding of own) {
      const badge = finding.severity === 'error' ? red('error  ') : yellow('warning');
      print(`    ${badge} ${dim(finding.id.padEnd(24))} ${finding.message}`);
      if (finding.path !== undefined) print(`    ${' '.repeat(7)} ${dim(`at ${finding.path}`)}`);
    }
  }
  print();
  print(`  ${files.length} file(s): ${errors} error(s), ${warnings} warning(s)${flag(parsed, 'strict') && warnings > 0 ? ' (--strict makes warnings fail)' : ''}`);
  print();
  return failed ? 1 : 0;
}
