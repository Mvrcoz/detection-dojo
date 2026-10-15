/**
 * Sigma evaluator public API. STUB: the real implementation replaces this file.
 * See docs/ARCHITECTURE.md section 3.
 */
import type { CompiledRule, SigmaRule } from './types.ts';

export type * from './types.ts';

/** Parse one Sigma rule document. Throws RuleParseError / UnsupportedFeatureError. */
export function parseRuleYaml(_text: string): SigmaRule {
  throw new Error('not implemented');
}

/** Compile a parsed rule into a matcher. Throws RuleParseError / UnsupportedFeatureError. */
export function compileRule(_rule: SigmaRule): CompiledRule {
  throw new Error('not implemented');
}

/** parseRuleYaml + compileRule. */
export function loadRule(text: string): CompiledRule {
  return compileRule(parseRuleYaml(text));
}
