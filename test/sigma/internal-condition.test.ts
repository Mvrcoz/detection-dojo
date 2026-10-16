import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RuleParseError, UnsupportedFeatureError } from '../../src/errors.ts';
import {
  collectReferences,
  compileCondition,
  parseCondition,
  readConditions,
  type ConditionNode,
} from '../../src/sigma/condition.ts';

const NAMES = ['a', 'b', 'c', 'selection_x', 'selection_y', 'filter_1', '_hidden'];

/** Evaluate `source` when exactly the named selections are true. */
function evaluate(source: string, truthy: readonly string[], names: readonly string[] = NAMES): boolean {
  const node = parseCondition(source, names, 'detection.condition');
  return compileCondition(node)(names.map((name) => truthy.includes(name)));
}

function parseError(source: string, names: readonly string[] = NAMES): RuleParseError {
  try {
    parseCondition(source, names, 'detection.condition');
  } catch (error) {
    assert.ok(error instanceof RuleParseError, `expected RuleParseError, got ${String(error)}`);
    return error;
  }
  assert.fail(`"${source}" should not parse`);
}

describe('operator precedence', () => {
  it('and binds tighter than or', () => {
    // a or (b and c)
    assert.equal(evaluate('a or b and c', ['a']), true);
    assert.equal(evaluate('a or b and c', ['b']), false);
    assert.equal(evaluate('a or b and c', ['b', 'c']), true);
    // (a and b) or c
    assert.equal(evaluate('a and b or c', ['c']), true);
    assert.equal(evaluate('a and b or c', ['a']), false);
  });

  it('not binds tighter than and', () => {
    // (not a) and b
    assert.equal(evaluate('not a and b', ['b']), true);
    assert.equal(evaluate('not a and b', ['a', 'b']), false);
    assert.equal(evaluate('not a and b', []), false);
  });

  it('not binds tighter than or', () => {
    assert.equal(evaluate('not a or b', []), true);
    assert.equal(evaluate('not a or b', ['a']), false);
    assert.equal(evaluate('not a or b', ['a', 'b']), true);
  });

  it('parentheses override precedence', () => {
    assert.equal(evaluate('(a or b) and c', ['a']), false);
    assert.equal(evaluate('(a or b) and c', ['a', 'c']), true);
    assert.equal(evaluate('not (a or b)', ['c']), true);
    assert.equal(evaluate('not (a or b)', ['b']), false);
    assert.equal(evaluate('a and not (b or c)', ['a']), true);
    assert.equal(evaluate('a and not (b or c)', ['a', 'c']), false);
  });

  it('chains of the same operator are flat', () => {
    const node = parseCondition('a and b and c', NAMES, 'p');
    assert.equal(node.type, 'and');
    assert.equal(node.type === 'and' && node.operands.length, 3);
    const either = parseCondition('a or b or c', NAMES, 'p');
    assert.equal(either.type === 'or' && either.operands.length, 3);
  });

  it('is not sensitive to extra whitespace, tabs or newlines', () => {
    assert.equal(evaluate('  a\tand\n  b ', ['a', 'b']), true);
    assert.equal(evaluate('(a)and(b)', ['a', 'b']), true);
  });

  it('treats keywords case-insensitively but names case-sensitively', () => {
    assert.equal(evaluate('a AND NOT b', ['a']), true);
    assert.equal(evaluate('A', ['a'], ['A', 'a']), false);
    assert.equal(evaluate('Not a Or B', [], ['a', 'B']), true);
  });

  it('folds repeated negations instead of recursing', () => {
    assert.equal(evaluate('not not a', ['a']), true);
    assert.equal(evaluate('not not not a', ['a']), false);
    const long = `${'not '.repeat(100_001)}a`;
    assert.equal(evaluate(long, ['a']), false);
  });
});

describe('quantifiers', () => {
  it('1 of / any of: at least one match', () => {
    assert.equal(evaluate('1 of selection_*', ['selection_y']), true);
    assert.equal(evaluate('any of selection_*', ['selection_x']), true);
    assert.equal(evaluate('1 of selection_*', ['a']), false);
  });

  it('all of: every match', () => {
    assert.equal(evaluate('all of selection_*', ['selection_x']), false);
    assert.equal(evaluate('all of selection_*', ['selection_x', 'selection_y']), true);
  });

  it('supports wildcards at the start, the middle and several places', () => {
    assert.equal(evaluate('1 of *_x', ['selection_x']), true);
    assert.equal(evaluate('1 of sel*_y', ['selection_y']), true);
    assert.equal(evaluate('all of *ction_*', ['selection_x', 'selection_y']), true);
    assert.equal(evaluate('1 of filter_1', ['filter_1']), true);
  });

  it('them covers all selections except those starting with an underscore', () => {
    assert.equal(evaluate('1 of them', ['_hidden']), false);
    assert.equal(evaluate('1 of them', ['c']), true);
    const everyVisible = NAMES.filter((name) => !name.startsWith('_'));
    assert.equal(evaluate('all of them', everyVisible), true);
    assert.equal(evaluate('all of them', ['a']), false);
  });

  it('combines with the other operators', () => {
    assert.equal(evaluate('1 of selection_* and not 1 of filter*', ['selection_x']), true);
    assert.equal(evaluate('1 of selection_* and not 1 of filter*', ['selection_x', 'filter_1']), false);
    assert.equal(evaluate('a and 1 of selection_*', ['a', 'selection_y']), true);
  });

  it('accepts quantifier keywords in any case', () => {
    assert.equal(evaluate('ALL OF Them', NAMES.filter((n) => !n.startsWith('_'))), true);
  });

  it('records the selections a pattern resolved to', () => {
    const node = parseCondition('1 of selection_*', NAMES, 'p');
    assert.deepEqual(node.type === 'of' && node.indexes, [3, 4]);
  });
});

describe('references', () => {
  it('collects every selection the condition uses', () => {
    const used = new Set<number>();
    collectReferences(parseCondition('a and not (b or 1 of selection_*)', NAMES, 'p'), used);
    assert.deepEqual([...used].sort(), [0, 1, 3, 4]);
  });
});

describe('condition errors', () => {
  it('names an undefined selection, lists the defined ones and suggests the nearest', () => {
    const error = parseError('selecton', ['selection', 'filter']);
    assert.match(error.message, /Selection 'selecton' is not defined; defined selections: selection, filter/);
    assert.match(error.message, /Did you mean 'selection'\?/);
    assert.equal(error.path, 'detection.condition');
  });

  it('does not suggest unrelated names', () => {
    assert.doesNotMatch(parseError('zzz', ['selection', 'filter']).message, /Did you mean/);
  });

  it('reports a pattern that matches nothing', () => {
    assert.match(parseError('1 of nothing_*').message, /pattern 'nothing_\*' matches no selection/);
    assert.match(parseError('1 of them', ['_only']).message, /'them' matches no selection/);
  });

  it('reports an empty condition', () => {
    assert.match(parseError('   ').message, /condition is empty/);
  });

  it('reports dangling operators and parentheses', () => {
    assert.match(parseError('a and').message, /ends too early/);
    assert.match(parseError('a or or b').message, /keyword/);
    assert.match(parseError('(a and b').message, /Missing closing '\)'/);
    assert.match(parseError('a and b)').message, /no matching '\('/);
    assert.match(parseError('a b').message, /joined with 'and' or 'or'/);
    assert.match(parseError('()').message, /selection name was expected/);
    assert.match(parseError('not').message, /ends too early/);
  });

  it('rejects quantifiers other than 1, any and all', () => {
    assert.match(parseError('2 of selection_*').message, /Sigma only defines '1 of'/);
    assert.match(parseError('some of selection_*').message, /use '1 of', 'any of' or 'all of'/);
    assert.match(parseError('1 of').message, /needs 'them' or a selection name pattern/);
    assert.match(parseError('1 of and').message, /needs 'them' or a selection name pattern/);
  });

  it('refuses absurd parenthesis nesting instead of overflowing the stack', () => {
    const depth = 5_000;
    const error = parseError(`${'('.repeat(depth)}a${')'.repeat(depth)}`);
    assert.match(error.message, /nests parentheses/);
  });

  it('reports aggregations as unsupported, naming the fix', () => {
    for (const source of ['selection | count() > 5', 'a | near b', 'a|count(x) by y >= 3']) {
      assert.throws(
        () => parseCondition(source, NAMES, 'p'),
        (error: unknown) =>
          error instanceof UnsupportedFeatureError &&
          error.feature === 'aggregation' &&
          /SIEM/.test(error.message) &&
          /falsepositives/.test(error.message),
        source,
      );
    }
  });

  it('reports a pipe before other syntax problems', () => {
    assert.throws(() => parseCondition('selection ) | count() > 1', NAMES, 'p'), UnsupportedFeatureError);
  });
});

describe('readConditions', () => {
  it('accepts a string or a list of strings, with a path for each', () => {
    assert.deepEqual(readConditions({ condition: 'a' }), [{ source: 'a', path: 'detection.condition' }]);
    assert.deepEqual(readConditions({ condition: ['a', 'b'] }), [
      { source: 'a', path: 'detection.condition[0]' },
      { source: 'b', path: 'detection.condition[1]' },
    ]);
  });

  it('rejects a missing, empty or non-text condition', () => {
    assert.throws(() => readConditions({}), (e: unknown) => e instanceof RuleParseError && e.path === 'detection.condition');
    assert.throws(() => readConditions({ condition: null }), RuleParseError);
    assert.throws(() => readConditions({ condition: [] }), /empty/);
    assert.throws(
      () => readConditions({ condition: ['a', 5] }),
      (e: unknown) => e instanceof RuleParseError && e.path === 'detection.condition[1]',
    );
    assert.throws(() => readConditions({ condition: { a: 1 } }), /nested map/);
  });
});

describe('compiled evaluator', () => {
  it('only reads results by index and tolerates missing entries', () => {
    const node: ConditionNode = { type: 'ref', index: 9 };
    assert.equal(compileCondition(node)([true]), false);
  });
});
