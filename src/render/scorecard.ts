/**
 * The scorecard is the product's main screen: one glance tells a learner which
 * of the three checks failed, and the lists below show exactly which events.
 */

import type { GradeResult, Kata, LabeledEvent } from '../kata/types.ts';
import { bold, cyan, dim, gray, green, red, symbols, terminalWidth, truncate, yellow } from './color.ts';

const TIER_NAMES = { 1: 'Starter', 2: 'Intermediate', 3: 'Boss' } as const;

export function tierName(tier: 1 | 2 | 3): string {
  return TIER_NAMES[tier];
}

/** Fields that identify a log event best, in the order a defender reads them. */
const PREFERRED_FIELDS = [
  'Image',
  'CommandLine',
  'ParentImage',
  'ParentCommandLine',
  'EventID',
  'TargetObject',
  'TargetFilename',
  'DestinationIp',
  'eventName',
  'User',
];

/** One-line description of an event: its most telling fields, shortened to fit. */
export function summarizeEvent(event: Record<string, unknown>, max = 88): string {
  const commandLine = event['CommandLine'];
  if (typeof commandLine === 'string' && commandLine !== '') {
    // The command line is what a defender reads first. Mention the image only when the
    // command line does not already show it (a renamed binary is exactly that case).
    const image = event['Image'];
    const imageName = typeof image === 'string' ? (image.split(/[\\/]/).pop() ?? '') : '';
    const shown = imageName !== '' && !commandLine.toLowerCase().includes(imageName.toLowerCase());
    return truncate(shown ? `${commandLine}  [image: ${imageName}]` : commandLine, max);
  }
  const keys = Object.keys(event);
  const chosen = PREFERRED_FIELDS.filter((key) => key in event);
  const picked = (chosen.length > 0 ? chosen : keys).slice(0, 3);
  const parts = picked.map((key) => `${key}=${formatValue(event[key])}`);
  return truncate(parts.join('  '), max);
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function bar(numerator: number, denominator: number, good: boolean, width = 12): string {
  const { barFull, barEmpty } = symbols();
  const ratio = denominator === 0 ? 0 : numerator / denominator;
  const filled = Math.round(ratio * width);
  const text = barFull.repeat(filled) + barEmpty.repeat(width - filled);
  return good ? green(text) : red(text);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function requiredVariants(kata: Kata, total: number): number {
  const wanted = kata.meta.thresholds.min_variants_caught;
  return wanted === 'all' ? total : wanted;
}

export interface ScorecardOptions {
  verbose?: boolean;
  /** Attempts so far, from the learner's progress file. */
  attempts?: number;
  /** Hints already revealed by `watch`, shown under the failure lists. */
  revealedHints?: string[];
  /** Title of the kata to suggest next, shown after a pass. */
  nextSuggestion?: string;
}

export function renderScorecard(kata: Kata, result: GradeResult, options: ScorecardOptions = {}): string {
  const sym = symbols();
  const width = terminalWidth();
  const lines: string[] = [];
  const mark = (ok: boolean): string => (ok ? green(sym.ok) : red(sym.bad));
  const number = String(kata.meta.number).padStart(2, '0');

  lines.push('');
  lines.push(`  ${bold(`Kata ${number}`)} ${gray(sym.dot)} ${bold(kata.meta.title)}`);
  lines.push(`  ${dim(`${tierName(kata.meta.tier)}  ${sym.dot}  ${kata.meta.attack.join(', ')}  ${sym.dot}  ${kata.meta.kind === 'tune' ? 'tune the rule' : 'write the rule'}`)}`);
  lines.push('');

  const positives = result.tp + result.fn;
  const benign = result.fp + result.tn;
  const thresholds = kata.meta.thresholds;
  const label = (text: string): string => text.padEnd(17);

  lines.push(
    `  ${mark(result.checks.tpr)} ${label('True positives')} ${bar(result.tp, positives, result.checks.tpr)}  ${result.tp}/${positives}` +
      `  ${dim(`caught ${percent(result.tpr)}, need ${percent(thresholds.min_tpr)}`)}`,
  );
  lines.push(
    `  ${mark(result.checks.fpr)} ${label('False positives')} ${bar(result.fp, benign, result.checks.fpr)}  ${result.fp}/${benign}` +
      `  ${dim(`benign events matched, allowed ${percent(thresholds.max_fpr)}`)}`,
  );
  if (result.variantsTotal > 0) {
    const need = requiredVariants(kata, result.variantsTotal);
    lines.push(
      `  ${mark(result.checks.variants)} ${label('Evasion variants')} ${bar(result.variantsCaught, result.variantsTotal, result.checks.variants)}  ${result.variantsCaught}/${result.variantsTotal}` +
        `  ${dim(need === 0 ? 'optional for this kata' : `caught, need ${need}`)}`,
    );
  }
  lines.push('');

  if (result.passed) {
    lines.push(`  ${green(bold(' PASS '))}  ${green('Every check passed.')}`);
  } else {
    const failed = (['tpr', 'fpr', 'variants'] as const).filter((key) => !result.checks[key]).length;
    lines.push(`  ${red(bold(' FAIL '))}  ${red(`${failed} of 3 checks failed.`)}`);
  }
  if (options.attempts !== undefined) lines.push(`  ${dim(`Attempts on this kata: ${options.attempts}`)}`);

  const cap = options.verbose === true ? Number.POSITIVE_INFINITY : 5;
  const inner = Math.max(30, width - 14);
  const section = (title: string, events: LabeledEvent[], detail: (event: LabeledEvent) => string | undefined): void => {
    if (events.length === 0) return;
    lines.push('');
    lines.push(`  ${bold(title)}`);
    for (const labeled of events.slice(0, cap)) {
      lines.push(`    ${dim(`line ${String(labeled.line).padStart(2)}`)}  ${summarizeEvent(labeled.event, inner)}`);
      const extra = detail(labeled);
      if (extra !== undefined) lines.push(`             ${cyan(sym.arrow)} ${truncate(extra, inner)}`);
    }
    if (events.length > cap) lines.push(`    ${dim(`... and ${events.length - cap} more (use --verbose)`)}`);
  };

  section('Missed attacks (the rule should have fired on these):', result.failures.missedPositives, (e) => e.note);
  section('False alarms (benign events the rule fired on):', result.failures.falsePositives, (e) =>
    e.note === undefined ? undefined : `why it is benign: ${e.note}`,
  );
  section('Evasion variants that slipped past:', result.failures.missedVariants, (e) =>
    e.technique === undefined ? undefined : `technique: ${e.technique}`,
  );

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push(`  ${yellow(bold('Heads up'))}`);
    for (const warning of result.warnings) lines.push(`    ${yellow(sym.dot)} ${warning}`);
  }

  if (options.revealedHints !== undefined && options.revealedHints.length > 0 && !result.passed) {
    lines.push('');
    lines.push(`  ${bold('Hints')}`);
    options.revealedHints.forEach((hint, index) => lines.push(`    ${cyan(`${index + 1}.`)} ${hint}`));
  }

  lines.push('');
  return lines.join('\n');
}

/** What to show after a pass: the write-up, where the reference rule lives, and what to do next. */
export function renderPassEpilogue(kata: Kata, options: { nextSuggestion?: string } = {}): string {
  const lines: string[] = [];
  lines.push(`  ${bold('What to take away')}`);
  for (const line of kata.explain.trim().split(/\r?\n/)) lines.push(`  ${line}`);
  lines.push('');
  lines.push(`  ${dim('Compare with the reference rule:')} ${kata.dir}${kata.dir.includes('\\') ? '\\' : '/'}solution.yml`);
  if (options.nextSuggestion !== undefined) lines.push(`  ${dim('Next up:')} ${options.nextSuggestion}`);
  lines.push('');
  return lines.join('\n');
}
