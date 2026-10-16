import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RuleParseError } from '../src/errors.ts';
import { WatchSession } from '../src/commands/watch.ts';
import type { GradeResult, Kata } from '../src/kata/types.ts';

const kata = {
  dir: '/katas/01-demo',
  meta: {
    number: 1,
    id: 'demo',
    title: 'Demo',
    tier: 1,
    kind: 'write',
    attack: ['T1059'],
    tags: [],
    logsource: {},
    scenario: 's',
    objective: 'o',
    hints: ['first hint', 'second hint', 'third hint'],
    thresholds: { min_tpr: 1, max_fpr: 0, min_variants_caught: 0 },
    estimated_minutes: 5,
    author: 'a',
  },
  positives: [],
  benign: [],
  variants: [],
  starter: '',
  solution: '',
  explain: 'Because.',
} satisfies Kata;

function result(passed: boolean): GradeResult {
  return {
    kataId: 'demo',
    tp: passed ? 1 : 0,
    fn: passed ? 0 : 1,
    fp: 0,
    tn: 1,
    tpr: passed ? 1 : 0,
    fpr: 0,
    precision: passed ? 1 : 0,
    variantsCaught: 0,
    variantsTotal: 0,
    passed,
    checks: { tpr: passed, fpr: true, variants: true },
    failures: { missedPositives: [], falsePositives: [], missedVariants: [] },
    warnings: [],
  };
}

function session(outcomes: Array<GradeResult | Error>) {
  const queue = [...outcomes];
  const recorded: GradeResult[] = [];
  const instance = new WatchSession(kata, {
    readRule: () => 'rule',
    grade: async () => {
      const next = queue.shift();
      if (next === undefined) throw new Error('test ran out of outcomes');
      if (next instanceof Error) throw next;
      return next;
    },
    record: (r) => {
      recorded.push(r);
      return { attempts: recorded.length, next: undefined };
    },
  });
  return { instance, recorded };
}

describe('WatchSession', () => {
  it('shows no hint after the first failure', async () => {
    const { instance } = session([result(false)]);
    const { output, passed } = await instance.runOnce();
    assert.equal(passed, false);
    assert.doesNotMatch(output, /first hint/);
  });

  it('reveals hint 1 on the second consecutive failure and hint 2 on the third', async () => {
    const { instance } = session([result(false), result(false), result(false)]);
    await instance.runOnce();
    const second = await instance.runOnce();
    assert.match(second.output, /first hint/);
    assert.doesNotMatch(second.output, /second hint/);
    const third = await instance.runOnce();
    assert.match(third.output, /second hint/);
  });

  it('never reveals more hints than the kata has', async () => {
    const { instance } = session(Array.from({ length: 8 }, () => result(false)));
    let last = { output: '', passed: false };
    for (let i = 0; i < 8; i += 1) last = await instance.runOnce();
    assert.match(last.output, /third hint/);
    assert.doesNotMatch(last.output, /fourth/);
  });

  it('resets the failure streak after a pass and shows the write-up', async () => {
    const { instance } = session([result(false), result(false), result(true), result(false), result(false)]);
    await instance.runOnce();
    await instance.runOnce();
    const passed = await instance.runOnce();
    assert.equal(passed.passed, true);
    assert.match(passed.output, /Because\./);
    assert.equal(instance.consecutiveFailures, 0);
    await instance.runOnce();
    const again = await instance.runOnce();
    assert.match(again.output, /first hint/);
    assert.doesNotMatch(again.output, /second hint/);
  });

  it('treats a rule that cannot be graded as a failing run and keeps going', async () => {
    const { instance, recorded } = session([new RuleParseError('Selection missing.'), new RuleParseError('Still broken.')]);
    const first = await instance.runOnce();
    assert.match(first.output, /could not be graded/);
    assert.match(first.output, /Selection missing\./);
    const second = await instance.runOnce();
    assert.match(second.output, /first hint/);
    assert.equal(recorded.length, 0);
  });

  it('lets unexpected errors escape instead of hiding bugs', async () => {
    const { instance } = session([new TypeError('bug')]);
    await assert.rejects(() => instance.runOnce(), TypeError);
  });
});
