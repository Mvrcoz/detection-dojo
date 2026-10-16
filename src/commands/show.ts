import { UsageError } from '../errors.ts';
import { loadKata } from '../kata/index.ts';
import type { Kata } from '../kata/types.ts';
import { bold, cyan, dim, gray } from '../render/color.ts';
import { tierName } from '../render/scorecard.ts';
import {
  attackUrl,
  flag,
  parseCommandArgs,
  print,
  printJson,
  rejectExtraPositionals,
  requirePositional,
  text,
} from './common.ts';

export const SHOW_USAGE = 'dojo show <kata> [--hint N] [--events] [--json]';

/** Field names seen across the attack events, most common first: the learner's vocabulary for the rule. */
export function fieldsSeen(kata: Kata): string[] {
  const counts = new Map<string, number>();
  for (const { event } of kata.positives) {
    for (const key of Object.keys(event)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => key);
}

function describeLogsource(kata: Kata): string {
  const { product, category, service } = kata.meta.logsource;
  return [product && `product: ${product}`, category && `category: ${category}`, service && `service: ${service}`]
    .filter(Boolean)
    .join(', ');
}

/** The scenario briefing, shared by `show` and `start`. Never reveals benign events or the solution. */
export function renderBriefing(kata: Kata): string {
  const meta = kata.meta;
  const lines: string[] = [];
  lines.push('');
  lines.push(`  ${bold(`Kata ${String(meta.number).padStart(2, '0')}: ${meta.title}`)}`);
  lines.push(`  ${dim(`${tierName(meta.tier)}  |  ${meta.kind === 'tune' ? 'tune the rule' : 'write the rule'}  |  about ${meta.estimated_minutes} min`)}`);
  lines.push('');
  for (const line of meta.scenario.trim().split(/\r?\n/)) lines.push(`  ${line}`);
  lines.push('');
  lines.push(`  ${bold('Objective')}  ${meta.objective.trim()}`);
  lines.push(`  ${bold('Log source')} ${describeLogsource(kata)}`);
  lines.push(`  ${bold('ATT&CK')}     ${meta.attack.map((id) => `${id} ${gray(attackUrl(id))}`).join('  ')}`);
  lines.push('');
  lines.push(`  ${bold('Fields in these events')}  ${fieldsSeen(kata).join(', ')}`);
  const sample = kata.positives[0];
  if (sample !== undefined) {
    lines.push('');
    lines.push(`  ${bold('One example of the attack')}`);
    for (const line of JSON.stringify(sample.event, null, 2).split('\n')) lines.push(`    ${line}`);
  }
  lines.push('');
  lines.push(`  ${dim(`${meta.hints.length} hints available: dojo show ${meta.number} --hint 1`)}`);
  lines.push('');
  return lines.join('\n');
}

export async function showCommand(args: string[]): Promise<number> {
  const parsed = parseCommandArgs(args, { hint: { type: 'string' }, events: { type: 'boolean' } });
  rejectExtraPositionals(parsed, 1, SHOW_USAGE);
  const kata = loadKata(requirePositional(parsed, 0, 'kata', SHOW_USAGE));

  const hintText = text(parsed, 'hint');
  if (hintText !== undefined) {
    const n = Number(hintText);
    if (!Number.isInteger(n) || n < 1 || n > kata.meta.hints.length) {
      throw new UsageError(`--hint must be a number from 1 to ${kata.meta.hints.length} (got '${hintText}').`);
    }
    const hint = kata.meta.hints[n - 1] ?? '';
    if (flag(parsed, 'json')) printJson({ kata: kata.meta.id, hint: n, text: hint });
    else {
      print();
      print(`  ${cyan(`Hint ${n} of ${kata.meta.hints.length}`)}  ${hint}`);
      print();
    }
    return 0;
  }

  if (flag(parsed, 'json')) {
    printJson({
      ...kata.meta,
      fields: fieldsSeen(kata),
      example: kata.positives[0]?.event ?? null,
      ...(flag(parsed, 'events') ? { events: kata.positives.map((p) => p.event) } : {}),
    });
    return 0;
  }

  print(renderBriefing(kata));
  if (flag(parsed, 'events')) {
    print(`  ${bold('All attack events')}`);
    for (const positive of kata.positives) print(`    ${JSON.stringify(positive.event)}`);
    print();
  }
  return 0;
}
