import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { UsageError } from '../errors.ts';
import { loadKata } from '../kata/index.ts';
import { bold, cyan, dim } from '../render/color.ts';
import { flag, parseCommandArgs, print, rejectExtraPositionals, requirePositional, text } from './common.ts';
import { renderBriefing } from './show.ts';

export const START_USAGE = 'dojo start <kata> [--out FILE] [--force]';

export async function startCommand(args: string[]): Promise<number> {
  const parsed = parseCommandArgs(args, { out: { type: 'string' }, force: { type: 'boolean' } });
  rejectExtraPositionals(parsed, 1, START_USAGE);
  const kata = loadKata(requirePositional(parsed, 0, 'kata', START_USAGE));

  const target = resolve(text(parsed, 'out') ?? `${kata.meta.id}.yml`);
  if (existsSync(target) && !flag(parsed, 'force')) {
    throw new UsageError(`'${target}' already exists, so it was left untouched. Pick another name with --out, or pass --force to overwrite it.`);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, kata.starter.endsWith('\n') ? kata.starter : `${kata.starter}\n`, 'utf8');

  print(renderBriefing(kata));
  print(`  ${bold('Your starter rule is ready:')} ${target}`);
  print(`  Edit it, then grade it as you save with:  ${cyan(`dojo watch ${kata.meta.number} ${text(parsed, 'out') ?? `${kata.meta.id}.yml`}`)}`);
  print(`  ${dim(`Or grade once with: dojo test ${kata.meta.number} <file>`)}`);
  print();
  return 0;
}
