/**
 * Conformance: the `re` modifier and its sub-modifiers `i`, `m`, `s`.
 *
 * Source: Sigma modifiers appendix ("re": case-sensitive by default; `i`, `m`, `s`)
 * and docs/ARCHITECTURE.md 3.3 (JavaScript RegExp engine, unanchored search, invalid
 * regex is a compile-time RuleParseError, source limited to 2000 characters).
 * Regex values are NOT processed by the Sigma wildcard/escape rules: `*` is a
 * quantifier and `\\` is an escaped backslash.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compile,
  expectRejected,
  expectRuleParseError,
  fieldCases,
  fieldRule,
} from './helpers.ts';

// ---------------------------------------------------------------------------
// Default behavior: unanchored, case-sensitive search
// ---------------------------------------------------------------------------

fieldCases('CommandLine|re', [
  ['re is an unanchored search: it matches in the middle', 'evil', { CommandLine: 'run evil now' }, true],
  ['re does not have to cover the whole value', 'run', { CommandLine: 'run evil now' }, true],
  ['re with ^ matches at the start', '^run', { CommandLine: 'run evil now' }, true],
  ['re with ^ fails when the text is not at the start', '^evil', { CommandLine: 'run evil now' }, false],
  ['re with $ matches at the end', 'now$', { CommandLine: 'run evil now' }, true],
  ['re with $ fails when the text is not at the end', 'evil$', { CommandLine: 'run evil now' }, false],
  ['re anchored at both ends needs the whole value', '^run evil now$', { CommandLine: 'run evil now' }, true],
  ['re anchored at both ends rejects a longer value', '^run evil$', { CommandLine: 'run evil now' }, false],
  ['re is case-sensitive by default', 'EVIL', { CommandLine: 'run evil now' }, false],
  ['re matches when the case is exact', 'evil', { CommandLine: 'run evil now' }, true],
  ['re supports character classes', '^[a-z]+ [a-z]+ [a-z]+$', { CommandLine: 'run evil now' }, true],
  ['re supports digit escapes', String.raw`^\d+$`, { CommandLine: '12345' }, true],
  ['re digit escapes reject letters', String.raw`^\d+$`, { CommandLine: '12a45' }, false],
  ['re keeps \\S meaning "non-whitespace" (the pattern is not lower-cased)', String.raw`^\S+$`, { CommandLine: 'a b' }, false],
  ['re accepts a value without whitespace for \\S+', String.raw`^\S+$`, { CommandLine: 'ab' }, true],
  ['re keeps character-range case (the pattern is not lower-cased)', '^[A-Z]+$', { CommandLine: 'abc' }, false],
  ['re accepts the right case for a character range', '^[A-Z]+$', { CommandLine: 'ABC' }, true],
  ['re supports alternation', 'foo|bar', { CommandLine: 'a bar b' }, true],
  ['re alternation fails when neither branch occurs', 'foo|bar', { CommandLine: 'a baz b' }, false],
  ['re supports groups with bounded quantifiers', '(ab){2,3}', { CommandLine: 'xababx' }, true],
  ['re quantifier lower bounds are honored', '^(ab){2,3}$', { CommandLine: 'ab' }, false],
  ['re quantifier upper bounds are honored', '^(ab){2,3}$', { CommandLine: 'abababab' }, false],
  ['re treats * as a quantifier, not as a Sigma wildcard', 'a*b', { CommandLine: 'b' }, true],
  ['re dot matches any single character', 'a.c', { CommandLine: 'abc' }, true],
  ['re escaped dot does not match another character', String.raw`a\.c`, { CommandLine: 'abc' }, false],
  ['re escaped dot matches a literal dot', String.raw`a\.c`, { CommandLine: 'a.c' }, true],
  [
    're keeps a doubled backslash as an escaped backslash',
    String.raw`C:\\Windows`,
    { CommandLine: String.raw`C:\Windows\x` },
    true,
  ],
  ['re word boundaries match a whole word', String.raw`\bcmd\b`, { CommandLine: 'run cmd now' }, true],
  ['re word boundaries reject a word embedded in another', String.raw`\bcmd\b`, { CommandLine: 'xcmdx' }, false],
  ['re handles the file-extension idiom', String.raw`\.exe$`, { CommandLine: 'a.exe' }, true],
  ['re with a list matches when any pattern matches', ['^zzz', 'now$'], { CommandLine: 'run evil now' }, true],
  ['re with a list fails when no pattern matches', ['^zzz', '^yyy'], { CommandLine: 'run evil now' }, false],
  ['re fails on a missing field', 'x', {}, false],
  ['re searches the text form of a number', String.raw`^44\d$`, { CommandLine: 443 }, true],
  ['re never matches the text "null" for a null field', 'null', { CommandLine: null }, false],
  ['re never matches the text of an object', 'object', { CommandLine: { a: 1 } }, false],
  ['re matches one element of an array', '^b$', { CommandLine: ['a', 'b'] }, true],
  ['re does not join array elements into one string', 'a,b', { CommandLine: ['a', 'b'] }, false],
  ['an empty regex matches any present string', '', { CommandLine: 'abc' }, true],
  ['an empty regex does not match a missing field', '', {}, false],
  ['without re|m, ^ only matches at the start of the whole value', '^second', { CommandLine: 'first\nsecond' }, false],
  ['without re|m, $ only matches at the end of the whole value', 'first$', { CommandLine: 'first\nsecond' }, false],
  ['without re|s, a dot does not match a line break', 'a.b', { CommandLine: 'a\nb' }, false],
]);

// ---------------------------------------------------------------------------
// Sub-modifiers: i (ignore case), m (multi-line anchors), s (dot matches newline)
// ---------------------------------------------------------------------------

fieldCases('CommandLine|re|i', [
  ['re|i ignores case', 'EVIL', { CommandLine: 'run evil now' }, true],
  ['re|i ignores case for character ranges', '^[A-Z]+$', { CommandLine: 'abc' }, true],
  ['re|i still requires the letters to match', 'EVIL', { CommandLine: 'run good now' }, false],
  ['re|i ignores case of non-ASCII letters', '\u00c4\u00d6', { CommandLine: '\u00e4\u00f6' }, true],
]);

fieldCases('CommandLine|re|m', [
  ['re|m lets ^ match after a line break', '^second', { CommandLine: 'first\nsecond' }, true],
  ['re|m lets $ match before a line break', 'first$', { CommandLine: 'first\nsecond' }, true],
  ['re|m does not make other text match', '^third', { CommandLine: 'first\nsecond' }, false],
  ['re|m stays case-sensitive', '^SECOND', { CommandLine: 'first\nsecond' }, false],
]);

fieldCases('CommandLine|re|s', [
  ['re|s lets a dot match a line break', 'a.b', { CommandLine: 'a\nb' }, true],
  ['re|s still needs a character for the dot', 'a.b', { CommandLine: 'ab' }, false],
  ['re|s stays case-sensitive', 'A.B', { CommandLine: 'a\nb' }, false],
]);

fieldCases('CommandLine|re|i|s', [
  ['re|i|s combines ignore-case with dot-matches-newline', 'A.B', { CommandLine: 'a\nb' }, true],
]);

fieldCases('CommandLine|re|i|m', [
  ['re|i|m combines ignore-case with multi-line anchors', '^SECOND', { CommandLine: 'first\nsecond' }, true],
]);

fieldCases('CommandLine|re|m|s', [
  ['re|m|s combines multi-line anchors with dot-matches-newline', '^first.second$', { CommandLine: 'first\nsecond' }, true],
]);

fieldCases('CommandLine|re|all', [
  ['re with all requires every pattern to match', ['^run', 'now$'], { CommandLine: 'run evil now' }, true],
  ['re with all fails when one pattern does not match', ['^run', '^now'], { CommandLine: 'run evil now' }, false],
]);

// ---------------------------------------------------------------------------
// Invalid regular expressions fail at compile time with a path
// ---------------------------------------------------------------------------

const invalidPatterns: ReadonlyArray<readonly [string, string]> = [
  ['an unclosed group', '(unclosed'],
  ['an unclosed character class', '[abc'],
  ['a quantifier with nothing to repeat', '*abc'],
  ['a quantifier range in reverse order', 'a{2,1}'],
  ['a dangling backslash at the end', '\\'],
];

for (const [label, pattern] of invalidPatterns) {
  test(`${label} is a RuleParseError that points at the field`, () => {
    expectRuleParseError(() => compile(fieldRule('Image|re', pattern)), { path: /selection.*Image/ });
  });
}

test('an invalid regex is also rejected when it is one entry of a list', () => {
  expectRuleParseError(() => compile(fieldRule('Image|re', ['^ok$', '(broken'])), { path: /selection.*Image/ });
});

test('an invalid regex is rejected together with a sub-modifier', () => {
  expectRuleParseError(() => compile(fieldRule('Image|re|i', '(broken')), { path: /selection.*Image/ });
});

// ---------------------------------------------------------------------------
// Size limit: regex source longer than 2000 characters is rejected
// ---------------------------------------------------------------------------

test('a regex of exactly 2000 characters is accepted and works', () => {
  const pattern = 'a'.repeat(2000);
  const compiled = compile(fieldRule('Image|re', pattern));
  assert.equal(compiled.match({ Image: 'a'.repeat(2000) }).matched, true);
  assert.equal(compiled.match({ Image: 'a'.repeat(1999) }).matched, false);
});

test('a regex of 2001 characters is rejected with a message about its length', () => {
  expectRuleParseError(() => compile(fieldRule('Image|re', 'a'.repeat(2001))), {
    path: /selection.*Image/,
    message: /2000|long|length/i,
  });
});

test('one over-long regex in a list rejects the whole rule', () => {
  expectRuleParseError(() => compile(fieldRule('Image|re', ['ok', 'a'.repeat(2001)])), {
    path: /selection.*Image/,
  });
});

// ---------------------------------------------------------------------------
// Only i, m and s are regex flags; everything else is an invalid modifier
// ---------------------------------------------------------------------------

const badRegexModifiers: ReadonlyArray<readonly [string, RegExp]> = [
  ['Image|re|g', /\bg\b/],
  ['Image|re|u', /\bu\b/],
  ['Image|re|contains', /re|contains/],
  ['Image|contains|re', /re|contains/],
  ['Image|re|startswith', /re|startswith/],
  ['Image|i', /\bi\b/],
];

for (const [fieldKey, namedModifier] of badRegexModifiers) {
  test(`${fieldKey}: is rejected and the message names a modifier`, () => {
    expectRejected(() => compile(fieldRule(fieldKey, 'x')), { message: namedModifier });
  });
}

// ---------------------------------------------------------------------------
// Evaluation has no hidden state between events
// ---------------------------------------------------------------------------

test('repeated evaluation of the same event gives the same answer every time', () => {
  // A global/sticky RegExp keeps lastIndex between calls and flips every other answer.
  const compiled = compile(fieldRule('Image|re', 'cmd'));
  for (let attempt = 0; attempt < 6; attempt += 1) {
    assert.equal(compiled.match({ Image: 'C:\\cmd.exe' }).matched, true, `attempt ${attempt}`);
  }
});

test('alternating matching and non-matching events do not influence each other', () => {
  const compiled = compile(fieldRule('Image|re', 'cmd'));
  const verdicts = [true, false, true, false, true, false].map(
    (shouldMatch, index) => compiled.match({ Image: shouldMatch ? `cmd${index}` : `other${index}` }).matched,
  );
  assert.deepEqual(verdicts, [true, false, true, false, true, false]);
});
