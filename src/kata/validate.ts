/**
 * `validateKata`: everything `dojo validate-kata` checks about a kata, from file
 * layout to whether the reference solution really passes (docs/ARCHITECTURE.md
 * section 4). Errors make the kata unusable; warnings are advice to the author.
 */

import { RuleParseError, UnsupportedFeatureError } from '../errors.ts';
import { gradeRule } from './grade.ts';
import { inspectKataDir } from './load.ts';
import type { GradeResult, Kata, KataThresholds, LabeledEvent } from './types.ts';

const MIN_POSITIVES = 3;
const MIN_BENIGN = 6;
/** Tier 2 and 3 katas are about evasion, so they must ship variants; tier 1 may omit them. */
const MIN_VARIANTS_TIER_2_AND_UP = 3;

export interface KataValidation {
  errors: string[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON with sorted keys, so two events that differ only in key order compare equal. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    const members = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value);
}

function lineList(events: LabeledEvent[]): string {
  return events.map((e) => e.line).join(', ');
}

function percent(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

function describeShortfalls(result: GradeResult, thresholds: KataThresholds): string {
  const shortfalls: string[] = [];
  if (!result.checks.tpr) {
    shortfalls.push(
      `true-positive rate ${percent(result.tpr)} is below the required ${percent(thresholds.min_tpr)} (missed positive lines: ${lineList(result.failures.missedPositives)})`,
    );
  }
  if (!result.checks.fpr) {
    shortfalls.push(
      `false-positive rate ${percent(result.fpr)} is above the allowed ${percent(thresholds.max_fpr)} (matched benign lines: ${lineList(result.failures.falsePositives)})`,
    );
  }
  if (!result.checks.variants) {
    const required = thresholds.min_variants_caught === 'all' ? result.variantsTotal : thresholds.min_variants_caught;
    shortfalls.push(
      `caught ${result.variantsCaught} of ${result.variantsTotal} variants but ${required} are required (missed variant lines: ${lineList(result.failures.missedVariants)})`,
    );
  }
  return shortfalls.join('; ');
}

/** Counts, required prose, duplicates and notes: checks that need no rule evaluation. */
function checkContent(kata: Kata, errors: string[], warnings: string[]): void {
  const { meta } = kata;

  if (kata.positives.length < MIN_POSITIVES) {
    errors.push(
      `events/positive.jsonl has ${kata.positives.length} events; a kata needs at least ${MIN_POSITIVES} events the rule must match`,
    );
  }
  if (kata.benign.length < MIN_BENIGN) {
    errors.push(
      `events/benign.jsonl has ${kata.benign.length} events; a kata needs at least ${MIN_BENIGN} look-alikes the rule must not match`,
    );
  }
  if (meta.tier >= 2 && kata.variants.length < MIN_VARIANTS_TIER_2_AND_UP) {
    errors.push(
      `events/variants.jsonl has ${kata.variants.length} events; tier ${meta.tier} katas need at least ${MIN_VARIANTS_TIER_2_AND_UP} evasion variants`,
    );
  }
  const required = meta.thresholds.min_variants_caught;
  if (required !== 'all' && required > kata.variants.length) {
    errors.push(
      `kata.yml: thresholds.min_variants_caught is ${required} but events/variants.jsonl has only ${kata.variants.length} events, so no rule could pass`,
    );
  }

  for (const [name, text] of [
    ['starter.yml', kata.starter],
    ['solution.yml', kata.solution],
    ['explain.md', kata.explain],
  ] as const) {
    if (text.trim() === '') errors.push(`${name} is empty`);
  }

  const seen = new Map<string, { group: string; line: number }>();
  const groups = [
    ['positive', kata.positives],
    ['benign', kata.benign],
    ['variant', kata.variants],
  ] as const;
  for (const [group, events] of groups) {
    for (const { event, line } of events) {
      const key = canonicalJson(event);
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, { group, line });
      } else if (first.group !== group) {
        errors.push(
          `the ${group} event on line ${line} is identical to the ${first.group} event on line ${first.line}; one event cannot be both a match and a non-match`,
        );
      } else {
        warnings.push(`the ${group} event on line ${line} repeats line ${first.line}`);
      }
    }
  }

  const unexplained = kata.benign.filter((e) => e.note === undefined);
  if (unexplained.length > 0) {
    warnings.push(
      `events/benign.jsonl lines ${lineList(unexplained)} have no "_dojo": {"note": ...}; explain why each look-alike is benign, learners see the note when they match it`,
    );
  }
  const untagged = kata.variants.filter((e) => e.technique === undefined);
  if (untagged.length > 0) {
    warnings.push(
      `events/variants.jsonl lines ${lineList(untagged)} have no "_dojo": {"technique": ...}; name the evasion technique so learners know what they missed`,
    );
  }
  if (meta.attack.length === 0) warnings.push('kata.yml: "attack" is empty; map the kata to at least one ATT&CK technique if one applies');
}

type RuleRun = { result: GradeResult } | { compileError: string };

/** Grade a reference rule; a rule that does not compile is a finding about the kata, not a crash. */
function runRule(kata: Kata, ruleYaml: string): RuleRun {
  try {
    return { result: gradeRule(kata, ruleYaml) };
  } catch (err) {
    if (err instanceof RuleParseError || err instanceof UnsupportedFeatureError) {
      return { compileError: err.message };
    }
    throw err;
  }
}

function checkSolution(kata: Kata, errors: string[], warnings: string[]): void {
  const run = runRule(kata, kata.solution);
  if ('compileError' in run) {
    errors.push(`solution.yml does not compile: ${run.compileError}`);
    return;
  }
  const { result } = run;
  for (const warning of result.warnings) warnings.push(`solution.yml: ${warning}`);

  if (!result.passed) {
    errors.push(`solution.yml does not pass the thresholds: ${describeShortfalls(result, kata.meta.thresholds)}`);
    return;
  }

  // Passing the thresholds is the requirement; catching everything is the intent
  // (a reference rule that is itself noisy teaches the wrong lesson).
  const { missedPositives, missedVariants, falsePositives } = result.failures;
  if (missedPositives.length > 0) {
    warnings.push(`solution.yml passes but misses positive events on lines ${lineList(missedPositives)}; the reference rule should match every positive`);
  }
  if (missedVariants.length > 0) {
    warnings.push(`solution.yml passes but misses variant events on lines ${lineList(missedVariants)}; the reference rule should match every variant`);
  }
  if (falsePositives.length > 0) {
    warnings.push(`solution.yml passes but matches benign events on lines ${lineList(falsePositives)}; the reference rule should match none`);
  }
}

function checkStarter(kata: Kata, errors: string[]): void {
  const run = runRule(kata, kata.starter);

  if (kata.meta.kind === 'write') {
    // A skeleton that does not even compile yet is fine: the learner has to write the rule anyway.
    if ('result' in run && run.result.passed) {
      errors.push('starter.yml already passes all thresholds; the starter of a write kata must leave work to do');
    }
    return;
  }

  if ('compileError' in run) {
    errors.push(`starter.yml of a tune kata must be a working but flawed rule, but it does not compile: ${run.compileError}`);
    return;
  }
  const { result } = run;
  if (result.fn > 0) {
    errors.push(
      `starter.yml of a tune kata must already match every positive event, but it misses lines ${lineList(result.failures.missedPositives)}`,
    );
  } else if (result.checks.fpr && result.checks.variants) {
    errors.push('starter.yml already passes all thresholds; the starter of a tune kata must produce false positives or miss variants');
  }
}

/**
 * Validate the kata in `dir`. Never throws for a bad kata: every problem is
 * returned as a message that names the file (and line) to fix.
 *
 * The solution and starter are only run once the kata is otherwise well formed,
 * because grading a kata with missing or malformed events produces misleading noise.
 */
export function validateKata(dir: string): KataValidation {
  const { kata, errors, warnings } = inspectKataDir(dir);
  if (kata === undefined) return { errors, warnings };

  checkContent(kata, errors, warnings);
  if (errors.length === 0) {
    checkSolution(kata, errors, warnings);
    checkStarter(kata, errors);
  }
  return { errors, warnings };
}
