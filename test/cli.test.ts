/**
 * End-to-end tests: every case runs the real CLI as a subprocess against the
 * fixture kata, so exit codes, stdout/stderr separation and --json shapes are
 * checked exactly as a user (or CI) would see them.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'src', 'cli.ts');
const FIXTURES = join(ROOT, 'test', 'fixtures', 'katas');
const FIXTURE_KATA = join(FIXTURES, '01-fixture-basic');

let work: string;
let home: string;

function dojo(args: string[], extraEnv: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: work,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1', DOJO_KATAS_DIR: FIXTURES, DOJO_HOME: home, ...extraEnv },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

before(() => {
  work = mkdtempSync(join(tmpdir(), 'dojo-cli-'));
  home = mkdtempSync(join(tmpdir(), 'dojo-home-'));
});

after(() => {
  rmSync(work, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('global behavior', () => {
  it('prints the version and exits 0', () => {
    const { code, out } = dojo(['--version']);
    assert.equal(code, 0);
    assert.match(out.trim(), /^\d+\.\d+\.\d+/);
  });

  it('shows a welcome screen with the next step when run with no arguments', () => {
    const { code, out } = dojo([]);
    assert.equal(code, 0);
    assert.match(out, /dojo list/);
    assert.match(out, /dojo start 1/);
  });

  it('lists every command in --help', () => {
    const { out } = dojo(['--help']);
    for (const name of ['list', 'show', 'start', 'test', 'watch', 'lint', 'new', 'validate-kata']) {
      assert.match(out, new RegExp(`\\b${name}\\b`));
    }
  });

  it('rejects an unknown command with exit 2 and a friendly stderr message only', () => {
    const { code, out, err } = dojo(['frobnicate']);
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.match(err, /^error: unknown command 'frobnicate'/);
    assert.doesNotMatch(err, /\n\s+at /);
  });

  it('rejects an unknown flag with exit 2', () => {
    const { code, err } = dojo(['list', '--bogus']);
    assert.equal(code, 2);
    assert.match(err, /error: Unknown option '--bogus'/);
  });

  it('does not treat prototype property names as commands', () => {
    assert.equal(dojo(['constructor']).code, 2);
    assert.equal(dojo(['__proto__']).code, 2);
  });
});

describe('list and show', () => {
  it('lists the curriculum as a table', () => {
    const { code, out } = dojo(['list']);
    assert.equal(code, 0);
    assert.match(out, /Certutil used as a downloader/);
    assert.match(out, /0\/1 katas completed/);
  });

  it('emits a single JSON document with --json', () => {
    const { code, out } = dojo(['list', '--json']);
    assert.equal(code, 0);
    const parsed = JSON.parse(out) as Array<{ id: string; passed: boolean }>;
    assert.equal(parsed[0]?.id, 'fixture-basic');
    assert.equal(parsed[0]?.passed, false);
  });

  it('filters by tier', () => {
    assert.match(dojo(['list', '--tier', '3']).out, /No katas match/);
    assert.equal(dojo(['list', '--tier', '9']).code, 2);
  });

  it('resolves a kata by number, id and directory name', () => {
    for (const query of ['1', '01', 'fixture-basic', '01-fixture-basic']) {
      assert.equal(dojo(['show', query]).code, 0, query);
    }
  });

  it('shows the scenario and one example, but never benign notes or the solution', () => {
    const { out } = dojo(['show', '1']);
    assert.match(out, /Objective/);
    assert.match(out, /One example of the attack/);
    assert.doesNotMatch(out, /Hashing a local file/);
    assert.doesNotMatch(out, /5d1e9b9c-2f3a-4c52-9a43-6f7a2b1c0d11/);
  });

  it('reveals a single hint on request and validates the number', () => {
    assert.match(dojo(['show', '1', '--hint', '1']).out, /Hint 1 of 3/);
    assert.equal(dojo(['show', '1', '--hint', '9']).code, 2);
  });

  it('refuses path traversal in the kata query', () => {
    for (const query of ['../../etc', '..\\..\\Windows', FIXTURE_KATA, 'C:\\Windows']) {
      const { code, err } = dojo(['show', query]);
      assert.equal(code, 2, query);
      assert.match(err, /^error: No kata matches/);
    }
  });
});

describe('start and test', () => {
  it('writes a starter file and refuses to overwrite it', () => {
    const first = dojo(['start', '1', '--out', 'mine.yml']);
    assert.equal(first.code, 0);
    assert.ok(existsSync(join(work, 'mine.yml')));
    const second = dojo(['start', '1', '--out', 'mine.yml']);
    assert.equal(second.code, 2);
    assert.match(second.err, /already exists/);
    assert.equal(dojo(['start', '1', '--out', 'mine.yml', '--force']).code, 0);
  });

  it('fails the starter rule with exit 1 and explains what was missed', () => {
    const { code, out } = dojo(['test', '1', 'mine.yml']);
    assert.equal(code, 1);
    assert.match(out, /FAIL/);
    assert.match(out, /Missed attacks/);
    assert.match(out, /Classic download/);
  });

  it('passes the reference solution with exit 0 and prints the write-up', () => {
    const { code, out } = dojo(['test', '1', '--solution']);
    assert.equal(code, 0);
    assert.match(out, /PASS/);
    assert.match(out, /What to take away/);
  });

  it('emits JSON for a pass and a fail, with matching exit codes', () => {
    const pass = dojo(['test', '1', '--solution', '--json']);
    assert.equal(pass.code, 0);
    assert.equal((JSON.parse(pass.out) as { passed: boolean }).passed, true);
    const fail = dojo(['test', '1', 'mine.yml', '--json']);
    assert.equal(fail.code, 1);
    const parsed = JSON.parse(fail.out) as { passed: boolean; result: { tp: number } };
    assert.equal(parsed.passed, false);
    assert.equal(parsed.result.tp, 0);
  });

  it('records progress for a learner rule but not for --solution', () => {
    const solutionHome = mkdtempSync(join(tmpdir(), 'dojo-home-'));
    dojo(['test', '1', '--solution'], { DOJO_HOME: solutionHome });
    assert.equal(existsSync(join(solutionHome, 'progress.json')), false);
    writeFileSync(join(work, 'solved.yml'), readFileSync(join(FIXTURE_KATA, 'solution.yml')));
    dojo(['test', '1', 'solved.yml'], { DOJO_HOME: solutionHome });
    assert.match(dojo(['list'], { DOJO_HOME: solutionHome }).out, /1\/1 katas completed/);
    rmSync(solutionHome, { recursive: true, force: true });
  });

  it('exits 2 with a friendly message for a missing rule file, a directory, and garbage', () => {
    assert.match(dojo(['test', '1', 'nope.yml']).err, /does not exist/);
    mkdirSync(join(work, 'adir'), { recursive: true });
    assert.match(dojo(['test', '1', 'adir']).err, /is not a file/);
    writeFileSync(join(work, 'garbage.yml'), Buffer.from([0, 159, 146, 150, 255, 254, 0, 1, 2]));
    const garbage = dojo(['test', '1', 'garbage.yml']);
    assert.equal(garbage.code, 2);
    assert.match(garbage.err, /^error: /);
    assert.doesNotMatch(garbage.err, /\n\s+at /);
  });

  it('reports an unsupported Sigma feature as a user error, not a crash', () => {
    writeFileSync(
      join(work, 'agg.yml'),
      'title: t\nlogsource: {product: windows}\ndetection:\n  selection:\n    Image: x\n  condition: selection | count() > 3\n',
    );
    const { code, err } = dojo(['test', '1', 'agg.yml']);
    assert.equal(code, 2);
    assert.match(err, /aggregat/i);
  });

  it('rejects a rule file above the size limit before parsing it', () => {
    writeFileSync(join(work, 'huge.yml'), 'x'.repeat(300 * 1024));
    const { code, err } = dojo(['test', '1', 'huge.yml']);
    assert.equal(code, 2);
    assert.match(err, /limit/);
  });
});

describe('lint', () => {
  it('accepts a well-formed rule', () => {
    const { code, out } = dojo(['lint', join(FIXTURE_KATA, 'solution.yml')]);
    assert.equal(code, 0);
    assert.match(out, /0 error\(s\), 0 warning\(s\)/);
  });

  it('flags hygiene problems as warnings and fails only with --strict', () => {
    writeFileSync(
      join(work, 'sloppy.yml'),
      "title: Sloppy\nlogsource: {product: windows}\ndetection:\n  selection:\n    CommandLine|contains: 'ab'\n    Image|re: '(a+)+$'\n  condition: selection\n",
    );
    const loose = dojo(['lint', 'sloppy.yml']);
    assert.equal(loose.code, 0);
    for (const id of ['missing-id', 'broad-short-contains', 'nested-quantifier-redos', 'missing-attack-tag']) {
      assert.match(loose.out, new RegExp(id));
    }
    assert.equal(dojo(['lint', 'sloppy.yml', '--strict']).code, 1);
  });

  it('exits 1 for a rule that cannot compile and reports JSON findings', () => {
    writeFileSync(join(work, 'broken.yml'), 'title: x\nlogsource: {}\ndetection:\n  selection: {Image: x}\n  condition: selecton\n');
    const { code, out } = dojo(['lint', 'broken.yml', '--json']);
    assert.equal(code, 1);
    const report = JSON.parse(out) as { errors: number; findings: Array<{ severity: string }> };
    assert.equal(report.errors, 1);
    assert.equal(report.findings[0]?.severity, 'error');
  });

  it('lints a directory recursively and skips node_modules', () => {
    mkdirSync(join(work, 'rules', 'node_modules'), { recursive: true });
    writeFileSync(join(work, 'rules', 'ok.yml'), readFileSync(join(FIXTURE_KATA, 'solution.yml')));
    writeFileSync(join(work, 'rules', 'node_modules', 'bad.yml'), 'not: [a rule');
    const { code, out } = dojo(['lint', 'rules', '--json']);
    assert.equal(code, 0);
    assert.equal((JSON.parse(out) as { files: number }).files, 1);
  });

  it('warns when the rule logsource differs from the kata', () => {
    writeFileSync(
      join(work, 'wrongsrc.yml'),
      'title: t\nlogsource: {product: linux, category: process_creation}\ndetection:\n  selection:\n    Image|endswith: /x\n  condition: selection\n',
    );
    assert.match(dojo(['lint', 'wrongsrc.yml', '--kata', '1']).out, /logsource-mismatch/);
  });
});

describe('new and validate-kata', () => {
  it('scaffolds a kata whose only validation errors are the template markers', () => {
    const katas = join(work, 'mykatas');
    const created = dojo(['new', 'demo-kata', '--dir', katas, '--tier', '2']);
    assert.equal(created.code, 0);
    const target = join(katas, '01-demo-kata');
    for (const file of ['kata.yml', 'starter.yml', 'solution.yml', 'explain.md', 'events/positive.jsonl', 'events/benign.jsonl', 'events/variants.jsonl']) {
      assert.ok(existsSync(join(target, file)), file);
    }
    const checked = dojo(['validate-kata', target, '--json']);
    assert.equal(checked.code, 1);
    const report = JSON.parse(checked.out) as { katas: Array<{ errors: string[] }> };
    const errors = report.katas[0]?.errors ?? [];
    assert.ok(errors.length > 0);
    assert.ok(errors.every((message) => message.includes('CHANGE ME')), errors.join('\n'));
  });

  it('numbers the next kata after existing ones and refuses to overwrite or duplicate an id', () => {
    const katas = join(work, 'mykatas');
    assert.equal(dojo(['new', 'second-kata', '--dir', katas]).code, 0);
    assert.ok(existsSync(join(katas, '02-second-kata')));
    assert.equal(dojo(['new', 'second-kata', '--dir', katas]).code, 2);
  });

  it('rejects invalid ids', () => {
    for (const id of ['Bad_ID', '../x', 'a', '-lead']) assert.equal(dojo(['new', id, '--dir', join(work, 'zz')]).code, 2, id);
  });

  it('validates the fixture kata with --all', () => {
    const { code, out } = dojo(['validate-kata', '--all']);
    assert.equal(code, 0, out);
    assert.match(out, /all valid/);
  });
});
