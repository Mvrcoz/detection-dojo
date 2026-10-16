/**
 * validateKata checks that run the reference solution and the starter through
 * the grader, so they need the Sigma evaluator. Structural checks that do not
 * are in validate.test.ts.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateKata } from '../../src/kata/validate.ts';
import {
  VALID_KATA_DIR,
  copyValidKata,
  createSandbox,
  readKataFile,
  replaceInKataFile,
  writeKataFile,
} from './helpers/fixtures.ts';

const sandbox = createSandbox();

function freshKata(): string {
  return copyValidKata(sandbox.dir());
}

describe('validateKata: the valid fixture', () => {
  it('has no errors and no warnings', () => {
    assert.deepEqual(validateKata(VALID_KATA_DIR), { errors: [], warnings: [] });
  });
});

describe('validateKata: the reference solution', () => {
  it('must pass the thresholds', () => {
    const dir = freshKata();
    replaceInKataFile(dir, 'solution.yml', "CommandLine|contains: 'http'", "CommandLine|contains: 'matches-nothing'");
    const { errors } = validateKata(dir);
    assert.equal(errors.length, 1);
    assert.match(
      errors[0] ?? '',
      /^solution\.yml does not pass the thresholds: true-positive rate 0% is below the required 100% \(missed positive lines: 1, 2, 3\); caught 0 of 3 variants but 3 are required \(missed variant lines: 1, 2, 3\)$/,
    );
  });

  it('must not be too noisy', () => {
    const dir = freshKata();
    replaceInKataFile(dir, 'solution.yml', "  selection_url:\n    CommandLine|contains: 'http'\n", '');
    const { errors } = validateKata(dir);
    assert.equal(errors.length, 1);
    assert.match(
      errors[0] ?? '',
      /^solution\.yml does not pass the thresholds: false-positive rate 14\.3% is above the allowed 0% \(matched benign lines: 4\)$/,
    );
  });

  it('must compile', () => {
    const dir = freshKata();
    replaceInKataFile(dir, 'solution.yml', 'all of selection_*', 'selection_missing');
    const { errors } = validateKata(dir);
    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? '', /^solution\.yml does not compile: .*selection_missing/);
  });

  it('must be a rule this tool supports', () => {
    const dir = freshKata();
    replaceInKataFile(dir, 'solution.yml', 'condition: all of selection_*', 'condition: selection_image | count() > 3');
    assert.match(validateKata(dir).errors[0] ?? '', /^solution\.yml does not compile: /);
  });

  it('passes with advice when it meets the thresholds without catching everything', () => {
    const dir = freshKata();
    // Thresholds loose enough for a solution that misses a positive, a variant and matches a benign event.
    replaceInKataFile(dir, 'kata.yml', 'min_tpr: 1\n  max_fpr: 0\n  min_variants_caught: all', 'min_tpr: 0.6\n  max_fpr: 0.2\n  min_variants_caught: 2');
    replaceInKataFile(dir, 'solution.yml', "CommandLine|contains: 'http'", "CommandLine|contains: 'files.'");
    replaceInKataFile(dir, 'solution.yml', "      - '/urlcache'\n", '');
    replaceInKataFile(dir, 'solution.yml', "    CommandLine|contains:\n      - '-urlcache'", "    CommandLine|contains: '-urlcache'");
    replaceInKataFile(dir, 'events/benign.jsonl', 'notepad.exe C:', 'notepad.exe C:');
    const { errors, warnings } = validateKata(dir);
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 2, JSON.stringify(warnings));
    assert.match(warnings[0] ?? '', /^solution\.yml passes but misses positive events on lines 3;/);
    assert.match(warnings[1] ?? '', /^solution\.yml passes but misses variant events on lines 2;/);
  });

  it('warns when a passing solution still matches a benign event', () => {
    const dir = freshKata();
    replaceInKataFile(dir, 'kata.yml', 'max_fpr: 0', 'max_fpr: 0.2');
    replaceInKataFile(dir, 'solution.yml', "  selection_url:\n    CommandLine|contains: 'http'\n", '');
    const { errors, warnings } = validateKata(dir);
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /^solution\.yml passes but matches benign events on lines 4;/);
  });

  it('shows the compile warnings of the solution to its author', () => {
    const dir = freshKata();
    replaceInKataFile(dir, 'solution.yml', 'condition: all of selection_*', 'extra_selection:\n    Image: nothing\n  condition: all of selection_*');
    const { errors, warnings } = validateKata(dir);
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /^solution\.yml: unreferenced-selection: /);
  });
});

describe('validateKata: the starter of a write kata', () => {
  it('may be a skeleton that does not compile yet', () => {
    const dir = freshKata();
    writeKataFile(dir, 'starter.yml', 'title: Fill me in\ndetection: [unfinished\n');
    assert.deepEqual(validateKata(dir), { errors: [], warnings: [] });
  });

  it('may be a rule that compiles and fails', () => {
    // The fixture's own starter is exactly this case.
    assert.deepEqual(validateKata(VALID_KATA_DIR).errors, []);
  });

  it('must not already pass', () => {
    const dir = freshKata();
    writeKataFile(dir, 'starter.yml', readKataFile(dir, 'solution.yml'));
    assert.deepEqual(validateKata(dir).errors, [
      'starter.yml already passes all thresholds; the starter of a write kata must leave work to do',
    ]);
  });
});

describe('validateKata: the starter of a tune kata', () => {
  /** Catches every positive but is noisy and easy to evade. */
  const NOISY_STARTER = [
    'title: Noisy certutil',
    'logsource:',
    '  category: process_creation',
    '  product: windows',
    'detection:',
    '  selection:',
    "    Image|endswith: '\\certutil.exe'",
    "    CommandLine|contains: '-urlcache'",
    '  condition: selection',
    '',
  ].join('\n');

  function tuneKata(): string {
    const dir = freshKata();
    replaceInKataFile(dir, 'kata.yml', 'kind: write', 'kind: tune');
    return dir;
  }

  it('is accepted when it catches every positive but is noisy or evadable', () => {
    const dir = tuneKata();
    writeKataFile(dir, 'starter.yml', NOISY_STARTER);
    assert.deepEqual(validateKata(dir), { errors: [], warnings: [] });
  });

  it('must already match every positive event', () => {
    const dir = tuneKata(); // the fixture starter matches nothing
    assert.deepEqual(validateKata(dir).errors, [
      'starter.yml of a tune kata must already match every positive event, but it misses lines 1, 2, 3',
    ]);
  });

  it('must compile, because the learner is meant to fix a working rule', () => {
    const dir = tuneKata();
    writeKataFile(dir, 'starter.yml', 'title: broken\ndetection: [unfinished\n');
    const { errors } = validateKata(dir);
    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? '', /^starter\.yml of a tune kata must be a working but flawed rule, but it does not compile: /);
  });

  it('must not already pass', () => {
    const dir = tuneKata();
    writeKataFile(dir, 'starter.yml', readKataFile(dir, 'solution.yml'));
    assert.deepEqual(validateKata(dir).errors, [
      'starter.yml already passes all thresholds; the starter of a tune kata must produce false positives or miss variants',
    ]);
  });
});

describe('validateKata: ordering', () => {
  it('does not run the grader on a kata with structural errors', () => {
    const dir = freshKata();
    // The solution is broken too, but the missing explain.md is the only thing reported.
    replaceInKataFile(dir, 'solution.yml', 'all of selection_*', 'selection_missing');
    writeKataFile(dir, 'explain.md', '');
    assert.deepEqual(validateKata(dir).errors, ['explain.md is empty']);
  });
});
