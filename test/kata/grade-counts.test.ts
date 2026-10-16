/**
 * The grading arithmetic, exercised through a stub matcher so it does not depend
 * on the Sigma evaluator. Rule-level behaviour (real YAML rules) is in grade.test.ts.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gradeCompiledRule } from '../../src/kata/grade.ts';
import type { KataThresholds } from '../../src/kata/types.ts';
import { stubRule, syntheticKata } from './helpers/fixtures.ts';

/** `caught` events that the stub matches followed by `total - caught` that it misses. */
function flags(caught: number, total: number): boolean[] {
  return Array.from({ length: total }, (_, i) => i < caught);
}

function thresholds(overrides: Partial<KataThresholds>): KataThresholds {
  return { min_tpr: 1, max_fpr: 0, min_variants_caught: 0, ...overrides };
}

describe('gradeCompiledRule: counts and rates', () => {
  it('counts each outcome and computes the rates', () => {
    const kata = syntheticKata({
      positives: [true, true, true, false],
      benign: [true, false, false, false, false],
      variants: [true, false, true],
    });
    const result = gradeCompiledRule(kata, stubRule());
    assert.equal(result.kataId, 'synthetic');
    assert.deepEqual([result.tp, result.fn, result.fp, result.tn], [3, 1, 1, 4]);
    assert.equal(result.tpr, 3 / 4);
    assert.equal(result.fpr, 1 / 5);
    assert.equal(result.precision, 3 / 4);
    assert.deepEqual([result.variantsCaught, result.variantsTotal], [2, 3]);
  });

  it('reports a perfect score', () => {
    const kata = syntheticKata({ positives: [true, true], benign: [false, false, false], variants: [true] });
    const result = gradeCompiledRule(kata, stubRule());
    assert.deepEqual([result.tpr, result.fpr, result.precision], [1, 0, 1]);
    assert.deepEqual(result.checks, { tpr: true, fpr: true, variants: true });
    assert.equal(result.passed, true);
  });

  it('defines tpr as 1 without positives and fpr as 0 without benign events', () => {
    const result = gradeCompiledRule(syntheticKata({}), stubRule());
    assert.equal(result.tpr, 1);
    assert.equal(result.fpr, 0);
    assert.equal(result.precision, 0);
    assert.equal(result.passed, true);
  });

  it('defines precision as 0 when the rule matched nothing', () => {
    const result = gradeCompiledRule(syntheticKata({ positives: [false, false], benign: [false] }), stubRule());
    assert.equal(result.precision, 0);
    assert.equal(result.tpr, 0);
    assert.equal(result.passed, false);
  });

  it('computes precision from matches on positives and benign events only', () => {
    const kata = syntheticKata({ positives: [true, true, false], benign: [true, true], variants: [true, true, true] });
    assert.equal(gradeCompiledRule(kata, stubRule()).precision, 2 / 4);
  });

  it('lists the events behind each failure, with their lines', () => {
    const kata = syntheticKata({
      positives: [true, false, false],
      benign: [false, true, false, true],
      variants: [false, true, false],
    });
    const { failures } = gradeCompiledRule(kata, stubRule());
    assert.deepEqual(failures.missedPositives.map((e) => e.line), [2, 3]);
    assert.deepEqual(failures.falsePositives.map((e) => e.line), [2, 4]);
    assert.deepEqual(failures.missedVariants.map((e) => e.line), [1, 3]);
    assert.equal(failures.missedPositives[0], kata.positives[1], 'the labeled event itself is returned, notes included');
  });

  it('is deterministic: the same inputs give an equal result', () => {
    const kata = syntheticKata({ positives: [true, false], benign: [true], variants: [true] });
    assert.deepEqual(gradeCompiledRule(kata, stubRule()), gradeCompiledRule(kata, stubRule()));
  });
});

describe('gradeCompiledRule: thresholds', () => {
  // Cases chosen so that multiplying the threshold by the total would round the wrong way
  // (0.7 * 10 === 7.000000000000001, 0.57 * 100 === 56.99999999999999).
  const exactlyOnTheLine: Array<[number, number, number]> = [
    [7, 10, 0.7],
    [4, 5, 0.8],
    [9, 10, 0.9],
    [3, 10, 0.3],
    [57, 100, 0.57],
    [1, 3, 1 / 3],
    [2, 3, 2 / 3],
    [27, 30, 0.9],
  ];

  for (const [caught, total, minimum] of exactlyOnTheLine) {
    it(`passes tpr when ${caught}/${total} meets min_tpr ${minimum} exactly`, () => {
      const kata = syntheticKata({ positives: flags(caught, total) }, { thresholds: thresholds({ min_tpr: minimum }) });
      const result = gradeCompiledRule(kata, stubRule());
      assert.equal(result.checks.tpr, true);
    });

    it(`fails tpr when one fewer than ${caught}/${total} is caught against min_tpr ${minimum}`, () => {
      const kata = syntheticKata({ positives: flags(caught - 1, total) }, { thresholds: thresholds({ min_tpr: minimum }) });
      assert.equal(gradeCompiledRule(kata, stubRule()).checks.tpr, false);
    });
  }

  const falsePositiveLine: Array<[number, number, number]> = [
    [1, 10, 0.1],
    [3, 10, 0.3],
    [57, 100, 0.57],
    [1, 3, 1 / 3],
    [7, 10, 0.7],
  ];

  for (const [falsePositives, total, maximum] of falsePositiveLine) {
    it(`passes fpr when ${falsePositives}/${total} equals max_fpr ${maximum} exactly`, () => {
      const kata = syntheticKata({ benign: flags(falsePositives, total) }, { thresholds: thresholds({ max_fpr: maximum }) });
      assert.equal(gradeCompiledRule(kata, stubRule()).checks.fpr, true);
    });

    it(`fails fpr when one more than ${falsePositives}/${total} is matched against max_fpr ${maximum}`, () => {
      const kata = syntheticKata({ benign: flags(falsePositives + 1, total) }, { thresholds: thresholds({ max_fpr: maximum }) });
      assert.equal(gradeCompiledRule(kata, stubRule()).checks.fpr, false);
    });
  }

  it('requires every positive with the default min_tpr of 1', () => {
    const kata = syntheticKata({ positives: flags(9, 10) });
    assert.equal(gradeCompiledRule(kata, stubRule()).checks.tpr, false);
  });

  it('allows no false positives with the default max_fpr of 0', () => {
    const kata = syntheticKata({ benign: flags(1, 50) });
    assert.equal(gradeCompiledRule(kata, stubRule()).checks.fpr, false);
  });

  it('treats "all" as every variant in the kata', () => {
    const all = thresholds({ min_variants_caught: 'all' });
    assert.equal(gradeCompiledRule(syntheticKata({ variants: flags(3, 3) }, { thresholds: all }), stubRule()).checks.variants, true);
    assert.equal(gradeCompiledRule(syntheticKata({ variants: flags(2, 3) }, { thresholds: all }), stubRule()).checks.variants, false);
    assert.equal(gradeCompiledRule(syntheticKata({}, { thresholds: all }), stubRule()).checks.variants, true, 'no variants, nothing to catch');
  });

  it('compares a numeric variants threshold with the number caught', () => {
    const two = thresholds({ min_variants_caught: 2 });
    assert.equal(gradeCompiledRule(syntheticKata({ variants: flags(2, 5) }, { thresholds: two }), stubRule()).checks.variants, true);
    assert.equal(gradeCompiledRule(syntheticKata({ variants: flags(1, 5) }, { thresholds: two }), stubRule()).checks.variants, false);
  });

  it('does not require variants by default', () => {
    assert.equal(gradeCompiledRule(syntheticKata({ variants: flags(0, 4) }), stubRule()).checks.variants, true);
  });

  it('passes only when all three checks pass', () => {
    const base = { positives: flags(2, 2), benign: flags(0, 3), variants: flags(1, 1) };
    const kata = (shape: typeof base) => syntheticKata(shape, { thresholds: thresholds({ min_variants_caught: 'all' }) });

    assert.equal(gradeCompiledRule(kata(base), stubRule()).passed, true);
    assert.equal(gradeCompiledRule(kata({ ...base, positives: flags(1, 2) }), stubRule()).passed, false);
    assert.equal(gradeCompiledRule(kata({ ...base, benign: flags(1, 3) }), stubRule()).passed, false);
    assert.equal(gradeCompiledRule(kata({ ...base, variants: flags(0, 1) }), stubRule()).passed, false);
  });

  it('reports which individual checks failed', () => {
    const kata = syntheticKata(
      { positives: flags(2, 2), benign: flags(1, 3), variants: flags(0, 2) },
      { thresholds: thresholds({ min_variants_caught: 1 }) },
    );
    assert.deepEqual(gradeCompiledRule(kata, stubRule()).checks, { tpr: true, fpr: false, variants: false });
  });
});

describe('gradeCompiledRule: warnings and robustness', () => {
  it('passes the rule compile warnings through', () => {
    const warnings = ['unreferenced-selection: selection "filter" is never used by the condition'];
    const result = gradeCompiledRule(syntheticKata({ positives: [true] }), stubRule({ warnings }));
    assert.deepEqual(result.warnings, warnings);
  });

  it('does not modify the rule warnings array', () => {
    const warnings = ['unreferenced-selection: x'];
    const rule = stubRule({ warnings, throwOnLine: () => true });
    gradeCompiledRule(syntheticKata({ positives: [true] }), rule);
    assert.deepEqual(warnings, ['unreferenced-selection: x']);
  });

  it('counts an event the rule throws on as not matched and warns about it', () => {
    const kata = syntheticKata({ positives: [true, true], benign: [true, true] });
    const result = gradeCompiledRule(kata, stubRule({ throwOnLine: (line) => line === 2 }));
    assert.deepEqual([result.tp, result.fn, result.fp, result.tn], [1, 1, 1, 1]);
    assert.equal(result.warnings.length, 2);
    assert.match(result.warnings[0] ?? '', /^match-error: the rule threw while checking the positive event on line 2 \(stub failure\); it was counted as not matched$/);
    assert.match(result.warnings[1] ?? '', /benign event on line 2/);
  });

  it('lists the first few throwing events and summarises the rest', () => {
    const kata = syntheticKata({ positives: flags(8, 8) });
    const result = gradeCompiledRule(kata, stubRule({ throwOnLine: () => true }));
    assert.equal(result.tp, 0);
    assert.equal(result.warnings.length, 6);
    assert.equal(result.warnings[5], 'match-error: 3 more events made the rule throw and were counted as not matched');
  });

  it('still grades the remaining events after one throws', () => {
    const kata = syntheticKata({ positives: [true, true, true] });
    const result = gradeCompiledRule(kata, stubRule({ throwOnLine: (line) => line === 1 }));
    assert.equal(result.tp, 2);
  });
});
