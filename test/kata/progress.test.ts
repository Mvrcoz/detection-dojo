import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { loadProgress, progressPath, recordResult } from '../../src/kata/progress.ts';
import { createSandbox, fakeResult, withEnv } from './helpers/fixtures.ts';

const sandbox = createSandbox();
let home: string;
const originalHome = process.env.DOJO_HOME;

beforeEach(() => {
  home = sandbox.dir();
  process.env.DOJO_HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.DOJO_HOME;
  else process.env.DOJO_HOME = originalHome;
});

/** Run `fn` and return what it wrote to stderr; the real stderr stays quiet. */
function captureStderr<T>(fn: () => T): { result: T; output: string } {
  const original = process.stderr.write;
  let output = '';
  process.stderr.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    return { result: fn(), output };
  } finally {
    process.stderr.write = original;
  }
}

function writeProgressFile(content: string | Buffer): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(progressPath(), content);
}

const VALID_ENTRY = {
  passed: true,
  attempts: 2,
  bestTpr: 1,
  bestFpr: 0,
  bestVariantsCaught: 3,
  firstPassedAt: '2025-01-01T00:00:00.000Z',
  lastAttemptAt: '2025-01-02T00:00:00.000Z',
};

const UNPASSED_ENTRY = {
  passed: false,
  attempts: 1,
  bestTpr: 0.5,
  bestFpr: 0.25,
  bestVariantsCaught: 0,
  lastAttemptAt: '2025-01-02T00:00:00.000Z',
};

describe('progressPath', () => {
  it('lives in DOJO_HOME when set', () => {
    assert.equal(progressPath(), path.join(home, 'progress.json'));
  });

  it('defaults to ~/.detection-dojo when DOJO_HOME is unset or blank', () => {
    for (const value of [undefined, '', '  ']) {
      withEnv('DOJO_HOME', value, () => {
        assert.equal(progressPath(), path.join(homedir(), '.detection-dojo', 'progress.json'));
      });
    }
  });
});

describe('loadProgress', () => {
  it('returns empty progress when there is no file', () => {
    assert.deepEqual(loadProgress(), { version: 1, katas: {} });
  });

  it('reads back a saved record', () => {
    writeProgressFile(JSON.stringify({ version: 1, katas: { 'fixture-basic': VALID_ENTRY } }));
    assert.deepEqual(loadProgress().katas['fixture-basic'], VALID_ENTRY);
  });

  it('tolerates a UTF-8 BOM and CRLF line endings', () => {
    const text = JSON.stringify({ version: 1, katas: { a1: VALID_ENTRY } }, null, 2).replace(/\n/g, '\r\n');
    writeProgressFile(`﻿${text}`);
    assert.deepEqual(Object.keys(loadProgress().katas), ['a1']);
  });

  it('treats a corrupt file as empty', () => {
    for (const content of ['', '{', 'not json', '{"version":1,"katas":', '\u0000\u0001\u0002']) {
      writeProgressFile(content);
      assert.deepEqual(loadProgress(), { version: 1, katas: {} }, JSON.stringify(content));
    }
  });

  it('treats a file of the wrong shape or version as empty', () => {
    for (const value of [null, [], 'text', 7, {}, { version: 2, katas: {} }, { version: 1 }, { version: 1, katas: [] }]) {
      writeProgressFile(JSON.stringify(value));
      assert.deepEqual(loadProgress(), { version: 1, katas: {} }, JSON.stringify(value));
    }
  });

  it('keeps the valid entries and drops the malformed ones', () => {
    writeProgressFile(
      JSON.stringify({
        version: 1,
        katas: {
          good: VALID_ENTRY,
          'bad-attempts': { ...VALID_ENTRY, attempts: -1 },
          'bad-rate': { ...VALID_ENTRY, bestTpr: 1.5 },
          'bad-passed': { ...VALID_ENTRY, passed: 'yes' },
          'no-last-attempt': { ...VALID_ENTRY, lastAttemptAt: undefined },
          'not-an-object': 'passed',
        },
      }),
    );
    assert.deepEqual(Object.keys(loadProgress().katas), ['good']);
  });

  it('accepts an entry without firstPassedAt', () => {
    writeProgressFile(JSON.stringify({ version: 1, katas: { 'not-yet': UNPASSED_ENTRY } }));
    assert.deepEqual(loadProgress().katas['not-yet'], UNPASSED_ENTRY);
  });

  it('ignores keys that are not kata ids, including __proto__', () => {
    writeProgressFile(
      `{"version":1,"katas":{"__proto__":${JSON.stringify(VALID_ENTRY)},"Not A Slug":${JSON.stringify(VALID_ENTRY)},"fine-one":${JSON.stringify(VALID_ENTRY)}}}`,
    );
    const progress = loadProgress();
    assert.deepEqual(Object.keys(progress.katas), ['fine-one']);
    assert.equal(Object.getPrototypeOf(progress.katas), Object.prototype);
  });

  it('ignores a progress file that is absurdly large', () => {
    writeProgressFile(Buffer.alloc(1024 * 1024 + 1, 0x20));
    assert.deepEqual(loadProgress(), { version: 1, katas: {} });
  });
});

describe('recordResult', () => {
  it('creates the folder and file on the first attempt', () => {
    const nested = path.join(home, 'not', 'yet', 'there');
    process.env.DOJO_HOME = nested;
    const progress = recordResult('fixture-basic', fakeResult({ passed: false, tpr: 0.5, fpr: 0.25, variantsCaught: 1 }));
    const saved = JSON.parse(readFileSync(path.join(nested, 'progress.json'), 'utf8'));
    assert.deepEqual(saved, progress);
    assert.equal(saved.version, 1);
  });

  it('records a first failing attempt', () => {
    const progress = recordResult('fixture-basic', fakeResult({ passed: false, tpr: 0.5, fpr: 0.25, variantsCaught: 1 }));
    const entry = progress.katas['fixture-basic'];
    assert.equal(entry?.passed, false);
    assert.equal(entry?.attempts, 1);
    assert.equal(entry?.bestTpr, 0.5);
    assert.equal(entry?.bestFpr, 0.25);
    assert.equal(entry?.bestVariantsCaught, 1);
    assert.equal(entry?.firstPassedAt, undefined);
    assert.match(entry?.lastAttemptAt ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('stamps firstPassedAt on the attempt that passes, and never moves it', () => {
    recordResult('fixture-basic', fakeResult({ passed: false }));
    const first = recordResult('fixture-basic', fakeResult({ passed: true })).katas['fixture-basic'];
    assert.equal(first?.passed, true);
    assert.equal(first?.firstPassedAt, first?.lastAttemptAt);

    const second = recordResult('fixture-basic', fakeResult({ passed: true })).katas['fixture-basic'];
    assert.equal(second?.firstPassedAt, first?.firstPassedAt);
    assert.equal(second?.attempts, 3);
  });

  it('keeps the best rates and variants across attempts', () => {
    recordResult('fixture-basic', fakeResult({ passed: false, tpr: 0.5, fpr: 0.4, variantsCaught: 2 }));
    recordResult('fixture-basic', fakeResult({ passed: false, tpr: 0.9, fpr: 0.5, variantsCaught: 1 }));
    const entry = recordResult('fixture-basic', fakeResult({ passed: false, tpr: 0.7, fpr: 0.1, variantsCaught: 0 })).katas['fixture-basic'];
    assert.equal(entry?.bestTpr, 0.9);
    assert.equal(entry?.bestFpr, 0.1);
    assert.equal(entry?.bestVariantsCaught, 2);
  });

  it('does not forget a pass when a later experiment fails', () => {
    recordResult('fixture-basic', fakeResult({ passed: true }));
    const entry = recordResult('fixture-basic', fakeResult({ passed: false, tpr: 0, fpr: 1, variantsCaught: 0 })).katas['fixture-basic'];
    assert.equal(entry?.passed, true);
    assert.equal(entry?.bestTpr, 1);
    assert.equal(entry?.bestFpr, 0);
    assert.equal(entry?.attempts, 2);
  });

  it('tracks katas independently and persists them all', () => {
    recordResult('first-kata', fakeResult({ passed: true }));
    recordResult('second-kata', fakeResult({ passed: false }));
    const reloaded = loadProgress();
    assert.equal(reloaded.katas['first-kata']?.passed, true);
    assert.equal(reloaded.katas['second-kata']?.passed, false);
    assert.equal(reloaded.katas['second-kata']?.attempts, 1);
  });

  it('leaves only progress.json behind: no temporary files', () => {
    for (let i = 0; i < 5; i++) recordResult('fixture-basic', fakeResult());
    assert.deepEqual(readdirSync(home), ['progress.json']);
  });

  it('replaces a corrupt file with a fresh record', () => {
    writeProgressFile('{"version":1,"katas":{"fixture-bas');
    const progress = recordResult('fixture-basic', fakeResult());
    assert.equal(progress.katas['fixture-basic']?.attempts, 1);
    assert.deepEqual(loadProgress(), progress);
  });

  it('keeps entries from a file that was partly damaged', () => {
    writeProgressFile(JSON.stringify({ version: 1, katas: { 'old-kata': VALID_ENTRY, broken: { passed: 'maybe' } } }));
    const progress = recordResult('fixture-basic', fakeResult());
    assert.deepEqual(Object.keys(progress.katas).sort(), ['fixture-basic', 'old-kata']);
  });

  it('handles kata ids that collide with Object.prototype names', () => {
    const progress = recordResult('constructor', fakeResult());
    assert.equal(progress.katas['constructor']?.attempts, 1);
    assert.equal(recordResult('constructor', fakeResult()).katas['constructor']?.attempts, 2);
  });

  it('does not throw when the progress file cannot be written, warns once on stderr and returns the new state', () => {
    // A regular file where the folder should be makes mkdir fail on every platform.
    const blocker = path.join(home, 'blocker');
    writeFileSync(blocker, 'a file, not a folder');
    process.env.DOJO_HOME = path.join(blocker, 'inside');

    const { result, output } = captureStderr(() => recordResult('fixture-basic', fakeResult({ passed: true })));
    assert.equal(result.katas['fixture-basic']?.attempts, 1);
    assert.equal(result.katas['fixture-basic']?.passed, true);
    assert.equal(output.split('\n').filter(Boolean).length, 1, output);
    assert.match(output, /^warning: could not save your progress to .*progress\.json \(\w+\)\. Your grade is not affected\.\n$/);
  });

  it('does not throw when the target is a directory, and cleans up its temporary file', () => {
    mkdirSync(progressPath(), { recursive: true });
    const { result, output } = captureStderr(() => recordResult('fixture-basic', fakeResult()));
    assert.equal(result.katas['fixture-basic']?.attempts, 1);
    assert.match(output, /^warning: could not save your progress/);
    assert.deepEqual(readdirSync(home), ['progress.json']);
  });

  it('refuses an invalid kata id with a warning instead of writing a key it would later drop', () => {
    const { result, output } = captureStderr(() => recordResult('Not A Slug', fakeResult()));
    assert.deepEqual(result, { version: 1, katas: {} });
    assert.match(output, /"Not A Slug" is not a valid kata id/);
    assert.deepEqual(readdirSync(home), []);
  });
});
