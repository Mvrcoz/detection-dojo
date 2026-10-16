/**
 * Structural validation: one deliberately broken kata per defect, generated into
 * a temp folder from the valid fixture. None of these reach the grader, so they
 * run without the Sigma evaluator; checks that run the solution and starter are
 * in grade-validate.test.ts.
 */

import assert from 'node:assert/strict';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { validateKata } from '../../src/kata/validate.ts';
import {
  appendEventLines,
  copyValidKata,
  createSandbox,
  readKataFile,
  replaceInKataFile,
  writeKataFile,
} from './helpers/fixtures.ts';

const sandbox = createSandbox();

interface Defect {
  name: string;
  /** Build a broken kata inside `parent` and return its folder. */
  build(parent: string): string;
  /** The single error the defect must produce. */
  expect: RegExp;
}

/** A defect made by editing a fresh copy of the valid fixture. */
function edit(name: string, expectedError: RegExp, change: (dir: string) => void): Defect {
  return {
    name,
    expect: expectedError,
    build(parent) {
      const dir = copyValidKata(parent);
      change(dir);
      return dir;
    },
  };
}

/** Keep only the first `count` lines of an events file. */
function truncateEvents(dir: string, file: string, count: number): void {
  const kept = readKataFile(dir, `events/${file}`).split('\n').slice(0, count);
  writeKataFile(dir, `events/${file}`, `${kept.join('\n')}\n`);
}

const DEFECTS: Defect[] = [
  edit('a slug with capitals and an underscore as the id', /kata\.yml: "id" must be a lowercase slug/, (dir) =>
    replaceInKataFile(dir, 'kata.yml', 'id: fixture-basic', 'id: Bad_Slug'),
  ),
  {
    name: 'a folder name that does not match number and id',
    expect: /the folder is named "02-fixture-basic" but kata\.yml says number 1 and id "fixture-basic"/,
    build(parent) {
      const dir = copyValidKata(parent);
      const renamed = path.join(parent, '02-fixture-basic');
      renameSync(dir, renamed);
      return renamed;
    },
  },
  edit('an unknown key in kata.yml', /kata\.yml: unknown key "hint" \(did you mean "hints"\?\)/, (dir) =>
    replaceInKataFile(dir, 'kata.yml', 'author: detection-dojo fixtures', 'author: someone\nhint: a typo'),
  ),
  edit('a duplicated key in kata.yml', /kata\.yml: Map keys must be unique/, (dir) =>
    replaceInKataFile(dir, 'kata.yml', 'tier: 1', 'tier: 1\ntier: 2'),
  ),
  edit('a missing required key', /kata\.yml: missing required key "objective"/, (dir) =>
    replaceInKataFile(dir, 'kata.yml', /objective: >-[\s\S]*?\nhints:/.exec(readKataFile(dir, 'kata.yml'))?.[0] ?? '', 'hints:'),
  ),
  edit('a threshold outside 0..1', /kata\.yml: "thresholds\.min_tpr" must be a number from 0 to 1/, (dir) =>
    replaceInKataFile(dir, 'kata.yml', 'min_tpr: 1', 'min_tpr: 1.5'),
  ),
  edit('an ATT&CK id in the wrong format', /kata\.yml: "attack\[0\]" must be a MITRE ATT&CK technique id/, (dir) =>
    replaceInKataFile(dir, 'kata.yml', '  - T1105', '  - attack.t1105'),
  ),
  edit('only one hint', /kata\.yml: "hints" needs 2 to 4 entries, gentlest first \(found 1\)/, (dir) => {
    const text = readKataFile(dir, 'kata.yml');
    writeKataFile(dir, 'kata.yml', text.replace(/hints:\n(  - .*\n){3}/, 'hints:\n  - only one\n'));
  }),
  edit('five hints', /kata\.yml: "hints" needs 2 to 4 entries, gentlest first \(found 5\)/, (dir) => {
    const text = readKataFile(dir, 'kata.yml');
    writeKataFile(dir, 'kata.yml', text.replace(/hints:\n(  - .*\n){3}/, 'hints:\n  - a\n  - b\n  - c\n  - d\n  - e\n'));
  }),
  edit('an oversized kata.yml', /kata\.yml is .*, over the 64\.0 KiB limit/, (dir) =>
    writeKataFile(dir, 'kata.yml', `${readKataFile(dir, 'kata.yml')}# ${'x'.repeat(70 * 1024)}\n`),
  ),
  edit('a missing solution file', /^solution\.yml is missing$/, (dir) => rmSync(path.join(dir, 'solution.yml'))),
  edit('a missing events folder', /^events\/ is missing$/, (dir) => rmSync(path.join(dir, 'events'), { recursive: true })),
  edit('a missing required events file', /^events\/positive\.jsonl is missing$/, (dir) =>
    rmSync(path.join(dir, 'events', 'positive.jsonl')),
  ),
  edit('an events file over the size limit', /^events\/benign\.jsonl is 3\.0 MiB, over the 2\.0 MiB limit; remove content you do not need$/, (dir) =>
    writeKataFile(dir, 'events/benign.jsonl', Buffer.alloc(3 * 1024 * 1024, 10)),
  ),
  edit('more events than the per-file limit', /^events\/variants\.jsonl has 501 events; the limit is 500 per file/, (dir) =>
    writeKataFile(dir, 'events/variants.jsonl', `${'{"a":1}\n'.repeat(501)}`),
  ),
  edit('a single event over the size limit', /^events\/positive\.jsonl line 4: the event is 100\.0 KiB, over the 64\.0 KiB limit per event$/, (dir) =>
    appendEventLines(dir, 'positive.jsonl', `{"CommandLine":"${'a'.repeat(100 * 1024 - 20)}"}`),
  ),
  edit('a line that is not valid JSON', /^events\/positive\.jsonl line 4: not valid JSON/, (dir) =>
    appendEventLines(dir, 'positive.jsonl', '{"CommandLine": "unterminated'),
  ),
  edit('a line that is a JSON array', /^events\/benign\.jsonl line 8: each line must be a JSON object, but this one is a list$/, (dir) =>
    appendEventLines(dir, 'benign.jsonl', '["not","an","object"]'),
  ),
  edit('a _dojo annotation with a misspelt key', /^events\/variants\.jsonl line 4: "_dojo" has an unknown key "notes"/, (dir) =>
    appendEventLines(dir, 'variants.jsonl', '{"Image":"x.exe","_dojo":{"notes":"typo"}}'),
  ),
  edit('a file that is not UTF-8', /^explain\.md is not valid UTF-8 text$/, (dir) =>
    writeKataFile(dir, 'explain.md', Buffer.from([0x23, 0xff, 0xfe])),
  ),
  edit('fewer than three positive events', /^events\/positive\.jsonl has 2 events; a kata needs at least 3 events the rule must match$/, (dir) =>
    truncateEvents(dir, 'positive.jsonl', 2),
  ),
  edit('fewer than six benign events', /^events\/benign\.jsonl has 5 events; a kata needs at least 6 look-alikes the rule must not match$/, (dir) =>
    truncateEvents(dir, 'benign.jsonl', 5),
  ),
  edit('a tier 2 kata without evasion variants', /^events\/variants\.jsonl has 0 events; tier 2 katas need at least 3 evasion variants$/, (dir) => {
    replaceInKataFile(dir, 'kata.yml', 'tier: 1', 'tier: 2');
    rmSync(path.join(dir, 'events', 'variants.jsonl'));
  }),
  edit('a variants threshold nobody can reach', /^kata\.yml: thresholds\.min_variants_caught is 4 but events\/variants\.jsonl has only 3 events, so no rule could pass$/, (dir) =>
    replaceInKataFile(dir, 'kata.yml', 'min_variants_caught: all', 'min_variants_caught: 4'),
  ),
  edit('the same event labeled as positive and benign', /^the benign event on line 1 is identical to the positive event on line 4; one event cannot be both a match and a non-match$/, (dir) => {
    const firstBenign = readKataFile(dir, 'events/benign.jsonl').split('\n')[0] ?? '';
    appendEventLines(dir, 'positive.jsonl', firstBenign);
  }),
  edit('the same event with its keys in another order', /is identical to the positive event on line 1/, (dir) => {
    appendEventLines(dir, 'variants.jsonl', '{"CommandLine":"x","Image":"y"}');
    writeKataFile(dir, 'events/positive.jsonl', `{"Image":"y","CommandLine":"x"}\n${readKataFile(dir, 'events/positive.jsonl')}`);
  }),
  edit('an empty explain.md', /^explain\.md is empty$/, (dir) => writeKataFile(dir, 'explain.md', '  \n')),
  edit('an empty starter.yml', /^starter\.yml is empty$/, (dir) => writeKataFile(dir, 'starter.yml', '')),
];

describe('validateKata: structural defects', () => {
  for (const defect of DEFECTS) {
    it(`reports ${defect.name}`, () => {
      const { errors } = validateKata(defect.build(sandbox.dir()));
      assert.equal(errors.length, 1, `expected exactly one error, got: ${JSON.stringify(errors)}`);
      assert.match(errors[0] ?? '', defect.expect);
    });
  }

  it('reports every defect of a kata with several, in one pass', () => {
    const dir = copyValidKata(sandbox.dir());
    rmSync(path.join(dir, 'explain.md'));
    replaceInKataFile(dir, 'kata.yml', 'tier: 1', 'tier: 7');
    appendEventLines(dir, 'positive.jsonl', 'garbage');
    assert.equal(validateKata(dir).errors.length, 3);
  });

  it('reports a folder that does not exist instead of throwing', () => {
    const { errors } = validateKata(path.join(sandbox.dir(), 'nowhere'));
    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? '', /does not exist or cannot be read/);
  });

  it('reports a path that is a file instead of a folder', () => {
    const file = path.join(sandbox.dir(), 'plain.txt');
    writeFileSync(file, 'x');
    assert.match(validateKata(file).errors[0] ?? '', /is not a folder/);
  });

  it('reports a folder with nothing in it', () => {
    const empty = path.join(sandbox.dir(), '01-empty');
    mkdirSync(empty);
    const { errors } = validateKata(empty);
    assert.ok(errors.includes('kata.yml is missing'));
    assert.ok(errors.includes('solution.yml is missing'));
    assert.ok(errors.includes('events/ is missing'));
  });
});

describe('validateKata: warnings', () => {
  it('warns about files that are not part of the format, but ignores dotfiles', () => {
    const dir = copyValidKata(sandbox.dir());
    rmSync(path.join(dir, 'explain.md')); // keeps the grader out of this test
    writeKataFile(dir, 'notes.txt', 'scratch');
    writeKataFile(dir, '.gitkeep', '');
    writeKataFile(dir, 'events/extra.jsonl', '{}\n');
    const { warnings } = validateKata(dir);
    assert.deepEqual(warnings, [
      'events/extra.jsonl is not part of the kata format and is ignored',
      'notes.txt is not part of the kata format and is ignored',
    ]);
  });

  it('warns about benign events that lack a note and variants that lack a technique', () => {
    const dir = copyValidKata(sandbox.dir());
    truncateEvents(dir, 'positive.jsonl', 2); // keeps the grader out of this test
    writeKataFile(
      dir,
      'events/benign.jsonl',
      `${[1, 2, 3, 4, 5, 6].map((n) => (n % 2 === 0 ? `{"n":${n}}` : `{"n":${n},"_dojo":{"note":"ok"}}`)).join('\n')}\n`,
    );
    writeKataFile(dir, 'events/variants.jsonl', '{"v":1}\n{"v":2,"_dojo":{"technique":"t"}}\n{"v":3}\n');
    const { warnings } = validateKata(dir);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0] ?? '', /^events\/benign\.jsonl lines 2, 4, 6 have no "_dojo": \{"note": \.\.\.\}/);
    assert.match(warnings[1] ?? '', /^events\/variants\.jsonl lines 1, 3 have no "_dojo": \{"technique": \.\.\.\}/);
  });

  it('warns about an event repeated within one class', () => {
    const dir = copyValidKata(sandbox.dir());
    truncateEvents(dir, 'benign.jsonl', 5); // keeps the grader out of this test
    appendEventLines(dir, 'positive.jsonl', readKataFile(dir, 'events/positive.jsonl').split('\n')[0] ?? '');
    const { warnings } = validateKata(dir);
    assert.ok(warnings.includes('the positive event on line 4 repeats line 1'), JSON.stringify(warnings));
  });

  it('warns when a kata maps to no ATT&CK technique', () => {
    const dir = copyValidKata(sandbox.dir());
    truncateEvents(dir, 'positive.jsonl', 2); // keeps the grader out of this test
    replaceInKataFile(dir, 'kata.yml', 'attack:\n  - T1105', 'attack: []');
    const { warnings } = validateKata(dir);
    assert.ok(warnings.some((w) => /"attack" is empty/.test(w)), JSON.stringify(warnings));
  });
});
