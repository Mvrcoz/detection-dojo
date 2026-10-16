/**
 * Field modifiers: parsing `Field|mod1|mod2` keys into a validated chain, and
 * turning the rule's values into string tests according to that chain.
 *
 * Modifier order matters, as in the specification: value transforms
 * (`windash`, `utf16*`, `base64*`) rewrite each rule value left to right, and
 * the match-type modifier (`contains`, ...) is applied to the result. The
 * validation here rejects chains that have no sensible meaning with a message
 * that shows the corrected spelling, because "invalid combination" alone does
 * not teach anything.
 */
import { RuleParseError, UnsupportedFeatureError } from '../errors.ts';
import { parseCidr } from './cidr.ts';
import {
  base64,
  base64OffsetVariants,
  encodeUtf16,
  encodeUtf8,
  expandWindash,
  windashSites,
  WINDASH_MAX_SITES,
  type Utf16Flavor,
} from './encode.ts';
import { didYouMean } from './suggest.ts';
import {
  compileShaped,
  exactLiteral,
  hasWildcards,
  literal,
  literalText,
  matchesEverything,
  parseWildcards,
  shapePattern,
  type MatchMode,
  type PatternPart,
  type StringTest,
} from './wildcard.ts';

/** A value as written in the rule: any YAML scalar except null. */
export type RuleValue = string | number | boolean;

/** Regex source longer than this is rejected; a rule that needs more should be split into several values. */
export const MAX_REGEX_LENGTH = 2000;

/**
 * Upper bound on the string patterns one rule may compile to. `windash` and
 * `base64offset` multiply the number of patterns, so without a cap a 256 KiB
 * rule could ask for tens of millions of them.
 */
export const MAX_COMPILED_PATTERNS = 20_000;

/** Counts down the patterns a rule is still allowed to compile. */
export interface PatternBudget {
  remaining: number;
}

type Transform = 'windash' | Utf16Flavor | 'base64' | 'base64offset';
type ChainKind = 'string' | 'regex' | 'cidr' | 'compare' | 'exists' | 'fieldref';
type CompareOperator = 'lt' | 'lte' | 'gt' | 'gte';

export interface ModifierChain {
  /** Field name before the first pipe; empty for keyword searches. */
  readonly field: string;
  /** Every modifier as written, in order. */
  readonly modifiers: readonly string[];
  readonly kind: ChainKind;
  /** `all`: a list of values must all match instead of any. */
  readonly all: boolean;
  readonly cased: boolean;
  readonly transforms: readonly Transform[];
  /** `contains` / `startswith` / `endswith` when written; plain equality otherwise. */
  readonly mode: Exclude<MatchMode, 'equals'> | undefined;
  /** Regex flags in JavaScript spelling (a subset of `ims`). */
  readonly regexFlags: string;
  readonly compare: CompareOperator | undefined;
}

/** The implicit chain of an entry in a plain keyword list. */
export const KEYWORD_CHAIN: ModifierChain = {
  field: '',
  modifiers: [],
  kind: 'string',
  all: false,
  cased: false,
  transforms: [],
  mode: undefined,
  regexFlags: '',
  compare: undefined,
};

const SUPPORTED_MODIFIERS = [
  'all', 'base64', 'base64offset', 'cased', 'cidr', 'contains', 'endswith', 'exists', 'fieldref',
  'gt', 'gte', 'i', 'lt', 'lte', 'm', 're', 's', 'startswith', 'utf16', 'utf16be', 'utf16le', 'wide', 'windash',
];

const TIME_PART_HINT =
  'Time-part modifiers need timestamp parsing, which this tool does not do. Match the timestamp text with `|startswith` or `|contains` instead.';

const UNSUPPORTED_HINTS: Readonly<Record<string, string>> = {
  expand:
    'Placeholders such as %name% are filled in by a processing pipeline, which this tool does not run. Write the concrete value in the rule instead.',
  neq: 'Put the value in its own selection and negate that selection in the condition, for example `selection and not filter`.',
  minute: TIME_PART_HINT,
  hour: TIME_PART_HINT,
  day: TIME_PART_HINT,
  week: TIME_PART_HINT,
  month: TIME_PART_HINT,
  year: TIME_PART_HINT,
  ignorecase: 'Write the regex flag as `|re|i`.',
  multiline: 'Write the regex flag as `|re|m`.',
  dotall: 'Write the regex flag as `|re|s`.',
};

function unsupportedModifier(modifier: string, key: string, path: string): never {
  const hint = UNSUPPORTED_HINTS[modifier] ?? '';
  const suggestion = hint === '' ? didYouMean(modifier, SUPPORTED_MODIFIERS) : undefined;
  throw new UnsupportedFeatureError(
    `|${modifier}`,
    `The modifier '|${modifier}' (in '${key}' at ${path}) is not supported by detection-dojo. ` +
      (hint !== '' ? `${hint} ` : '') +
      (suggestion !== undefined ? `Did you mean '|${suggestion}'? ` : '') +
      `Supported modifiers: ${SUPPORTED_MODIFIERS.join(', ')}.`,
  );
}

/**
 * Split `Field|mod1|mod2` and validate the modifier chain. `path` is the
 * location of this key in the rule and is attached to every error.
 */
export function parseModifierChain(key: string, path: string): ModifierChain {
  const [field = '', ...modifiers] = key.split('|');
  const fail = (message: string): never => {
    throw new RuleParseError(message, path);
  };

  // One mutable record instead of loose `let`s: TypeScript cannot see
  // assignments made inside the helper closures below and would narrow
  // plain variables to their initial values.
  const state = {
    all: false,
    cased: false,
    kind: 'string' as ChainKind,
    typeModifier: undefined as string | undefined,
    mode: undefined as Exclude<MatchMode, 'equals'> | undefined,
    modeIndex: -1,
    fieldrefIndex: -1,
    compare: undefined as CompareOperator | undefined,
    transforms: [] as Transform[],
    flags: [] as string[],
  };

  const setKind = (kind: ChainKind, name: string): void => {
    if (state.typeModifier !== undefined) {
      fail(`'|${name}' cannot be combined with '|${state.typeModifier}' in '${key}'; use one or the other.`);
    }
    state.typeModifier = name;
    state.kind = kind;
  };

  const addTransform = (transform: Transform, written: string): void => {
    const { transforms } = state;
    const isEncoding = transform === 'base64' || transform === 'base64offset';
    const isUtf16 = !isEncoding && transform !== 'windash';
    if (transforms.includes(transform)) fail(`The modifier '|${written}' is used twice in '${key}'.`);
    if (isEncoding && transforms.some((t) => t === 'base64' || t === 'base64offset')) {
      fail(`Use either '|base64' or '|base64offset' in '${key}', not both.`);
    }
    if (isUtf16 && transforms.some((t) => t === 'utf16le' || t === 'utf16be' || t === 'utf16')) {
      fail(`Use only one of '|utf16le', '|utf16be', '|utf16' and '|wide' in '${key}'.`);
    }
    if (!isEncoding && transforms.some((t) => t === 'base64' || t === 'base64offset')) {
      fail(`'|${written}' must come before '|base64' or '|base64offset' in '${key}', because the transforms apply left to right.`);
    }
    transforms.push(transform);
  };

  for (const [index, modifier] of modifiers.entries()) {
    switch (modifier) {
      case 'all':
        if (state.all) fail(`The modifier '|all' is used twice in '${key}'.`);
        state.all = true;
        break;
      case 'cased':
        if (state.cased) fail(`The modifier '|cased' is used twice in '${key}'.`);
        state.cased = true;
        break;
      case 'contains':
      case 'startswith':
      case 'endswith':
        if (state.mode !== undefined) {
          fail(`Use only one of '|contains', '|startswith' and '|endswith' in '${key}' (found '|${state.mode}' and '|${modifier}').`);
        }
        state.mode = modifier;
        state.modeIndex = index;
        break;
      case 'windash':
      case 'base64':
      case 'base64offset':
        addTransform(modifier, modifier);
        break;
      case 'utf16le':
      case 'wide':
      case 'utf16be':
      case 'utf16': {
        const following = modifiers[index + 1];
        if (following !== 'base64' && following !== 'base64offset') {
          fail(
            `'|${modifier}' only makes sense in front of '|base64' or '|base64offset', ` +
              `for example '${field}|${modifier}|base64offset|contains' (found in '${key}').`,
          );
        }
        addTransform(modifier === 'wide' ? 'utf16le' : modifier, modifier);
        break;
      }
      case 're':
        setKind('regex', modifier);
        break;
      case 'i':
      case 'm':
      case 's':
        state.flags.push(modifier);
        break;
      case 'cidr':
        setKind('cidr', modifier);
        break;
      case 'exists':
        setKind('exists', modifier);
        break;
      case 'fieldref':
        setKind('fieldref', modifier);
        state.fieldrefIndex = index;
        break;
      case 'lt':
      case 'lte':
      case 'gt':
      case 'gte':
        setKind('compare', modifier);
        state.compare = modifier;
        break;
      default:
        unsupportedModifier(modifier, key, path);
    }
  }

  const { kind, mode, transforms, flags } = state;

  const rejectExtras = (what: string): void => {
    const extras = modifiers.filter((m) => m !== 'all' && m !== state.typeModifier && !flags.includes(m));
    if (extras.length > 0) {
      fail(`'|${what}' cannot be combined with ${extras.map((m) => `'|${m}'`).join(', ')} in '${key}'.`);
    }
  };

  if (flags.length > 0 && kind !== 'regex') {
    fail(`'|${flags[0]}' is a flag for regular expressions and must follow '|re', for example '${field}|re|${flags[0]}' (in '${key}').`);
  }
  if (new Set(flags).size !== flags.length) fail(`A regex flag is repeated in '${key}'.`);

  switch (kind) {
    case 'exists':
      if (field === '') fail(`'|exists' needs a field name in front of the pipe, but '${key}' has none.`);
      rejectExtras('exists');
      break;
    case 'regex':
      if (mode !== undefined) {
        fail(
          `'|${mode}' cannot follow '|re' in '${key}': a regular expression already searches anywhere in the value. ` +
            'Use ^ and $ inside the pattern to anchor it.',
        );
      }
      if (state.cased) {
        fail(`'|cased' is not needed with '|re' in '${key}': regular expressions are case-sensitive already. Use '|re|i' to ignore case.`);
      }
      rejectExtras('re');
      break;
    case 'cidr':
    case 'compare':
      rejectExtras(state.typeModifier ?? kind);
      break;
    case 'fieldref':
      if (field === '') fail(`'|fieldref' needs a field name in front of the pipe, but '${key}' has none.`);
      if (transforms.length > 0) fail(`'|fieldref' cannot be combined with '|${transforms[0]}' in '${key}'.`);
      if (mode !== undefined && state.modeIndex < state.fieldrefIndex) {
        fail(`Write '|fieldref' before '|${mode}' (for example '${field}|fieldref|${mode}'), not after it, in '${key}'.`);
      }
      break;
    case 'string':
      break;
  }

  return {
    field,
    modifiers,
    kind,
    all: state.all,
    cased: state.cased,
    transforms,
    mode,
    regexFlags: ['i', 'm', 's'].filter((flag) => flags.includes(flag)).join(''),
    compare: state.compare,
  };
}

/** One rule value in the middle of the transform pipeline: still text with wildcards, or already bytes. */
type Stage = { readonly parts: PatternPart[] } | { readonly bytes: Uint8Array };

function requirePlainText(parts: readonly PatternPart[], transform: string, path: string): string {
  if (hasWildcards(parts)) {
    throw new RuleParseError(
      `'|${transform}' cannot be used with a value containing the wildcards '*' or '?', because encoded text has no meaningful wildcards. ` +
        "Write a literal star or question mark as '\\*' or '\\?', or drop the wildcard and use '|contains' instead.",
      path,
    );
  }
  return literalText(parts);
}

function applyTransform(stage: Stage, transform: Transform, path: string): Stage[] {
  if (transform === 'windash') {
    if (!('parts' in stage)) return [stage];
    const sites = stage.parts.reduce((sum, part) => sum + (part.kind === 'literal' ? windashSites(part.text).length : 0), 0);
    if (sites > WINDASH_MAX_SITES) {
      throw new RuleParseError(
        `'|windash' expands at most ${WINDASH_MAX_SITES} dashes in one value, but this value has ${sites}. ` +
          'Split it into several values (a list matches if any value matches), each with fewer dashes.',
        path,
      );
    }
    let combinations: PatternPart[][] = [[]];
    for (const part of stage.parts) {
      const variants = part.kind === 'literal' ? expandWindash(part.text).map(literal) : [part];
      combinations = combinations.flatMap((prefix) => variants.map((variant) => [...prefix, variant]));
    }
    return combinations.map((parts) => ({ parts }));
  }

  if (transform === 'base64' || transform === 'base64offset') {
    const bytes = 'bytes' in stage ? stage.bytes : encodeUtf8(requirePlainText(stage.parts, transform, path));
    const encoded = transform === 'base64' ? [base64(bytes)] : base64OffsetVariants(bytes);
    if (transform === 'base64offset' && encoded.includes('')) {
      // A one-byte value leaves no base64 character at some alignment that depends on it alone.
      // pySigma would emit an empty pattern there, which with `contains` matches every event.
      throw new RuleParseError(
        "'|base64offset' needs a longer value: this one is so short that at one of the three alignments no base64 character is determined by it, " +
          'so the pattern would match everything. Use at least two characters.',
        path,
      );
    }
    return encoded.map((text) => ({ parts: [literal(text)] }));
  }

  // UTF-16 flavors; the chain validation guarantees a base64 transform follows.
  if ('bytes' in stage) return [stage];
  return [{ bytes: encodeUtf16(requirePlainText(stage.parts, transform, path), transform) }];
}

/** All alternative patterns one rule value stands for after the transforms (OR-ed together). */
function expandValue(text: string, transforms: readonly Transform[], path: string): PatternPart[][] {
  let stages: Stage[] = [{ parts: parseWildcards(text) }];
  for (const transform of transforms) {
    stages = stages.flatMap((stage) => applyTransform(stage, transform, path));
  }
  return stages.flatMap((stage) => ('parts' in stage ? [stage.parts] : []));
}

export interface CompiledValues {
  /** Event values are lower-cased before the tests run (case-insensitive string comparison). */
  readonly fold: boolean;
  /** Every test must pass (the `all` modifier), instead of any. */
  readonly all: boolean;
  /** Plain values that can be tested by hash lookup; only populated when `all` is false. */
  readonly exact: ReadonlySet<string>;
  /** One test per rule value (per alternative when not `all`). */
  readonly tests: readonly StringTest[];
  /** A value was a bare `*`: any present, non-null field satisfies it. */
  readonly matchesAnyPresent: boolean;
}

function anyOf(tests: readonly StringTest[]): StringTest {
  const [only] = tests;
  if (tests.length === 1 && only !== undefined) return only;
  return (subject) => {
    for (const test of tests) if (test(subject)) return true;
    return false;
  };
}

/** Numeric text such as `42`, `-1.5`, `1e3`; hex and `Infinity` are deliberately not numbers. */
const NUMERIC_TEXT = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*$/;

export function parseNumeric(text: string): number | undefined {
  if (!NUMERIC_TEXT.test(text)) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

const COMPARATORS: Readonly<Record<CompareOperator, (actual: number, expected: number) => boolean>> = {
  lt: (actual, expected) => actual < expected,
  lte: (actual, expected) => actual <= expected,
  gt: (actual, expected) => actual > expected,
  gte: (actual, expected) => actual >= expected,
};

function chargeBudget(budget: PatternBudget, count: number, path: string): void {
  budget.remaining -= count;
  if (budget.remaining < 0) {
    throw new RuleParseError(
      `This rule expands to more than ${MAX_COMPILED_PATTERNS} match patterns (modifiers such as windash and base64offset multiply every value). ` +
        'Remove some values or modifiers.',
      path,
    );
  }
}

/**
 * Compile the rule values of one field entry into string tests. Only for the
 * kinds that compare text (`string`, `regex`, `cidr`, `compare`); `exists`
 * and `fieldref` are handled by the caller because they do not test one value
 * in isolation.
 *
 * `keyword` is true for searches over the whole event, where a plain value
 * means "contains" rather than "equals".
 */
export function compileValues(
  chain: ModifierChain,
  values: readonly RuleValue[],
  path: string,
  budget: PatternBudget,
  keyword: boolean,
): CompiledValues {
  const exact = new Set<string>();
  const tests: StringTest[] = [];
  let matchesAnyPresent = false;
  let fold = false;

  for (const [index, value] of values.entries()) {
    const valuePath = values.length > 1 ? `${path}[${index}]` : path;
    const text = String(value);
    chargeBudget(budget, 1, valuePath);

    switch (chain.kind) {
      case 'regex': {
        if (text.length > MAX_REGEX_LENGTH) {
          throw new RuleParseError(
            `The regular expression is ${text.length} characters long; the limit is ${MAX_REGEX_LENGTH}. ` +
              'Split it into several shorter values (a list matches if any value matches).',
            valuePath,
          );
        }
        let regex: RegExp;
        try {
          regex = new RegExp(text, chain.regexFlags);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new RuleParseError(
            `Invalid regular expression: ${reason}. Stick to the portable subset that Sigma defines ` +
              '(. ^ $ * + ? {n,m} [a-z] [^a-z] | and groups); PCRE-only syntax such as inline flags (?i), atomic groups or possessive quantifiers is not available. ' +
              'Use `|re|i` for case-insensitive matching.',
            valuePath,
            { cause: error },
          );
        }
        tests.push((subject) => regex.test(subject));
        break;
      }
      case 'cidr': {
        const parsed = parseCidr(text);
        if (!parsed.ok) {
          throw new RuleParseError(`Invalid CIDR range: ${parsed.reason}.`, valuePath);
        }
        const { range } = parsed;
        tests.push((subject) => range.contains(subject));
        break;
      }
      case 'compare': {
        const expected = typeof value === 'number' ? value : typeof value === 'string' ? parseNumeric(value) : undefined;
        if (expected === undefined || !Number.isFinite(expected)) {
          throw new RuleParseError(
            `'|${chain.compare}' compares numbers, but the value ${JSON.stringify(value)} is not a number.`,
            valuePath,
          );
        }
        const compareFn = COMPARATORS[chain.compare ?? 'lt'];
        tests.push((subject) => {
          const actual = parseNumeric(subject);
          return actual !== undefined && compareFn(actual, expected);
        });
        break;
      }
      default: {
        fold = !chain.cased;
        const mode: MatchMode = chain.mode ?? (keyword ? 'contains' : 'equals');
        const shapes = expandValue(text, chain.transforms, valuePath).map((parts) => shapePattern(parts, mode, chain.cased));
        chargeBudget(budget, shapes.length - 1, valuePath);
        if (shapes.some(matchesEverything)) matchesAnyPresent = true;

        if (chain.all) {
          tests.push(anyOf(shapes.map(compileShaped)));
        } else {
          for (const shape of shapes) {
            const plain = exactLiteral(shape);
            if (plain !== undefined) exact.add(plain);
            else tests.push(compileShaped(shape));
          }
        }
      }
    }
  }

  return { fold, all: chain.all, exact, tests, matchesAnyPresent };
}
