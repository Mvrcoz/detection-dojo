/**
 * Public types of the Sigma evaluator. Internals (AST, matchers) are private
 * to src/sigma/ and may be designed freely; this file is the contract that the
 * kata engine and the CLI build against.
 */

/** A log event. Values are JSON values. Field lookup rules are in docs/ARCHITECTURE.md. */
export type SigmaEvent = Record<string, unknown>;

export type SigmaLevel = 'informational' | 'low' | 'medium' | 'high' | 'critical';

export interface SigmaLogsource {
  product?: string;
  category?: string;
  service?: string;
  definition?: string;
  [key: string]: unknown;
}

export interface SigmaDetection {
  condition: string | string[];
  timeframe?: string;
  /** Named selections / filters / keyword lists, referenced from `condition`. */
  [name: string]: unknown;
}

export interface SigmaRule {
  title: string;
  id?: string;
  name?: string;
  status?: string;
  description?: string;
  author?: string;
  date?: string;
  modified?: string;
  references?: string[];
  tags?: string[];
  logsource: SigmaLogsource;
  detection: SigmaDetection;
  fields?: string[];
  falsepositives?: string[];
  level?: SigmaLevel;
  [key: string]: unknown;
}

export interface MatchResult {
  matched: boolean;
  /** Result of every named selection for this event, used to explain misses to learners. */
  selections: Record<string, boolean>;
}

export interface CompiledRule {
  rule: SigmaRule;
  /** Names of every selection defined in `detection` (excluding `condition`/`timeframe`). */
  selectionNames: string[];
  /** Sorted, de-duplicated event field names the rule reads (keyword searches excluded). */
  usedFields: string[];
  /** Non-fatal issues found while compiling (e.g. a selection never referenced by the condition). */
  warnings: string[];
  match(event: SigmaEvent): MatchResult;
}
