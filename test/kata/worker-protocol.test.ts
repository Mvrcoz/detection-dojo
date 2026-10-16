import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DojoError, GradeTimeoutError, KataFormatError, RuleParseError, UnsupportedFeatureError } from '../../src/errors.ts';
import { fromWireError, toWireError } from '../../src/kata/worker-protocol.ts';

/** What actually happens to the error in a worker: it is cloned across a thread boundary as plain data. */
function crossTheBoundary(err: unknown): Error {
  return fromWireError(structuredClone(toWireError(err)));
}

describe('worker error transport', () => {
  it('rebuilds a RuleParseError with its path', () => {
    const error = crossTheBoundary(new RuleParseError('condition names an unknown selection', 'detection.condition'));
    assert.ok(error instanceof RuleParseError);
    assert.equal(error.message, 'condition names an unknown selection');
    assert.equal(error.path, 'detection.condition');
    assert.equal(error.code, 'RULE_PARSE');
    assert.equal(error.name, 'RuleParseError');
  });

  it('rebuilds a RuleParseError that has no path', () => {
    const error = crossTheBoundary(new RuleParseError('not YAML'));
    assert.ok(error instanceof RuleParseError);
    assert.equal(error.path, undefined);
  });

  it('rebuilds an UnsupportedFeatureError with its feature', () => {
    const error = crossTheBoundary(new UnsupportedFeatureError('aggregation', 'aggregations need a SIEM'));
    assert.ok(error instanceof UnsupportedFeatureError);
    assert.equal(error.feature, 'aggregation');
    assert.equal(error.message, 'aggregations need a SIEM');
    assert.equal(error.code, 'UNSUPPORTED_FEATURE');
  });

  it('rebuilds a KataFormatError', () => {
    const error = crossTheBoundary(new KataFormatError('bad kata'));
    assert.ok(error instanceof KataFormatError);
    assert.equal(error.message, 'bad kata');
  });

  it('keeps the code of a DojoError subclass it does not know how to rebuild exactly', () => {
    const error = crossTheBoundary(new GradeTimeoutError(5));
    assert.ok(error instanceof DojoError);
    assert.equal((error as DojoError).code, 'GRADE_TIMEOUT');
    assert.match(error.message, /took longer than 5 ms/);
  });

  it('returns other errors as plain Errors carrying the original stack', () => {
    const original = new TypeError('boom');
    const error = crossTheBoundary(original);
    assert.equal(error instanceof DojoError, false);
    assert.equal(error.message, 'boom');
    assert.equal(error.stack, original.stack);
  });

  it('copes with a thrown value that is not an Error', () => {
    assert.equal(crossTheBoundary('just a string').message, 'just a string');
    assert.equal(crossTheBoundary(undefined).message, 'undefined');
  });
});
