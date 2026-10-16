/**
 * Detection items: one `field|modifiers: value(s)` entry of a selection, or a
 * keyword search, compiled into a closure over an event.
 */
import { RuleParseError } from '../errors.ts';
import { describeValue } from './describe.ts';
import {
  compileFieldPath,
  eventScalars,
  eventScalarsLowerCase,
  lookupField,
  scalarsOf,
  type EventContext,
  type FieldPath,
} from './lookup.ts';
import {
  compileValues,
  KEYWORD_CHAIN,
  parseModifierChain,
  type CompiledValues,
  type ModifierChain,
  type PatternBudget,
  type RuleValue,
} from './modifiers.ts';
import { hasWildcards, literalText, parseWildcards } from './wildcard.ts';

export type Matcher = (ctx: EventContext) => boolean;

export interface CompiledEntry {
  readonly match: Matcher;
  /** Event fields this entry reads (keyword searches read none). */
  readonly fields: readonly string[];
}

export function isRuleValue(value: unknown): value is RuleValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** Validate the value side of `field: value` / `field: [values]` and return it as a list. */
function readValues(raw: unknown, key: string, path: string): RuleValue[] {
  if (isRuleValue(raw)) return [raw];

  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      throw new RuleParseError(`'${key}' has an empty list of values; give it at least one value.`, path);
    }
    return raw.map((element, index) => {
      if (isRuleValue(element)) return element;
      if (element === null) {
        throw new RuleParseError(
          `'${key}' contains null in its list of values. Sigma does not allow null inside a list: ` +
            `test for a missing field in its own selection (\`${key.split('|')[0]}: null\`) and combine the selections in the condition.`,
          `${path}[${index}]`,
        );
      }
      throw new RuleParseError(
        `'${key}' contains ${describeValue(element)} at position ${index + 1}; list items must be text, numbers or booleans.`,
        `${path}[${index}]`,
      );
    });
  }

  throw new RuleParseError(
    `The value of '${key}' is ${describeValue(raw)}; use text, a number, a boolean, or a list of them. ` +
      (typeof raw === 'object' && raw !== null
        ? 'If the next line was meant to be another field, check its indentation.'
        : ''),
    path,
  );
}

/** Run the tests against one already case-folded value. */
function matchesAny(subject: string, values: CompiledValues): boolean {
  if (values.exact.has(subject)) return true;
  for (const test of values.tests) if (test(subject)) return true;
  return false;
}

/** Every test must pass on at least one subject. */
function everyTestMatchesSome(subjects: readonly string[], values: CompiledValues): boolean {
  for (const test of values.tests) {
    let passed = false;
    for (const subject of subjects) {
      if (test(subject)) {
        passed = true;
        break;
      }
    }
    if (!passed) return false;
  }
  return true;
}

function fieldMatcher(path: FieldPath, values: CompiledValues): Matcher {
  const { fold, all, matchesAnyPresent } = values;

  if (all) {
    return (ctx) => {
      const raw = lookupField(ctx, path);
      if (raw === undefined || raw === null) return false;
      const texts = scalarsOf(raw);
      return everyTestMatchesSome(fold ? texts.map((text) => text.toLowerCase()) : texts, values);
    };
  }

  return (ctx) => {
    const raw = lookupField(ctx, path);
    if (raw === undefined || raw === null) return false;
    if (matchesAnyPresent) return true;

    if (typeof raw === 'string') return matchesAny(fold ? raw.toLowerCase() : raw, values);
    if (typeof raw === 'number' || typeof raw === 'boolean') return matchesAny(String(raw), values);
    for (const text of scalarsOf(raw)) {
      if (matchesAny(fold ? text.toLowerCase() : text, values)) return true;
    }
    return false;
  };
}

/** Keyword search: the values are tested against every scalar anywhere in the event. */
function keywordMatcher(values: CompiledValues): Matcher {
  const { fold, all } = values;
  return (ctx) => {
    const subjects = fold ? eventScalarsLowerCase(ctx) : eventScalars(ctx);
    if (all) return everyTestMatchesSome(subjects, values);
    for (const subject of subjects) if (matchesAny(subject, values)) return true;
    return false;
  };
}

function nullMatcher(path: FieldPath): Matcher {
  return (ctx) => {
    const raw = lookupField(ctx, path);
    return raw === undefined || raw === null;
  };
}

function existsMatcher(path: FieldPath, wanted: boolean): Matcher {
  return (ctx) => {
    const raw = lookupField(ctx, path);
    return (raw !== undefined && raw !== null) === wanted;
  };
}

function fieldrefMatcher(chain: ModifierChain, left: FieldPath, targets: readonly FieldPath[]): Matcher {
  const mode = chain.mode ?? 'equals';
  const fold = !chain.cased;
  const compare = (actual: string, reference: string): boolean => {
    switch (mode) {
      case 'startswith':
        return actual.startsWith(reference);
      case 'endswith':
        return actual.endsWith(reference);
      case 'contains':
        return actual.includes(reference);
      default:
        return actual === reference;
    }
  };

  const matchesTarget = (ctx: EventContext, target: FieldPath): boolean => {
    const actuals = scalarsOf(lookupField(ctx, left));
    const references = scalarsOf(lookupField(ctx, target));
    for (const actual of actuals) {
      const a = fold ? actual.toLowerCase() : actual;
      for (const reference of references) {
        if (compare(a, fold ? reference.toLowerCase() : reference)) return true;
      }
    }
    return false;
  };

  if (chain.all) {
    return (ctx) => targets.every((target) => matchesTarget(ctx, target));
  }
  return (ctx) => targets.some((target) => matchesTarget(ctx, target));
}

/**
 * Compile one `key: value` entry of a selection map. `path` is the location
 * of the entry in the rule, for error messages.
 */
export function compileMapEntry(key: string, raw: unknown, path: string, budget: PatternBudget): CompiledEntry {
  const chain = parseModifierChain(key, path);
  const fieldPath = chain.field === '' ? undefined : compileFieldPath(chain.field);

  if (raw === null || raw === undefined) {
    if (chain.modifiers.length > 0) {
      throw new RuleParseError(
        `'${key}' has no value, but a modifier needs one to work with. ` +
          `To test that the field is missing, write \`${chain.field}: null\` without modifiers or \`${chain.field}|exists: false\`.`,
        path,
      );
    }
    if (fieldPath === undefined) {
      throw new RuleParseError("A keyword search needs a value; this entry has an empty name and no value.", path);
    }
    return { match: nullMatcher(fieldPath), fields: [chain.field] };
  }

  if (chain.kind === 'exists') {
    if (typeof raw !== 'boolean' || fieldPath === undefined) {
      throw new RuleParseError(
        `'|exists' takes true or false (for example \`${chain.field}|exists: true\`), but '${key}' has ${JSON.stringify(raw)}.`,
        path,
      );
    }
    return { match: existsMatcher(fieldPath, raw), fields: [chain.field] };
  }

  const values = readValues(raw, key, path);

  if (chain.kind === 'fieldref' && fieldPath !== undefined) {
    const targets = values.map((value, index) => {
      const valuePath = values.length > 1 ? `${path}[${index}]` : path;
      const parts = parseWildcards(String(value));
      if (typeof value !== 'string' || hasWildcards(parts) || literalText(parts) === '') {
        throw new RuleParseError(
          `'|fieldref' takes the name of another field as its value (for example \`${chain.field}|fieldref: OtherField\`); ` +
            `${JSON.stringify(value)} is not usable, and field names cannot contain wildcards.`,
          valuePath,
        );
      }
      return literalText(parts);
    });
    return {
      match: fieldrefMatcher(chain, fieldPath, targets.map(compileFieldPath)),
      fields: [chain.field, ...targets],
    };
  }

  if (fieldPath === undefined) {
    return { match: keywordMatcher(compileValues(chain, values, path, budget, true)), fields: [] };
  }
  return {
    match: fieldMatcher(fieldPath, compileValues(chain, values, path, budget, false)),
    fields: [chain.field],
  };
}

/** Compile a plain list of keywords (`- 'mimikatz'`): any scalar in the event containing any of them. */
export function compileKeywords(values: readonly RuleValue[], path: string, budget: PatternBudget): CompiledEntry {
  return { match: keywordMatcher(compileValues(KEYWORD_CHAIN, values, path, budget, true)), fields: [] };
}
