/**
 * YAML text to a structurally valid `SigmaRule`.
 *
 * This layer answers "is this a Sigma rule at all?" (required keys, key types,
 * unsupported document kinds). What the detection section means is decided
 * later, in `compileRule`, so that a rule built in code gets the same checks
 * as one read from a file.
 */
import { Buffer } from 'node:buffer';
import { parseDocument } from 'yaml';
import { RuleParseError, UnsupportedFeatureError } from '../errors.ts';
import { readConditions } from './condition.ts';
import { describeValue } from './describe.ts';
import { isRecord } from './lookup.ts';
import type { SigmaRule } from './types.ts';

/** Largest accepted rule text. Real rules are a few kilobytes; the cap bounds parser memory and time. */
export const MAX_RULE_BYTES = 256 * 1024;

// Aliases are legal YAML, but a chain of them can expand a tiny file into
// gigabytes ("billion laughs"), so the count is capped.
const MAX_YAML_ALIASES = 100;

const STRING_KEYS = ['id', 'name', 'status', 'description', 'author', 'date', 'modified'] as const;
const STRING_LIST_KEYS = ['references', 'tags', 'fields', 'falsepositives'] as const;
const LEVELS = ['informational', 'low', 'medium', 'high', 'critical'];

function readYaml(source: string): unknown {
  const doc = parseDocument(source, {
    uniqueKeys: true,
    // Merge keys (`<<: *anchor`) are YAML 1.1, but SigmaHQ rules are written for PyYAML and use them.
    merge: true,
    // The library would otherwise print its own warnings to the console.
    logLevel: 'silent',
  });

  if (doc.errors.some((error) => error.code === 'MULTIPLE_DOCS')) {
    throw new UnsupportedFeatureError(
      'multi-document YAML',
      'This file contains more than one YAML document (a line with "---" in the middle). ' +
        'detection-dojo grades one rule at a time: put each rule in its own file, and write it as one complete document.',
    );
  }

  const [error] = doc.errors;
  if (error !== undefined) {
    if (error.code === 'RESOURCE_EXHAUSTION') {
      throw new RuleParseError('The YAML is nested too deeply to read. A Sigma rule needs only a few levels of indentation.', undefined, { cause: error });
    }
    const where = error.linePos ? ` (line ${error.linePos[0].line}, column ${error.linePos[0].col})` : '';
    const reason = (error.message.split('\n')[0] ?? '').replace(/ at line \d+, column \d+:?$/, '');
    const hint =
      error.code === 'DUPLICATE_KEY'
        ? ' A key may appear only once in a map; to give a field several values, use a list under a single key.'
        : error.code === 'TAB_AS_INDENT'
          ? ' Indent with spaces.'
          : '';
    throw new RuleParseError(`Invalid YAML${where}: ${reason}.${hint}`, undefined, { cause: error });
  }

  try {
    return doc.toJS({ maxAliasCount: MAX_YAML_ALIASES });
  } catch (cause) {
    if (cause instanceof RangeError) {
      throw new RuleParseError('The YAML is nested too deeply to read. A Sigma rule needs only a few levels of indentation.', undefined, { cause });
    }
    throw new RuleParseError(
      `The YAML uses too many aliases (*name references) or cannot be expanded: ${cause instanceof Error ? cause.message : String(cause)}.`,
      undefined,
      { cause },
    );
  }
}

function rejectUnsupportedDocumentKinds(rule: Record<string, unknown>): void {
  const action = rule['action'];
  if (action === 'global' || action === 'reset' || action === 'repeat') {
    throw new UnsupportedFeatureError(
      `action: ${action}`,
      `This file uses \`action: ${action}\`, which builds rules out of several YAML documents that share settings. ` +
        'Write each rule as one complete, standalone document instead.',
    );
  }
  if (Object.hasOwn(rule, 'correlation')) {
    throw new UnsupportedFeatureError(
      'correlation rules',
      'Correlation rules link several events over time (counts, sequences) and need a SIEM to evaluate. ' +
        'Write a detection rule for the single event that matters, and describe the correlation in `description`.',
    );
  }
  if (Object.hasOwn(rule, 'filter')) {
    throw new UnsupportedFeatureError(
      'filter meta-rules',
      'Sigma filters are meta-rules that modify other rules. Add the exclusion to the rule itself instead: ' +
        'define a `filter` selection under `detection` and write `condition: selection and not filter`.',
    );
  }
}

function requireKey(rule: Record<string, unknown>, key: string, hint: string): unknown {
  const value = rule[key];
  if (!Object.hasOwn(rule, key) || value === null || value === undefined) {
    throw new RuleParseError(`The rule is missing the required '${key}' key. ${hint}`, key);
  }
  return value;
}

function validateRule(value: unknown): SigmaRule {
  if (value === null || value === undefined) {
    throw new RuleParseError('The rule is empty. A Sigma rule needs at least `title:`, `logsource:` and `detection:`.');
  }
  if (!isRecord(value)) {
    throw new RuleParseError(
      `A Sigma rule must be a YAML map of keys (title, logsource, detection, ...), but this document is ${describeValue(value)}.`,
    );
  }

  rejectUnsupportedDocumentKinds(value);

  const title = requireKey(value, 'title', 'Add a short name, for example `title: Suspicious Scheduled Task Creation`.');
  if (typeof title !== 'string' || title.trim() === '') {
    throw new RuleParseError(`'title' must be non-empty text, but it is ${describeValue(title)}.`, 'title');
  }

  const logsource = requireKey(
    value,
    'logsource',
    'It says where the events come from, for example `logsource: {product: windows, category: process_creation}`.',
  );
  if (!isRecord(logsource)) {
    throw new RuleParseError(`'logsource' must be a map such as \`product: windows\`, but it is ${describeValue(logsource)}.`, 'logsource');
  }

  const detection = requireKey(
    value,
    'detection',
    'It holds your selections and the `condition` that combines them, for example `detection: {selection: {Image|endswith: \'\\cmd.exe\'}, condition: selection}`.',
  );
  if (!isRecord(detection)) {
    throw new RuleParseError(`'detection' must be a map of selections plus a condition, but it is ${describeValue(detection)}.`, 'detection');
  }
  readConditions(detection);

  for (const key of STRING_KEYS) {
    const entry = value[key];
    if (Object.hasOwn(value, key) && entry !== undefined && entry !== null && typeof entry !== 'string') {
      throw new RuleParseError(
        `'${key}' must be text, but it is ${describeValue(entry)}. Put the value in quotes if it looks like a number or a date.`,
        key,
      );
    }
  }
  for (const key of STRING_LIST_KEYS) {
    const entry = value[key];
    if (!Object.hasOwn(value, key) || entry === undefined || entry === null) continue;
    if (!Array.isArray(entry) || entry.some((item) => typeof item !== 'string')) {
      throw new RuleParseError(
        `'${key}' must be a list of text items (\`${key}:\` followed by \`- item\` lines), but it is ${describeValue(entry)}.`,
        key,
      );
    }
  }
  const level = value['level'];
  if (Object.hasOwn(value, 'level') && level !== undefined && level !== null && !LEVELS.includes(String(level))) {
    throw new RuleParseError(`'level' must be one of ${LEVELS.join(', ')}, but it is ${JSON.stringify(level)}.`, 'level');
  }

  // The checks above establish the SigmaRule shape (title, logsource, detection.condition and the
  // typed optional keys); everything else is intentionally free-form per the specification.
  return value as SigmaRule;
}

/** Parse one Sigma rule document. Throws RuleParseError / UnsupportedFeatureError. */
export function parseRuleYaml(text: string): SigmaRule {
  if (typeof text !== 'string') {
    throw new RuleParseError(`The rule text must be a string, but it is ${describeValue(text)}.`);
  }
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_RULE_BYTES) {
    throw new RuleParseError(
      `The rule is ${bytes} bytes long; the limit is ${MAX_RULE_BYTES} bytes (256 KiB). A Sigma rule is normally a few kilobytes.`,
    );
  }
  // A leading byte order mark (common from Windows editors) is not part of the YAML.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return validateRule(readYaml(source));
}
