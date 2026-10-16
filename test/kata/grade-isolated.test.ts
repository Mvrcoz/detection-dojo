/**
 * gradeRuleIsolated: grading in a worker thread with a timeout. The timeout and
 * error-transport tests need the Sigma evaluator inside the worker.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GradeTimeoutError, RuleParseError, UnsupportedFeatureError } from '../../src/errors.ts';
import { gradeRule } from '../../src/kata/grade.ts';
import { gradeRuleIsolated } from '../../src/kata/isolated.ts';
import { loadKataFromDir } from '../../src/kata/load.ts';
import type { Kata } from '../../src/kata/types.ts';
import { VALID_KATA_DIR } from './helpers/fixtures.ts';

const kata = loadKataFromDir(VALID_KATA_DIR);

/** A regular expression with exponential backtracking on the event below. */
const REDOS_RULE = `
title: Catastrophic backtracking
logsource:
  product: test
detection:
  selection:
    Data|re: '(a+)+$'
  condition: selection
`;

function redosKata(): Kata {
  return { ...kata, positives: [{ event: { Data: `${'a'.repeat(48)}!` }, line: 1 }], benign: [], variants: [] };
}

describe('gradeRuleIsolated', () => {
  it('returns the same result as grading in-process', async () => {
    const isolated = await gradeRuleIsolated(kata, kata.solution);
    assert.deepEqual(isolated, gradeRule(kata, kata.solution));
    assert.equal(isolated.passed, true);
  });

  it('returns the full failure details across the thread boundary', async () => {
    const isolated = await gradeRuleIsolated(kata, kata.starter);
    assert.deepEqual(isolated, gradeRule(kata, kata.starter));
    assert.equal(isolated.failures.missedPositives.length, 3);
    assert.equal(isolated.failures.missedPositives[0]?.line, 1);
  });

  it('can run several gradings at once', async () => {
    const results = await Promise.all([
      gradeRuleIsolated(kata, kata.solution),
      gradeRuleIsolated(kata, kata.starter),
      gradeRuleIsolated(kata, kata.solution),
    ]);
    assert.deepEqual(results.map((r) => r.passed), [true, false, true]);
  });

  it('rethrows a RuleParseError as a RuleParseError with its message and path', async () => {
    let inProcess: unknown;
    try {
      gradeRule(kata, 'title: no detection\nlogsource:\n  product: windows\n');
    } catch (err) {
      inProcess = err;
    }
    assert.ok(inProcess instanceof RuleParseError);

    await assert.rejects(gradeRuleIsolated(kata, 'title: no detection\nlogsource:\n  product: windows\n'), (err: unknown) => {
      assert.ok(err instanceof RuleParseError);
      assert.equal(err.message, (inProcess as RuleParseError).message);
      assert.equal(err.path, (inProcess as RuleParseError).path);
      assert.equal(err.code, 'RULE_PARSE');
      return true;
    });
  });

  it('rethrows an UnsupportedFeatureError as an UnsupportedFeatureError', async () => {
    const rule = kata.solution.replace('condition: all of selection_*', 'condition: selection_image | count() > 3');
    await assert.rejects(gradeRuleIsolated(kata, rule), (err: unknown) => {
      assert.ok(err instanceof UnsupportedFeatureError);
      assert.ok(err.feature.length > 0);
      return true;
    });
  });

  it('stops a rule that runs too long and throws GradeTimeoutError', async () => {
    const started = Date.now();
    await assert.rejects(gradeRuleIsolated(redosKata(), REDOS_RULE, { timeoutMs: 400 }), (err: unknown) => {
      assert.ok(err instanceof GradeTimeoutError);
      assert.match(err.message, /took longer than 400 ms/);
      assert.equal(err.code, 'GRADE_TIMEOUT');
      return true;
    });
    assert.ok(Date.now() - started < 4000, 'the worker was terminated rather than waited for');
  });

  it('times out even when the deadline passes before the worker has started', async () => {
    await assert.rejects(gradeRuleIsolated(kata, kata.solution, { timeoutMs: 1 }), GradeTimeoutError);
  });

  it('keeps working after a timeout', async () => {
    await assert.rejects(gradeRuleIsolated(redosKata(), REDOS_RULE, { timeoutMs: 300 }), GradeTimeoutError);
    assert.equal((await gradeRuleIsolated(kata, kata.solution)).passed, true);
  });

  it('rejects a timeout that is not a positive number', async () => {
    for (const timeoutMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assert.rejects(gradeRuleIsolated(kata, kata.solution, { timeoutMs }), RangeError, String(timeoutMs));
    }
  });
});
