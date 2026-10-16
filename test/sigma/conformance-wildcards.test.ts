/**
 * Conformance: string wildcards, escaping and case-insensitivity.
 *
 * Source: Sigma specification sections "Case Sensitivity", "String Wildcards" and
 * "Escape Rules (Backslash)", plus docs/ARCHITECTURE.md 3.3. Values written with
 * String.raw are exactly what the Sigma author typed, so the backslash cases read
 * like the spec's escape table.
 *
 *   \      plain backslash        \\      plain backslash
 *   \* \?  literal * and ?        \\*     literal backslash, then a wildcard
 *   \\\*   backslash, literal *   \\\\    two plain backslashes
 */

import { fieldCases } from './helpers.ts';

// ---------------------------------------------------------------------------
// `*` : any run of characters, including none
// ---------------------------------------------------------------------------

fieldCases('Image', [
  ['a star in the middle matches any run of characters', 'a*c', { Image: 'abbbc' }, true],
  ['a star in the middle matches an empty run', 'a*c', { Image: 'ac' }, true],
  ['a star in the middle still needs both ends', 'a*c', { Image: 'ab' }, false],
  ['a trailing star matches any suffix', 'abc*', { Image: 'abcdef' }, true],
  ['a trailing star also matches the bare prefix', 'abc*', { Image: 'abc' }, true],
  ['a trailing star requires the prefix at the very start', 'abc*', { Image: 'xabc' }, false],
  ['a leading star matches any prefix', '*abc', { Image: 'xxabc' }, true],
  ['a leading star requires the suffix at the very end', '*abc', { Image: 'abcx' }, false],
  ['stars on both sides find the text anywhere', '*abc*', { Image: 'xxabcxx' }, true],
  ['stars on both sides still require the text', '*abc*', { Image: 'xxabxcxx' }, false],
  ['several stars are matched in order', 'a*b*c', { Image: 'a1b2c' }, true],
  ['several stars in the wrong order fail', 'a*b*c', { Image: 'a1c2b' }, false],
  ['a star spans path separators', '/usr/*/bin', { Image: '/usr/local/x/bin' }, true],
  ['a star spans line breaks', 'a*b', { Image: 'a\nb' }, true],
  ['two adjacent stars behave like one', 'a**c', { Image: 'abc' }, true],
  ['two adjacent stars still match an empty run', 'a**c', { Image: 'ac' }, true],
  ['a star followed by a question mark needs at least one character', '*?', { Image: 'a' }, true],
  ['a star followed by a question mark rejects the empty string', '*?', { Image: '' }, false],
]);

// ---------------------------------------------------------------------------
// A bare `*` means "the field exists and is not null"
// ---------------------------------------------------------------------------

fieldCases('Image', [
  ['a bare star matches a non-empty string', '*', { Image: 'x' }, true],
  ['a bare star matches an empty string because the field exists', '*', { Image: '' }, true],
  ['a bare star matches the number zero', '*', { Image: 0 }, true],
  ['a bare star matches false', '*', { Image: false }, true],
  ['a bare star does not match a missing field', '*', {}, false],
  ['a bare star does not match a null field', '*', { Image: null }, false],
  ['a bare star inside a list is still an existence test', ['*', 'never'], { Image: 'x' }, true],
  ['a bare star inside a list does not match a missing field', ['*', 'never'], {}, false],
]);

// ---------------------------------------------------------------------------
// `?` : exactly one character
// ---------------------------------------------------------------------------

fieldCases('Image', [
  ['a question mark matches exactly one character', 'prog?.exe', { Image: 'prog1.exe' }, true],
  ['a question mark does not match zero characters', 'prog?.exe', { Image: 'prog.exe' }, false],
  ['a question mark does not match two characters', 'prog?.exe', { Image: 'prog12.exe' }, false],
  ['a question mark matches a space', 'a?b', { Image: 'a b' }, true],
  ['a question mark matches a line break', 'a?b', { Image: 'a\nb' }, true],
  ['a question mark matches a non-ASCII letter', 'caf?', { Image: 'caf\u00e9' }, true],
  // A character is a code point: an emoji outside the BMP is one character, not two.
  ['a question mark counts an emoji as a single character', 'a?b', { Image: 'a\u{1F600}b' }, true],
  ['two question marks do not match one emoji', 'a??b', { Image: 'a\u{1F600}b' }, false],
  ['three question marks match exactly three characters', '???', { Image: 'abc' }, true],
  ['three question marks reject two characters', '???', { Image: 'ab' }, false],
  ['three question marks reject four characters', '???', { Image: 'abcd' }, false],
  ['a question mark and a star combine', 'a?*c', { Image: 'abxxc' }, true],
  ['a question mark followed by a star still needs one character', 'a?*c', { Image: 'ac' }, false],
  ['a question mark matches a literal question mark in the event', 'a?b', { Image: 'a?b' }, true],
  ['a question mark matches a literal star in the event', 'a?b', { Image: 'a*b' }, true],
]);

// ---------------------------------------------------------------------------
// Backslash escaping (spec table)
// ---------------------------------------------------------------------------

fieldCases('Image', [
  ['an escaped star is a literal star', String.raw`a\*b`, { Image: 'a*b' }, true],
  ['an escaped star does not act as a wildcard', String.raw`a\*b`, { Image: 'axxb' }, false],
  ['an escaped star does not match an empty run', String.raw`a\*b`, { Image: 'ab' }, false],
  ['an escaped question mark is a literal question mark', String.raw`a\?b`, { Image: 'a?b' }, true],
  ['an escaped question mark does not match another character', String.raw`a\?b`, { Image: 'axb' }, false],
  [
    'a backslash before an ordinary character is a plain backslash',
    String.raw`C:\Windows\System32`,
    { Image: String.raw`C:\Windows\System32` },
    true,
  ],
  [
    'a doubled backslash is a single plain backslash',
    String.raw`C:\\Windows`,
    { Image: String.raw`C:\Windows` },
    true,
  ],
  [
    'a doubled backslash does not demand two backslashes in the event',
    String.raw`C:\\Windows`,
    { Image: String.raw`C:\\Windows` },
    false,
  ],
  [
    'an escaped backslash before a star is a literal backslash followed by a wildcard',
    String.raw`C:\Windows\\*`,
    { Image: String.raw`C:\Windows\anything.exe` },
    true,
  ],
  [
    'a wildcard after an escaped backslash still needs that backslash',
    String.raw`C:\Windows\\*`,
    { Image: 'C:\\Windowsanything.exe' },
    false,
  ],
  [
    'a backslash before an escaped star is a literal backslash and a literal star',
    String.raw`a\\\*`,
    { Image: String.raw`a\*` },
    true,
  ],
  [
    'a backslash before an escaped star does not act as a wildcard',
    String.raw`a\\\*`,
    { Image: String.raw`a\xyz` },
    false,
  ],
  ['four backslashes are two plain backslashes', String.raw`a\\\\b`, { Image: String.raw`a\\b` }, true],
  ['four backslashes do not match a single backslash', String.raw`a\\\\b`, { Image: String.raw`a\b` }, false],
  ['three backslashes are handled as two', String.raw`a\\\b`, { Image: String.raw`a\\b` }, true],
  ['a trailing backslash is a plain backslash', 'dir\\', { Image: 'dir\\' }, true],
  [
    'the common idiom *\\name matches a file name by suffix',
    String.raw`*\cmd.exe`,
    { Image: String.raw`C:\Windows\System32\cmd.exe` },
    true,
  ],
  [
    'the idiom *\\name does not match a longer file name',
    String.raw`*\cmd.exe`,
    { Image: String.raw`C:\Windows\System32\xcmd.exe` },
    false,
  ],
  [
    'a single backslash before a star escapes the star, so it is not a wildcard',
    String.raw`C:\Windows\*.exe`,
    { Image: String.raw`C:\Windows\cmd.exe` },
    false,
  ],
  [
    'a single backslash before a star makes the star literal',
    String.raw`C:\Windows\*.exe`,
    { Image: 'C:\\Windows*.exe' },
    true,
  ],
]);

// ---------------------------------------------------------------------------
// Case-insensitive by default ("All values are treated as case-insensitive strings")
// ---------------------------------------------------------------------------

fieldCases('Image', [
  ['plain equality ignores case (upper rule, lower event)', 'ABC', { Image: 'abc' }, true],
  ['plain equality ignores case (lower rule, upper event)', 'abc', { Image: 'ABC' }, true],
  ['wildcard patterns ignore case', '*CMD.EXE', { Image: 'c:\\windows\\cmd.exe' }, true],
  ['case-insensitivity covers accented Latin letters', '\u00c4\u00d6\u00dc', { Image: '\u00e4\u00f6\u00fc' }, true],
  ['case-insensitivity covers Greek letters', '\u0391\u0392\u0393', { Image: '\u03b1\u03b2\u03b3' }, true],
  ['case-insensitivity covers Cyrillic letters', '\u041f\u0420\u0418\u0412\u0415\u0422', { Image: '\u043f\u0440\u0438\u0432\u0435\u0442' }, true],
  ['different letters never match just because of case folding', 'abc', { Image: 'abd' }, false],
]);

// ---------------------------------------------------------------------------
// Plain equality is anchored on both ends and does not trim
// ---------------------------------------------------------------------------

fieldCases('Image', [
  ['plain equality needs the whole value, not a suffix', 'cmd.exe', { Image: 'C:\\cmd.exe' }, false],
  ['plain equality needs the whole value, not a prefix', 'cmd', { Image: 'cmd.exe' }, false],
  ['plain equality does not trim trailing whitespace of the rule value', 'abc ', { Image: 'abc' }, false],
  ['plain equality does not trim leading whitespace of the event value', 'abc', { Image: ' abc' }, false],
  ['plain equality keeps inner whitespace significant', 'a  b', { Image: 'a b' }, false],
  ['a list of patterns matches when any pattern matches', ['*.exe', '*.dll'], { Image: 'x.dll' }, true],
  ['a list of patterns fails when no pattern matches', ['*.exe', '*.dll'], { Image: 'x.txt' }, false],
]);

// ---------------------------------------------------------------------------
// Everything except * and ? is literal: regex syntax in a plain value is just text
// ---------------------------------------------------------------------------

fieldCases('Image', [
  ['a dot is a literal dot, not "any character"', 'a.c', { Image: 'abc' }, false],
  ['a dot matches a literal dot', 'a.c', { Image: 'a.c' }, true],
  ['a plus is a literal plus', 'a+b', { Image: 'aab' }, false],
  ['a plus matches a literal plus', 'a+b', { Image: 'a+b' }, true],
  ['parentheses are literal', '(x)', { Image: 'x' }, false],
  ['parentheses match literal parentheses', '(x)', { Image: '(x)' }, true],
  ['square brackets are literal, not a character class', '[abc]', { Image: 'a' }, false],
  ['square brackets match literal brackets', '[abc]', { Image: '[abc]' }, true],
  ['anchors are literal text', '^abc$', { Image: 'abc' }, false],
  ['anchors match literal caret and dollar', '^abc$', { Image: '^abc$' }, true],
  ['a pipe is literal, not alternation', 'a|b', { Image: 'a' }, false],
  ['a pipe matches a literal pipe', 'a|b', { Image: 'a|b' }, true],
  ['braces are literal, not a quantifier', 'a{2}', { Image: 'aa' }, false],
  ['braces match literal braces', 'a{2}', { Image: 'a{2}' }, true],
  ['backslash-d is a literal backslash and a d, not a digit class', String.raw`\d`, { Image: '5' }, false],
  ['backslash-d matches a literal backslash and d', String.raw`\d`, { Image: String.raw`\d` }, true],
  ['wildcard characters in the event value are plain text', 'abc', { Image: 'a*' }, false],
]);

// ---------------------------------------------------------------------------
// Wildcards inside contains / startswith / endswith values are honored too
// ---------------------------------------------------------------------------

fieldCases('Image|contains', [
  ['contains honors a star inside the value', 'a*c', { Image: 'xxabbcxx' }, true],
  ['contains honors a question mark inside the value', 'a?c', { Image: 'xxabcxx' }, true],
  ['contains with a question mark needs exactly one character', 'a?c', { Image: 'xxacxx' }, false],
  ['contains treats an escaped star as a literal star', String.raw`a\*c`, { Image: 'xxa*cxx' }, true],
  ['contains with an escaped star does not match other characters', String.raw`a\*c`, { Image: 'xxabcxx' }, false],
]);

fieldCases('Image|startswith', [
  ['startswith honors a star inside the value', 'a*c', { Image: 'abcdef' }, true],
  ['startswith honors a question mark inside the value', 'a?c', { Image: 'abcdef' }, true],
  ['startswith still anchors at the start', 'a*c', { Image: 'xabcdef' }, false],
]);

fieldCases('Image|endswith', [
  ['endswith honors a star inside the value', 'x*z', { Image: '..xyyz' }, true],
  ['endswith honors a question mark inside the value', 'x?z', { Image: '..xyz' }, true],
  ['endswith still anchors at the end', 'x*z', { Image: 'xyzz.' }, false],
]);
