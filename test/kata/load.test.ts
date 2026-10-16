import assert from 'node:assert/strict';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { KataFormatError, KataNotFoundError } from '../../src/errors.ts';
import { listKatas, loadKata, loadKataFromDir } from '../../src/kata/load.ts';
import { kataDirName } from '../../src/kata/resolve.ts';
import {
  FIXTURE_KATAS_ROOT,
  VALID_KATA_DIR,
  VALID_KATA_NAME,
  appendEventLines,
  copyValidKata,
  createSandbox,
  replaceInKataFile,
  writeKataFile,
} from './helpers/fixtures.ts';

const sandbox = createSandbox();

/** A copy of the valid kata renumbered to `number`/`id`, so a root can hold several. */
function copyKataAs(root: string, number: number, id: string): string {
  const dir = copyValidKata(root, kataDirName(number, id));
  replaceInKataFile(dir, 'kata.yml', 'number: 1\nid: fixture-basic', `number: ${number}\nid: ${id}`);
  return dir;
}

/** Rewrite every text file of a kata with a UTF-8 BOM and CRLF line endings. */
function convertToBomAndCrlf(dir: string): void {
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else writeFileSync(full, `\uFEFF${readFileSync(full, 'utf8').replace(/\n/g, '\r\n')}`);
    }
  };
  visit(dir);
}

/** Try to create a symbolic link; undefined means this machine is not allowed to (common on Windows). */
function trySymlink(target: string, linkPath: string, type: 'file' | 'dir' | 'junction'): boolean {
  try {
    symlinkSync(target, linkPath, type);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw err;
  }
}

describe('loadKata on the valid fixture', () => {
  const kata = loadKata(VALID_KATA_NAME, FIXTURE_KATAS_ROOT);

  it('reads kata.yml into typed metadata', () => {
    assert.equal(kata.meta.number, 1);
    assert.equal(kata.meta.id, 'fixture-basic');
    assert.equal(kata.meta.tier, 1);
    assert.equal(kata.meta.kind, 'write');
    assert.deepEqual(kata.meta.attack, ['T1105']);
    assert.deepEqual(kata.meta.logsource, { category: 'process_creation', product: 'windows' });
    assert.deepEqual(kata.meta.thresholds, { min_tpr: 1, max_fpr: 0, min_variants_caught: 'all' });
    assert.equal(kata.meta.hints.length, 3);
    assert.match(kata.meta.scenario, /certutil\.exe/);
  });

  it('records the absolute kata directory', () => {
    assert.equal(kata.dir, path.resolve(VALID_KATA_DIR));
    assert.ok(path.isAbsolute(kata.dir));
  });

  it('loads the three event sets with their labels', () => {
    assert.equal(kata.positives.length, 3);
    assert.equal(kata.benign.length, 7);
    assert.equal(kata.variants.length, 3);
    assert.deepEqual(kata.positives.map((e) => e.line), [1, 2, 3]);
    assert.match(kata.benign[0]?.note ?? '', /Hashing a local file/);
    assert.equal(kata.variants[0]?.technique, 'renamed binary');
  });

  it('removes the _dojo annotation from every event the rule will see', () => {
    for (const { event } of [...kata.positives, ...kata.benign, ...kata.variants]) {
      assert.equal(Object.hasOwn(event, '_dojo'), false);
    }
    assert.equal(kata.positives[0]?.event.Image, 'C:\\Windows\\System32\\certutil.exe');
  });

  it('loads the starter, solution and explanation with LF line endings', () => {
    assert.match(kata.starter, /replace-me/);
    assert.match(kata.solution, /all of selection_\*/);
    assert.match(kata.explain, /^# Why this rule works/);
    for (const text of [kata.starter, kata.solution, kata.explain]) assert.equal(text.includes('\r'), false);
  });

  it('finds the same kata by number, id and folder name', () => {
    for (const query of ['1', '01', 'fixture-basic', VALID_KATA_NAME]) {
      assert.equal(loadKata(query, FIXTURE_KATAS_ROOT).meta.id, 'fixture-basic', query);
    }
  });

  it('reports an unknown kata as not found', () => {
    assert.throws(() => loadKata('99', FIXTURE_KATAS_ROOT), KataNotFoundError);
  });
});

describe('loadKataFromDir', () => {
  it('accepts a relative path', () => {
    const relative = path.relative(process.cwd(), VALID_KATA_DIR);
    assert.equal(loadKataFromDir(relative).dir, path.resolve(VALID_KATA_DIR));
  });

  it('tolerates a UTF-8 BOM and CRLF line endings in every file', () => {
    const copy = copyValidKata(sandbox.dir());
    convertToBomAndCrlf(copy);
    const original = loadKataFromDir(VALID_KATA_DIR);
    const converted = loadKataFromDir(copy);
    assert.deepEqual({ ...converted, dir: '' }, { ...original, dir: '' });
  });

  it('treats a missing optional variants file as no variants', () => {
    const copy = copyValidKata(sandbox.dir());
    rmSync(path.join(copy, 'events', 'variants.jsonl'));
    assert.deepEqual(loadKataFromDir(copy).variants, []);
  });

  it('fails with a KataFormatError that names the kata and the problem', () => {
    const copy = copyValidKata(sandbox.dir());
    rmSync(path.join(copy, 'solution.yml'));
    assert.throws(
      () => loadKataFromDir(copy),
      (err: unknown) =>
        err instanceof KataFormatError && err.message === 'Kata "01-fixture-basic" is not valid: solution.yml is missing',
    );
  });

  it('lists several problems as bullets', () => {
    const copy = copyValidKata(sandbox.dir());
    rmSync(path.join(copy, 'solution.yml'));
    appendEventLines(copy, 'positive.jsonl', '{broken');
    assert.throws(
      () => loadKataFromDir(copy),
      (err: unknown) => {
        assert.ok(err instanceof KataFormatError);
        assert.match(err.message, /^Kata "01-fixture-basic" is not valid:\n {2}- solution\.yml is missing\n {2}- events\/positive\.jsonl line 4: not valid JSON/);
        return true;
      },
    );
  });

  it('truncates a long list of problems and points at validate-kata', () => {
    const copy = copyValidKata(sandbox.dir());
    appendEventLines(copy, 'positive.jsonl', ...Array.from({ length: 9 }, () => 'oops'));
    assert.throws(
      () => loadKataFromDir(copy),
      (err: unknown) => err instanceof KataFormatError && /\.\.\.and 3 more; run "dojo validate-kata /.test(err.message),
    );
  });

  it('rejects a folder that does not exist or is a file', () => {
    const sandboxDir = sandbox.dir();
    assert.throws(() => loadKataFromDir(path.join(sandboxDir, 'nope')), /does not exist or cannot be read/);
    const file = path.join(sandboxDir, 'a-file');
    writeFileSync(file, 'x');
    assert.throws(() => loadKataFromDir(file), /is not a folder/);
  });

  it('requires the folder name to match number and id from kata.yml', () => {
    const parent = sandbox.dir();
    const copy = copyValidKata(parent);
    const renamed = path.join(parent, '07-wrong-name');
    renameSync(copy, renamed);
    assert.throws(
      () => loadKataFromDir(renamed),
      /the folder is named "07-wrong-name" but kata\.yml says number 1 and id "fixture-basic", so it must be named "01-fixture-basic"/,
    );
  });

  it('refuses an oversized events file without reading it', () => {
    const copy = copyValidKata(sandbox.dir());
    writeKataFile(copy, 'events/benign.jsonl', Buffer.alloc(2 * 1024 * 1024 + 1, 10));
    assert.throws(() => loadKataFromDir(copy), /events\/benign\.jsonl is 2\.0 MiB, over the 2\.0 MiB limit|events\/benign\.jsonl is 2097153 bytes, over the 2097152-byte limit/);
  });

  it('refuses a file that is not valid UTF-8', () => {
    const copy = copyValidKata(sandbox.dir());
    writeKataFile(copy, 'explain.md', Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]));
    assert.throws(() => loadKataFromDir(copy), /explain\.md is not valid UTF-8 text/);
  });

  it('refuses a directory where a file belongs', () => {
    const copy = copyValidKata(sandbox.dir());
    rmSync(path.join(copy, 'starter.yml'));
    mkdirSync(path.join(copy, 'starter.yml'));
    assert.throws(() => loadKataFromDir(copy), /starter\.yml must be a regular file/);
  });
});

describe('symbolic links inside a kata', () => {
  it('refuses an events folder that links outside the kata', (t) => {
    const parent = sandbox.dir();
    const outside = path.join(parent, 'outside-events');
    mkdirSync(outside);
    for (const file of ['positive.jsonl', 'benign.jsonl', 'variants.jsonl']) {
      writeFileSync(path.join(outside, file), readFileSync(path.join(VALID_KATA_DIR, 'events', file)));
    }
    const copy = copyValidKata(parent);
    rmSync(path.join(copy, 'events'), { recursive: true });
    // A junction needs no privileges on Windows; elsewhere it is a plain directory symlink.
    if (!trySymlink(outside, path.join(copy, 'events'), 'junction')) {
      t.skip('this account may not create links');
      return;
    }
    assert.throws(() => loadKataFromDir(copy), /events\/ is a symbolic link/);
    assert.ok(statSync(path.join(outside, 'positive.jsonl')).isFile(), 'the link target is left alone');
  });

  it('refuses a file that links outside the kata', (t) => {
    const parent = sandbox.dir();
    const secret = path.join(parent, 'secret.txt');
    writeFileSync(secret, 'not part of the kata');
    const copy = copyValidKata(parent);
    rmSync(path.join(copy, 'explain.md'));
    const link = path.join(copy, 'explain.md');
    // Without the privilege for file symlinks (Windows), a junction in the same place is also reported as a link.
    if (!trySymlink(secret, link, 'file') && !trySymlink(parent, link, 'junction')) {
      t.skip('this account may not create links');
      return;
    }
    assert.throws(() => loadKataFromDir(copy), /explain\.md is a symbolic link/);
  });
});

describe('listKatas', () => {
  it('summarises the fixture curriculum', () => {
    assert.deepEqual(listKatas(FIXTURE_KATAS_ROOT), [
      {
        number: 1,
        id: 'fixture-basic',
        dirName: '01-fixture-basic',
        title: 'Certutil used as a downloader',
        tier: 1,
        kind: 'write',
        attack: ['T1105'],
        tags: ['fixture', 'process-creation'],
        estimated_minutes: 10,
      },
    ]);
  });

  it('sorts by kata number, so 100 comes after 10', () => {
    const root = sandbox.dir();
    copyKataAs(root, 100, 'hundred');
    copyKataAs(root, 10, 'ten');
    copyKataAs(root, 2, 'two');
    assert.deepEqual(listKatas(root).map((k) => k.dirName), ['02-two', '10-ten', '100-hundred']);
  });

  it('returns an empty list for a folder without katas and ignores unrelated entries', () => {
    const root = sandbox.dir();
    assert.deepEqual(listKatas(root), []);
    writeFileSync(path.join(root, 'README.md'), 'hello');
    mkdirSync(path.join(root, '_template'));
    mkdirSync(path.join(root, '.git'));
    writeFileSync(path.join(root, '05-a-file-not-a-folder'), 'x');
    assert.deepEqual(listKatas(root), []);
  });

  it('names the broken kata when its kata.yml is invalid', () => {
    const root = sandbox.dir();
    copyKataAs(root, 2, 'fine-one');
    const broken = copyKataAs(root, 3, 'broken-one');
    replaceInKataFile(broken, 'kata.yml', 'tier: 1', 'tier: 9');
    assert.throws(
      () => listKatas(root),
      (err: unknown) =>
        err instanceof KataFormatError && /^Kata "03-broken-one" is not valid: kata\.yml: "tier" must be a whole number from 1 to 3/.test(err.message),
    );
  });

  it('names a kata folder whose name does not match its kata.yml', () => {
    const root = sandbox.dir();
    const dir = copyKataAs(root, 2, 'two');
    renameSync(dir, path.join(root, '03-two'));
    assert.throws(() => listKatas(root), /Kata "03-two" is not valid: the folder is named "03-two" but kata\.yml says number 2/);
  });

  it('rejects a folder that starts like a kata but is not named <NN>-<id>', () => {
    const root = sandbox.dir();
    mkdirSync(path.join(root, '04_underscore_name'));
    assert.throws(
      () => listKatas(root),
      (err: unknown) => err instanceof KataFormatError && /"04_underscore_name".*not a valid kata folder name/.test(err.message),
    );
  });

  it('rejects two katas with the same number or the same id', () => {
    const sameNumber = sandbox.dir();
    copyKataAs(sameNumber, 4, 'first');
    copyKataAs(sameNumber, 4, 'second');
    assert.throws(() => listKatas(sameNumber), /Kata number 4 is used by both "04-first" and "04-second"/);

    const sameId = sandbox.dir();
    copyKataAs(sameId, 4, 'twin');
    copyKataAs(sameId, 5, 'twin');
    assert.throws(() => listKatas(sameId), /Kata id "twin" is used by both "04-twin" and "05-twin"/);
  });

  it('reads only kata.yml, so a kata with broken events still lists', () => {
    const root = sandbox.dir();
    const dir = copyKataAs(root, 2, 'two');
    writeKataFile(dir, 'events/positive.jsonl', 'not json at all\n');
    assert.deepEqual(listKatas(root).map((k) => k.id), ['two']);
  });

  it('explains a missing katas folder', () => {
    assert.throws(() => listKatas(path.join(sandbox.dir(), 'missing')), /Cannot read the katas folder/);
  });
});
