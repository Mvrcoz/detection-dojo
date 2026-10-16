import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UsageError } from '../errors.ts';
import { isValidKataId, kataDirName, katasRoot } from '../kata/index.ts';
import { findKataDirNames, parseKataDirName } from '../kata/resolve.ts';
import { bold, cyan, dim } from '../render/color.ts';
import { flag, parseCommandArgs, print, printJson, rejectExtraPositionals, requirePositional, text } from './common.ts';

export const NEW_USAGE = 'dojo new <id> [--tier 1|2|3] [--kind write|tune] [--dir DIR] [--json]';

/** Marker left in every template; `validate-kata` refuses a kata that still contains it. */
export const PLACEHOLDER = 'CHANGE ME';

const jsonl = (events: Array<Record<string, unknown>>): string => `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;

const tool = (image: string, commandLine: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  EventID: 1,
  Image: image,
  OriginalFileName: 'dojo-example.exe',
  CommandLine: commandLine,
  ParentImage: 'C:\\Windows\\System32\\cmd.exe',
  User: 'EXAMPLE\\analyst',
  ...extra,
});

/** Existing kata directory names; a folder that does not exist yet simply has none. */
function existingKatas(root: string): string[] {
  return existsSync(root) ? findKataDirNames(root) : [];
}

function nextNumber(root: string): number {
  const numbers = existingKatas(root)
    .map((name) => parseKataDirName(name)?.number ?? 0)
    .filter((n) => n > 0);
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

export async function newCommand(args: string[]): Promise<number> {
  const parsed = parseCommandArgs(args, { tier: { type: 'string' }, kind: { type: 'string' }, dir: { type: 'string' } });
  rejectExtraPositionals(parsed, 1, NEW_USAGE);
  const id = requirePositional(parsed, 0, 'id', NEW_USAGE);
  if (!isValidKataId(id)) {
    throw new UsageError(`'${id}' is not a valid kata id. Use 2 to 51 lowercase letters, digits or hyphens, starting with a letter or digit (for example 'schtasks-persistence').`);
  }
  const tier = Number(text(parsed, 'tier') ?? '1');
  if (![1, 2, 3].includes(tier)) throw new UsageError('--tier must be 1, 2 or 3.');
  const kind = text(parsed, 'kind') ?? 'write';
  if (kind !== 'write' && kind !== 'tune') throw new UsageError("--kind must be 'write' or 'tune'.");

  const root = resolve(text(parsed, 'dir') ?? katasRoot());
  const number = nextNumber(root);
  const target = join(root, kataDirName(number, id));
  if (existsSync(target)) throw new UsageError(`'${target}' already exists; nothing was written.`);
  const sibling = existingKatas(root).find((name) => parseKataDirName(name)?.id === id);
  if (sibling !== undefined) throw new UsageError(`A kata with the id '${id}' already exists (${sibling}); ids must be unique.`);

  const needAll = tier >= 2 ? 'all' : 0;
  const kataYml = `number: ${number}
id: ${id}
title: "${PLACEHOLDER}: short, descriptive title"
tier: ${tier}
kind: ${kind}
attack:
  - T1059
tags:
  - ${PLACEHOLDER.toLowerCase().replace(' ', '-')}
logsource:
  category: process_creation
  product: windows
scenario: |
  ${PLACEHOLDER}: tell a short story that sets up ONE idea. Who ran what, where, and why a defender should care.
  Keep it concrete and free of real names, real malware or real infrastructure.
objective: >-
  ${PLACEHOLDER}: one or two sentences saying what behavior the rule must detect.
hints:
  - "${PLACEHOLDER}: a gentle nudge that points at the right field or idea."
  - "${PLACEHOLDER}: name the technique or the telltale in the command line."
  - "${PLACEHOLDER}: nearly the answer, without writing the rule for them."
thresholds:
  min_tpr: 1
  max_fpr: 0
  min_variants_caught: ${needAll}
estimated_minutes: 10
author: ${PLACEHOLDER} (your name or GitHub handle)
`;

  const starter =
    kind === 'tune'
      ? `title: ${PLACEHOLDER} noisy rule to improve
id: 00000000-0000-4000-8000-000000000000
status: experimental
description: This rule catches the attack but also fires on harmless activity. Tighten it.
logsource:
  category: process_creation
  product: windows
detection:
  selection:
    Image|endswith: '\\dojo-example.exe'
  condition: selection
level: medium
`
      : `title: ${PLACEHOLDER} your rule title
id: 00000000-0000-4000-8000-000000000000
status: experimental
description: Describe the behavior you detect.
logsource:
  category: process_creation
  product: windows
detection:
  selection:
    Image|endswith: '\\replace-me.exe'
  condition: selection
falsepositives:
  - Describe what legitimate activity could look similar
level: medium
`;

  const solution = `title: Example tool collecting data
id: 11111111-1111-4111-8111-111111111111
status: experimental
description: Detects dojo-example.exe run in collection mode. Replace with the real reference rule.
author: ${PLACEHOLDER}
tags:
  - attack.execution
  - attack.t1059
logsource:
  category: process_creation
  product: windows
detection:
  selection_image:
    - Image|endswith: '\\dojo-example.exe'
    - OriginalFileName: 'dojo-example.exe'
  selection_args:
    CommandLine|contains: '--collect'
  condition: all of selection_*
falsepositives:
  - Describe what legitimate activity could look similar
level: high
`;

  const explain = `${PLACEHOLDER}: write what the learner should take away. Explain which fields mattered, why the benign look-alikes
are benign, and what each evasion variant teaches. Two or three short paragraphs is plenty.
`;

  const positives = [
    tool('C:\\Tools\\dojo-example.exe', 'dojo-example.exe --collect all'),
    tool('C:\\Users\\analyst\\Downloads\\dojo-example.exe', 'dojo-example.exe --collect hosts'),
    tool('C:\\Windows\\Temp\\dojo-example.exe', 'dojo-example.exe --collect users --quiet'),
  ];
  const benign = [
    { ...tool('C:\\Tools\\dojo-example.exe', 'dojo-example.exe --version'), _dojo: { note: 'Printing the version collects nothing.' } },
    { ...tool('C:\\Tools\\dojo-example.exe', 'dojo-example.exe --help'), _dojo: { note: 'Help text only.' } },
    { ...tool('C:\\Tools\\dojo-example.exe', 'dojo-example.exe --verify-install'), _dojo: { note: 'Same binary, harmless mode: matching only on the image name is too broad.' } },
    { ...tool('C:\\Windows\\System32\\whoami.exe', 'whoami.exe /collect', { OriginalFileName: 'whoami.exe' }), _dojo: { note: 'Different tool that happens to share a switch name.' } },
    { ...tool('C:\\Windows\\System32\\notepad.exe', 'notepad.exe notes.txt', { OriginalFileName: 'NOTEPAD.EXE' }), _dojo: { note: 'Everyday editor.' } },
    { ...tool('C:\\Windows\\System32\\cmd.exe', 'cmd.exe /c echo collect', { OriginalFileName: 'Cmd.Exe' }), _dojo: { note: 'The word appears in an echo, not as a switch of the tool.' } },
  ];
  const variants = [
    { ...tool('C:\\TOOLS\\DOJO-EXAMPLE.EXE', 'DOJO-EXAMPLE.EXE --COLLECT all'), _dojo: { technique: 'upper-case path and switch' } },
    { ...tool('D:\\portable\\dojo-example.exe', 'dojo-example.exe   --collect   all'), _dojo: { technique: 'extra spaces between arguments' } },
    { ...tool('C:\\Users\\analyst\\AppData\\Local\\Temp\\renamed.exe', 'renamed.exe --collect all'), _dojo: { technique: 'renamed binary (OriginalFileName still gives it away)' } },
  ];

  mkdirSync(join(target, 'events'), { recursive: true });
  writeFileSync(join(target, 'kata.yml'), kataYml, 'utf8');
  writeFileSync(join(target, 'starter.yml'), starter, 'utf8');
  writeFileSync(join(target, 'solution.yml'), solution, 'utf8');
  writeFileSync(join(target, 'explain.md'), explain, 'utf8');
  writeFileSync(join(target, 'events', 'positive.jsonl'), jsonl(positives), 'utf8');
  writeFileSync(join(target, 'events', 'benign.jsonl'), jsonl(benign), 'utf8');
  writeFileSync(join(target, 'events', 'variants.jsonl'), jsonl(variants), 'utf8');

  if (flag(parsed, 'json')) {
    printJson({ created: target, number, id });
    return 0;
  }
  print();
  print(`  ${bold('Created')} ${target}`);
  print(`  Every file holds working example content marked "${PLACEHOLDER}". Replace it with your kata, then run:`);
  print(`    ${cyan(`dojo validate-kata "${target}"`)}`);
  print(`  ${dim('Validation fails until every placeholder is gone, so a template can never be published by accident.')}`);
  print(`  ${dim('Guide: docs/KATA_FORMAT.md')}`);
  print();
  return 0;
}
