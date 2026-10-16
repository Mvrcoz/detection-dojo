/**
 * gradeRule on real Sigma rules against the fixture kata. Needs the Sigma
 * evaluator; the grading arithmetic alone is covered by grade-counts.test.ts.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RuleParseError, UnsupportedFeatureError } from '../../src/errors.ts';
import { gradeRule } from '../../src/kata/grade.ts';
import { loadKataFromDir } from '../../src/kata/load.ts';
import { VALID_KATA_DIR } from './helpers/fixtures.ts';

const kata = loadKataFromDir(VALID_KATA_DIR);

/** Matches certutil and the cache switch but not a URL, the original file name or slash switches. */
const NAIVE_RULE = `
title: Naive certutil cache switch
logsource:
  category: process_creation
  product: windows
detection:
  selection:
    Image|endswith: '\\certutil.exe'
    CommandLine|contains: '-urlcache'
  condition: selection
`;

describe('gradeRule on the fixture kata', () => {
  it('passes the reference solution with a perfect score', () => {
    const result = gradeRule(kata, kata.solution);
    assert.equal(result.kataId, 'fixture-basic');
    assert.deepEqual([result.tp, result.fn, result.fp, result.tn], [3, 0, 0, 7]);
    assert.deepEqual([result.tpr, result.fpr, result.precision], [1, 0, 1]);
    assert.deepEqual([result.variantsCaught, result.variantsTotal], [3, 3]);
    assert.equal(result.passed, true);
    assert.deepEqual(result.failures, { missedPositives: [], falsePositives: [], missedVariants: [] });
    assert.deepEqual(result.warnings, []);
  });

  it('fails the starter skeleton because it matches nothing', () => {
    const result = gradeRule(kata, kata.starter);
    assert.deepEqual([result.tp, result.fn, result.fp, result.tn], [0, 3, 0, 7]);
    assert.equal(result.tpr, 0);
    assert.equal(result.precision, 0);
    assert.equal(result.passed, false);
    assert.deepEqual(result.checks, { tpr: false, fpr: true, variants: false });
    assert.deepEqual(result.failures.missedPositives.map((e) => e.line), [1, 2, 3]);
  });

  it('tells a noisy, evadable rule exactly what it got wrong', () => {
    const result = gradeRule(kata, NAIVE_RULE);
    assert.deepEqual([result.tp, result.fn, result.fp, result.tn], [3, 0, 1, 6]);
    assert.equal(result.fpr, 1 / 7);
    assert.equal(result.precision, 3 / 4);
    assert.equal(result.variantsCaught, 1);
    assert.equal(result.passed, false);
    assert.deepEqual(result.checks, { tpr: true, fpr: false, variants: false });

    const [falsePositive] = result.failures.falsePositives;
    assert.match(falsePositive?.event.CommandLine as string, /-urlcache \* delete/);
    assert.match(falsePositive?.note ?? '', /Clearing certutil's URL cache/);
    assert.deepEqual(result.failures.missedVariants.map((e) => e.technique), ['renamed binary', 'slash-style switches']);
  });

  it('never shows the rule the _dojo annotations', () => {
    const peekingRule = `
title: Peeks at annotations
logsource:
  product: windows
detection:
  selection:
    _dojo|exists: true
  condition: selection
`;
    const result = gradeRule(kata, peekingRule);
    assert.equal(result.tp + result.fp, 0);
  });

  it('does not change the kata it grades', () => {
    const before = structuredClone(kata);
    gradeRule(kata, kata.solution);
    gradeRule(kata, NAIVE_RULE);
    assert.deepEqual(kata, before);
  });

  it('is repeatable', () => {
    assert.deepEqual(gradeRule(kata, NAIVE_RULE), gradeRule(kata, NAIVE_RULE));
  });

  it('surfaces rule compile warnings to the learner', () => {
    const rule = kata.solution.replace(
      'condition: all of selection_*',
      'extra_selection:\n    Image: nothing\n  condition: all of selection_*',
    );
    const result = gradeRule(kata, rule);
    assert.equal(result.passed, true);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0] ?? '', /^unreferenced-selection: /);
  });
});

describe('gradeRule with rules that cannot be graded', () => {
  it('throws RuleParseError for text that is not a Sigma rule', () => {
    assert.throws(() => gradeRule(kata, 'just some words'), RuleParseError);
    assert.throws(() => gradeRule(kata, ''), RuleParseError);
    assert.throws(() => gradeRule(kata, 'title: no detection here\nlogsource:\n  product: windows\n'), RuleParseError);
  });

  it('throws RuleParseError when the condition names a selection that does not exist', () => {
    const rule = kata.solution.replace('all of selection_*', 'selection_missing');
    assert.throws(() => gradeRule(kata, rule), RuleParseError);
  });

  it('throws UnsupportedFeatureError for aggregations instead of guessing', () => {
    const rule = kata.solution.replace('condition: all of selection_*', 'condition: selection_image | count() > 3');
    assert.throws(() => gradeRule(kata, rule), UnsupportedFeatureError);
  });
});
