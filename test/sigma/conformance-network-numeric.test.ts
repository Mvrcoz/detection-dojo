/**
 * Conformance: `cidr`, the numeric comparisons `lt`/`lte`/`gt`/`gte`, `exists`
 * and `fieldref`.
 *
 * Source: Sigma modifiers appendix (IP modifiers, numeric modifiers, `exists`,
 * `fieldref`) and docs/ARCHITECTURE.md 3.3. CIDR matching covers IPv4 and IPv6 and
 * only ever matches strings that are valid IP addresses.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compile, expectRejected, expectRuleParseError, fieldCases, fieldRule, rule, ruleCases } from './helpers.ts';

// ---------------------------------------------------------------------------
// cidr: IPv4
// ---------------------------------------------------------------------------

fieldCases('DestinationIp|cidr', [
  ['a /8 range includes its first address', '10.0.0.0/8', { DestinationIp: '10.0.0.0' }, true],
  ['a /8 range includes its last address', '10.0.0.0/8', { DestinationIp: '10.255.255.255' }, true],
  ['a /8 range includes an address in the middle', '10.0.0.0/8', { DestinationIp: '10.1.2.3' }, true],
  ['a /8 range excludes the next network', '10.0.0.0/8', { DestinationIp: '11.0.0.0' }, false],
  ['a /8 range excludes the previous network', '10.0.0.0/8', { DestinationIp: '9.255.255.255' }, false],
  ['a /8 range is not a text prefix test: 110.0.0.1 is outside 10.0.0.0/8', '10.0.0.0/8', { DestinationIp: '110.0.0.1' }, false],
  ['a /24 range includes its last address', '192.168.1.0/24', { DestinationIp: '192.168.1.255' }, true],
  ['a /24 range excludes the next network', '192.168.1.0/24', { DestinationIp: '192.168.2.0' }, false],
  ['a /24 range excludes the previous network', '192.168.1.0/24', { DestinationIp: '192.168.0.255' }, false],
  ['a /25 range includes its first address', '192.168.1.128/25', { DestinationIp: '192.168.1.128' }, true],
  ['a /25 range includes its last address', '192.168.1.128/25', { DestinationIp: '192.168.1.255' }, true],
  ['a /25 range excludes the address just below it', '192.168.1.128/25', { DestinationIp: '192.168.1.127' }, false],
  ['a /12 range includes its last address', '172.16.0.0/12', { DestinationIp: '172.31.255.255' }, true],
  ['a /12 range excludes the address just above it', '172.16.0.0/12', { DestinationIp: '172.32.0.0' }, false],
  ['a /12 range excludes the address just below it', '172.16.0.0/12', { DestinationIp: '172.15.255.255' }, false],
  ['a /32 range matches exactly one address', '203.0.113.7/32', { DestinationIp: '203.0.113.7' }, true],
  ['a /32 range excludes the next address', '203.0.113.7/32', { DestinationIp: '203.0.113.8' }, false],
  ['a /32 range excludes the previous address', '203.0.113.7/32', { DestinationIp: '203.0.113.6' }, false],
  ['a /31 range matches both of its addresses', '192.0.2.0/31', { DestinationIp: '192.0.2.1' }, true],
  ['a /31 range excludes the third address', '192.0.2.0/31', { DestinationIp: '192.0.2.2' }, false],
  ['a /0 range matches every IPv4 address', '0.0.0.0/0', { DestinationIp: '255.255.255.255' }, true],
  ['an IPv4 /0 range does not match an IPv6 address', '0.0.0.0/0', { DestinationIp: '::1' }, false],
  ['a list of ranges matches when any range contains the address', ['10.0.0.0/8', '192.168.0.0/16'], { DestinationIp: '192.168.5.5' }, true],
  ['a list of ranges fails when no range contains the address', ['10.0.0.0/8', '192.168.0.0/16'], { DestinationIp: '172.16.0.1' }, false],
  ['an array field matches when any address is in range', '10.0.0.0/8', { DestinationIp: ['8.8.8.8', '10.1.1.1'] }, true],
  ['an array field fails when no address is in range', '10.0.0.0/8', { DestinationIp: ['8.8.8.8', '1.1.1.1'] }, false],
]);

// ---------------------------------------------------------------------------
// cidr: values that are not IP addresses never match
// ---------------------------------------------------------------------------

fieldCases('DestinationIp|cidr', [
  ['text that is not an address never matches', '0.0.0.0/0', { DestinationIp: 'not-an-ip' }, false],
  ['an empty string never matches', '0.0.0.0/0', { DestinationIp: '' }, false],
  ['an address with too few octets never matches', '0.0.0.0/0', { DestinationIp: '10.0.0' }, false],
  ['an address with an octet above 255 never matches', '0.0.0.0/0', { DestinationIp: '10.0.0.256' }, false],
  ['an address with too many octets never matches', '0.0.0.0/0', { DestinationIp: '10.0.0.1.5' }, false],
  ['an address in CIDR notation is not an address', '0.0.0.0/0', { DestinationIp: '10.0.0.1/8' }, false],
  ['an address with leading junk never matches', '0.0.0.0/0', { DestinationIp: 'ip10.0.0.1' }, false],
  ['an address with trailing junk never matches', '0.0.0.0/0', { DestinationIp: '10.0.0.1abc' }, false],
  ['a plain integer is not an address', '0.0.0.0/0', { DestinationIp: 167772161 }, false],
  ['a missing field never matches', '0.0.0.0/0', {}, false],
  ['a null field never matches', '0.0.0.0/0', { DestinationIp: null }, false],
  ['a boolean never matches', '0.0.0.0/0', { DestinationIp: true }, false],
]);

// ---------------------------------------------------------------------------
// cidr: IPv6
// ---------------------------------------------------------------------------

fieldCases('DestinationIp|cidr', [
  ['an IPv6 /32 range includes an address inside it', '2001:db8::/32', { DestinationIp: '2001:db8::1' }, true],
  ['an IPv6 /32 range includes its network address', '2001:db8::/32', { DestinationIp: '2001:db8::' }, true],
  ['an IPv6 /32 range includes its last address', '2001:db8::/32', { DestinationIp: '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff' }, true],
  ['an IPv6 /32 range excludes the next network', '2001:db8::/32', { DestinationIp: '2001:db9::1' }, false],
  ['IPv6 hex digits are case-insensitive', '2001:db8::/32', { DestinationIp: '2001:DB8::1' }, true],
  ['IPv6 addresses may be written in expanded form', '2001:db8::/32', { DestinationIp: '2001:0db8:0000:0000:0000:0000:0000:0001' }, true],
  ['an IPv6 /128 range matches exactly one address', '::1/128', { DestinationIp: '::1' }, true],
  ['an IPv6 /128 range matches the expanded spelling of that address', '::1/128', { DestinationIp: '0:0:0:0:0:0:0:1' }, true],
  ['an IPv6 /128 range excludes a neighbor', '::1/128', { DestinationIp: '::2' }, false],
  ['an IPv6 /10 range includes the start of fe80::/10', 'fe80::/10', { DestinationIp: 'fe80::1' }, true],
  ['an IPv6 /10 range includes its upper edge', 'fe80::/10', { DestinationIp: 'febf::1' }, true],
  ['an IPv6 /10 range excludes the next block', 'fe80::/10', { DestinationIp: 'fec0::1' }, false],
  ['an IPv6 /10 range excludes the block below', 'fe80::/10', { DestinationIp: 'fe7f::1' }, false],
  ['an IPv6 /48 range includes a subnet inside it', '2001:db8:1::/48', { DestinationIp: '2001:db8:1:ffff::1' }, true],
  ['an IPv6 /48 range excludes a sibling', '2001:db8:1::/48', { DestinationIp: '2001:db8:2::1' }, false],
  ['an IPv6 /0 range matches every IPv6 address', '::/0', { DestinationIp: '2001:db8::1' }, true],
  ['an IPv6 /0 range does not match an IPv4 address', '::/0', { DestinationIp: '1.2.3.4' }, false],
  ['an IPv6 range does not match an IPv4 address', '2001:db8::/32', { DestinationIp: '192.0.2.1' }, false],
  ['an IPv4 range does not match an IPv6 address', '10.0.0.0/8', { DestinationIp: '2001:db8::1' }, false],
  ['an IPv6 address with two compressions never matches', '::/0', { DestinationIp: '2001:db8:::1' }, false],
  ['an IPv6 address with a non-hex digit never matches', '::/0', { DestinationIp: '2001:db8::g' }, false],
  ['an IPv6 address with a five-digit group never matches', '::/0', { DestinationIp: '12345::1' }, false],
  ['an IPv6 address with too few groups and no compression never matches', '::/0', { DestinationIp: '2001:db8' }, false],
]);

// ---------------------------------------------------------------------------
// cidr: invalid ranges fail at compile time instead of silently never matching
// ---------------------------------------------------------------------------

const invalidRanges: ReadonlyArray<readonly [string, string]> = [
  ['an IPv4 prefix length above 32', '10.0.0.0/33'],
  ['an IPv6 prefix length above 128', '2001:db8::/129'],
  ['text that is not a range', 'not-a-cidr'],
  ['a negative prefix length', '10.0.0.0/-1'],
  ['a missing prefix length after the slash', '10.0.0.0/'],
];

for (const [label, range] of invalidRanges) {
  test(`${label} is a RuleParseError that points at the field`, () => {
    expectRuleParseError(() => compile(fieldRule('DestinationIp|cidr', range)), { path: /selection.*DestinationIp/ });
  });
}

test('cidr cannot be combined with a string match-type modifier', () => {
  expectRejected(() => compile(fieldRule('DestinationIp|cidr|contains', '10.0.0.0/8')), { message: /cidr|contains/ });
});

// ---------------------------------------------------------------------------
// lt / lte / gt / gte
// ---------------------------------------------------------------------------

fieldCases('Port|gt', [
  ['gt matches a larger number', 1023, { Port: 8080 }, true],
  ['gt matches a larger numeric string', 1023, { Port: '8080' }, true],
  ['gt rejects an equal number', 1023, { Port: 1023 }, false],
  ['gt matches the next integer', 1023, { Port: 1024 }, true],
  ['gt rejects a smaller number', 1023, { Port: 80 }, false],
  ['gt compares numbers, not text: 9 is not greater than 1023', 1023, { Port: '9' }, false],
  ['gt compares numbers, not text: 100000 is greater than 99999', 99999, { Port: '100000' }, true],
  ['gt rejects text that is not a number', 1023, { Port: 'abc' }, false],
  ['gt rejects an empty string', 1023, { Port: '' }, false],
  ['gt rejects a whitespace-only string', 1023, { Port: '   ' }, false],
  ['gt rejects null', 1023, { Port: null }, false],
  ['gt rejects a missing field', 1023, {}, false],
  ['gt rejects a boolean', 0, { Port: true }, false],
  ['gt rejects NaN', 0, { Port: Number.NaN }, false],
  ['gt rejects infinity because only finite numbers compare', 0, { Port: Number.POSITIVE_INFINITY }, false],
  ['gt matches when any array element is larger', 1023, { Port: [80, 8080] }, true],
  ['gt fails when no array element is larger', 1023, { Port: [80, 22] }, false],
  ['gt with a list of thresholds matches when it beats any one of them', [1000, 5000], { Port: 2000 }, true],
  ['gt with a list of thresholds fails when it beats none', [1000, 5000], { Port: 500 }, false],
  ['gt handles numbers beyond 32 bits', 4294967296, { Port: 4294967297 }, true],
]);

fieldCases('Port|gte', [
  ['gte matches an equal number', 1024, { Port: 1024 }, true],
  ['gte matches an equal numeric string', 1024, { Port: '1024' }, true],
  ['gte rejects a smaller number', 1024, { Port: 1023 }, false],
  ['gte matches a larger number', 1024, { Port: 65535 }, true],
  ['gte rejects text that is not a number', 1024, { Port: 'high' }, false],
]);

fieldCases('Port|lt', [
  ['lt matches a smaller number', 1024, { Port: 1023 }, true],
  ['lt matches a smaller numeric string', 1024, { Port: '80' }, true],
  ['lt rejects an equal number', 1024, { Port: 1024 }, false],
  ['lt rejects a larger number', 1024, { Port: 2000 }, false],
  ['lt rejects text that is not a number', 1024, { Port: 'x' }, false],
  ['lt rejects a missing field', 1024, {}, false],
]);

fieldCases('Port|lte', [
  ['lte matches an equal number', 1024, { Port: 1024 }, true],
  ['lte matches zero', 1024, { Port: 0 }, true],
  ['lte rejects a larger number', 1024, { Port: 1025 }, false],
  ['lte matches an equal numeric string', 1024, { Port: '1024' }, true],
]);

fieldCases('Delta|lt', [
  ['lt works with negative numbers', 0, { Delta: -5 }, true],
  ['lt works with negative numeric strings', 0, { Delta: '-5' }, true],
  ['lt rejects zero against zero', 0, { Delta: 0 }, false],
  ['lt rejects a positive number against zero', 0, { Delta: 5 }, false],
]);

fieldCases('Score|gt', [
  ['gt works with fractional thresholds', 1.5, { Score: 2 }, true],
  ['gt works with fractional values', 1.5, { Score: 1.51 }, true],
  ['gt rejects a numeric string equal to a fractional threshold', 1.5, { Score: '1.5' }, false],
  ['gt accepts a numeric string just above a fractional threshold', 1.5, { Score: '1.50001' }, true],
  ['gt rejects a value below a fractional threshold', 1.5, { Score: 1 }, false],
]);

const comparisonWithStringModifier: ReadonlyArray<readonly [string, RegExp]> = [
  ['Port|gt|contains', /gt|contains/],
  ['Port|lt|re', /lt|re/],
  ['Port|gte|startswith', /gte|startswith/],
];

for (const [fieldKey, namedModifier] of comparisonWithStringModifier) {
  test(`${fieldKey}: a numeric comparison cannot be combined with a string modifier`, () => {
    expectRejected(() => compile(fieldRule(fieldKey, 10)), { message: namedModifier });
  });
}

// ---------------------------------------------------------------------------
// exists
// ---------------------------------------------------------------------------

fieldCases('Field|exists', [
  ['exists:true matches a present string', true, { Field: 'x' }, true],
  ['exists:true matches an empty string because the field is present', true, { Field: '' }, true],
  ['exists:true matches the number zero', true, { Field: 0 }, true],
  ['exists:true matches false', true, { Field: false }, true],
  ['exists:true matches an object value', true, { Field: { a: 1 } }, true],
  ['exists:true matches an array value', true, { Field: ['a'] }, true],
  ['exists:true does not match a missing field', true, {}, false],
  ['exists:true does not match when only other fields are present', true, { Other: 'x' }, false],
  ['exists:true finds the field through the case-insensitive fallback', true, { field: 'x' }, true],
  ['exists:false matches a missing field', false, {}, true],
  ['exists:false does not match a present string', false, { Field: 'x' }, false],
  ['exists:false does not match an empty string', false, { Field: '' }, false],
  ['exists:false does not match the number zero', false, { Field: 0 }, false],
  ['exists:false does not match false', false, { Field: false }, false],
  ['exists:false respects the case-insensitive fallback', false, { field: 'x' }, false],
  // The published Sigma modifiers page does not say how `exists` treats null. We follow
  // docs/ARCHITECTURE.md 3.3 (and how Splunk/Elastic backends behave): a null value counts
  // as absent, which also keeps `Field: null` and `Field|exists: false` consistent.
  ['exists:true does not match a field that is present with a null value', true, { Field: null }, false],
  ['exists:false matches a field that is present with a null value', false, { Field: null }, true],
]);

fieldCases('Process.Image|exists', [
  ['exists follows a dotted path into nested objects', true, { Process: { Image: 'x' } }, true],
  ['exists fails when the nested object lacks the key', true, { Process: { Other: 'x' } }, false],
  ['exists fails when the parent is not an object', true, { Process: 'text' }, false],
]);

test('exists can be combined with other fields in one selection', () => {
  const text = rule({ selection: { 'A|exists': true, B: 'x' } }, 'selection');
  const compiled = compile(text);
  assert.equal(compiled.match({ A: '1', B: 'x' }).matched, true);
  assert.equal(compiled.match({ B: 'x' }).matched, false);
  assert.equal(compiled.match({ A: '1', B: 'y' }).matched, false);
});

test('exists with a value that is not true or false is a RuleParseError', () => {
  expectRuleParseError(() => compile(fieldRule('Field|exists', 'maybe')), { path: /selection.*Field/ });
});

test('exists cannot be combined with a string match-type modifier', () => {
  expectRejected(() => compile(fieldRule('Field|exists|contains', true)), { message: /exists|contains/ });
});

// ---------------------------------------------------------------------------
// fieldref: compare two fields of the same event
// ---------------------------------------------------------------------------

fieldCases('A|fieldref', [
  ['fieldref matches when both fields hold the same string', 'B', { A: 'x', B: 'x' }, true],
  ['fieldref ignores case for strings', 'B', { A: 'abc', B: 'ABC' }, true],
  ['fieldref fails when the values differ', 'B', { A: 'x', B: 'y' }, false],
  ['fieldref fails when the referenced field is missing', 'B', { A: 'x' }, false],
  ['fieldref fails when the checked field is missing', 'B', { B: 'x' }, false],
  ['fieldref fails when both fields are missing', 'B', {}, false],
  ['fieldref compares a number with its text form', 'B', { A: 5, B: '5' }, true],
  ['fieldref compares two equal numbers', 'B', { A: 5, B: 5 }, true],
  ['fieldref compares a boolean with its text form', 'B', { A: true, B: 'true' }, true],
  ['fieldref does not trim whitespace', 'B', { A: 'a ', B: 'a' }, false],
  ['fieldref compares literally: identical values containing a star are equal', 'B', { A: 'a*', B: 'a*' }, true],
  ['fieldref compares literally: a star in the other field is not a wildcard', 'B', { A: 'abc', B: 'a*' }, false],
  ['fieldref compares literally: a question mark in the checked field is not a wildcard', 'B', { A: 'a?c', B: 'abc' }, false],
  ['fieldref compares literally: identical values with regex characters are equal', 'B', { A: 'x(y', B: 'x(y' }, true],
  ['fieldref finds the referenced field through the case-insensitive fallback', 'b', { A: 'x', B: 'x' }, true],
]);

fieldCases('Process.Image|fieldref', [
  ['fieldref follows dotted paths on both sides', 'Parent.Image', { Process: { Image: 'x' }, Parent: { Image: 'X' } }, true],
  ['fieldref with dotted paths fails when the values differ', 'Parent.Image', { Process: { Image: 'x' }, Parent: { Image: 'y' } }, false],
]);

fieldCases('A|fieldref|startswith', [
  ['fieldref with startswith matches when the field starts with the other field', 'B', { A: 'C:\\Windows\\x.exe', B: 'c:\\windows' }, true],
  ['fieldref with startswith fails when it does not', 'B', { A: 'x', B: 'xy' }, false],
  ['fieldref with startswith fails when the other field is missing', 'B', { A: 'x' }, false],
]);

fieldCases('A|fieldref|contains', [
  ['fieldref with contains matches when the field contains the other field', 'B', { A: 'hello world', B: 'LO W' }, true],
  ['fieldref with contains fails when it does not', 'B', { A: 'hello', B: 'xyz' }, false],
  ['fieldref with contains treats the other field as literal text', 'B', { A: 'a(b)c', B: '(b)' }, true],
  ['fieldref with contains does not treat regex characters as syntax', 'B', { A: 'abc', B: 'a.c' }, false],
]);

fieldCases('A|fieldref|endswith', [
  ['fieldref with endswith matches when the field ends with the other field', 'B', { A: 'file.exe', B: '.EXE' }, true],
  ['fieldref with endswith fails when it does not', 'B', { A: 'file.exe', B: '.dll' }, false],
]);

ruleCases([
  [
    'fieldref can be negated to find events where two fields differ',
    rule({ same: { 'A|fieldref': 'B' } }, 'not same'),
    { A: 'x', B: 'y' },
    true,
  ],
  [
    'a negated fieldref does not match when the fields are equal',
    rule({ same: { 'A|fieldref': 'B' } }, 'not same'),
    { A: 'x', B: 'X' },
    false,
  ],
]);
