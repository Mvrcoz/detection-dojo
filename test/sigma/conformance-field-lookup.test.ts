/**
 * Conformance: how a rule's field name finds a value in the event, and how event
 * values of every JSON type are compared.
 *
 * Source: docs/ARCHITECTURE.md 3.3 ("Field lookup": exact key first, then a dotted
 * path into nested objects, then a case-insensitive fallback for both; arrays match
 * when any element matches; numbers and booleans compare as their canonical text)
 * and the Sigma specification ("Special Values": null, empty string, numbers).
 */

import { fieldCases } from './helpers.ts';

// ---------------------------------------------------------------------------
// Exact keys, dotted keys and nested paths
// ---------------------------------------------------------------------------

fieldCases('Image', [
  ['an exact key is found', 'x', { Image: 'x' }, true],
  ['an absent field does not match', 'x', { Other: 'x' }, false],
  ['a field with a different value does not match', 'x', { Image: 'y' }, false],
  ['an event with no fields does not match', 'x', {}, false],
]);

fieldCases('a.b', [
  ['a key that literally contains a dot is found by exact match', 'x', { 'a.b': 'x' }, true],
  ['a dotted name also reaches into a nested object', 'x', { a: { b: 'x' } }, true],
  ['a dotted name does not match when the nested value differs', 'x', { a: { b: 'y' } }, false],
  ['an exact dotted key takes precedence over a nested path (value from the exact key)', 'flat', { 'a.b': 'flat', a: { b: 'nested' } }, true],
  ['an exact dotted key takes precedence over a nested path (nested value is ignored)', 'nested', { 'a.b': 'flat', a: { b: 'nested' } }, false],
  ['a missing parent object means no match', 'x', { z: { b: 'x' } }, false],
  ['a parent that is a string means no match', 'x', { a: 'text' }, false],
  ['a parent that is null means no match', 'x', { a: null }, false],
  ['a parent that is a number means no match', 'x', { a: 5 }, false],
  ['a dotted lookup is case-insensitive for each path segment', 'x', { A: { B: 'x' } }, true],
  ['a dotted lookup is case-insensitive for a flat dotted key', 'x', { 'A.B': 'x' }, true],
]);

fieldCases('a.b.c', [
  ['a dotted name reaches three levels deep', 'x', { a: { b: { c: 'x' } } }, true],
  ['a dotted name fails when the deepest level is missing', 'x', { a: { b: {} } }, false],
]);

fieldCases('process.image', [
  ['a lower-case dotted rule field finds a mixed-case nested event', 'x', { Process: { Image: 'x' } }, true],
]);

fieldCases('Field With Space', [
  ['a field name containing spaces is found', 'x', { 'Field With Space': 'x' }, true],
]);

fieldCases('Ünicöde', [
  ['a field name with non-ASCII letters is found', 'x', { 'Ünicöde': 'x' }, true],
  ['a field name with non-ASCII letters is found case-insensitively', 'x', { 'ünicÖde': 'x' }, true],
]);

// ---------------------------------------------------------------------------
// Case-insensitive fallback
// ---------------------------------------------------------------------------

fieldCases('CommandLine', [
  ['a lower-case event key is found when no exact key exists', 'x', { commandline: 'x' }, true],
  ['an upper-case event key is found when no exact key exists', 'x', { COMMANDLINE: 'x' }, true],
  ['an exact-case key wins over a differently cased key (exact value matches)', 'exact', { CommandLine: 'exact', commandline: 'other' }, true],
  ['an exact-case key wins over a differently cased key (other value is ignored)', 'other', { CommandLine: 'exact', commandline: 'other' }, false],
  ['field names are not matched by prefix', 'x', { CommandLineArgs: 'x' }, false],
  ['field names are not matched by suffix', 'x', { MyCommandLine: 'x' }, false],
]);

// ---------------------------------------------------------------------------
// Arrays in the event: any element may match
// ---------------------------------------------------------------------------

fieldCases('Tags', [
  ['an array matches when any element matches (middle element)', 'b', { Tags: ['a', 'b', 'c'] }, true],
  ['an array matches when the first element matches', 'a', { Tags: ['a', 'b', 'c'] }, true],
  ['an array matches when the last element matches', 'c', { Tags: ['a', 'b', 'c'] }, true],
  ['an array does not match when no element matches', 'z', { Tags: ['a', 'b'] }, false],
  ['an empty array matches nothing', 'a', { Tags: [] }, false],
  ['array elements are compared case-insensitively', 'B', { Tags: ['a', 'b'] }, true],
  ['numeric array elements compare as text', '443', { Tags: [80, 443] }, true],
  ['a null element in an array is skipped', 'a', { Tags: [null, 'a'] }, true],
  ['wildcards apply to each array element separately', 'a*', { Tags: ['zzz', 'abc'] }, true],
  ['a wildcard pattern does not span two array elements', 'a*c', { Tags: ['a', 'c'] }, false],
  ['a list of rule values matches an array when any pair matches', ['x', 'y'], { Tags: ['q', 'y'] }, true],
  ['a list of rule values fails when no pair matches', ['x', 'y'], { Tags: ['q', 'r'] }, false],
]);

// ---------------------------------------------------------------------------
// Numbers and booleans compare as their canonical text
// ---------------------------------------------------------------------------

fieldCases('Port', [
  ['a numeric rule value matches the same number', 443, { Port: 443 }, true],
  ['a numeric rule value matches the same number written as text', 443, { Port: '443' }, true],
  ['a text rule value matches a number', '443', { Port: 443 }, true],
  ['different numbers do not match', 443, { Port: 444 }, false],
  ['a numeric rule value does not match a longer number', 44, { Port: 443 }, false],
  ['a negative number matches its text form', -1, { Port: '-1' }, true],
  ['a decimal number matches its text form', 1.5, { Port: '1.5' }, true],
  ['zero matches the text "0"', 0, { Port: '0' }, true],
  ['zero does not match the empty string', 0, { Port: '' }, false],
  ['zero does not match false', 0, { Port: false }, false],
  ['a list mixing numbers and text matches either form', [80, '443'], { Port: 443 }, true],
]);

fieldCases('Flag', [
  ['true matches a true event value', true, { Flag: true }, true],
  ['true matches the text "true"', true, { Flag: 'true' }, true],
  ['true matches the text "True" because text is compared case-insensitively', true, { Flag: 'True' }, true],
  ['true does not match false', true, { Flag: false }, false],
  ['true does not match the number one', true, { Flag: 1 }, false],
  ['true does not match the text "yes"', true, { Flag: 'yes' }, false],
  ['false matches a false event value', false, { Flag: false }, true],
  ['false matches the text "false"', false, { Flag: 'false' }, true],
  ['false does not match a missing field', false, {}, false],
  ['false does not match the number zero', false, { Flag: 0 }, false],
  ['false does not match a null field', false, { Flag: null }, false],
  ['the text "true" in a rule matches a true event value', 'true', { Flag: true }, true],
]);

// ---------------------------------------------------------------------------
// Missing, null and structured values
// ---------------------------------------------------------------------------

fieldCases('Image', [
  ['a missing field never matches a value', 'x', {}, false],
  ['a null field never matches a value', 'x', { Image: null }, false],
  ['a null field never matches a wildcard pattern with content', 'a*', { Image: null }, false],
  ['an object value never matches its default text form', '[object Object]', { Image: { a: 1 } }, false],
  ['an object value never matches its JSON text', '{"a":1}', { Image: { a: 1 } }, false],
  ['an array value never matches its joined text', 'a,b', { Image: ['a', 'b'] }, false],
]);

// ---------------------------------------------------------------------------
// Only the event's own data is a field: inherited JavaScript properties are not
// ---------------------------------------------------------------------------

for (const inherited of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
  fieldCases(`${inherited}|exists`, [
    [`"${inherited}" is not a field of an empty event (exists:true)`, true, {}, false],
    [`"${inherited}" is absent from an empty event (exists:false)`, false, {}, true],
  ]);
}

fieldCases('toString', [
  ['a bare star does not see an inherited property', '*', {}, false],
]);

fieldCases('constructor', [
  ['an event may legitimately own a field called constructor', 'x', { constructor: 'x' }, true],
]);

fieldCases('a.constructor.name', [
  ['a dotted path does not walk into inherited properties', 'Object', { a: {} }, false],
]);

fieldCases('Image.length', [
  ['a dotted path does not read properties of a string', 3, { Image: 'abc' }, false],
]);

fieldCases('Tags.length', [
  ['a dotted path does not read properties of an array', 2, { Tags: ['a', 'b'] }, false],
]);

fieldCases('Image.length|exists', [
  ['exists does not treat properties of a string as fields', true, { Image: 'abc' }, false],
]);
