import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compilePattern, parseWildcards, type MatchMode, type PatternPart } from '../../src/sigma/wildcard.ts';

/** Compact notation for assertions: literal text as-is, `*` and `?` for wildcards. */
function show(parts: readonly PatternPart[]): string {
  return parts.map((part) => (part.kind === 'literal' ? `<${part.text}>` : part.kind === 'any' ? '*' : '?')).join('');
}

function matches(pattern: string, subject: string, mode: MatchMode = 'equals', cased = false): boolean {
  const test = compilePattern(parseWildcards(pattern), mode, cased);
  return test(cased ? subject : subject.toLowerCase());
}

describe('parseWildcards', () => {
  it('splits literals from * and ?', () => {
    assert.equal(show(parseWildcards('abc')), '<abc>');
    assert.equal(show(parseWildcards('a*c')), '<a>*<c>');
    assert.equal(show(parseWildcards('?bc?')), '?<bc>?');
    assert.equal(show(parseWildcards('')), '');
  });

  it('treats escaped wildcards as literal characters', () => {
    assert.equal(show(parseWildcards('a\\*b')), '<a*b>');
    assert.equal(show(parseWildcards('a\\?b')), '<a?b>');
  });

  it('follows the escape table of the Sigma specification', () => {
    // plain backslash, not followed by a wildcard: single or double
    assert.equal(show(parseWildcards('C:\\Windows')), '<C:\\Windows>');
    assert.equal(show(parseWildcards('C:\\\\Windows')), '<C:\\Windows>');
    // backslash before a wildcard has to be escaped to keep the wildcard
    assert.equal(show(parseWildcards('dir\\\\*')), '<dir\\>*');
    // three backslashes escape both the backslash and the wildcard
    assert.equal(show(parseWildcards('dir\\\\\\*')), '<dir\\*>');
    // three or four backslashes are a double backslash
    assert.equal(show(parseWildcards('a\\\\\\b')), '<a\\\\b>');
    assert.equal(show(parseWildcards('a\\\\\\\\b')), '<a\\\\b>');
  });

  it('keeps a trailing lone backslash', () => {
    assert.equal(show(parseWildcards('C:\\')), '<C:\\>');
  });
});

describe('compilePattern modes', () => {
  it('equals is a whole-string comparison', () => {
    assert.ok(matches('cmd.exe', 'cmd.exe'));
    assert.ok(!matches('cmd.exe', 'xcmd.exe'));
    assert.ok(!matches('cmd.exe', 'cmd.exe '));
  });

  it('contains, startswith and endswith add the implicit wildcards', () => {
    assert.ok(matches('mid', 'a-mid-z', 'contains'));
    assert.ok(!matches('mid', 'a-mud-z', 'contains'));
    assert.ok(matches('pre', 'prefix', 'startswith'));
    assert.ok(!matches('pre', 'a prefix', 'startswith'));
    assert.ok(matches('fix', 'prefix', 'endswith'));
    assert.ok(!matches('fix', 'prefix!', 'endswith'));
  });

  it('honours wildcards inside contains values', () => {
    assert.ok(matches('a*c', 'xx a--c yy', 'contains'));
    assert.ok(matches('a?c', 'xx abc yy', 'contains'));
    assert.ok(!matches('a?c', 'xx ac yy', 'contains'));
  });

  it('an empty value matches the empty string for equals and everything for contains', () => {
    assert.ok(matches('', ''));
    assert.ok(!matches('', 'x'));
    assert.ok(matches('', 'anything', 'contains'));
    assert.ok(matches('', '', 'contains'));
  });

  it('a lone * matches everything including the empty string', () => {
    assert.ok(matches('*', ''));
    assert.ok(matches('*', 'abc'));
  });
});

describe('glob matching', () => {
  it('? matches exactly one character', () => {
    assert.ok(matches('prog?.exe', 'proga.exe'));
    assert.ok(!matches('prog?.exe', 'prog.exe'));
    assert.ok(!matches('prog?.exe', 'progab.exe'));
  });

  it('* matches any run including none', () => {
    assert.ok(matches('a*b*c', 'abc'));
    assert.ok(matches('a*b*c', 'aXXbYYc'));
    assert.ok(!matches('a*b*c', 'aXXbYY'));
  });

  it('backtracks to the last star when a later literal fails', () => {
    assert.ok(matches('*ab*ab*c', 'xabxabxabyc'));
    assert.ok(matches('*aab', 'aaab'));
    assert.ok(matches('a*a*a*b', 'aaaaaab'));
    assert.ok(!matches('a*a*a*b', 'aaaaaa'));
  });

  it('? counts a surrogate pair as one character', () => {
    assert.ok(matches('a?b', 'a\u{1F600}b'));
    assert.ok(!matches('a??b', 'a\u{1F600}b'));
  });

  it('respects case-sensitivity when asked to', () => {
    assert.ok(matches('ABC', 'abc'));
    assert.ok(!matches('ABC', 'abc', 'equals', true));
    assert.ok(matches('ABC', 'ABC', 'equals', true));
  });

  it('does not blow up on patterns that are exponential for backtracking regex engines', () => {
    const subject = 'a'.repeat(20_000);
    const test = compilePattern(parseWildcards('*a*a*a*a*a*a*a*a*b'), 'equals', false);
    const started = performance.now();
    assert.equal(test(subject), false);
    assert.ok(performance.now() - started < 2_000, 'wildcard matching should finish quickly');
  });

  it('stays fast on a long subject with many partial matches', () => {
    const subject = 'ab'.repeat(30_000) + 'xabc';
    const test = compilePattern(parseWildcards('*ab?ab*c'), 'equals', false);
    const started = performance.now();
    assert.equal(test(subject), true);
    assert.ok(performance.now() - started < 2_000);
  });
});
