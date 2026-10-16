import { gradeRuleIsolated, listKatas, loadKata, recordResult } from '../kata/index.ts';
import type { GradeResult, Kata } from '../kata/types.ts';
import { renderPassEpilogue, renderScorecard } from '../render/scorecard.ts';
import {
  flag,
  nextUnfinished,
  parseCommandArgs,
  print,
  printJson,
  readRuleFile,
  rejectExtraPositionals,
  requirePositional,
} from './common.ts';

export const TEST_USAGE = 'dojo test <kata> <rule.yml> [--solution] [--verbose] [--json]';

/** Record progress, and say what to try next. Progress problems never fail a grade. */
export function recordAndSuggest(kata: Kata, result: GradeResult): { attempts: number; next: string | undefined } {
  const progress = recordResult(kata.meta.id, result);
  let next: string | undefined;
  try {
    const candidate = nextUnfinished(listKatas(), progress, kata.meta.id);
    if (candidate !== undefined) next = `dojo show ${candidate.number}  (${candidate.title})`;
  } catch {
    // A broken sibling kata must not hide the learner's own result.
  }
  return { attempts: progress.katas[kata.meta.id]?.attempts ?? 0, next };
}

export async function testCommand(args: string[]): Promise<number> {
  const parsed = parseCommandArgs(args, { solution: { type: 'boolean' }, verbose: { type: 'boolean' } });
  const useSolution = flag(parsed, 'solution');
  rejectExtraPositionals(parsed, useSolution ? 1 : 2, TEST_USAGE);

  const kata = loadKata(requirePositional(parsed, 0, 'kata', TEST_USAGE));
  const ruleYaml = useSolution ? kata.solution : readRuleFile(requirePositional(parsed, 1, 'rule.yml', TEST_USAGE));
  const result = await gradeRuleIsolated(kata, ruleYaml);

  // Grading the reference solution is a maintainer check; it is not the learner's progress.
  const recorded = useSolution ? { attempts: undefined, next: undefined } : recordAndSuggest(kata, result);

  if (flag(parsed, 'json')) {
    printJson({ kata: kata.meta.id, passed: result.passed, solution: useSolution, result });
    return result.passed ? 0 : 1;
  }

  print(renderScorecard(kata, result, { verbose: flag(parsed, 'verbose'), attempts: recorded.attempts }));
  if (result.passed) print(renderPassEpilogue(kata, recorded.next === undefined ? {} : { nextSuggestion: recorded.next }));
  return result.passed ? 0 : 1;
}
