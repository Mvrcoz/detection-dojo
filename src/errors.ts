/**
 * Error types shared across detection-dojo.
 *
 * Rule of thumb: anything a *user* can cause (bad YAML, unsupported Sigma
 * feature, unknown kata, malformed events file) is a DojoError subclass and is
 * shown as a friendly message. Anything else is a bug and may surface as a
 * stack trace.
 */

export class DojoError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** The rule file is not valid YAML or not a structurally valid Sigma rule. */
export class RuleParseError extends DojoError {
  /** Dotted location inside the rule, e.g. `detection.selection.Image|contains`. */
  readonly path: string | undefined;

  constructor(message: string, path?: string, options?: { cause?: unknown }) {
    super('RULE_PARSE', message, options);
    this.path = path;
  }
}

/**
 * The rule uses valid Sigma that this evaluator deliberately does not support
 * (aggregations, `near`, correlation rules, unknown modifiers, ...). We fail
 * loudly instead of silently returning a wrong answer.
 */
export class UnsupportedFeatureError extends DojoError {
  readonly feature: string;

  constructor(feature: string, message: string) {
    super('UNSUPPORTED_FEATURE', message);
    this.feature = feature;
  }
}

/** A kata directory is missing files or violates the kata format. */
export class KataFormatError extends DojoError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('KATA_FORMAT', message, options);
  }
}

/** The user asked for a kata that does not exist. */
export class KataNotFoundError extends DojoError {
  constructor(query: string, available: string[]) {
    super(
      'KATA_NOT_FOUND',
      `No kata matches "${query}". Try one of: ${available.join(', ') || '(none installed)'}.`,
    );
  }
}

/** Grading did not finish in time (for example a pathological regex). */
export class GradeTimeoutError extends DojoError {
  constructor(timeoutMs: number) {
    super(
      'GRADE_TIMEOUT',
      `Grading took longer than ${timeoutMs} ms and was stopped. A regular expression in your rule may be catastrophically slow (ReDoS).`,
    );
  }
}

/** Command-line usage problem (unknown flag, missing argument). */
export class UsageError extends DojoError {
  constructor(message: string) {
    super('USAGE', message);
  }
}
