import { watch } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { DojoError, UsageError } from '../errors.ts';
import { gradeRuleIsolated, loadKata } from '../kata/index.ts';
import type { GradeResult, Kata } from '../kata/types.ts';
import { bold, clearScreen, dim, red, symbols, yellow } from '../render/color.ts';
import { renderPassEpilogue, renderScorecard } from '../render/scorecard.ts';
import { flag, parseCommandArgs, print, readRuleFile, rejectExtraPositionals, requirePositional } from './common.ts';
import { recordAndSuggest } from './test.ts';

export const WATCH_USAGE = 'dojo watch <kata> <rule.yml>';

const DEBOUNCE_MS = 150;

export interface WatchDeps {
  readRule(): string;
  grade(ruleYaml: string): Promise<GradeResult>;
  record(result: GradeResult): { attempts: number; next: string | undefined };
}

/**
 * The state machine behind `dojo watch`, kept free of file watching and
 * terminal I/O so it can be unit tested: every save becomes one `runOnce`,
 * and consecutive failures slowly unlock the kata's hints (hint 1 appears on
 * the second failing run, hint 2 on the third, and so on).
 */
export class WatchSession {
  private readonly kata: Kata;
  private readonly deps: WatchDeps;
  private failures = 0;

  constructor(kata: Kata, deps: WatchDeps) {
    this.kata = kata;
    this.deps = deps;
  }

  get consecutiveFailures(): number {
    return this.failures;
  }

  private revealedHints(): string[] {
    const count = Math.min(Math.max(0, this.failures - 1), this.kata.meta.hints.length);
    return this.kata.meta.hints.slice(0, count);
  }

  async runOnce(): Promise<{ output: string; passed: boolean }> {
    let result: GradeResult;
    try {
      result = await this.deps.grade(this.deps.readRule());
    } catch (error) {
      if (!(error instanceof DojoError)) throw error;
      this.failures += 1;
      const lines = ['', `  ${red(bold('Your rule could not be graded'))}`, `  ${error.message}`];
      const hints = this.revealedHints();
      if (hints.length > 0) {
        lines.push('', `  ${bold('Hints')}`);
        hints.forEach((hint, index) => lines.push(`    ${index + 1}. ${hint}`));
      }
      lines.push('');
      return { output: lines.join('\n'), passed: false };
    }

    if (result.passed) {
      this.failures = 0;
      const recorded = this.deps.record(result);
      const epilogue = renderPassEpilogue(this.kata, recorded.next === undefined ? {} : { nextSuggestion: recorded.next });
      return { output: renderScorecard(this.kata, result, { attempts: recorded.attempts }) + epilogue, passed: true };
    }

    this.failures += 1;
    const recorded = this.deps.record(result);
    return {
      output: renderScorecard(this.kata, result, { attempts: recorded.attempts, revealedHints: this.revealedHints() }),
      passed: false,
    };
  }
}

export async function watchCommand(args: string[]): Promise<number> {
  const parsed = parseCommandArgs(args, {});
  if (flag(parsed, 'json')) throw new UsageError('watch is interactive and does not support --json. Use `dojo test --json` instead.');
  rejectExtraPositionals(parsed, 2, WATCH_USAGE);
  const kata = loadKata(requirePositional(parsed, 0, 'kata', WATCH_USAGE));
  const file = resolve(requirePositional(parsed, 1, 'rule.yml', WATCH_USAGE));
  readRuleFile(file); // fail early with a friendly message if the file is missing

  const session = new WatchSession(kata, {
    readRule: () => readRuleFile(file),
    grade: (ruleYaml) => gradeRuleIsolated(kata, ruleYaml),
    record: (result) => recordAndSuggest(kata, result),
  });

  const footer = `  ${dim(`Watching ${file}`)}\n  ${dim('Save the file to re-run. Press Ctrl-C to stop.')}\n`;
  let running = false;
  let pending = false;

  const render = async (): Promise<void> => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      do {
        pending = false;
        const { output } = await session.runOnce();
        process.stdout.write(clearScreen() + output + footer);
      } while (pending);
    } catch (error) {
      process.stdout.write(`${yellow(symbols().bad)} ${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      running = false;
    }
  };

  await render();

  // Watch the directory: many editors save by writing a temp file and renaming it over the original.
  const wanted = basename(file).toLowerCase();
  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(dirname(file), { persistent: true }, (_event, filename) => {
    if (filename !== null && filename.toString().toLowerCase() !== wanted) return;
    clearTimeout(timer);
    timer = setTimeout(() => void render(), DEBOUNCE_MS);
  });

  await new Promise<void>((done) => {
    process.once('SIGINT', () => {
      clearTimeout(timer);
      watcher.close();
      print();
      done();
    });
  });
  return 0;
}
