/**
 * Sigma string values: parsing of `*` / `?` wildcards and backslash escapes,
 * and matching without regular expressions.
 *
 * Wildcards are deliberately NOT converted to a RegExp. A hostile (or just
 * careless) value such as `*a*a*a*a*b` becomes an exponential pattern in a
 * backtracking regex engine, while the two-pointer matcher below is
 * polynomial in the worst case and linear for the shapes rules actually use.
 */

/** One piece of a parsed Sigma string: a run of literal text or a wildcard. */
export type PatternPart =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'any' }
  | { readonly kind: 'one' };

/** Tests one (already case-folded, if applicable) event value. */
export type StringTest = (subject: string) => boolean;

/** How a pattern is anchored against the event value. */
export type MatchMode = 'equals' | 'startswith' | 'endswith' | 'contains';

const ANY: PatternPart = Object.freeze({ kind: 'any' });
const ONE: PatternPart = Object.freeze({ kind: 'one' });

export function literal(text: string): PatternPart {
  return { kind: 'literal', text };
}

/**
 * Parse a rule value into literal runs and wildcards, using the escape rules
 * of the Sigma specification:
 *
 *   `\*` and `\?` are a literal star / question mark,
 *   `\\` is one backslash,
 *   a backslash before any other character stays a backslash (Windows paths
 *   such as `C:\Windows` need no escaping).
 *
 * Three or four backslashes therefore collapse to two, as the specification
 * requires, because each pair is consumed as one escaped backslash.
 */
export function parseWildcards(raw: string): PatternPart[] {
  const parts: PatternPart[] = [];
  let run = '';
  let escaped = false;

  const flush = (): void => {
    if (run !== '') {
      parts.push(literal(run));
      run = '';
    }
  };

  for (let i = 0; i < raw.length; i++) {
    const char = raw.charAt(i);
    if (escaped) {
      run += char === '*' || char === '?' || char === '\\' ? char : `\\${char}`;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '*') {
      flush();
      parts.push(ANY);
    } else if (char === '?') {
      flush();
      parts.push(ONE);
    } else {
      run += char;
    }
  }
  if (escaped) run += '\\';
  flush();
  return parts;
}

export function hasWildcards(parts: readonly PatternPart[]): boolean {
  return parts.some((part) => part.kind !== 'literal');
}

/** Join the literal text of a wildcard-free pattern. */
export function literalText(parts: readonly PatternPart[]): string {
  let text = '';
  for (const part of parts) if (part.kind === 'literal') text += part.text;
  return text;
}

/**
 * Apply the match mode (`contains` wraps the value in `*`, and so on), merge
 * neighbouring literals, collapse runs of `*`, and case-fold the literals
 * unless the comparison is case-sensitive. The result is the canonical form
 * that classification and matching work on.
 */
export function shapePattern(
  parts: readonly PatternPart[],
  mode: MatchMode,
  cased: boolean,
): PatternPart[] {
  const wrapped: PatternPart[] = [];
  if (mode === 'endswith' || mode === 'contains') wrapped.push(ANY);
  wrapped.push(...parts);
  if (mode === 'startswith' || mode === 'contains') wrapped.push(ANY);

  const shaped: PatternPart[] = [];
  for (const part of wrapped) {
    const last = shaped[shaped.length - 1];
    if (part.kind === 'literal') {
      if (part.text === '') continue;
      const text = cased ? part.text : part.text.toLowerCase();
      if (last?.kind === 'literal') shaped[shaped.length - 1] = literal(last.text + text);
      else shaped.push(literal(text));
    } else if (part.kind === 'any' && last?.kind === 'any') {
      continue;
    } else {
      shaped.push(part);
    }
  }
  return shaped;
}

/** True when the shaped pattern accepts every string (it is a lone `*`). */
export function matchesEverything(shaped: readonly PatternPart[]): boolean {
  return shaped.length === 1 && shaped[0]?.kind === 'any';
}

/** The text of a shaped pattern that is one plain literal (or empty), otherwise undefined. */
export function exactLiteral(shaped: readonly PatternPart[]): string | undefined {
  if (shaped.length === 0) return '';
  const only = shaped[0];
  return shaped.length === 1 && only?.kind === 'literal' ? only.text : undefined;
}

/** Build a matcher for an already shaped pattern, using native string methods for the common shapes. */
export function compileShaped(shaped: readonly PatternPart[]): StringTest {
  const [first, second, third] = shaped;

  if (shaped.length === 0) return (subject) => subject.length === 0;
  if (first?.kind === 'literal' && shaped.length === 1) {
    const text = first.text;
    return (subject) => subject === text;
  }
  if (first?.kind === 'any' && shaped.length === 1) return () => true;
  if (first?.kind === 'literal' && second?.kind === 'any' && shaped.length === 2) {
    const text = first.text;
    return (subject) => subject.startsWith(text);
  }
  if (first?.kind === 'any' && second?.kind === 'literal' && shaped.length === 2) {
    const text = second.text;
    return (subject) => subject.endsWith(text);
  }
  if (first?.kind === 'any' && second?.kind === 'literal' && third?.kind === 'any' && shaped.length === 3) {
    const text = second.text;
    return (subject) => subject.includes(text);
  }
  return compileGlob(shaped);
}

/** Shape and compile in one step; convenient for callers that need no further analysis. */
export function compilePattern(
  parts: readonly PatternPart[],
  mode: MatchMode,
  cased: boolean,
): StringTest {
  return compileShaped(shapePattern(parts, mode, cased));
}

const LITERAL = 0;
const STAR = 1;
const SINGLE = 2;

/** Number of UTF-16 code units the code point starting at `index` occupies. */
function codePointLength(text: string, index: number): number {
  const unit = text.charCodeAt(index);
  if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
    const next = text.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return 2;
  }
  return 1;
}

/**
 * General matcher for patterns mixing literals with `*` and `?`.
 *
 * Classic two-pointer scan: advance through pattern and text together, and on
 * a mismatch fall back to the most recent `*`, letting it swallow one more
 * character. Only the last `*` is ever revisited, which is what keeps this
 * polynomial instead of exponential. `?` consumes one code point, so an emoji
 * (a surrogate pair) counts as a single character.
 */
function compileGlob(shaped: readonly PatternPart[]): StringTest {
  let pattern = '';
  const kinds: number[] = [];
  let minLength = 0;
  for (const part of shaped) {
    if (part.kind === 'literal') {
      pattern += part.text;
      for (let i = 0; i < part.text.length; i++) kinds.push(LITERAL);
      minLength += part.text.length;
    } else if (part.kind === 'any') {
      pattern += '*';
      kinds.push(STAR);
    } else {
      pattern += '?';
      kinds.push(SINGLE);
      minLength += 1;
    }
  }
  const kindAt = Uint8Array.from(kinds);

  return (subject) => {
    if (subject.length < minLength) return false;
    let t = 0;
    let p = 0;
    let starPattern = -1;
    let starText = 0;
    while (t < subject.length) {
      const kind = p < kindAt.length ? kindAt[p] : -1;
      if (kind === STAR) {
        starPattern = p++;
        starText = t;
      } else if (kind === SINGLE) {
        t += codePointLength(subject, t);
        p++;
      } else if (kind === LITERAL && pattern.charCodeAt(p) === subject.charCodeAt(t)) {
        t++;
        p++;
      } else if (starPattern >= 0) {
        starText += codePointLength(subject, starText);
        t = starText;
        p = starPattern + 1;
      } else {
        return false;
      }
    }
    while (p < kindAt.length && kindAt[p] === STAR) p++;
    return p === kindAt.length;
  };
}
