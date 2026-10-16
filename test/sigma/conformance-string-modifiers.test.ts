/**
 * Conformance: the string match-type modifiers `contains`, `startswith`,
 * `endswith`, the list modifier `all`, and the case modifier `cased`.
 *
 * Source: Sigma modifiers appendix ("Generic modifiers") and docs/ARCHITECTURE.md
 * 3.3. These modifiers are shorthand for wildcards (`*value*`, `value*`, `*value`),
 * are case-insensitive unless `cased` is present, and take lists of values.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RuleParseError,
  UnsupportedFeatureError,
  compile,
  expectRejected,
  fieldCases,
  fieldRule,
  rule,
} from './helpers.ts';

// ---------------------------------------------------------------------------
// contains
// ---------------------------------------------------------------------------

fieldCases('CommandLine|contains', [
  ['contains matches the value in the middle', 'evil', { CommandLine: 'run evil now' }, true],
  ['contains matches the value at the start', 'run', { CommandLine: 'run evil now' }, true],
  ['contains matches the value at the end', 'now', { CommandLine: 'run evil now' }, true],
  ['contains matches when the value is the whole field', 'run evil now', { CommandLine: 'run evil now' }, true],
  ['contains fails when the value does not occur', 'good', { CommandLine: 'run evil now' }, false],
  ['contains is case-insensitive by default (upper rule value)', 'EVIL', { CommandLine: 'run evil now' }, true],
  ['contains is case-insensitive by default (upper event value)', 'evil', { CommandLine: 'RUN EVIL NOW' }, true],
  ['contains is not limited to whole words', 'cmd', { CommandLine: 'xcmdx' }, true],
  ['contains with a list matches when any value occurs', ['nope', 'evil'], { CommandLine: 'run evil now' }, true],
  ['contains with a list fails when no value occurs', ['nope', 'never'], { CommandLine: 'run evil now' }, false],
  ['contains fails when the field is missing', 'evil', {}, false],
  ['contains with an empty value matches any present string', '', { CommandLine: 'abc' }, true],
  ['contains with an empty value matches an empty string', '', { CommandLine: '' }, true],
  ['contains with an empty value does not match a missing field', '', {}, false],
  ['contains searches the text form of a number', 44, { CommandLine: 443 }, true],
  ['contains searches the text form of a boolean', 'ru', { CommandLine: true }, true],
  ['contains never matches the text "null" for a null field', 'null', { CommandLine: null }, false],
  ['contains never matches the text of an object value', 'object', { CommandLine: { a: 1 } }, false],
  ['contains never matches the joined text of an array', '1,2', { CommandLine: [1, 2] }, false],
  ['contains matches one element of an array', '2', { CommandLine: [1, 2] }, true],
  ['contains does not span two array elements', 'ab', { CommandLine: ['a', 'b'] }, false],
  ['contains treats the value as literal text, not a pattern', 'a.c', { CommandLine: 'xabcx' }, false],
]);

// ---------------------------------------------------------------------------
// all: change the OR between listed values into AND
// ---------------------------------------------------------------------------

fieldCases('CommandLine|contains|all', [
  [
    'all requires every listed value to occur',
    ['-enc', 'bypass'],
    { CommandLine: 'powershell -nop -enc AAAA -ep bypass' },
    true,
  ],
  ['all fails when one listed value is missing', ['-enc', 'bypass'], { CommandLine: 'powershell -enc AAAA' }, false],
  [
    'all does not depend on the order of the values in the event',
    ['bypass', '-enc'],
    { CommandLine: 'powershell -enc AAAA -ep bypass' },
    true,
  ],
  ['all accepts overlapping values', ['abc', 'bcd'], { CommandLine: 'xabcdx' }, true],
  ['all fails on a missing field', ['a', 'b'], {}, false],
  ['all is still case-insensitive', ['ABC', 'DEF'], { CommandLine: 'abc def' }, true],
  ['all with several values needs all of them, not most of them', ['a', 'b', 'c'], { CommandLine: 'a b' }, false],
]);

fieldCases('CommandLine|endswith|all', [
  ['all works with endswith when every suffix fits', ['.exe', 'exe'], { CommandLine: 'a.exe' }, true],
  ['all works with endswith and fails when one suffix does not fit', ['.exe', '.dll'], { CommandLine: 'a.exe' }, false],
]);

fieldCases('CommandLine|startswith|all', [
  ['all works with startswith when every prefix fits', ['ab', 'a'], { CommandLine: 'abc' }, true],
  ['all works with startswith and fails when one prefix does not fit', ['ab', 'b'], { CommandLine: 'abc' }, false],
]);

fieldCases('Tags|contains|all', [
  ['all against an array field lets different elements satisfy different values', ['ab', 'cd'], { Tags: ['xxab', 'cdyy'] }, true],
  ['all against an array field still needs every value to be found', ['ab', 'cd'], { Tags: ['xxab'] }, false],
]);

test('all on a single value is either rejected clearly or behaves like a plain contains', () => {
  // The spec says `all` cannot be used on single-item values but does not say how a
  // tool must react. Both a clear rejection and the harmless reading are acceptable;
  // a wrong answer or an unexplained crash is not.
  let compiled;
  try {
    compiled = compile(fieldRule('Image|contains|all', 'evil'));
  } catch (error) {
    assert.ok(
      error instanceof RuleParseError || error instanceof UnsupportedFeatureError,
      `expected a user-facing error, got ${String(error)}`,
    );
    return;
  }
  assert.equal(compiled.match({ Image: 'so evil' }).matched, true);
  assert.equal(compiled.match({ Image: 'fine' }).matched, false);
});

// ---------------------------------------------------------------------------
// startswith
// ---------------------------------------------------------------------------

fieldCases('Image|startswith', [
  ['startswith matches a prefix', 'C:\\Windows', { Image: 'C:\\Windows\\System32\\cmd.exe' }, true],
  ['startswith matches a prefix that ends with a backslash', 'C:\\Windows\\', { Image: 'C:\\Windows\\System32\\cmd.exe' }, true],
  ['startswith matches when the value is the whole field', 'abc', { Image: 'abc' }, true],
  ['startswith is case-insensitive by default', 'c:\\WINDOWS', { Image: 'C:\\Windows\\cmd.exe' }, true],
  ['startswith does not match a value that only occurs later', 'cmd', { Image: 'C:\\cmd.exe' }, false],
  ['startswith does not match a longer value', 'abcd', { Image: 'abc' }, false],
  ['startswith with a list matches when any prefix fits', ['zzz', 'C:\\Win'], { Image: 'C:\\Windows' }, true],
  ['startswith with a list fails when no prefix fits', ['zzz', 'yyy'], { Image: 'C:\\Windows' }, false],
  ['startswith fails when the field is missing', 'C:', {}, false],
  ['startswith with an empty value matches any present string', '', { Image: 'abc' }, true],
  ['startswith with an empty value does not match a missing field', '', {}, false],
  ['startswith treats the value as literal text, not a pattern', 'a.c', { Image: 'abcdef' }, false],
]);

fieldCases('Port|startswith', [
  ['startswith uses the text form of a number', 44, { Port: 443 }, true],
  ['startswith on a number fails when the digits do not lead', 43, { Port: 443 }, false],
]);

// ---------------------------------------------------------------------------
// endswith
// ---------------------------------------------------------------------------

fieldCases('Image|endswith', [
  ['endswith matches a suffix', '.exe', { Image: 'C:\\x\\cmd.exe' }, true],
  [
    'endswith matches a file name preceded by a backslash',
    String.raw`\cmd.exe`,
    { Image: String.raw`C:\Windows\System32\CMD.EXE` },
    true,
  ],
  [
    'endswith with a leading backslash rejects a longer file name',
    String.raw`\cmd.exe`,
    { Image: String.raw`C:\Windows\System32\xcmd.exe` },
    false,
  ],
  ['endswith is case-insensitive by default', '.EXE', { Image: 'cmd.exe' }, true],
  ['endswith does not match a value that only occurs earlier', 'cmd', { Image: 'cmd.exe' }, false],
  ['endswith with a list matches when any suffix fits', ['.dll', '.exe'], { Image: 'a.exe' }, true],
  ['endswith with a list fails when no suffix fits', ['.dll', '.sys'], { Image: 'a.exe' }, false],
  ['endswith fails when the field is missing', '.exe', {}, false],
  ['endswith with an empty value matches any present string', '', { Image: 'abc' }, true],
  ['endswith treats the value as literal text, not a pattern', 'a.c', { Image: 'xabc' }, false],
]);

fieldCases('Port|endswith', [
  ['endswith uses the text form of a number', 3, { Port: 443 }, true],
  ['endswith on a number fails when the digits do not trail', 4, { Port: 443 }, false],
]);

// ---------------------------------------------------------------------------
// cased: make matching case-sensitive
// ---------------------------------------------------------------------------

fieldCases('Image|cased', [
  ['cased equality matches identical case', 'Cmd.exe', { Image: 'Cmd.exe' }, true],
  ['cased equality rejects different case', 'Cmd.exe', { Image: 'cmd.exe' }, false],
  ['cased equality honors wildcards', 'A*B', { Image: 'AxxB' }, true],
  ['cased equality with a wildcard rejects different case', 'A*B', { Image: 'axxb' }, false],
  ['cased equality distinguishes accented capitals', '\u00c4', { Image: '\u00e4' }, false],
  ['cased equality accepts the exact accented capital', '\u00c4', { Image: '\u00c4' }, true],
]);

fieldCases('Image|cased|contains', [
  ['cased contains matches identical case', 'Evil', { Image: 'x Evil x' }, true],
  ['cased contains rejects different case', 'Evil', { Image: 'x evil x' }, false],
  ['cased contains with a list matches only the exact-case entry', ['A', 'B'], { Image: 'xBx' }, true],
  ['cased contains with a list rejects when only another case occurs', ['A', 'B'], { Image: 'xbx' }, false],
]);

fieldCases('Image|cased|contains|all', [
  ['cased with all needs every value in the exact case', ['Ab', 'Cd'], { Image: 'AbCd' }, true],
  ['cased with all fails when one value has the wrong case', ['Ab', 'Cd'], { Image: 'abCd' }, false],
]);

fieldCases('Image|cased|startswith', [
  ['cased startswith matches identical case', 'C:\\Win', { Image: 'C:\\Windows' }, true],
  ['cased startswith rejects different case', 'C:\\WIN', { Image: 'C:\\Windows' }, false],
]);

fieldCases('Image|cased|endswith', [
  ['cased endswith matches identical case', String.raw`\Cmd.exe`, { Image: String.raw`C:\Windows\Cmd.exe` }, true],
  ['cased endswith rejects different case', String.raw`\Cmd.exe`, { Image: String.raw`C:\Windows\cmd.exe` }, false],
]);

test('cased applies only to its own field, other fields stay case-insensitive', () => {
  const compiled = compile(rule({ selection: { 'Image|cased': 'Abc', User: 'Bob' } }, 'selection'));
  assert.equal(compiled.match({ Image: 'Abc', User: 'BOB' }).matched, true);
  assert.equal(compiled.match({ Image: 'abc', User: 'BOB' }).matched, false);
});

// ---------------------------------------------------------------------------
// Invalid combinations are rejected, naming the modifier
// ---------------------------------------------------------------------------

const conflictingMatchTypes: ReadonlyArray<readonly [string, RegExp]> = [
  ['Image|contains|startswith', /contains|startswith/],
  ['Image|startswith|endswith', /startswith|endswith/],
  ['Image|endswith|contains', /endswith|contains/],
  ['Image|contains|endswith', /contains|endswith/],
];

for (const [fieldKey, namedModifier] of conflictingMatchTypes) {
  test(`${fieldKey}: two match-type modifiers on one field are rejected`, () => {
    expectRejected(() => compile(fieldRule(fieldKey, 'x')), { message: namedModifier });
  });
}

const typoedModifiers: ReadonlyArray<readonly [string, RegExp]> = [
  ['Image|contain', /contain/],
  ['Image|startwith', /startwith/],
  ['Image|endwith', /endwith/],
  ['Image|frobnicate', /frobnicate/],
];

for (const [fieldKey, namedModifier] of typoedModifiers) {
  test(`${fieldKey}: an unknown modifier is rejected and named in the message`, () => {
    expectRejected(() => compile(fieldRule(fieldKey, 'x')), { message: namedModifier });
  });
}
