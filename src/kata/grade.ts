/**
 * Grading: run a learner's Sigma rule over a kata's labeled events and decide
 * whether it passes. Pure: no I/O, no clock, no randomness, so the same rule and
 * kata always produce the same result (docs/ARCHITECTURE.md, "Grading (exact)").
 *
 * This runs the rule in the calling thread. Anything that grades a rule a
 * stranger wrote (the CLI) should go through `gradeRuleIsolated`, which adds a
 * timeout in case the rule contains a catastrophically slow regular expression.
 */

import { loadRule } from '../sigma/index.ts';
import type { CompiledRule } from '../sigma/types.ts';
import type { GradeResult, Kata, LabeledEvent } from './types.ts';

/** Individual "the rule threw on this event" warnings before the rest are summarised. */
const MAX_LISTED_MATCH_ERRORS = 5;

/**
 * Grade `ruleYaml` against `kata`. Throws `RuleParseError` or
 * `UnsupportedFeatureError` when the rule cannot be compiled.
 */
export function gradeRule(kata: Kata, ruleYaml: string): GradeResult {
  return gradeCompiledRule(kata, loadRule(ruleYaml));
}

/**
 * The grading arithmetic, separated from compiling so it can be exercised with
 * any matcher. `gradeRule` is this plus `loadRule`.
 */
export function gradeCompiledRule(kata: Kata, rule: CompiledRule): GradeResult {
  const warnings = [...rule.warnings];

  let matchErrors = 0;
  // The evaluator promises not to throw, but one odd event must not abort the
  // whole grade: count it as "not matched" and tell the learner.
  const isMatch = (labeled: LabeledEvent, group: string): boolean => {
    try {
      return rule.match(labeled.event).matched;
    } catch (err) {
      matchErrors += 1;
      if (matchErrors <= MAX_LISTED_MATCH_ERRORS) {
        const reason = err instanceof Error ? err.message : String(err);
        warnings.push(
          `match-error: the rule threw while checking the ${group} event on line ${labeled.line} (${reason}); it was counted as not matched`,
        );
      }
      return false;
    }
  };
  const partition = (events: LabeledEvent[], group: string) => {
    const matched: LabeledEvent[] = [];
    const missed: LabeledEvent[] = [];
    for (const labeled of events) (isMatch(labeled, group) ? matched : missed).push(labeled);
    return { matched, missed };
  };

  const positives = partition(kata.positives, 'positive');
  const benign = partition(kata.benign, 'benign');
  const variants = partition(kata.variants, 'variant');
  if (matchErrors > MAX_LISTED_MATCH_ERRORS) {
    warnings.push(
      `match-error: ${matchErrors - MAX_LISTED_MATCH_ERRORS} more events made the rule throw and were counted as not matched`,
    );
  }

  const tp = positives.matched.length;
  const fn = positives.missed.length;
  const fp = benign.matched.length;
  const tn = benign.missed.length;
  const variantsCaught = variants.matched.length;
  const variantsTotal = kata.variants.length;

  const tpr = tp + fn === 0 ? 1 : tp / (tp + fn);
  const fpr = fp + tn === 0 ? 0 : fp / (fp + tn);
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);

  // Each rate is one division of two integer counts, so it is the correctly
  // rounded double of the exact fraction. A threshold such as 0.8 is the same
  // double as 4/5, which keeps "exactly on the threshold" a pass. Multiplying
  // the threshold by the total instead (0.7 * 10 = 7.000000000000001) would not.
  const { min_tpr, max_fpr, min_variants_caught } = kata.meta.thresholds;
  const requiredVariants = min_variants_caught === 'all' ? variantsTotal : min_variants_caught;
  const checks = {
    tpr: tpr >= min_tpr,
    fpr: fpr <= max_fpr,
    variants: variantsCaught >= requiredVariants,
  };

  return {
    kataId: kata.meta.id,
    tp,
    fn,
    fp,
    tn,
    tpr,
    fpr,
    precision,
    variantsCaught,
    variantsTotal,
    passed: checks.tpr && checks.fpr && checks.variants,
    checks,
    failures: {
      missedPositives: positives.missed,
      falsePositives: benign.matched,
      missedVariants: variants.missed,
    },
    warnings,
  };
}
