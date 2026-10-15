/**
 * Kata engine public API. STUB: the real implementation replaces this file.
 * See docs/ARCHITECTURE.md section 5.
 */
import type { GradeResult, Kata, KataSummary, Progress } from './types.ts';

export type * from './types.ts';

const nope = (): never => {
  throw new Error('not implemented');
};

export function katasRoot(): string {
  return nope();
}
export function listKatas(_root?: string): KataSummary[] {
  return nope();
}
export function loadKata(_query: string, _root?: string): Kata {
  return nope();
}
export function loadKataFromDir(_dir: string): Kata {
  return nope();
}
export function validateKata(_dir: string): { errors: string[]; warnings: string[] } {
  return nope();
}
export function gradeRule(_kata: Kata, _ruleYaml: string): GradeResult {
  return nope();
}
export function gradeRuleIsolated(
  _kata: Kata,
  _ruleYaml: string,
  _opts?: { timeoutMs?: number },
): Promise<GradeResult> {
  return nope();
}
export function loadProgress(): Progress {
  return nope();
}
export function recordResult(_kataId: string, _result: GradeResult): Progress {
  return nope();
}
export function progressPath(): string {
  return nope();
}
