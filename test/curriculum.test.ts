/**
 * Guards the bundled curriculum: every kata must be valid, its reference
 * solution must pass, and its starter must not. A contributor who breaks a
 * kata (or the grader) finds out here instead of in a learner's terminal.
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { gradeRule, katasRoot, listKatas, loadKata, validateKata } from '../src/kata/index.ts';

const katas = listKatas(join(import.meta.dirname, '..', 'katas'));

describe('bundled curriculum', () => {
  it('ships a complete, ordered, three-tier curriculum', () => {
    assert.ok(katas.length >= 15, `expected at least 15 katas, found ${katas.length}`);
    assert.deepEqual(
      katas.map((k) => k.number),
      katas.map((_, i) => i + 1),
      'kata numbers must be 1..N with no gaps',
    );
    assert.equal(new Set(katas.map((k) => k.id)).size, katas.length, 'ids must be unique');
    for (const tier of [1, 2, 3]) assert.ok(katas.some((k) => k.tier === tier), `no kata in tier ${tier}`);
    assert.ok(katas.some((k) => k.kind === 'tune'), 'the curriculum should include at least one tuning kata');
    const tiers = katas.map((k) => k.tier);
    assert.deepEqual(tiers, [...tiers].sort(), 'tiers must not go backwards');
  });

  it('is the folder the CLI uses by default', () => {
    assert.equal(katasRoot(), join(import.meta.dirname, '..', 'katas'));
  });

  for (const summary of katas) {
    describe(`${String(summary.number).padStart(2, '0')} ${summary.id}`, () => {
      const dir = join(import.meta.dirname, '..', 'katas', summary.dirName);

      it('passes validate-kata with no errors', () => {
        const { errors } = validateKata(dir);
        assert.deepEqual(errors, []);
      });

      it('is solved by its reference solution', () => {
        const kata = loadKata(summary.dirName, join(dir, '..'));
        const result = gradeRule(kata, kata.solution);
        assert.equal(result.passed, true, JSON.stringify(result.checks));
      });

      it('is not solved by its starter rule', () => {
        const kata = loadKata(summary.dirName, join(dir, '..'));
        assert.equal(gradeRule(kata, kata.starter).passed, false);
      });

      it('explains every benign and variant event it asks the learner to reason about', () => {
        const kata = loadKata(summary.dirName, join(dir, '..'));
        for (const benign of kata.benign) assert.ok(benign.note, `benign line ${benign.line} has no note`);
        for (const variant of kata.variants) assert.ok(variant.technique, `variant line ${variant.line} has no technique`);
        for (const positive of kata.positives) assert.ok(positive.note, `positive line ${positive.line} has no note`);
      });
    });
  }
});
