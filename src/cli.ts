#!/usr/bin/env node
/**
 * detection-dojo command-line entry point: dispatches to a command and turns
 * every kind of failure into one of the documented exit codes
 * (docs/ARCHITECTURE.md section 2).
 */

import { readFileSync } from 'node:fs';
import { DojoError } from './errors.ts';
import { lintCommand, LINT_USAGE } from './commands/lint.ts';
import { listCommand, LIST_USAGE } from './commands/list.ts';
import { newCommand, NEW_USAGE } from './commands/new.ts';
import { showCommand, SHOW_USAGE } from './commands/show.ts';
import { startCommand, START_USAGE } from './commands/start.ts';
import { testCommand, TEST_USAGE } from './commands/test.ts';
import { validateKataCommand, VALIDATE_USAGE } from './commands/validate-kata.ts';
import { watchCommand, WATCH_USAGE } from './commands/watch.ts';
import { bold, configureOutput, cyan, dim } from './render/color.ts';

type Command = (args: string[]) => Promise<number>;

const COMMANDS: Record<string, { run: Command; usage: string; summary: string }> = {
  list: { run: listCommand, usage: LIST_USAGE, summary: 'Show the curriculum and your progress' },
  show: { run: showCommand, usage: SHOW_USAGE, summary: 'Read a kata\'s scenario, objective and hints' },
  start: { run: startCommand, usage: START_USAGE, summary: 'Create a starter rule file for a kata' },
  test: { run: testCommand, usage: TEST_USAGE, summary: 'Grade a rule against a kata once' },
  watch: { run: watchCommand, usage: WATCH_USAGE, summary: 'Re-grade every time you save your rule' },
  lint: { run: lintCommand, usage: LINT_USAGE, summary: 'Check Sigma rule files for common problems' },
  new: { run: newCommand, usage: NEW_USAGE, summary: 'Scaffold a new kata (for contributors)' },
  'validate-kata': { run: validateKataCommand, usage: VALIDATE_USAGE, summary: 'Validate kata directories (for contributors)' },
};

function version(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    return manifest.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function helpText(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
  const lines = Object.entries(COMMANDS).map(([name, { summary }]) => `  ${cyan(name.padEnd(width))}  ${summary}`);
  return [
    '',
    `  ${bold('detection-dojo')} ${dim(`v${version()}`)}  Learn detection engineering by writing Sigma rules that get graded.`,
    '',
    `  ${bold('Usage')}  dojo <command> [options]`,
    '',
    ...lines,
    '',
    `  ${bold('Global options')}`,
    '  --json        machine-readable output (one JSON document on stdout)',
    '  --no-color    disable colors (also honors NO_COLOR)',
    '  -h, --help    show help for a command',
    '  -v, --version show the version',
    '',
    `  ${dim('Run "dojo <command> --help" for a command\'s options.')}`,
    '',
  ].join('\n');
}

function welcome(): string {
  return [
    helpText(),
    `  ${bold('New here?')} ${cyan('dojo list')}  then  ${cyan('dojo start 1')}`,
    '',
  ].join('\n');
}

async function main(argv: string[]): Promise<number> {
  configureOutput({ noColor: argv.includes('--no-color') });

  const [first, ...rest] = argv;
  if (first === undefined) {
    process.stdout.write(`${welcome()}\n`);
    return 0;
  }
  if (first === '-v' || first === '--version') {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  if (first === '-h' || first === '--help' || first === 'help') {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }

  const command = COMMANDS[first];
  if (command === undefined || !Object.hasOwn(COMMANDS, first)) {
    process.stderr.write(`error: unknown command '${first}'. Run "dojo --help" to see the commands.\n`);
    return 2;
  }
  if (rest.includes('-h') || rest.includes('--help')) {
    process.stdout.write(`\n  Usage: ${command.usage}\n\n  ${command.summary}.\n\n`);
    return 0;
  }
  return command.run(rest);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof DojoError) {
      process.stderr.write(`error: ${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`unexpected error (this is a bug, please report it):\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 70;
  },
);
