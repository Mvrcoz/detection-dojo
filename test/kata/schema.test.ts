import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkKataMeta, parseKataMeta } from '../../src/kata/schema.ts';

function validRaw(): Record<string, unknown> {
  return {
    number: 4,
    id: 'schtasks-persistence',
    title: 'Scheduled task persistence',
    tier: 2,
    kind: 'write',
    attack: ['T1053.005', 'T1053'],
    tags: ['persistence'],
    logsource: { category: 'process_creation', product: 'windows' },
    scenario: 'A scheduled task appeared.',
    objective: 'Detect it.',
    hints: ['one', 'two', 'three'],
    thresholds: { min_tpr: 1, max_fpr: 0.1, min_variants_caught: 2 },
    estimated_minutes: 15,
    author: 'someone',
  };
}

/** The errors checkKataMeta reports when `change` is applied to a valid document. */
function errorsAfter(change: (raw: Record<string, unknown>) => void): string[] {
  const raw = validRaw();
  change(raw);
  return checkKataMeta(raw).errors;
}

describe('checkKataMeta', () => {
  it('accepts a complete document and returns it unchanged', () => {
    const { meta, errors } = checkKataMeta(validRaw());
    assert.deepEqual(errors, []);
    assert.deepEqual(meta, validRaw());
  });

  it('fills in documented defaults for tags and thresholds', () => {
    const raw = validRaw();
    delete raw.tags;
    delete raw.thresholds;
    const { meta, errors } = checkKataMeta(raw);
    assert.deepEqual(errors, []);
    assert.deepEqual(meta?.tags, []);
    assert.deepEqual(meta?.thresholds, { min_tpr: 1, max_fpr: 0, min_variants_caught: 0 });
  });

  it('fills in individual missing thresholds', () => {
    const raw = validRaw();
    raw.thresholds = { max_fpr: 0.25 };
    assert.deepEqual(checkKataMeta(raw).meta?.thresholds, { min_tpr: 1, max_fpr: 0.25, min_variants_caught: 0 });
  });

  it('accepts "all" and integers for min_variants_caught', () => {
    for (const value of ['all', 0, 3]) {
      const raw = validRaw();
      raw.thresholds = { min_variants_caught: value };
      assert.equal(checkKataMeta(raw).meta?.thresholds.min_variants_caught, value);
    }
  });

  it('trims surrounding whitespace from text fields', () => {
    const raw = validRaw();
    raw.title = '  Padded title \n';
    assert.equal(checkKataMeta(raw).meta?.title, 'Padded title');
  });

  it('rejects an unknown key and suggests the closest valid one', () => {
    assert.deepEqual(errorsAfter((raw) => { raw.hint = ['x']; }), [
      'kata.yml: unknown key "hint" (did you mean "hints"?)',
    ]);
    assert.deepEqual(errorsAfter((raw) => { raw.estimated_minute = 3; }), [
      'kata.yml: unknown key "estimated_minute" (did you mean "estimated_minutes"?)',
    ]);
  });

  it('lists the valid keys when nothing is close to an unknown key', () => {
    const [error] = errorsAfter((raw) => { raw.zzzzzzzz = 1; });
    assert.match(error ?? '', /unknown key "zzzzzzzz"; valid keys are number, id, title/);
  });

  it('rejects an unknown key inside thresholds', () => {
    const errors = errorsAfter((raw) => { raw.thresholds = { min_tpr: 1, max_fp: 0 }; });
    assert.deepEqual(errors, ['kata.yml: unknown key "thresholds.max_fp" (did you mean "max_fpr"?)']);
  });

  it('names every missing required key', () => {
    const errors = errorsAfter((raw) => {
      delete raw.objective;
      delete raw.author;
    });
    assert.deepEqual(errors, [
      'kata.yml: missing required key "objective"',
      'kata.yml: missing required key "author"',
    ]);
  });

  it('reports every problem at once instead of stopping at the first', () => {
    const errors = errorsAfter((raw) => {
      raw.id = 'Bad_Id';
      raw.tier = 4;
      raw.kind = 'cook';
    });
    assert.equal(errors.length, 3);
  });

  it('enforces the id slug pattern', () => {
    for (const id of ['Bad_Slug', 'x', '-lead', 'has space', 'a'.repeat(52), 12]) {
      const errors = errorsAfter((raw) => { raw.id = id; });
      assert.equal(errors.length, 1, String(id));
      assert.match(errors[0] ?? '', /"id" must be/);
    }
  });

  it('enforces integer ranges and types for number, tier and estimated_minutes', () => {
    const cases: Array<[string, unknown]> = [
      ['number', 0],
      ['number', 1000],
      ['number', 1.5],
      ['number', '4'],
      ['tier', 0],
      ['tier', 4],
      ['tier', '2'],
      ['estimated_minutes', 0],
      ['estimated_minutes', -3],
      ['estimated_minutes', 481],
    ];
    for (const [key, value] of cases) {
      const errors = errorsAfter((raw) => { raw[key] = value; });
      assert.equal(errors.length, 1, `${key}=${String(value)}`);
      assert.match(errors[0] ?? '', new RegExp(`"${key}" must be a whole number`));
    }
  });

  it('only allows kind write or tune', () => {
    assert.match(errorsAfter((raw) => { raw.kind = 'read'; })[0] ?? '', /"kind" must be write or tune/);
  });

  it('requires ATT&CK ids shaped like T1053 or T1053.005', () => {
    for (const bad of ['t1053', 'T105', 'T1053.5', 'T1053.0055', 'attack.t1053', 'T1053 ', '1053']) {
      const errors = errorsAfter((raw) => { raw.attack = ['T1105', bad]; });
      if (bad === 'T1053 ') {
        assert.deepEqual(errors, [], 'surrounding whitespace is trimmed, so this one is fine');
      } else {
        assert.equal(errors.length, 1, bad);
        assert.match(errors[0] ?? '', /"attack\[1\]" must be a MITRE ATT&CK technique id/);
      }
    }
  });

  it('requires attack, tags and hints to be lists of non-empty text', () => {
    assert.match(errorsAfter((raw) => { raw.attack = 'T1105'; })[0] ?? '', /"attack" must be a list/);
    assert.match(errorsAfter((raw) => { raw.tags = [1]; })[0] ?? '', /"tags\[0\]" must be non-empty text/);
    assert.match(errorsAfter((raw) => { raw.hints = ['ok', '  ']; })[0] ?? '', /"hints\[1\]" must be non-empty text/);
  });

  it('requires two to four hints', () => {
    for (const count of [0, 1, 5]) {
      const errors = errorsAfter((raw) => { raw.hints = Array.from({ length: count }, (_, i) => `hint ${i}`); });
      assert.deepEqual(errors, [`kata.yml: "hints" needs 2 to 4 entries, gentlest first (found ${count})`]);
    }
    for (const count of [2, 3, 4]) {
      assert.deepEqual(errorsAfter((raw) => { raw.hints = Array.from({ length: count }, (_, i) => `hint ${i}`); }), []);
    }
  });

  it('requires non-empty title, scenario, objective and author', () => {
    for (const key of ['title', 'scenario', 'objective', 'author']) {
      for (const value of ['', '   ', 5, null]) {
        const errors = errorsAfter((raw) => { raw[key] = value; });
        assert.equal(errors.length, 1, `${key}=${JSON.stringify(value)}`);
        assert.match(errors[0] ?? '', new RegExp(`"${key}" must be non-empty text`));
      }
    }
  });

  it('requires logsource to be a non-empty mapping with text values for the well-known keys', () => {
    assert.match(errorsAfter((raw) => { raw.logsource = {}; })[0] ?? '', /"logsource" must be a mapping/);
    assert.match(errorsAfter((raw) => { raw.logsource = 'windows'; })[0] ?? '', /"logsource" must be a mapping/);
    assert.match(errorsAfter((raw) => { raw.logsource = { product: 3 }; })[0] ?? '', /"logsource.product" must be text/);
    assert.deepEqual(errorsAfter((raw) => { raw.logsource = { product: 'windows', custom: { a: 1 } }; }), []);
  });

  it('validates threshold ranges and types', () => {
    const bad: unknown[] = [
      { min_tpr: 1.5 },
      { min_tpr: -0.1 },
      { min_tpr: '1' },
      { max_fpr: 2 },
      { max_fpr: Number.NaN },
      { min_variants_caught: -1 },
      { min_variants_caught: 1.5 },
      { min_variants_caught: 'most' },
      'strict',
      null,
      [1],
    ];
    for (const thresholds of bad) {
      const errors = errorsAfter((raw) => { raw.thresholds = thresholds; });
      assert.equal(errors.length, 1, JSON.stringify(thresholds));
      assert.match(errors[0] ?? '', /thresholds/);
    }
  });

  it('rejects documents that are not mappings', () => {
    for (const raw of [null, undefined, 'text', 5, ['a']]) {
      const { meta, errors } = checkKataMeta(raw);
      assert.equal(meta, undefined);
      assert.equal(errors.length, 1);
    }
    assert.match(checkKataMeta(null).errors[0] ?? '', /file is empty/);
  });
});

describe('parseKataMeta', () => {
  const yaml = [
    'number: 7',
    'id: demo-kata',
    'title: Demo',
    'tier: 1',
    'kind: tune',
    'attack: [T1059.001]',
    'logsource: { product: windows }',
    'scenario: Something happened.',
    'objective: Catch it.',
    'hints: [a, b]',
    'estimated_minutes: 5',
    'author: me',
  ].join('\n');

  it('parses YAML text into KataMeta', () => {
    const { meta, errors } = parseKataMeta(yaml);
    assert.deepEqual(errors, []);
    assert.equal(meta?.kind, 'tune');
    assert.deepEqual(meta?.attack, ['T1059.001']);
  });

  it('reports a duplicated key instead of silently using the last one', () => {
    const { errors } = parseKataMeta(`${yaml}\ntier: 2\n`);
    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? '', /^kata\.yml: Map keys must be unique at line 13/);
  });

  it('reports YAML syntax errors with a location and without echoing the source', () => {
    const { errors } = parseKataMeta('number: [1\nid: x');
    assert.ok(errors.length > 0);
    for (const error of errors) {
      assert.match(error, /^kata\.yml: .+ at line \d+, column \d+$/);
    }
  });

  it('rejects a multi-document file', () => {
    const { errors } = parseKataMeta(`${yaml}\n---\nnumber: 8\n`);
    assert.match(errors[0] ?? '', /multiple documents/);
  });

  it('treats an empty file as an error, not as a crash', () => {
    assert.match(parseKataMeta('').errors[0] ?? '', /file is empty/);
    assert.match(parseKataMeta('# only a comment\n').errors[0] ?? '', /file is empty/);
  });

  it('does not expand YAML alias bombs', () => {
    const bomb = [
      'a: &a [x, x, x, x, x, x, x, x, x, x]',
      'b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]',
      'c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]',
      'd: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]',
      'e: [*d, *d, *d, *d, *d, *d, *d, *d, *d, *d]',
    ].join('\n');
    const { meta, errors } = parseKataMeta(bomb);
    assert.equal(meta, undefined);
    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? '', /alias/i);
  });
});
