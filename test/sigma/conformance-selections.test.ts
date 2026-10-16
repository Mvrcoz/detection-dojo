/**
 * Conformance: search-identifiers (selections).
 *
 * Source: Sigma specification section "Search-Identifiers" and "Keyword Search",
 * plus docs/ARCHITECTURE.md 3.2. A selection is a map (AND of its entries), a list
 * of maps (OR), or a list of plain values (a keyword search across the event).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compile,
  expectRuleParseError,
  fieldCases,
  matches,
  rule,
  ruleCases,
  ruleWith,
} from './helpers.ts';

// ---------------------------------------------------------------------------
// Map selections: every entry must match (logical AND)
// ---------------------------------------------------------------------------

const andMap = rule({ selection: { Image: 'cmd.exe', User: 'admin' } }, 'selection');

ruleCases([
  ['a map selection matches when every entry matches', andMap, { Image: 'cmd.exe', User: 'admin' }, true],
  ['a map selection fails when one entry does not match', andMap, { Image: 'cmd.exe', User: 'guest' }, false],
  ['a map selection fails when one of its fields is missing', andMap, { Image: 'cmd.exe' }, false],
  ['a map selection fails when the other field is missing', andMap, { User: 'admin' }, false],
  ['a map selection ignores extra event fields', andMap, { Image: 'cmd.exe', User: 'admin', Extra: 'x' }, true],
  ['a map selection never matches an empty event', andMap, {}, false],
  [
    'a single-entry map matches on that entry alone',
    rule({ selection: { Image: 'cmd.exe' } }, 'selection'),
    { Image: 'CMD.EXE' },
    true,
  ],
  [
    'selections are independent: a condition naming one ignores the others',
    rule({ first: { a: 1 }, second: { b: 1 } }, 'second'),
    { a: 1 },
    false,
  ],
]);

// ---------------------------------------------------------------------------
// Lists of values inside a map: OR within a field, AND across fields
// ---------------------------------------------------------------------------

const orWithinAndAcross = rule({ selection: { EventID: [4624, 4625], LogonType: [2, 10] } }, 'selection');

ruleCases([
  ['a value list matches when the first value matches', orWithinAndAcross, { EventID: 4624, LogonType: 2 }, true],
  ['a value list matches when a later value matches', orWithinAndAcross, { EventID: 4625, LogonType: 10 }, true],
  ['value lists on two fields are combined with AND', orWithinAndAcross, { EventID: 4624, LogonType: 3 }, false],
  ['a value list with no matching value fails the selection', orWithinAndAcross, { EventID: 4688, LogonType: 2 }, false],
  ['a value list on a missing field fails the selection', orWithinAndAcross, { EventID: 4624 }, false],
]);

// The first two examples of the "Search-Identifiers" section, verbatim.
const specMapWithList = ruleWith(`
  selection:
      EventLog: Security
      EventID:
          - 517
          - 1102
  condition: selection
`);

ruleCases([
  ['spec example: map with a list matches the first listed EventID', specMapWithList, { EventLog: 'Security', EventID: 517 }, true],
  ['spec example: map with a list matches the second listed EventID', specMapWithList, { EventLog: 'Security', EventID: 1102 }, true],
  ['spec example: map with a list rejects an unlisted EventID', specMapWithList, { EventLog: 'Security', EventID: 4624 }, false],
  ['spec example: map with a list rejects the wrong EventLog', specMapWithList, { EventLog: 'System', EventID: 517 }, false],
]);

// ---------------------------------------------------------------------------
// Lists of maps: any map may match (logical OR)
// ---------------------------------------------------------------------------

const mapList = rule(
  { selection: [{ Image: 'a.exe', User: 'x' }, { Image: 'b.exe' }] },
  'selection',
);

ruleCases([
  ['a list of maps matches when the first map matches completely', mapList, { Image: 'a.exe', User: 'x' }, true],
  ['a list of maps matches when only the last map matches', mapList, { Image: 'b.exe' }, true],
  ['each map in the list is itself an AND, so a partial match fails', mapList, { Image: 'a.exe', User: 'y' }, false],
  ['a list of maps matches when several maps match', mapList, { Image: 'b.exe', User: 'x' }, true],
  ['a list of maps fails when no map matches', mapList, { Image: 'c.exe', User: 'x' }, false],
]);

// The list-of-maps example from the spec ("each item is OR-ed"). The single-quoted
// YAML scalar '\\example.exe' holds two backslashes, which the escape rules read as
// one plain backslash.
const specMapList = ruleWith(String.raw`
  selection:
      - Image|endswith: '\\example.exe'
      - Description|contains: 'Test executable'
  condition: selection
`);

ruleCases([
  ['spec example: list of maps matches on the endswith entry', specMapList, { Image: String.raw`C:\tools\example.exe` }, true],
  ['spec example: list of maps matches on the contains entry', specMapList, { Description: 'My test executable v2' }, true],
  ['spec example: list of maps rejects an event matching neither entry', specMapList, { Image: String.raw`C:\tools\other.exe`, Description: 'x' }, false],
]);

// ---------------------------------------------------------------------------
// Keyword selections: a list of plain values searches the whole event
// ---------------------------------------------------------------------------

const keywords = rule({ keywords: ['mimikatz', 'sekurlsa::logonpasswords'] }, 'keywords');

ruleCases([
  ['a keyword matches whatever the field is called', keywords, { Anything: 'mimikatz' }, true],
  ['a keyword search is case-insensitive', keywords, { Anything: 'MiMiKaTz' }, true],
  // The spec says keyword strings "match against the full log message", i.e. a
  // keyword is found inside longer text, exactly as a SIEM free-text search would.
  ['a keyword is found inside a longer field value', keywords, { CommandLine: 'cmd /c run mimikatz now' }, true],
  ['any one of the listed keywords is enough', keywords, { CommandLine: 'privilege::debug sekurlsa::logonpasswords' }, true],
  ['a keyword search looks at every field, not only the first', keywords, { A: 'nothing', B: 'still nothing', C: 'mimikatz' }, true],
  ['a keyword search fails when no keyword occurs', keywords, { CommandLine: 'notepad.exe readme.txt' }, false],
  ['a keyword search never matches an empty event', keywords, {}, false],
  ['a keyword search descends into nested objects', keywords, { Process: { Details: { Cmd: 'x mimikatz' } } }, true],
  ['a keyword search looks inside arrays', keywords, { Args: ['one', 'two mimikatz'] }, true],
  ['a keyword search looks inside objects inside arrays', keywords, { Items: [{ Name: 'ok' }, { Name: 'mimikatz' }] }, true],
  ['a keyword search does not look at field names', keywords, { mimikatz: 'benign value' }, false],
  ['a keyword search ignores null values', keywords, { Field: null }, false],
  ['a keyword search never matches the text of an object', rule({ kw: ['object'] }, 'kw'), { Field: { a: 1 } }, false],
  ['a single plain value is a one-keyword search', rule({ kw: 'mimikatz' }, 'kw'), { Msg: 'found mimikatz' }, true],
  ['a keyword may contain wildcards', rule({ kw: ['rm *bash_history'] }, 'kw'), { Cmd: 'sudo rm -rf ~/.bash_history' }, true],
  ['a keyword with a wildcard still requires its literal parts', rule({ kw: ['rm *bash_history'] }, 'kw'), { Cmd: 'rm -rf ~/.zsh_history' }, false],
  ['a numeric keyword is searched as its text', rule({ kw: [4624] }, 'kw'), { Message: 'An account was logged on (event 4624)' }, true],
  ['a numeric keyword does not match unrelated text', rule({ kw: [4624] }, 'kw'), { Message: 'event 4625' }, false],
]);

// The `|all` keyword form from the spec: every keyword must occur somewhere in the event.
const allKeywords = rule({ kw: { '|all': ['OabVirtualDirectory', ' -ExternalUrl '] } }, 'kw');

ruleCases([
  ['|all keywords match when every keyword is present', allKeywords, { Cmd: 'Set-OabVirtualDirectory -ExternalUrl http://x' }, true],
  ['|all keywords fail when one keyword is missing', allKeywords, { Cmd: 'Set-OabVirtualDirectory' }, false],
  ['|all keywords may be spread over different fields of the event', allKeywords, { A: 'OabVirtualDirectory', B: 'x -ExternalUrl y' }, true],
]);

// Keyword selections combine with other selections through the condition.
ruleCases([
  [
    'a map selection and a keyword selection can both be required',
    rule({ selection: { Image: 'a.exe' }, kw: ['evil'] }, 'selection and kw'),
    { Image: 'a.exe', Msg: 'very evil' },
    true,
  ],
  [
    'requiring both a map and a keyword fails when the keyword is absent',
    rule({ selection: { Image: 'a.exe' }, kw: ['evil'] }, 'selection and kw'),
    { Image: 'a.exe', Msg: 'fine' },
    false,
  ],
  [
    'a keyword selection can be negated as a filter',
    rule({ kw: ['evil'], filter: ['trusted'] }, 'kw and not filter'),
    { Msg: 'evil but trusted' },
    false,
  ],
]);

// ---------------------------------------------------------------------------
// Empty or malformed selections are rejected when the rule is compiled
// ---------------------------------------------------------------------------

const emptyForms: ReadonlyArray<readonly [string, unknown]> = [
  ['an empty map', {}],
  ['an empty list', []],
  ['a null value', null],
  ['a list holding only an empty map', [{}]],
  ['a list that contains an empty map next to a real one', [{}, { a: 1 }]],
];

for (const [label, value] of emptyForms) {
  test(`${label} as a selection is a RuleParseError naming the selection`, () => {
    expectRuleParseError(() => compile(rule({ selection: { a: 1 }, filter: value }, 'selection')), {
      path: /filter/,
      message: /filter/,
    });
  });
}

test('an empty selection is rejected even when it is the only selection', () => {
  expectRuleParseError(() => compile(rule({ selection: {} }, 'selection')), { path: /selection/ });
});

test('a field value that is itself a map is a RuleParseError', () => {
  expectRuleParseError(() => compile(rule({ selection: { Field: { nested: 'x' } } }, 'selection')), {
    path: /selection/,
  });
});

// ---------------------------------------------------------------------------
// Null and empty-string values
// ---------------------------------------------------------------------------

fieldCases('Field', [
  ['null matches a field that is absent', null, {}, true],
  ['null matches a field that is explicitly null', null, { Field: null }, true],
  ['null does not match a present string', null, { Field: 'x' }, false],
  ['null does not match an empty string', null, { Field: '' }, false],
  ['null does not match the number zero', null, { Field: 0 }, false],
  ['null does not match false', null, { Field: false }, false],
  ['null does not match the text "null"', null, { Field: 'null' }, false],
  ['an empty string matches an empty string', '', { Field: '' }, true],
  ['an empty string does not match a non-empty string', '', { Field: 'x' }, false],
  ['an empty string does not match an absent field', '', {}, false],
]);

test('a YAML key with no value is null and matches an absent field', () => {
  const blankValue = ruleWith(`
    selection:
        Field:
    condition: selection
  `);
  assert.equal(matches(blankValue, {}), true);
  assert.equal(matches(blankValue, { Field: 'x' }), false);
});

// The spec's own null/empty-string example: "selection_main and 1 of selection_empty*".
const specNullExample = ruleWith(`
  selection_main:
      FieldA: 'something'
  selection_empty1:
      FieldB: ''
  selection_empty2:
      FieldB: null
  condition: selection_main and 1 of selection_empty*
`);

ruleCases([
  ['spec example: an absent FieldB satisfies the null selection', specNullExample, { FieldA: 'something' }, true],
  ['spec example: an empty FieldB satisfies the empty-string selection', specNullExample, { FieldA: 'something', FieldB: '' }, true],
  ['spec example: a filled FieldB satisfies neither selection', specNullExample, { FieldA: 'something', FieldB: 'x' }, false],
  ['spec example: the main selection is still required', specNullExample, { FieldA: 'other' }, false],
]);

// ---------------------------------------------------------------------------
// YAML quoting does not change the value the evaluator sees
// ---------------------------------------------------------------------------

const quotingStyles: ReadonlyArray<readonly [string, string]> = [
  ['an unquoted scalar', 'Field: abc'],
  ['a single-quoted scalar', "Field: 'abc'"],
  ['a double-quoted scalar', 'Field: "abc"'],
];

for (const [label, line] of quotingStyles) {
  const text = ruleWith(`
    selection:
        ${line}
    condition: selection
  `);
  test(`${label} compares equal to the same string in the event`, () => {
    assert.equal(matches(text, { Field: 'abc' }), true);
    assert.equal(matches(text, { Field: 'abd' }), false);
  });
}

test('a block list of values is read as alternatives', () => {
  const text = ruleWith(`
    selection:
        Field:
            - one
            - two
    condition: selection
  `);
  assert.equal(matches(text, { Field: 'two' }), true);
  assert.equal(matches(text, { Field: 'three' }), false);
});

test('a flow list of values is read as alternatives', () => {
  const text = ruleWith(`
    selection:
        Field: [one, two]
    condition: selection
  `);
  assert.equal(matches(text, { Field: 'one' }), true);
  assert.equal(matches(text, { Field: 'three' }), false);
});
