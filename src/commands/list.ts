import { listKatas, loadProgress } from '../kata/index.ts';
import { bold, cyan, dim, green, symbols } from '../render/color.ts';
import { tierName } from '../render/scorecard.ts';
import { renderTable } from '../render/table.ts';
import { UsageError } from '../errors.ts';
import { flag, nextUnfinished, parseCommandArgs, print, printJson, rejectExtraPositionals, text } from './common.ts';

export const LIST_USAGE = 'dojo list [--tier 1|2|3] [--tag TAG] [--json]';

export async function listCommand(args: string[]): Promise<number> {
  const parsed = parseCommandArgs(args, { tier: { type: 'string' }, tag: { type: 'string' } });
  rejectExtraPositionals(parsed, 0, LIST_USAGE);

  const tierText = text(parsed, 'tier');
  const tier = tierText === undefined ? undefined : Number(tierText);
  if (tier !== undefined && ![1, 2, 3].includes(tier)) throw new UsageError(`--tier must be 1, 2 or 3 (got '${tierText}').`);
  const tag = text(parsed, 'tag')?.toLowerCase();

  const all = listKatas();
  const progress = loadProgress();
  const shown = all.filter(
    (kata) => (tier === undefined || kata.tier === tier) && (tag === undefined || kata.tags.some((t) => t.toLowerCase() === tag)),
  );

  if (flag(parsed, 'json')) {
    printJson(
      shown.map((kata) => ({
        ...kata,
        passed: progress.katas[kata.id]?.passed === true,
        attempts: progress.katas[kata.id]?.attempts ?? 0,
      })),
    );
    return 0;
  }

  if (shown.length === 0) {
    print(all.length === 0 ? 'No katas are installed.' : 'No katas match those filters.');
    return 0;
  }

  const sym = symbols();
  const rows = shown.map((kata) => {
    const entry = progress.katas[kata.id];
    const status = entry?.passed === true ? green(`${sym.ok} done`) : entry !== undefined ? dim(`${entry.attempts} tries`) : dim('-');
    return [
      String(kata.number).padStart(2, '0'),
      kata.title,
      tierName(kata.tier),
      kata.kind === 'tune' ? 'tune' : 'write',
      kata.attack.join(', '),
      `${kata.estimated_minutes} min`,
      status,
    ];
  });

  print();
  print(
    renderTable(
      [
        { header: '#' },
        { header: 'Kata' },
        { header: 'Tier' },
        { header: 'Type' },
        { header: 'ATT&CK' },
        { header: 'Time', align: 'right' },
        { header: 'Status' },
      ],
      rows,
    ),
  );
  const done = all.filter((kata) => progress.katas[kata.id]?.passed === true).length;
  print();
  print(`  ${bold(`${done}/${all.length}`)} katas completed.`);
  const next = nextUnfinished(all, progress);
  if (next !== undefined) print(`  Next: ${cyan(`dojo show ${next.number}`)}  ${dim(next.title)}`);
  print();
  return 0;
}
