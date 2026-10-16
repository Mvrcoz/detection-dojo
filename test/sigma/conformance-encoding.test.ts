/**
 * Conformance: value-transform modifiers `base64`, `base64offset`, `utf16le`,
 * `utf16be`, `utf16`, `wide` and `windash`.
 *
 * Source: Sigma modifiers appendix and docs/ARCHITECTURE.md 3.3. The expected
 * strings below were computed from the spec's algorithm, not from the evaluator:
 *
 *   base64offset(bytes) = for shift in 0..2:
 *       encode(shift spaces + bytes), then keep [start[shift] : end[(len + shift) % 3]]
 *       with start = [0, 2, 3] and end = [none, -3, -2]
 *
 *   utf16le / wide : cmd -> 63 00 6d 00 64 00
 *   utf16be        : cmd -> 00 63 00 6d 00 64
 *   utf16          : cmd -> FF FE 63 00 6d 00 64 00   (byte order mark, then little-endian)
 *
 * Base64 text is only ever compared in the exact case produced by the encoder, so
 * these tests stay neutral on whether the evaluator folds case for encoded values.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  base64OffsetVariants,
  compile,
  expectRejected,
  fieldCases,
  fieldRule,
  hit,
  utf16WithBom,
  utf16be,
  utf16le,
  utf8,
} from './helpers.ts';

const HTTP = ['aHR0cDovL', 'h0dHA6Ly', 'odHRwOi8v'] as const;
const CMD = ['Y21k', 'NtZ', 'jbW'] as const;
const WIDE_CMD = ['YwBtAGQA', 'MAbQBkA', 'jAG0AZA'] as const;
const WIDE_WRITE_HOST = [
  'VwByAGkAdABlAC0ASABvAHMAdA',
  'cAcgBpAHQAZQAtAEgAbwBzAHQA',
  'XAHIAaQB0AGUALQBIAG8AcwB0A',
] as const;
const BOM_CMD = ['//5jAG0AZA', '/+YwBtAGQA', '//mMAbQBkA'] as const;
const NIHON = ['5pel5pys', 'aXpeacr', 'ml6XmnK'] as const;
// "Write-Host 'dojo'" as UTF-16LE then base64, the shape of a PowerShell -EncodedCommand.
const ENCODED_COMMAND = 'VwByAGkAdABlAC0ASABvAHMAdAAgACcAZABvAGoAbwAnAA==';

/** base64 of `prefix` filler bytes + payload + `suffix` filler bytes: the value sits at any alignment. */
function embedded(prefixBytes: number, payload: Uint8Array, suffixBytes: number): string {
  return Buffer.concat([utf8('P'.repeat(prefixBytes)), payload, utf8('S'.repeat(suffixBytes))]).toString('base64');
}

test('the reference algorithm used by these tests reproduces the hand-computed vectors', () => {
  assert.deepEqual(base64OffsetVariants(utf8('http://')), [...HTTP]);
  assert.deepEqual(base64OffsetVariants(utf8('cmd')), [...CMD]);
  assert.deepEqual(base64OffsetVariants(utf16le('cmd')), [...WIDE_CMD]);
  assert.deepEqual(base64OffsetVariants(utf16le('Write-Host')), [...WIDE_WRITE_HOST]);
  assert.deepEqual(base64OffsetVariants(utf16WithBom('cmd')), [...BOM_CMD]);
  assert.deepEqual(base64OffsetVariants(utf8('日本')), [...NIHON]);
  assert.equal(utf16le("Write-Host 'dojo'").toString('base64'), ENCODED_COMMAND);
});

// ---------------------------------------------------------------------------
// base64: the encoded form of the value, as UTF-8, with padding
// ---------------------------------------------------------------------------

fieldCases('Payload|base64', [
  ['base64 matches the encoded form of the value', 'Hello', { Payload: 'SGVsbG8=' }, true],
  ['base64 does not match the plain text', 'Hello', { Payload: 'Hello' }, false],
  ['base64 keeps the padding characters', 'Hello', { Payload: 'SGVsbG8' }, false],
  ['base64 encodes accented text as UTF-8', 'é', { Payload: 'w6k=' }, true],
  ['base64 encodes multi-byte UTF-8 text', '日本', { Payload: '5pel5pys' }, true],
  ['base64 with a list matches any encoded value', ['Hello', 'abc'], { Payload: 'YWJj' }, true],
  ['base64 with a list fails when no encoded value is present', ['Hello', 'abc'], { Payload: 'eHl6' }, false],
  ['base64 fails on a missing field', 'Hello', {}, false],
]);

fieldCases('Payload|base64|contains', [
  ['base64 followed by contains finds the encoded value inside a longer string', 'Hello', { Payload: 'xxxSGVsbG8=yyy' }, true],
  ['base64 followed by contains fails when only the plain text is present', 'Hello', { Payload: 'please say Hello' }, false],
]);

// ---------------------------------------------------------------------------
// base64offset: the three alignments of a value inside a longer base64 stream
// ---------------------------------------------------------------------------

fieldCases('Payload|base64offset', [
  ['base64offset matches the zero-shift variant', 'http://', { Payload: HTTP[0] }, true],
  ['base64offset matches the one-byte-shift variant', 'http://', { Payload: HTTP[1] }, true],
  ['base64offset matches the two-byte-shift variant', 'http://', { Payload: HTTP[2] }, true],
  ['base64offset does not match the plain text', 'http://', { Payload: 'http://' }, false],
  ['base64offset does not match unrelated base64', 'http://', { Payload: 'Zm9vYmFy' }, false],
]);

fieldCases('Payload|base64offset|contains', [
  ['base64offset with contains finds the zero-shift variant in a longer string', 'http://', { Payload: `xx${HTTP[0]}yy` }, true],
  ['base64offset with contains finds the one-byte-shift variant', 'http://', { Payload: `xx${HTTP[1]}yy` }, true],
  ['base64offset with contains finds the two-byte-shift variant', 'http://', { Payload: `xx${HTTP[2]}yy` }, true],
  ['base64offset with contains finds a three-byte value variant', 'cmd', { Payload: `xx${CMD[1]}yy` }, true],
  ['base64offset with contains handles multi-byte UTF-8 values', '日本', { Payload: `xx${NIHON[2]}yy` }, true],
  ['base64offset with contains does not match the plain text', 'http://', { Payload: 'curl http://example.test' }, false],
  [
    'base64offset with contains does not match the base64 of a different string',
    'http://',
    { Payload: Buffer.from('hxxp://example.test').toString('base64') },
    false,
  ],
  [
    'base64offset with a list matches when any value is encoded in the field',
    ['ftp://', 'http://'],
    { Payload: `xx${HTTP[1]}yy` },
    true,
  ],
]);

for (let prefix = 0; prefix < 6; prefix += 1) {
  for (const suffix of [0, 1, 2]) {
    test(`base64offset|contains finds "http://" after ${prefix} and before ${suffix} unrelated bytes`, () => {
      const payload = embedded(prefix, utf8('http://'), suffix);
      assert.equal(hit('Payload|base64offset|contains', 'http://', { Payload: payload }), true, payload);
    });
  }
}

for (let prefix = 0; prefix < 3; prefix += 1) {
  for (const suffix of [0, 1, 2]) {
    test(`base64offset|contains finds "Write-Host" after ${prefix} and before ${suffix} unrelated bytes`, () => {
      const payload = embedded(prefix, utf8('Write-Host'), suffix);
      assert.equal(hit('Payload|base64offset|contains', 'Write-Host', { Payload: payload }), true, payload);
    });
  }
}

for (let prefix = 0; prefix < 3; prefix += 1) {
  test(`base64offset|contains finds a multi-byte UTF-8 value after ${prefix} unrelated bytes`, () => {
    const payload = embedded(prefix, utf8('日本'), 1);
    assert.equal(hit('Payload|base64offset|contains', '日本', { Payload: payload }), true, payload);
  });
}

test('base64offset|contains rejects the base64 of a near miss', () => {
  // The misspelling is early in the value: base64offset deliberately ignores the
  // characters that depend on the last byte, so a change at the very end could still match.
  const nearMiss = embedded(1, utf8('Wr0te-Host'), 1);
  assert.equal(
    base64OffsetVariants(utf8('Write-Host')).some((variant) => nearMiss.includes(variant)),
    false,
    'fixture sanity: the near miss must not contain any variant',
  );
  assert.equal(hit('Payload|base64offset|contains', 'Write-Host', { Payload: nearMiss }), false);
});

test('base64offset|contains|all needs every value encoded somewhere in the field', () => {
  const both = utf8('Write-Host http://').toString('base64');
  const onlyFirst = utf8('Write-Host only').toString('base64');
  assert.equal(hit('Payload|base64offset|contains|all', ['Write-Host', 'http://'], { Payload: both }), true);
  assert.equal(hit('Payload|base64offset|contains|all', ['Write-Host', 'http://'], { Payload: onlyFirst }), false);
});

// ---------------------------------------------------------------------------
// utf16le / wide / utf16be / utf16: the character-set step before base64
// ---------------------------------------------------------------------------

fieldCases('Payload|wide|base64', [
  ['wide then base64 encodes UTF-16 little-endian', 'cmd', { Payload: 'YwBtAGQA' }, true],
  ['wide then base64 does not match the UTF-8 encoding', 'cmd', { Payload: 'Y21k' }, false],
]);

fieldCases('Payload|utf16le|base64', [
  ['utf16le is the same encoding as wide', 'cmd', { Payload: 'YwBtAGQA' }, true],
  ['utf16le does not match the big-endian encoding', 'cmd', { Payload: 'AGMAbQBk' }, false],
]);

fieldCases('Payload|utf16be|base64', [
  ['utf16be then base64 encodes UTF-16 big-endian', 'cmd', { Payload: 'AGMAbQBk' }, true],
  ['utf16be does not match the little-endian encoding', 'cmd', { Payload: 'YwBtAGQA' }, false],
]);

fieldCases('Payload|utf16|base64', [
  ['utf16 then base64 prepends the byte order mark (FF FE) to little-endian text', 'cmd', { Payload: '//5jAG0AZAA=' }, true],
  ['utf16 is not the same as bare little-endian', 'cmd', { Payload: 'YwBtAGQA' }, false],
]);

fieldCases('Payload|wide|base64offset|contains', [
  ['wide with base64offset finds the zero-shift variant', 'cmd', { Payload: `xx${WIDE_CMD[0]}yy` }, true],
  ['wide with base64offset finds the one-byte-shift variant', 'cmd', { Payload: `xx${WIDE_CMD[1]}yy` }, true],
  ['wide with base64offset finds the two-byte-shift variant', 'cmd', { Payload: `xx${WIDE_CMD[2]}yy` }, true],
  ['wide with base64offset does not match the UTF-8 encoding', 'cmd', { Payload: `xx${CMD[0]}yy` }, false],
  [
    'wide with base64offset finds a command inside a PowerShell -EncodedCommand argument',
    'Write-Host',
    { Payload: `powershell -enc ${ENCODED_COMMAND}` },
    true,
  ],
  [
    'wide with base64offset does not report a command that is not in the payload',
    'Write-Output',
    { Payload: `powershell -enc ${ENCODED_COMMAND}` },
    false,
  ],
]);

fieldCases('Payload|base64offset|contains', [
  [
    'UTF-8 base64offset does not find a UTF-16 encoded command',
    'Write-Host',
    { Payload: `powershell -enc ${ENCODED_COMMAND}` },
    false,
  ],
]);

fieldCases('Payload|utf16le|base64offset|contains', [
  ['utf16le with base64offset behaves exactly like wide', 'Write-Host', { Payload: `powershell -enc ${ENCODED_COMMAND}` }, true],
  ['utf16le with base64offset rejects the UTF-8 encoding', 'Write-Host', { Payload: utf8('Write-Host').toString('base64') }, false],
]);

fieldCases('Payload|utf16be|base64offset|contains', [
  [
    'utf16be with base64offset finds big-endian text',
    'Write-Host',
    { Payload: utf16be('Write-Host').toString('base64') },
    true,
  ],
  [
    'utf16be with base64offset does not find little-endian text',
    'Write-Host',
    { Payload: `powershell -enc ${ENCODED_COMMAND}` },
    false,
  ],
]);

fieldCases('Payload|utf16|base64offset|contains', [
  ['utf16 with base64offset includes the byte order mark (zero shift)', 'cmd', { Payload: '//5jAG0AZAA=' }, true],
  ['utf16 with base64offset includes the byte order mark (one-byte shift)', 'cmd', { Payload: `xx${BOM_CMD[1]}yy` }, true],
  ['utf16 with base64offset includes the byte order mark (two-byte shift)', 'cmd', { Payload: `xx${BOM_CMD[2]}yy` }, true],
  ['utf16 with base64offset does not match text encoded without the byte order mark', 'cmd', { Payload: `xx${WIDE_CMD[0]}yy` }, false],
]);

for (let prefix = 0; prefix < 6; prefix += 1) {
  test(`wide|base64offset|contains finds UTF-16 "Write-Host" after ${prefix} unrelated bytes`, () => {
    const payload = embedded(prefix, utf16le('Write-Host'), 2);
    assert.equal(hit('Payload|wide|base64offset|contains', 'Write-Host', { Payload: payload }), true, payload);
  });
}

// ---------------------------------------------------------------------------
// Invalid combinations
// ---------------------------------------------------------------------------

const misplacedEncodingModifiers: ReadonlyArray<readonly [string, RegExp]> = [
  ['Payload|wide', /wide|base64/],
  ['Payload|utf16le', /utf16le|base64/],
  ['Payload|utf16be', /utf16be|base64/],
  ['Payload|utf16', /utf16|base64/],
  ['Payload|wide|contains', /wide|base64/],
  ['Payload|base64|wide', /wide|base64/],
  ['Payload|contains|base64', /contains|base64/],
  ['Payload|contains|base64offset', /contains|base64offset/],
];

for (const [fieldKey, namedModifier] of misplacedEncodingModifiers) {
  test(`${fieldKey}: a character-set modifier must be followed by base64 or base64offset`, () => {
    expectRejected(() => compile(fieldRule(fieldKey, 'cmd')), { message: namedModifier });
  });
}

// ---------------------------------------------------------------------------
// windash: -, /, en dash, em dash and horizontal bar are interchangeable
// ---------------------------------------------------------------------------

const EN_DASH = '–';
const EM_DASH = '—';
const HORIZONTAL_BAR = '―';
const MINUS_SIGN = '−';

fieldCases('CommandLine|windash|contains', [
  ['windash matches the original hyphen', '-enc', { CommandLine: 'powershell -enc abc' }, true],
  ['windash matches a slash in place of the hyphen', '-enc', { CommandLine: 'powershell /enc abc' }, true],
  ['windash matches an en dash in place of the hyphen', '-enc', { CommandLine: `powershell ${EN_DASH}enc abc` }, true],
  ['windash matches an em dash in place of the hyphen', '-enc', { CommandLine: `powershell ${EM_DASH}enc abc` }, true],
  ['windash matches a horizontal bar in place of the hyphen', '-enc', { CommandLine: `powershell ${HORIZONTAL_BAR}enc abc` }, true],
  ['windash stays case-insensitive', '-enc', { CommandLine: 'POWERSHELL /ENC ABC' }, true],
  ['windash fails when the switch character is missing', '-enc', { CommandLine: 'powershell enc abc' }, false],
  ['windash does not accept a plus sign', '-enc', { CommandLine: 'powershell +enc abc' }, false],
  ['windash does not accept the Unicode minus sign', '-enc', { CommandLine: `powershell ${MINUS_SIGN}enc abc` }, false],
  ['windash fails when the switch name differs', '-enc', { CommandLine: 'powershell /exec abc' }, false],
  ['windash also expands a value written with a slash', '/enc', { CommandLine: 'powershell -enc abc' }, true],
  ['windash expands every switch in the value independently', '-ep bypass -enc', { CommandLine: `x /ep bypass ${EN_DASH}enc y` }, true],
  ['windash expands each switch even when only one is varied', '-ep bypass -enc', { CommandLine: 'x -ep bypass /enc y' }, true],
  ['windash with a list matches when any value matches', ['-enc', '-nop'], { CommandLine: 'x /nop' }, true],
  ['windash with a list fails when no value matches', ['-enc', '-nop'], { CommandLine: 'x nop enc' }, false],
  ['windash leaves text without dashes alone', 'powershell', { CommandLine: 'POWERSHELL.EXE' }, true],
]);

fieldCases('CommandLine|windash', [
  ['windash equality matches the hyphen form', '-enc', { CommandLine: '-enc' }, true],
  ['windash equality matches the slash form', '-enc', { CommandLine: '/enc' }, true],
  ['windash equality matches the en dash form', '-enc', { CommandLine: `${EN_DASH}enc` }, true],
  ['windash equality still needs the whole value to match', '-enc', { CommandLine: 'x -enc' }, false],
  ['windash equality still needs the switch name', '-enc', { CommandLine: 'enc' }, false],
]);

fieldCases('CommandLine|windash|startswith', [
  ['windash with startswith matches a slash switch at the start', '-enc', { CommandLine: '/encodedcommand abc' }, true],
  ['windash with startswith fails when the switch is not at the start', '-enc', { CommandLine: 'x /enc' }, false],
]);

fieldCases('CommandLine|windash|endswith', [
  ['windash with endswith matches a slash switch at the end', ' -enc', { CommandLine: 'run /enc' }, true],
  ['windash with endswith matches a hyphen switch at the end', ' -enc', { CommandLine: 'run -enc' }, true],
  ['windash with endswith fails without the switch character', ' -enc', { CommandLine: 'run enc' }, false],
]);

fieldCases('CommandLine|windash|contains|all', [
  ['windash with all needs every switch, in any dash style', ['-enc', '-nop'], { CommandLine: `x /enc ${EM_DASH}nop` }, true],
  ['windash with all fails when one switch is missing', ['-enc', '-nop'], { CommandLine: 'x /enc' }, false],
]);
