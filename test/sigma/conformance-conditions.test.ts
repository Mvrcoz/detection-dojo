/**
 * Conformance: the `condition` expression.
 *
 * Source: Sigma specification section "Condition Syntax" and the conditions page.
 * Operator precedence, lowest to highest: `or`, `and`, `not`, `x of pattern`,
 * parentheses. `1 of` / `any of` / `all of` take a selection-name pattern with `*`
 * wildcards or `them`. A condition may be a list, whose entries are OR-ed.
 * Aggregations, `near` and `timeframe` are deliberately unsupported
 * (docs/ARCHITECTURE.md 3.6) and must fail loudly.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compile,
  expectRuleParseError,
  expectUnsupported,
  rule,
  ruleCases,
  ruleWith,
  type SigmaEvent,
} from './helpers.ts';

// ---------------------------------------------------------------------------
// Boolean logic and precedence, checked against every truth assignment
// ---------------------------------------------------------------------------

function truthRule(condition: string | readonly string[]): string {
  return rule({ alpha: { x: 1 }, beta: { y: 1 }, gamma: { z: 1 } }, condition);
}

function truthEvent(alpha: boolean, beta: boolean, gamma: boolean): SigmaEvent {
  return { x: alpha ? 1 : 0, y: beta ? 1 : 0, z: gamma ? 1 : 0 };
}

type Logic = (a: boolean, b: boolean, c: boolean) => boolean;

/** [condition, the same expression written with JavaScript operators and the spec's precedence] */
const logicRows: ReadonlyArray<readonly [string, Logic]> = [
  ['alpha', (a) => a],
  ['not alpha', (a) => !a],
  ['not not alpha', (a) => a],
  ['not not not alpha', (a) => !a],
  ['alpha and beta', (a, b) => a && b],
  ['alpha or beta', (a, b) => a || b],
  ['alpha and beta and gamma', (a, b, c) => a && b && c],
  ['alpha or beta or gamma', (a, b, c) => a || b || c],
  ['alpha or beta and gamma', (a, b, c) => a || (b && c)],
  ['alpha and beta or gamma', (a, b, c) => (a && b) || c],
  ['alpha and beta or alpha and gamma', (a, b, c) => (a && b) || (a && c)],
  ['not alpha and beta', (a, b) => !a && b],
  ['not alpha or beta', (a, b) => !a || b],
  ['alpha and not beta', (a, b) => a && !b],
  ['alpha or not beta and gamma', (a, b, c) => a || (!b && c)],
  ['not alpha and not beta and not gamma', (a, b, c) => !a && !b && !c],
  ['alpha or not alpha', () => true],
  ['alpha and not alpha', () => false],
  ['(alpha)', (a) => a],
  ['((alpha))', (a) => a],
  ['((((((alpha))))))', (a) => a],
  ['(alpha or beta) and gamma', (a, b, c) => (a || b) && c],
  ['alpha and (beta or gamma)', (a, b, c) => a && (b || c)],
  ['(alpha and beta) or gamma', (a, b, c) => (a && b) || c],
  ['alpha or (beta and gamma)', (a, b, c) => a || (b && c)],
  ['not (alpha or beta)', (a, b) => !(a || b)],
  ['not (alpha and beta)', (a, b) => !(a && b)],
  ['not (alpha or beta) and gamma', (a, b, c) => !(a || b) && c],
  ['(alpha or beta) and not gamma', (a, b, c) => (a || b) && !c],
  ['alpha and (beta or (gamma and not alpha))', (a, b, c) => a && (b || (c && !a))],
  ['not (not alpha or not beta)', (a, b) => !(!a || !b)],
  // Keywords are case-insensitive (docs/ARCHITECTURE.md 3.4).
  ['alpha AND beta', (a, b) => a && b],
  ['alpha Or beta', (a, b) => a || b],
  ['NOT alpha', (a) => !a],
  ['alpha AND NOT beta', (a, b) => a && !b],
  ['alpha OR beta AND gamma', (a, b, c) => a || (b && c)],
  // Whitespace of any kind between tokens.
  ['  alpha    and   beta  ', (a, b) => a && b],
  ['alpha\n  and\n  beta', (a, b) => a && b],
  ['alpha\tor\tbeta', (a, b) => a || b],
  ['( alpha or beta )', (a, b) => a || b],
];

for (const [condition, logic] of logicRows) {
  test(`condition ${JSON.stringify(condition)} follows boolean logic for every combination of selections`, () => {
    const compiled = compile(truthRule(condition));
    for (const alpha of [false, true]) {
      for (const beta of [false, true]) {
        for (const gamma of [false, true]) {
          assert.equal(
            compiled.match(truthEvent(alpha, beta, gamma)).matched,
            logic(alpha, beta, gamma),
            `alpha=${alpha} beta=${beta} gamma=${gamma}`,
          );
        }
      }
    }
  });
}

test('a negated selection matches an event where the selection field is absent', () => {
  assert.equal(compile(truthRule('not alpha')).match({}).matched, true);
});

test('an empty event matches no plain selection', () => {
  assert.equal(compile(truthRule('alpha or beta or gamma')).match({}).matched, false);
});

// ---------------------------------------------------------------------------
// "x of pattern" and "them"
// ---------------------------------------------------------------------------

function ofRule(condition: string): string {
  return rule(
    {
      selection_1: { a: 1 },
      selection_2: { b: 1 },
      selection_3: { c: 1 },
      filter_1: { d: 1 },
      filter_2: { e: 1 },
    },
    condition,
  );
}

function firing(letters: string): SigmaEvent {
  return Object.fromEntries([...letters].map((letter) => [letter, 1]));
}

/** [condition, letters of the selections that fire (a, b, c = selection_1..3; d, e = filter_1..2), expected] */
const ofRows: ReadonlyArray<readonly [string, string, boolean]> = [
  ['1 of selection_*', 'a', true],
  ['1 of selection_*', 'c', true],
  ['1 of selection_*', 'abc', true],
  ['1 of selection_*', 'd', false],
  ['1 of selection_*', '', false],
  ['any of selection_*', 'b', true],
  ['any of selection_*', 'e', false],
  ['all of selection_*', 'abc', true],
  ['all of selection_*', 'abcd', true],
  ['all of selection_*', 'ab', false],
  ['all of selection_*', '', false],
  ['1 of them', 'e', true],
  ['1 of them', '', false],
  ['any of them', 'd', true],
  ['any of them', '', false],
  ['all of them', 'abcde', true],
  ['all of them', 'abcd', false],
  ['1 of filter_*', 'd', true],
  ['1 of filter_*', 'e', true],
  ['1 of filter_*', 'a', false],
  ['all of filter_*', 'de', true],
  ['all of filter_*', 'd', false],
  ['1 of selection_* and not 1 of filter_*', 'a', true],
  ['1 of selection_* and not 1 of filter_*', 'ad', false],
  ['1 of selection_* and not 1 of filter_*', 'd', false],
  ['1 of selection_* and not 1 of filter_*', '', false],
  ['all of selection_* and not any of filter_*', 'abc', true],
  ['all of selection_* and not any of filter_*', 'abce', false],
  ['all of selection_* and not any of filter_*', 'ab', false],
  ['not 1 of filter_* and 1 of selection_*', 'a', true],
  ['not 1 of filter_* and 1 of selection_*', 'ad', false],
  ['not 1 of filter_* and 1 of selection_*', 'd', false],
  ['1 of selection_* or 1 of filter_*', 'd', true],
  ['1 of selection_* or 1 of filter_*', 'a', true],
  ['1 of selection_* or 1 of filter_*', '', false],
  ['(1 of selection_*) and (1 of filter_*)', 'ad', true],
  ['(1 of selection_*) and (1 of filter_*)', 'a', false],
  ['selection_1 and 1 of filter_*', 'ae', true],
  ['selection_1 and 1 of filter_*', 'be', false],
  ['all of selection_* or all of filter_*', 'de', true],
  ['all of selection_* or all of filter_*', 'abc', true],
  ['all of selection_* or all of filter_*', 'ad', false],
  // Wildcards may appear anywhere in the pattern (spec: "at arbitrary positions").
  ['1 of *_1', 'a', true],
  ['1 of *_1', 'd', true],
  ['1 of *_1', 'b', false],
  ['1 of *_1', 'e', false],
  ['all of *_1', 'ad', true],
  ['all of *_1', 'a', false],
  ['1 of sel*_2', 'b', true],
  ['1 of sel*_2', 'a', false],
  ['1 of *_*', 'e', true],
  ['1 of *_*', '', false],
  ['1 of *filter*', 'e', true],
  ['1 of *filter*', 'a', false],
  // Keywords are case-insensitive.
  ['1 OF selection_*', 'a', true],
  ['ALL OF THEM', 'abcde', true],
  ['ALL OF THEM', 'abcd', false],
  ['Any Of Them', 'e', true],
  ['ALL OF selection_*', 'abc', true],
  ['NOT 1 OF filter_*', 'd', false],
  ['NOT 1 OF filter_*', '', true],
  ['1 of selection_* AND NOT 1 of filter_*', 'a', true],
];

for (const [condition, letters, expected] of ofRows) {
  test(`${JSON.stringify(condition)} is ${expected} when ${letters === '' ? 'nothing fires' : `only [${letters}] fire`}`, () => {
    assert.equal(compile(ofRule(condition)).match(firing(letters)).matched, expected);
  });
}

// ---------------------------------------------------------------------------
// Selection names that merely contain or start with a keyword are ordinary names
// ---------------------------------------------------------------------------

function keywordLikeNames(condition: string): string {
  return rule(
    {
      android: { a: 1 },
      order: { b: 1 },
      notepad: { c: 1 },
      them_a: { d: 1 },
      them_b: { e: 1 },
      of_interest: { f: 1 },
    },
    condition,
  );
}

ruleCases([
  ['names starting with "and" are names, not operators', keywordLikeNames('android'), { a: 1 }, true],
  ['names containing "or" are names, not operators', keywordLikeNames('order'), { b: 1 }, true],
  ['names starting with "not" are names, not negations', keywordLikeNames('notepad'), { c: 1 }, true],
  ['names starting with "not" can still be negated', keywordLikeNames('not notepad'), { c: 1 }, false],
  ['names combine with real operators', keywordLikeNames('android and notepad or order'), { b: 1 }, true],
  ['names combine with real operators (and-branch)', keywordLikeNames('android and notepad or order'), { a: 1, c: 1 }, true],
  ['names combine with real operators (no branch)', keywordLikeNames('android and notepad or order'), { a: 1 }, false],
  ['a pattern starting with "them" is a pattern, not the word them', keywordLikeNames('1 of them_*'), { d: 1 }, true],
  ['a pattern starting with "them" only covers matching names', keywordLikeNames('1 of them_*'), { a: 1 }, false],
  ['a name starting with "of" is a name', keywordLikeNames('of_interest'), { f: 1 }, true],
]);

// ---------------------------------------------------------------------------
// `them` and names that start with an underscore
// ---------------------------------------------------------------------------

// SPEC-DISAGREEMENT: docs/ARCHITECTURE.md 3.4 says `them` is "all selections". The Sigma
// specification (Condition Syntax) says `1 of them` / `all of them` apply across all
// search-identifiers "not starting with `_`" ("detections starting with underscores are
// excluded by convention"). These rows follow the specification.
const underscoreRule = rule({ selection: { a: 1 }, _helper: { b: 1 } }, 'all of them');

ruleCases([
  ['all of them ignores selections whose name starts with an underscore (spec)', underscoreRule, { a: 1 }, true],
  ['1 of them ignores selections whose name starts with an underscore (spec)', rule({ selection: { a: 1 }, _helper: { b: 1 } }, '1 of them'), { b: 1 }, false],
  ['a selection with a leading underscore can still be named explicitly', rule({ selection: { a: 1 }, _helper: { b: 1 } }, 'selection and _helper'), { a: 1, b: 1 }, true],
  ['an explicitly named underscore selection is still required', rule({ selection: { a: 1 }, _helper: { b: 1 } }, 'selection and _helper'), { a: 1 }, false],
]);

// ---------------------------------------------------------------------------
// Conditions given as a list: every entry is its own condition, OR-ed together
// ---------------------------------------------------------------------------

const conditionList = truthRule(['alpha', 'beta and gamma']);

ruleCases([
  ['a condition list matches when the first entry matches', conditionList, { x: 1, y: 0, z: 0 }, true],
  ['a condition list matches when the second entry matches', conditionList, { x: 0, y: 1, z: 1 }, true],
  ['a condition list fails when only part of the second entry matches', conditionList, { x: 0, y: 1, z: 0 }, false],
  ['a condition list fails when no entry matches', conditionList, { x: 0, y: 0, z: 1 }, false],
  ['a condition list fails on an empty event', conditionList, {}, false],
  ['a condition list with one entry behaves like a plain condition', truthRule(['alpha and beta']), { x: 1, y: 1, z: 0 }, true],
]);

test('a condition list is validated entry by entry: an undefined selection in a later entry is reported', () => {
  const error = expectRuleParseError(() => compile(truthRule(['alpha', 'beta and ghost'])), { path: /condition/ });
  assert.match(error.message, /ghost/);
});

test('an empty condition list is a RuleParseError', () => {
  expectRuleParseError(() => compile(truthRule([])), { path: /condition/ });
});

test('a condition list with an empty entry is a RuleParseError', () => {
  expectRuleParseError(() => compile(truthRule(['alpha', ''])), { path: /condition/ });
});

test('a condition list with a non-string entry is a RuleParseError', () => {
  expectRuleParseError(
    () =>
      compile(
        ruleWith(`
          alpha:
              x: 1
          condition:
              - alpha
              - 5
        `),
      ),
    { path: /condition/ },
  );
});

// ---------------------------------------------------------------------------
// Missing or malformed condition
// ---------------------------------------------------------------------------

test('a detection without a condition is a RuleParseError at detection.condition', () => {
  expectRuleParseError(() => compile(ruleWith('selection:\n    a: 1')), { path: /condition/ });
});

test('a blank condition (YAML null) is a RuleParseError', () => {
  expectRuleParseError(() => compile(ruleWith('selection:\n    a: 1\ncondition:')), { path: /condition/ });
});

test('a numeric condition is a RuleParseError', () => {
  expectRuleParseError(() => compile(ruleWith('selection:\n    a: 1\ncondition: 5')), { path: /condition/ });
});

test('a condition that is a map is a RuleParseError', () => {
  expectRuleParseError(() => compile(ruleWith('selection:\n    a: 1\ncondition:\n    selection: true')), {
    path: /condition/,
  });
});

// ---------------------------------------------------------------------------
// References to selections that do not exist
// ---------------------------------------------------------------------------

test('an undefined selection is a RuleParseError that names it and lists the defined ones', () => {
  const error = expectRuleParseError(
    () => compile(rule({ main_sel: { a: 1 }, other_sel: { b: 1 } }, 'main_sel and missing_one')),
    { path: /condition/ },
  );
  assert.match(error.message, /missing_one/);
  assert.match(error.message, /main_sel/);
  assert.match(error.message, /other_sel/);
});

test('an undefined selection on the negated side is also reported', () => {
  const error = expectRuleParseError(() => compile(rule({ selection: { a: 1 } }, 'selection and not filtr')), {
    path: /condition/,
  });
  assert.match(error.message, /filtr/);
});

test('selection names are case-sensitive: a different case is an undefined selection', () => {
  const error = expectRuleParseError(() => compile(rule({ Selection: { a: 1 } }, 'selection')), {
    path: /condition/,
  });
  assert.match(error.message, /selection/);
});

for (const inheritedName of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
  test(`"${inheritedName}" is an undefined selection, not an inherited object property`, () => {
    const error = expectRuleParseError(() => compile(rule({ selection: { a: 1 } }, inheritedName)), {
      path: /condition/,
    });
    assert.ok(error.message.includes(inheritedName), error.message);
  });
}

test('a pattern that matches no selection is a RuleParseError that quotes the pattern', () => {
  const error = expectRuleParseError(() => compile(rule({ selection: { a: 1 } }, '1 of nothing_*')), {
    path: /condition/,
  });
  assert.match(error.message, /nothing_\*/);
});

test('"all of" with a pattern that matches no selection is a RuleParseError', () => {
  expectRuleParseError(() => compile(rule({ selection: { a: 1 } }, 'all of zzz*')), { path: /condition/ });
});

test('"1 of them" in a detection that defines no selection is a RuleParseError', () => {
  expectRuleParseError(() => compile(ruleWith('condition: 1 of them')), { path: /condition|detection/ });
});

test('a condition naming a selection in a detection that defines none is a RuleParseError', () => {
  const error = expectRuleParseError(() => compile(ruleWith('condition: selection')), { path: /condition/ });
  assert.match(error.message, /selection/);
});

// ---------------------------------------------------------------------------
// Syntax errors
// ---------------------------------------------------------------------------

const malformedConditions: ReadonlyArray<readonly [string, string]> = [
  ['a dangling and', 'selection and'],
  ['a leading and', 'and selection'],
  ['a dangling or', 'selection or'],
  ['a doubled or', 'selection or or selection'],
  ['a doubled and', 'selection and and selection'],
  ['a bare not', 'not'],
  ['an unclosed parenthesis', '( selection'],
  ['an unopened parenthesis', 'selection )'],
  ['empty parentheses', '()'],
  ['two selections without an operator', 'selection selection'],
  ['"1 of" without a pattern', '1 of'],
  ['"of them" without a quantifier', 'of them'],
  ['a quantifier without "of"', '1 them'],
  ['an empty condition', ''],
  ['a blank condition', '   '],
];

for (const [label, condition] of malformedConditions) {
  test(`${label} is a RuleParseError at the condition`, () => {
    expectRuleParseError(() => compile(rule({ selection: { a: 1 } }, condition)), { path: /condition/ });
  });
}

// ---------------------------------------------------------------------------
// Deliberately unsupported: aggregation, near, timeframe
// ---------------------------------------------------------------------------

const aggregations: ReadonlyArray<readonly [string, string]> = [
  ['count() with a threshold', 'selection | count() > 5'],
  ['count() with a field and a group', 'selection | count(User) by Host > 3'],
  ['count() grouped by a field', 'selection | count() by User >= 10'],
  ['count() without spaces around the pipe', 'selection|count() > 2'],
  ['min()', 'selection | min(Port) > 10'],
  ['max()', 'selection | max(Port) < 10'],
  ['avg()', 'selection | avg(Port) > 1'],
  ['sum()', 'selection | sum(Port) > 100'],
];

for (const [label, condition] of aggregations) {
  test(`aggregation: ${label} is an UnsupportedFeatureError that names the feature`, () => {
    expectUnsupported(() => compile(rule({ selection: { a: 1 } }, condition)), { feature: /aggregat|count|min|max|avg|sum/i });
  });
}

test('the legacy near operator is an UnsupportedFeatureError that names the feature', () => {
  expectUnsupported(() => compile(rule({ selection: { a: 1 }, other: { b: 1 } }, 'selection | near other')), {
    feature: /near|aggregat/i,
  });
});

test('a condition list is rejected when any entry uses an aggregation', () => {
  expectUnsupported(() => compile(rule({ selection: { a: 1 } }, ['selection', 'selection | count() > 5'])), {
    feature: /aggregat|count/i,
  });
});

test('timeframe is an UnsupportedFeatureError even when the condition is fine', () => {
  expectUnsupported(
    () =>
      compile(
        ruleWith(`
          selection:
              a: 1
          timeframe: 15m
          condition: selection
        `),
      ),
    { feature: /timeframe/i },
  );
});

test('timeframe is not treated as a selection name by a wildcard pattern', () => {
  // The detection holds a timeframe key; the failure must be about timeframe, never
  // about a malformed "selection" called timeframe.
  expectUnsupported(
    () =>
      compile(
        ruleWith(`
          selection_a:
              a: 1
          timeframe: 5m
          condition: 1 of selection_*
        `),
      ),
    { feature: /timeframe/i },
  );
});
