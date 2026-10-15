/**
 * Public types of the kata engine: what a kata is on disk, and what grading a
 * rule against it returns. See docs/KATA_FORMAT.md for the on-disk format.
 */

import type { SigmaEvent, SigmaLogsource } from '../sigma/types.ts';

export type KataTier = 1 | 2 | 3;
/** `write`: author a rule from scratch. `tune`: starter rule is noisy/weak, fix it. */
export type KataKind = 'write' | 'tune';

export interface KataThresholds {
  /** Minimum true-positive rate to pass, 0..1. Default 1. */
  min_tpr: number;
  /** Maximum false-positive rate allowed, 0..1. Default 0. */
  max_fpr: number;
  /** Evasion variants that must be caught: an integer, or the string 'all'. Default 0. */
  min_variants_caught: number | 'all';
}

export interface KataMeta {
  /** Position in the curriculum, 1-based. Directory is `<NN>-<id>`. */
  number: number;
  /** Lowercase slug, `^[a-z0-9][a-z0-9-]{1,50}$`. */
  id: string;
  title: string;
  tier: KataTier;
  kind: KataKind;
  /** MITRE ATT&CK technique ids, e.g. `T1053.005`. */
  attack: string[];
  tags: string[];
  logsource: SigmaLogsource;
  /** Markdown narrative shown by `dojo show`. */
  scenario: string;
  /** One or two sentences: what the rule must detect. */
  objective: string;
  /** Progressive hints, gentlest first. 2 to 4 entries. */
  hints: string[];
  thresholds: KataThresholds;
  estimated_minutes: number;
  author: string;
}

/** One line of an events/*.jsonl file, with the optional `_dojo` annotation split out. */
export interface LabeledEvent {
  /** The event exactly as the rule sees it (the `_dojo` key is removed). */
  event: SigmaEvent;
  /** Why this event matters (shown to the learner when they get it wrong). */
  note?: string;
  /** For evasion variants: the evasion technique, e.g. "caret insertion". */
  technique?: string;
  /** 1-based line number in the source file, for error messages. */
  line: number;
}

export interface Kata {
  /** Absolute path of the kata directory. */
  dir: string;
  meta: KataMeta;
  /** Events the rule MUST match. */
  positives: LabeledEvent[];
  /** Benign look-alikes the rule MUST NOT match. */
  benign: LabeledEvent[];
  /** Evasion variants of the attack (should match; required count set by thresholds). */
  variants: LabeledEvent[];
  /** Text of starter.yml (a skeleton, or a noisy rule for `tune` katas). */
  starter: string;
  /** Text of solution.yml (reference rule). Only revealed after a pass or on request. */
  solution: string;
  /** Text of explain.md (shown after a pass). */
  explain: string;
}

export interface KataSummary {
  number: number;
  id: string;
  dirName: string;
  title: string;
  tier: KataTier;
  kind: KataKind;
  attack: string[];
  tags: string[];
  estimated_minutes: number;
}

export interface GradeFailures {
  missedPositives: LabeledEvent[];
  falsePositives: LabeledEvent[];
  missedVariants: LabeledEvent[];
}

export interface GradeResult {
  kataId: string;
  /** True positives: positives the rule matched. */
  tp: number;
  /** False negatives: positives the rule missed. */
  fn: number;
  /** False positives: benign events the rule matched. */
  fp: number;
  /** True negatives: benign events the rule correctly ignored. */
  tn: number;
  /** tp / (tp + fn), 0..1. 1 when there are no positives. */
  tpr: number;
  /** fp / (fp + tn), 0..1. 0 when there are no benign events. */
  fpr: number;
  /** tp / (tp + fp), 0 when the rule matched nothing. */
  precision: number;
  variantsCaught: number;
  variantsTotal: number;
  passed: boolean;
  /** Which individual thresholds were met. */
  checks: { tpr: boolean; fpr: boolean; variants: boolean };
  failures: GradeFailures;
  /** Rule compile warnings, surfaced to the learner. */
  warnings: string[];
}

/** Persistent learner progress, stored in `<DOJO_HOME>/progress.json`. */
export interface Progress {
  version: 1;
  katas: Record<
    string,
    {
      passed: boolean;
      attempts: number;
      bestTpr: number;
      bestFpr: number;
      bestVariantsCaught: number;
      firstPassedAt?: string;
      lastAttemptAt: string;
    }
  >;
}
