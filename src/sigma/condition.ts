/**
 * The Sigma `condition` language: tokenizer, recursive-descent parser and
 * evaluator.
 *
 * Grammar, lowest to highest precedence (specification, "Condition"):
 *
 *   expression := and_expr ('or' and_expr)*
 *   and_expr   := not_expr ('and' not_expr)*
 *   not_expr   := 'not' not_expr | atom
 *   atom       := '(' expression ')' | quantifier | selection-name
 *   quantifier := ('1' | 'any' | 'all') 'of' ('them' | name-pattern)
 *
 * Selection names and `of` patterns are resolved against the rule's defined
 * selections while parsing, so a typo is reported with the condition text in
 * front of the author rather than failing silently at match time.
 */
import { RuleParseError, UnsupportedFeatureError } from '../errors.ts';
import { describeValue } from './describe.ts';
import { didYouMean } from './suggest.ts';
import { compilePattern, literal, type PatternPart } from './wildcard.ts';

export type ConditionNode =
  | { readonly type: 'ref'; readonly index: number }
  | { readonly type: 'not'; readonly operand: ConditionNode }
  | { readonly type: 'and'; readonly operands: readonly ConditionNode[] }
  | { readonly type: 'or'; readonly operands: readonly ConditionNode[] }
  | {
      readonly type: 'of';
      readonly quantifier: 'any' | 'all';
      /** Indexes (into the rule's selection list) of every selection the pattern matched. */
      readonly indexes: readonly number[];
    };

/** Evaluates a condition against the boolean result of every selection (indexed like the selection list). */
export type ConditionEvaluator = (results: readonly boolean[]) => boolean;

// Deep parentheses are the only way to make the parser (and the evaluator it
// builds) recurse; real rules nest two or three levels. `not` chains are
// folded and `and`/`or` chains are flat, so neither can recurse unboundedly.
const MAX_NESTING = 64;

interface Token {
  readonly kind: 'word' | 'open' | 'close';
  readonly text: string;
}

/**
 * A pipe starts an aggregation (`selection | count() > 5`, `| near`). It is
 * reported while tokenizing, before any other syntax problem, because the
 * rest of such a condition is not malformed, just unsupported.
 */
function aggregationError(source: string): UnsupportedFeatureError {
  return new UnsupportedFeatureError(
    'aggregation',
    `The condition "${source}" uses a pipe ('|'), which starts an aggregation such as 'count() > 5' or 'near'. ` +
      'Aggregations need a SIEM that counts events over time and are not supported here. ' +
      'Write the per-event part of the detection (everything before the pipe) and note the threshold in `falsepositives`.',
  );
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source.charAt(i);
    if (/\s/.test(char)) {
      i++;
    } else if (char === '(') {
      tokens.push({ kind: 'open', text: char });
      i++;
    } else if (char === ')') {
      tokens.push({ kind: 'close', text: char });
      i++;
    } else if (char === '|') {
      throw aggregationError(source);
    } else {
      let end = i;
      while (end < source.length && !/[\s()|]/.test(source.charAt(end))) end++;
      tokens.push({ kind: 'word', text: source.slice(i, end) });
      i = end;
    }
  }
  return tokens;
}

const RESERVED = new Set(['and', 'or', 'not', 'of']);

function describe(token: Token | undefined): string {
  return token === undefined ? 'the end of the condition' : `'${token.text}'`;
}

function listNames(names: readonly string[]): string {
  return names.length > 0 ? names.join(', ') : '(none defined)';
}

/** The names a `them` / pattern quantifier selects, as indexes. */
function selectByPattern(pattern: string, names: readonly string[]): number[] {
  if (pattern.toLowerCase() === 'them') {
    // By convention selections whose name starts with an underscore are building
    // blocks for other selections and are excluded from "them".
    return names.flatMap((name, index) => (name.startsWith('_') ? [] : [index]));
  }
  const parts: PatternPart[] = [];
  pattern.split('*').forEach((piece, i) => {
    if (i > 0) parts.push({ kind: 'any' });
    if (piece !== '') parts.push(literal(piece));
  });
  const test = compilePattern(parts, 'equals', true);
  return names.flatMap((name, index) => (test(name) ? [index] : []));
}

class ConditionParser {
  private position = 0;
  private depth = 0;
  private readonly source: string;
  private readonly tokens: readonly Token[];
  private readonly names: readonly string[];
  private readonly path: string;

  constructor(source: string, tokens: readonly Token[], names: readonly string[], path: string) {
    this.source = source;
    this.tokens = tokens;
    this.names = names;
    this.path = path;
  }

  parse(): ConditionNode {
    if (this.tokens.length === 0) {
      this.fail('The condition is empty. Name the selections that must match, for example `condition: selection`.');
    }
    const node = this.parseOr();
    const extra = this.peek();
    if (extra !== undefined) {
      this.fail(
        extra.kind === 'close'
          ? `Unexpected ')' in the condition "${this.source}"; there is no matching '('.`
          : `Unexpected ${describe(extra)} in the condition "${this.source}". Selections must be joined with 'and' or 'or'.`,
      );
    }
    return node;
  }

  private fail(message: string): never {
    throw new RuleParseError(message, this.path);
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private isWord(token: Token | undefined, word: string): boolean {
    return token?.kind === 'word' && token.text.toLowerCase() === word;
  }

  private parseOr(): ConditionNode {
    const first = this.parseAnd();
    if (!this.isWord(this.peek(), 'or')) return first;
    const operands = [first];
    while (this.isWord(this.peek(), 'or')) {
      this.position++;
      operands.push(this.parseAnd());
    }
    return { type: 'or', operands };
  }

  private parseAnd(): ConditionNode {
    const first = this.parseNot();
    if (!this.isWord(this.peek(), 'and')) return first;
    const operands = [first];
    while (this.isWord(this.peek(), 'and')) {
      this.position++;
      operands.push(this.parseNot());
    }
    return { type: 'and', operands };
  }

  private parseNot(): ConditionNode {
    // Count the negations instead of recursing: `not not x` is `x`, and a
    // hostile condition with thousands of `not`s must not grow the call stack.
    let negations = 0;
    while (this.isWord(this.peek(), 'not')) {
      this.position++;
      negations++;
    }
    const atom = this.parseAtom();
    return negations % 2 === 1 ? { type: 'not', operand: atom } : atom;
  }

  private parseAtom(): ConditionNode {
    const token = this.peek();
    if (token === undefined) {
      this.fail(`The condition "${this.source}" ends too early; a selection name or '(' was expected at the end.`);
    }

    if (token.kind === 'open') {
      if (++this.depth > MAX_NESTING) {
        this.fail(`The condition "${this.source.slice(0, 40)}..." nests parentheses more than ${MAX_NESTING} levels deep.`);
      }
      this.position++;
      const inner = this.parseOr();
      if (this.peek()?.kind !== 'close') {
        this.fail(`Missing closing ')' in the condition "${this.source}".`);
      }
      this.position++;
      this.depth--;
      return inner;
    }

    if (token.kind === 'close') {
      this.fail(`Unexpected ')' in the condition "${this.source}"; a selection name was expected before it.`);
    }

    const next = this.tokens[this.position + 1];
    if (this.isWord(next, 'of')) return this.parseQuantifier(token.text);

    if (RESERVED.has(token.text.toLowerCase())) {
      this.fail(
        `Unexpected '${token.text}' in the condition "${this.source}"; a selection name was expected here. ` +
          `('${token.text}' is a keyword and cannot be used as a selection name.)`,
      );
    }
    this.position++;
    return this.reference(token.text);
  }

  private reference(name: string): ConditionNode {
    const index = this.names.indexOf(name);
    if (index === -1) {
      const suggestion = didYouMean(name, this.names);
      this.fail(
        `Selection '${name}' is not defined; defined selections: ${listNames(this.names)}.` +
          (suggestion === undefined ? '' : ` Did you mean '${suggestion}'?`),
      );
    }
    return { type: 'ref', index };
  }

  private parseQuantifier(word: string): ConditionNode {
    const lower = word.toLowerCase();
    if (lower !== '1' && lower !== 'any' && lower !== 'all') {
      this.fail(
        /^\d+$/.test(word)
          ? `'${word} of' is not supported; Sigma only defines '1 of' (any) and 'all of'.`
          : `Unexpected '${word}' before 'of' in the condition "${this.source}"; use '1 of', 'any of' or 'all of'.`,
      );
    }
    this.position += 2; // the quantifier word and `of`

    const patternToken = this.peek();
    if (patternToken?.kind !== 'word' || RESERVED.has(patternToken.text.toLowerCase())) {
      this.fail(
        `After '${word} of' the condition "${this.source}" needs 'them' or a selection name pattern ` +
          `such as 'selection_*', but found ${describe(patternToken)}.`,
      );
    }
    this.position++;

    const indexes = selectByPattern(patternToken.text, this.names);
    if (indexes.length === 0) {
      const reason =
        patternToken.text.toLowerCase() === 'them'
          ? "'them' matches no selection (selections whose names start with '_' are excluded)"
          : `The pattern '${patternToken.text}' matches no selection`;
      this.fail(`${reason}; defined selections: ${listNames(this.names)}.`);
    }
    return { type: 'of', quantifier: lower === 'all' ? 'all' : 'any', indexes };
  }
}

/**
 * Parse one condition string. `path` locates it in the rule for error
 * messages (for example `detection.condition`).
 */
export function parseCondition(source: string, names: readonly string[], path: string): ConditionNode {
  return new ConditionParser(source, tokenize(source), names, path).parse();
}

/** Turn a parsed condition into a closure over the per-selection results. */
export function compileCondition(node: ConditionNode): ConditionEvaluator {
  switch (node.type) {
    case 'ref': {
      const { index } = node;
      return (results) => results[index] === true;
    }
    case 'not': {
      const operand = compileCondition(node.operand);
      return (results) => !operand(results);
    }
    case 'and': {
      const operands = node.operands.map(compileCondition);
      return (results) => {
        for (const operand of operands) if (!operand(results)) return false;
        return true;
      };
    }
    case 'or': {
      const operands = node.operands.map(compileCondition);
      return (results) => {
        for (const operand of operands) if (operand(results)) return true;
        return false;
      };
    }
    case 'of': {
      const { indexes } = node;
      if (node.quantifier === 'all') {
        return (results) => {
          for (const index of indexes) if (results[index] !== true) return false;
          return true;
        };
      }
      return (results) => {
        for (const index of indexes) if (results[index] === true) return true;
        return false;
      };
    }
  }
}

/** Add the index of every selection the condition refers to into `into`. */
export function collectReferences(node: ConditionNode, into: Set<number>): void {
  switch (node.type) {
    case 'ref':
      into.add(node.index);
      break;
    case 'not':
      collectReferences(node.operand, into);
      break;
    case 'and':
    case 'or':
      for (const operand of node.operands) collectReferences(operand, into);
      break;
    case 'of':
      for (const index of node.indexes) into.add(index);
      break;
  }
}

/**
 * Read `detection.condition`: a string, or a non-empty list of strings that
 * are OR-ed together. Returns each entry with the path to report errors at.
 */
export function readConditions(
  detection: Readonly<Record<string, unknown>>,
): { source: string; path: string }[] {
  const raw = detection['condition'];
  if (!Object.hasOwn(detection, 'condition') || raw === undefined || raw === null) {
    throw new RuleParseError(
      'The detection section has no condition. Add one that names your selections, for example `condition: selection`.',
      'detection.condition',
    );
  }

  const entries = Array.isArray(raw) ? raw : [raw];
  if (entries.length === 0) {
    throw new RuleParseError('The condition list is empty; give it at least one condition.', 'detection.condition');
  }
  return entries.map((entry, i) => {
    const path = Array.isArray(raw) ? `detection.condition[${i}]` : 'detection.condition';
    if (typeof entry !== 'string') {
      throw new RuleParseError(
        `The condition must be text such as 'selection and not filter', but this one is ${describeValue(entry)}.`,
        path,
      );
    }
    return { source: entry, path };
  });
}
