/**
 * Sigma evaluator public API. See docs/ARCHITECTURE.md section 3 for the
 * supported subset of the Sigma specification and its deliberate limits.
 */
import { compileRule } from './compile.ts';
import { parseRuleYaml } from './parse.ts';
import type { CompiledRule } from './types.ts';

export type * from './types.ts';

/** Parse one Sigma rule document. Throws RuleParseError / UnsupportedFeatureError. */
export { parseRuleYaml };

/** Compile a parsed rule into a matcher. Throws RuleParseError / UnsupportedFeatureError. */
export { compileRule };

/** parseRuleYaml + compileRule. */
export function loadRule(text: string): CompiledRule {
  return compileRule(parseRuleYaml(text));
}
