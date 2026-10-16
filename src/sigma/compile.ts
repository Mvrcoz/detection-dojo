/**
 * Compiling a parsed rule into a matcher.
 *
 * Everything that can be decided from the rule alone is decided here, once:
 * modifier chains are validated, values are encoded and expanded, regexes are
 * built, the condition is parsed and its selection references are resolved.
 * `match()` then only walks closures over one event.
 */
import { RuleParseError, UnsupportedFeatureError } from '../errors.ts';
import { collectReferences, compileCondition, parseCondition, readConditions, type ConditionNode } from './condition.ts';
import { compileKeywords, compileMapEntry, isRuleValue, type CompiledEntry, type Matcher } from './items.ts';
import { createContext, isRecord, type EventContext } from './lookup.ts';
import { MAX_COMPILED_PATTERNS, type PatternBudget } from './modifiers.ts';
import type { CompiledRule, MatchResult, SigmaEvent, SigmaRule } from './types.ts';

/** Keys of `detection` that are not selections. */
const NON_SELECTION_KEYS = new Set(['condition', 'timeframe']);

function allOf(matchers: readonly Matcher[]): Matcher {
  const [only] = matchers;
  if (matchers.length === 1 && only !== undefined) return only;
  return (ctx) => {
    for (const matcher of matchers) if (!matcher(ctx)) return false;
    return true;
  };
}

function anyOf(matchers: readonly Matcher[]): Matcher {
  const [only] = matchers;
  if (matchers.length === 1 && only !== undefined) return only;
  return (ctx) => {
    for (const matcher of matchers) if (matcher(ctx)) return true;
    return false;
  };
}

/** A map of `field|modifiers: value` entries: every entry must match. */
function compileMap(map: Record<string, unknown>, path: string, budget: PatternBudget): CompiledEntry {
  const entries = Object.entries(map);
  if (entries.length === 0) {
    const name = /^detection\.([^.[]+)/.exec(path)?.[1] ?? path;
    throw new RuleParseError(
      `Selection '${name}' contains an empty map. Give it at least one field to match, for example \`Image|endswith: '\\cmd.exe'\`.`,
      path,
    );
  }
  const compiled = entries.map(([key, value]) => compileMapEntry(key, value, `${path}.${key}`, budget));
  return { match: allOf(compiled.map((entry) => entry.match)), fields: compiled.flatMap((entry) => entry.fields) };
}

/** Compile one named selection: a map, a list of maps, or a keyword list. */
function compileSelection(name: string, raw: unknown, budget: PatternBudget): CompiledEntry {
  const path = `detection.${name}`;

  if (raw === null || raw === undefined) {
    throw new RuleParseError(
      `Selection '${name}' is empty. Give it fields to match (\`${name}:\` followed by indented \`Field: value\` lines) or a list of keywords.`,
      path,
    );
  }

  if (isRuleValue(raw)) return compileKeywords([raw], path, budget);

  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      throw new RuleParseError(`Selection '${name}' is an empty list. Add at least one value or one map of fields.`, path);
    }
    if (raw.every(isRecord)) {
      const compiled = raw.map((map, index) => compileMap(map, `${path}[${index}]`, budget));
      return { match: anyOf(compiled.map((entry) => entry.match)), fields: compiled.flatMap((entry) => entry.fields) };
    }
    if (raw.every(isRuleValue)) return compileKeywords(raw, path, budget);

    const nullIndex = raw.indexOf(null);
    throw new RuleParseError(
      nullIndex !== -1
        ? `Selection '${name}' has an empty (null) list item at position ${nullIndex + 1}. Remove it, or check the indentation of the line.`
        : `Selection '${name}' mixes maps of fields with plain keyword values (or nested lists) in one list. Use either a list of maps or a list of keywords.`,
      path,
    );
  }

  if (isRecord(raw)) return compileMap(raw, path, budget);

  throw new RuleParseError(`Selection '${name}' must be a map of fields, a list of maps, or a list of keywords.`, path);
}

function setOwn(target: Record<string, boolean>, key: string, value: boolean): void {
  // Plain assignment of "__proto__" would silently change the prototype instead of adding a key.
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Compile a parsed rule into a matcher. Throws RuleParseError / UnsupportedFeatureError. */
export function compileRule(rule: SigmaRule): CompiledRule {
  const detection: unknown = rule?.detection;
  if (!isRecord(detection)) {
    throw new RuleParseError(
      'The rule has no `detection` section (a map with your selections and a `condition`).',
      'detection',
    );
  }

  if (Object.hasOwn(detection, 'timeframe')) {
    throw new UnsupportedFeatureError(
      'timeframe',
      '`timeframe` only matters for aggregations, which need a SIEM that counts events over time and are not supported here. ' +
        'Remove it, and note the intended time window in `description` or `falsepositives`.',
    );
  }

  const selectionNames = Object.keys(detection).filter((key) => !NON_SELECTION_KEYS.has(key));
  const budget: PatternBudget = { remaining: MAX_COMPILED_PATTERNS };
  const selections = selectionNames.map((name) => compileSelection(name, detection[name], budget));

  // A list of conditions is an OR of the entries (specification, "Condition").
  const conditions = readConditions(detection).map(({ source, path }) => parseCondition(source, selectionNames, path));
  const referenced = new Set<number>();
  for (const condition of conditions) collectReferences(condition, referenced);
  const [onlyCondition] = conditions;
  const root: ConditionNode =
    conditions.length === 1 && onlyCondition !== undefined ? onlyCondition : { type: 'or', operands: conditions };
  const evaluate = compileCondition(root);

  const warnings = selectionNames.flatMap((name, index) =>
    referenced.has(index)
      ? []
      : [`unreferenced-selection: Selection '${name}' is defined but the condition never uses it, so it has no effect.`],
  );
  const usedFields = [...new Set(selections.flatMap((selection) => selection.fields))].sort();
  const matchers = selections.map((selection) => selection.match);

  return {
    rule,
    selectionNames,
    usedFields,
    warnings,
    match(event: SigmaEvent): MatchResult {
      const ctx: EventContext = createContext(event);
      const results = matchers.map((matcher) => matcher(ctx));
      const byName: Record<string, boolean> = {};
      selectionNames.forEach((name, index) => setOwn(byName, name, results[index] === true));
      return { matched: evaluate(results), selections: byName };
    },
  };
}
