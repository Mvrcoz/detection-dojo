import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UsageError } from '../errors.ts';
import { katasRoot, validateKata } from '../kata/index.ts';
import { findKataDirNames } from '../kata/resolve.ts';
import { bold, dim, green, red, symbols, yellow } from '../render/color.ts';
import { flag, parseCommandArgs, print, printJson } from './common.ts';
import { PLACEHOLDER } from './new.ts';

export const VALIDATE_USAGE = 'dojo validate-kata <dir>... | --all [--json]';

const TEXT_FILES = ['kata.yml', 'starter.yml', 'solution.yml', 'explain.md'];

/** Templates from `dojo new` carry a marker; a kata that still has it is unfinished. */
function placeholderErrors(dir: string): string[] {
  const errors: string[] = [];
  for (const name of TEXT_FILES) {
    const file = join(dir, name);
    if (existsSync(file) && readFileSync(file, 'utf8').includes(PLACEHOLDER)) {
      errors.push(`${name} still contains the template marker "${PLACEHOLDER}". Replace every placeholder with real content.`);
    }
  }
  return errors;
}

export async function validateKataCommand(args: string[]): Promise<number> {
  const parsed = parseCommandArgs(args, { all: { type: 'boolean' } });
  const dirs = flag(parsed, 'all')
    ? findKataDirNames(katasRoot()).map((name) => join(katasRoot(), name))
    : parsed.positionals.map((p) => resolve(p));
  if (dirs.length === 0) throw new UsageError(`Nothing to validate. Usage: ${VALIDATE_USAGE}`);

  const reports = dirs.map((dir) => {
    const base = validateKata(dir);
    return { dir, errors: [...base.errors, ...(base.errors.length === 0 || existsSync(dir) ? placeholderErrors(dir) : [])], warnings: base.warnings };
  });
  const failed = reports.some((report) => report.errors.length > 0);

  if (flag(parsed, 'json')) {
    printJson({ ok: !failed, katas: reports });
    return failed ? 1 : 0;
  }

  const sym = symbols();
  print();
  for (const report of reports) {
    const ok = report.errors.length === 0;
    print(`  ${ok ? green(sym.ok) : red(sym.bad)} ${bold(report.dir)}`);
    for (const message of report.errors) print(`      ${red('error')}   ${message}`);
    for (const message of report.warnings) print(`      ${yellow('warning')} ${message}`);
  }
  print();
  print(`  ${dim(`${reports.length} kata(s) checked: ${failed ? 'validation failed' : 'all valid'}`)}`);
  print();
  return failed ? 1 : 0;
}
