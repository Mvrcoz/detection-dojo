import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GradeResult, Kata, LabeledEvent } from '../src/kata/types.ts';
import { stripAnsi, truncate, visibleLength } from '../src/render/color.ts';
import { renderScorecard, summarizeEvent } from '../src/render/scorecard.ts';
import { renderTable } from '../src/render/table.ts';

const kata = {
  dir: '/k',
  meta: {
    number: 3,
    id: 'x',
    title: 'Sample kata',
    tier: 2,
    kind: 'write',
    attack: ['T1053.005'],
    tags: [],
    logsource: {},
    scenario: '',
    objective: '',
    hints: ['a', 'b'],
    thresholds: { min_tpr: 1, max_fpr: 0, min_variants_caught: 'all' },
    estimated_minutes: 5,
    author: 'a',
  },
  positives: [],
  benign: [],
  variants: [],
  starter: '',
  solution: '',
  explain: '',
} satisfies Kata;

const labeled = (event: Record<string, unknown>, extra: Partial<LabeledEvent> = {}, line = 1): LabeledEvent => ({ event, line, ...extra });

const failing: GradeResult = {
  kataId: 'x',
  tp: 2,
  fn: 1,
  fp: 1,
  tn: 5,
  tpr: 2 / 3,
  fpr: 1 / 6,
  precision: 2 / 3,
  variantsCaught: 1,
  variantsTotal: 3,
  passed: false,
  checks: { tpr: false, fpr: false, variants: false },
  failures: {
    missedPositives: [labeled({ Image: 'C:\\a\\tool.exe', CommandLine: 'tool.exe --go' }, {}, 3)],
    falsePositives: [labeled({ CommandLine: 'tool.exe --help' }, { note: 'Help text only' }, 4)],
    missedVariants: [labeled({ CommandLine: 'T00L.EXE --GO' }, { technique: 'upper-case' }, 2)],
  },
  warnings: ['unreferenced-selection: x'],
};

describe('summarizeEvent', () => {
  it('leads with the command line and mentions the image only when it is not in the command', () => {
    assert.equal(summarizeEvent({ Image: 'C:\\x\\tool.exe', CommandLine: 'tool.exe -a' }), 'tool.exe -a');
    assert.equal(
      summarizeEvent({ Image: 'C:\\x\\renamed.exe', CommandLine: 'cu.exe -a' }),
      'cu.exe -a  [image: renamed.exe]',
    );
  });

  it('falls back to the most telling fields, then to the first fields', () => {
    assert.equal(summarizeEvent({ EventID: 13, TargetObject: 'HKLM\\Run\\x', Other: 1 }), 'EventID=13  TargetObject=HKLM\\Run\\x');
    assert.equal(summarizeEvent({ a: 1, b: 'two', c: null, d: 4 }), 'a=1  b=two  c=null');
  });

  it('shortens long values to the requested width', () => {
    assert.ok(visibleLength(summarizeEvent({ CommandLine: 'x'.repeat(500) }, 40)) <= 40);
  });
});

describe('renderScorecard', () => {
  it('shows each check, the failing events and their teaching notes', () => {
    const text = stripAnsi(renderScorecard(kata, failing, { attempts: 4, revealedHints: ['a'] }));
    assert.match(text, /Kata 03/);
    assert.match(text, /True positives\s+\S+\s+2\/3/);
    assert.match(text, /False positives\s+\S+\s+1\/6/);
    assert.match(text, /Evasion variants\s+\S+\s+1\/3/);
    assert.match(text, /FAIL\s+3 of 3 checks failed/);
    assert.match(text, /why it is benign: Help text only/);
    assert.match(text, /technique: upper-case/);
    assert.match(text, /Heads up/);
    assert.match(text, /Hints/);
    assert.match(text, /Attempts on this kata: 4/);
  });

  it('caps long lists and offers --verbose', () => {
    const many = Array.from({ length: 9 }, (_, i) => labeled({ CommandLine: `c${i}` }, {}, i + 1));
    const result = { ...failing, failures: { ...failing.failures, missedPositives: many } };
    assert.match(stripAnsi(renderScorecard(kata, result)), /and 4 more \(use --verbose\)/);
    assert.doesNotMatch(stripAnsi(renderScorecard(kata, result, { verbose: true })), /use --verbose/);
  });

  it('prints a PASS banner and hides the failure sections for a passing grade', () => {
    const passing: GradeResult = {
      ...failing,
      tp: 3,
      fn: 0,
      fp: 0,
      tn: 6,
      variantsCaught: 3,
      passed: true,
      checks: { tpr: true, fpr: true, variants: true },
      failures: { missedPositives: [], falsePositives: [], missedVariants: [] },
      warnings: [],
    };
    const text = stripAnsi(renderScorecard(kata, passing));
    assert.match(text, /PASS/);
    assert.doesNotMatch(text, /Missed attacks|False alarms|slipped past/);
  });

  it('emits no ANSI escapes when color is off (tests run with NO_COLOR or a non-TTY)', () => {
    assert.equal(renderScorecard(kata, failing), stripAnsi(renderScorecard(kata, failing)));
  });
});

describe('renderTable and truncate', () => {
  it('aligns columns by visible width', () => {
    const lines = renderTable([{ header: 'A' }, { header: 'B', align: 'right' }], [['x', '1'], ['longer', '22']]).split('\n');
    assert.equal(lines.length, 3);
    assert.match(stripAnsi(lines[1] ?? ''), /^ {2}x {8}1$/);
    assert.match(stripAnsi(lines[2] ?? ''), /^ {2}longer {2}22$/);
  });

  it('truncate keeps short text and shortens long text', () => {
    assert.equal(truncate('short', 10), 'short');
    assert.equal(visibleLength(truncate('x'.repeat(50), 10)), 10);
  });
});

describe('wrapWords', () => {
  it('wraps on word boundaries without losing text', async () => {
    const { wrapWords } = await import('../src/render/scorecard.ts');
    const text = 'Lists local accounts. "user" without "/add" creates nothing at all, so it is benign.';
    const lines = wrapWords(text, 30);
    assert.ok(lines.length > 1);
    assert.ok(lines.every((line) => [...line].length <= 30));
    assert.equal(lines.join(' '), text);
  });

  it('keeps a word that is longer than the width on its own line', async () => {
    const { wrapWords } = await import('../src/render/scorecard.ts');
    assert.deepEqual(wrapWords('a verylongwordthatcannotsplit b', 8), ['a', 'verylongwordthatcannotsplit', 'b']);
  });
});
