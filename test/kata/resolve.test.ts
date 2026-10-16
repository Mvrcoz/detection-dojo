import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { KataFormatError, KataNotFoundError } from '../../src/errors.ts';
import { loadKata } from '../../src/kata/load.ts';
import {
  isValidKataId,
  kataDirName,
  katasRoot,
  parseKataDirName,
  resolveKataDirName,
} from '../../src/kata/resolve.ts';
import {
  FIXTURE_KATAS_ROOT,
  VALID_KATA_DIR,
  VALID_KATA_NAME,
  copyValidKata,
  createSandbox,
  withEnv,
} from './helpers/fixtures.ts';

const sandbox = createSandbox();

describe('katasRoot', () => {
  it('uses DOJO_KATAS_DIR when it is set', () => {
    withEnv('DOJO_KATAS_DIR', FIXTURE_KATAS_ROOT, () => {
      assert.equal(katasRoot(), path.resolve(FIXTURE_KATAS_ROOT));
    });
  });

  it('resolves a relative DOJO_KATAS_DIR to an absolute path', () => {
    withEnv('DOJO_KATAS_DIR', 'some/relative/dir', () => {
      assert.equal(katasRoot(), path.resolve('some/relative/dir'));
    });
  });

  it('falls back to the bundled katas folder at the repository root when the variable is unset or blank', () => {
    const bundled = fileURLToPath(new URL('../../katas', import.meta.url));
    for (const value of [undefined, '', '   ']) {
      withEnv('DOJO_KATAS_DIR', value, () => {
        assert.equal(katasRoot(), bundled);
        assert.ok(path.isAbsolute(katasRoot()));
      });
    }
  });
});

describe('kata folder names', () => {
  it('builds and parses <NN>-<id>', () => {
    assert.equal(kataDirName(4, 'schtasks-persistence'), '04-schtasks-persistence');
    assert.equal(kataDirName(12, 'abc'), '12-abc');
    assert.equal(kataDirName(100, 'abc'), '100-abc');
    assert.deepEqual(parseKataDirName('04-schtasks-persistence'), { number: 4, id: 'schtasks-persistence' });
    assert.equal(parseKataDirName('4-too-short-number'), undefined);
    assert.equal(parseKataDirName('04_underscore'), undefined);
    assert.equal(parseKataDirName('04-Upper'), undefined);
  });

  it('accepts only lowercase slugs as ids', () => {
    for (const ok of ['ab', 'a1', 'schtasks-persistence', '1a', 'a'.repeat(51)]) {
      assert.equal(isValidKataId(ok), true, ok);
    }
    for (const bad of ['', 'a', '-ab', 'Ab', 'a_b', 'a b', 'a.b', 'a'.repeat(52)]) {
      assert.equal(isValidKataId(bad), false, bad);
    }
  });
});

describe('resolveKataDirName', () => {
  it('finds a kata by full name, number, zero-padded number and id', () => {
    for (const query of [VALID_KATA_NAME, '1', '01', 'fixture-basic', ' Fixture-Basic ']) {
      assert.equal(resolveKataDirName(query, FIXTURE_KATAS_ROOT), VALID_KATA_NAME, query);
    }
  });

  it('refuses anything that could be a path, by treating it as not found', () => {
    const hostile = [
      '..',
      '.',
      '../01-fixture-basic',
      '..\\01-fixture-basic',
      '01-fixture-basic/..',
      '01-fixture-basic/',
      './01-fixture-basic',
      '/etc/passwd',
      '\\\\server\\share',
      'C:\\Windows',
      'C:',
      'c:/windows',
      '01-fixture-basic\0',
      '\0',
      VALID_KATA_DIR,
      '%2e%2e',
      '~',
      '',
      '   ',
      'a'.repeat(5000),
    ];
    for (const query of hostile) {
      assert.throws(
        () => resolveKataDirName(query, FIXTURE_KATAS_ROOT),
        KataNotFoundError,
        `query ${JSON.stringify(query.slice(0, 40))} should not resolve`,
      );
    }
  });

  it('lists what is installed in the not-found message and strips control characters from the query', () => {
    assert.throws(
      () => resolveKataDirName('nope\u001b[31m', FIXTURE_KATAS_ROOT),
      (err: unknown) => {
        assert.ok(err instanceof KataNotFoundError);
        assert.match(err.message, /Try one of: 01-fixture-basic\./);
        assert.doesNotMatch(err.message, /\u001b/);
        return true;
      },
    );
  });

  it('says so when no katas are installed', () => {
    const empty = sandbox.dir();
    assert.throws(() => resolveKataDirName('1', empty), /\(none installed\)/);
  });

  it('ignores folders that are not shaped like katas and files that look like them', () => {
    const root = sandbox.dir();
    copyValidKata(root);
    mkdirSync(path.join(root, 'notes'));
    mkdirSync(path.join(root, '02_bad_name'));
    writeFileSync(path.join(root, '03-file-not-folder'), 'x');
    assert.equal(resolveKataDirName('fixture-basic', root), VALID_KATA_NAME);
    assert.throws(() => resolveKataDirName('03-file-not-folder', root), KataNotFoundError);
    assert.throws(() => resolveKataDirName('notes', root), KataNotFoundError);
  });

  it('orders the available katas by number, not alphabetically', () => {
    const root = sandbox.dir();
    for (const name of ['100-hundred', '09-nine', '10-ten']) mkdirSync(path.join(root, name));
    assert.throws(() => resolveKataDirName('missing', root), /09-nine, 10-ten, 100-hundred/);
  });

  it('reports an ambiguous number or id as a kata format problem', () => {
    const root = sandbox.dir();
    for (const name of ['04-first', '04-second', '05-first']) mkdirSync(path.join(root, name));
    assert.throws(() => resolveKataDirName('4', root), (err: unknown) => err instanceof KataFormatError && /Kata number 4/.test(err.message));
    assert.throws(() => resolveKataDirName('first', root), (err: unknown) => err instanceof KataFormatError && /Kata id "first"/.test(err.message));
    assert.equal(resolveKataDirName('04-second', root), '04-second');
    assert.equal(resolveKataDirName('second', root), '04-second');
  });

  it('explains a missing katas folder instead of throwing a raw filesystem error', () => {
    const missing = path.join(sandbox.dir(), 'nowhere');
    assert.throws(
      () => resolveKataDirName('1', missing),
      (err: unknown) => err instanceof KataFormatError && /Cannot read the katas folder/.test(err.message),
    );
  });
});

describe('loadKata query safety', () => {
  it('cannot be pointed at a kata outside the root with a path', () => {
    const root = sandbox.dir();
    assert.throws(() => loadKata(VALID_KATA_DIR, root), KataNotFoundError);
    assert.throws(() => loadKata(`..${path.sep}${VALID_KATA_NAME}`, root), KataNotFoundError);
  });
});
