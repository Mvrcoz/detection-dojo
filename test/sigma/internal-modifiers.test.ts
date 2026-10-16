import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RuleParseError, UnsupportedFeatureError } from '../../src/errors.ts';
import {
  compileValues,
  MAX_COMPILED_PATTERNS,
  MAX_REGEX_LENGTH,
  parseModifierChain,
  parseNumeric,
  type ModifierChain,
  type RuleValue,
} from '../../src/sigma/modifiers.ts';

const PATH = 'detection.selection.F';

function chain(key: string): ModifierChain {
  return parseModifierChain(key, PATH);
}

function invalid(key: string): RuleParseError {
  try {
    parseModifierChain(key, PATH);
  } catch (error) {
    assert.ok(error instanceof RuleParseError, `expected RuleParseError for ${key}, got ${String(error)}`);
    assert.equal(error.path, PATH);
    return error;
  }
  assert.fail(`${key} should be rejected`);
}

/** Compile and run the tests of a chain against an event value (lower-cased when the chain folds case). */
function run(key: string, values: RuleValue[], subject: string): boolean {
  const parsed = chain(key);
  const compiled = compileValues(parsed, values, PATH, { remaining: MAX_COMPILED_PATTERNS }, parsed.field === '');
  const text = compiled.fold ? subject.toLowerCase() : subject;
  const some = compiled.exact.has(text) || compiled.tests.some((test) => test(text));
  if (!compiled.all) return some;
  return compiled.tests.every((test) => test(text));
}

describe('parseModifierChain: valid chains', () => {
  it('splits the field from the modifiers', () => {
    const parsed = chain('CommandLine|contains|all');
    assert.equal(parsed.field, 'CommandLine');
    assert.deepEqual(parsed.modifiers, ['contains', 'all']);
    assert.equal(parsed.mode, 'contains');
    assert.equal(parsed.all, true);
    assert.equal(parsed.kind, 'string');
  });

  it('accepts a bare field and a keyword (empty field) with |all', () => {
    assert.equal(chain('Image').kind, 'string');
    const keywords = chain('|all');
    assert.equal(keywords.field, '');
    assert.equal(keywords.all, true);
  });

  it('accepts transform chains in the written order', () => {
    assert.deepEqual(chain('F|windash|contains').transforms, ['windash']);
    assert.deepEqual(chain('F|wide|base64offset|contains').transforms, ['utf16le', 'base64offset']);
    assert.deepEqual(chain('F|utf16be|base64|contains').transforms, ['utf16be', 'base64']);
    assert.deepEqual(chain('F|utf16|base64offset|contains').transforms, ['utf16', 'base64offset']);
  });

  it('accepts cased before or after the match type', () => {
    assert.equal(chain('F|cased|endswith').cased, true);
    assert.equal(chain('F|endswith|cased').cased, true);
  });

  it('collects regex flags in canonical order', () => {
    assert.equal(chain('F|re|s|i').regexFlags, 'is');
    assert.equal(chain('F|re|m|s|i').regexFlags, 'ims');
    assert.equal(chain('F|re').regexFlags, '');
  });

  it('accepts fieldref with a following match type', () => {
    const parsed = chain('F|fieldref|startswith');
    assert.equal(parsed.kind, 'fieldref');
    assert.equal(parsed.mode, 'startswith');
  });
});

describe('parseModifierChain: invalid chains', () => {
  it('rejects duplicates and conflicting match types', () => {
    assert.match(invalid('F|all|all').message, /'\|all' is used twice/);
    assert.match(invalid('F|contains|startswith').message, /only one of/);
    assert.match(invalid('F|base64|base64offset|contains').message, /not both/);
    assert.match(invalid('F|windash|windash').message, /used twice/);
    assert.match(invalid('F|wide|utf16be|base64').message, /only one of/);
  });

  it('requires utf16 flavors to be followed by base64', () => {
    assert.match(invalid('F|wide|contains').message, /in front of '\|base64' or '\|base64offset'/);
    assert.match(invalid('F|utf16le').message, /in front of/);
    assert.match(invalid('F|base64|wide').message, /in front of/);
  });

  it('requires transforms to come before base64', () => {
    assert.match(invalid('F|base64|windash').message, /must come before/);
  });

  it('keeps re, cidr, exists and comparisons on their own', () => {
    assert.match(invalid('F|re|contains').message, /already searches anywhere/);
    assert.match(invalid('F|re|cased').message, /case-sensitive already/);
    assert.match(invalid('F|re|windash').message, /cannot be combined with '\|windash'/);
    assert.match(invalid('F|cidr|contains').message, /cannot be combined/);
    assert.match(invalid('F|gt|lt').message, /cannot be combined/);
    assert.match(invalid('F|exists|contains').message, /cannot be combined/);
    assert.match(invalid('F|re|cidr').message, /cannot be combined with '\|re'/);
  });

  it('rejects regex flags outside of re', () => {
    assert.match(invalid('F|i|contains').message, /flag for regular expressions/);
    assert.match(invalid('F|re|i|i').message, /repeated/);
  });

  it('requires a field name for exists and fieldref', () => {
    assert.match(invalid('|exists').message, /needs a field name/);
    assert.match(invalid('|fieldref').message, /needs a field name/);
  });

  it('wants fieldref before the match type', () => {
    assert.match(invalid('F|contains|fieldref').message, /Write '\|fieldref' before '\|contains'/);
    assert.match(invalid('F|windash|fieldref').message, /cannot be combined with '\|windash'/);
  });
});

describe('parseModifierChain: unsupported modifiers', () => {
  function unsupported(key: string): UnsupportedFeatureError {
    try {
      parseModifierChain(key, PATH);
    } catch (error) {
      assert.ok(error instanceof UnsupportedFeatureError, `expected UnsupportedFeatureError for ${key}, got ${String(error)}`);
      return error;
    }
    assert.fail(`${key} should be rejected`);
  }

  it('names the modifier as the feature and lists what is supported', () => {
    const error = unsupported('F|lookup');
    assert.equal(error.feature, '|lookup');
    assert.match(error.message, /'\|lookup'/);
    assert.match(error.message, /Supported modifiers: .*contains.*windash/);
  });

  it('suggests the nearest modifier for typos', () => {
    assert.match(unsupported('F|contians').message, /Did you mean '\|contains'\?/);
    assert.match(unsupported('F|startwith').message, /Did you mean '\|startswith'\?/);
  });

  it('explains how to do without modifiers that are valid Sigma but out of scope', () => {
    assert.match(unsupported('F|expand').message, /pipeline/);
    assert.match(unsupported('F|neq').message, /not filter/);
    assert.match(unsupported('F|hour').message, /timestamp/);
    assert.match(unsupported('F|ignorecase').message, /\|re\|i/);
  });
});

describe('compileValues: strings', () => {
  it('compares case-insensitively unless cased', () => {
    assert.ok(run('F', ['CMD.exe'], 'cmd.EXE'));
    assert.ok(!run('F|cased', ['CMD.exe'], 'cmd.EXE'));
    assert.ok(run('F|cased', ['CMD.exe'], 'CMD.exe'));
  });

  it('applies the match type to every value', () => {
    assert.ok(run('F|endswith', ['\\cmd.exe', '\\powershell.exe'], 'C:\\Windows\\PowerShell.exe'));
    assert.ok(!run('F|startswith', ['abc'], 'xabc'));
  });

  it('combines values with and when all is set', () => {
    assert.ok(run('F|contains|all', ['-a', '-b'], 'x -a -b y'));
    assert.ok(!run('F|contains|all', ['-a', '-b'], 'x -a y'));
  });

  it('turns keyword values into contains searches by default', () => {
    assert.ok(run('', ['mimikatz'], 'run MIMIKATZ now'));
  });

  it('expands windash into every dash variant', () => {
    assert.ok(run('F|windash|contains', ['-enc'], 'powershell /enc abc'));
    assert.ok(run('F|windash|contains', ['-enc'], 'powershell \u2013enc abc'));
    assert.ok(!run('F|windash|contains', ['-enc'], 'powershell enc abc'));
    assert.ok(run('F|windash|contains', ['-a -b'], 'x /a \u2014b'));
  });

  it('matches encoded values at any alignment with base64offset', () => {
    const blob = Buffer.from('xxWrite-Host dojo', 'utf8').toString('base64');
    assert.ok(run('F|base64offset|contains', ['Write-Host'], blob));
    assert.ok(!run('F|base64offset|contains', ['Invoke-Mimikatz'], blob));
  });

  it('matches utf16 encoded values with wide + base64offset', () => {
    const blob = Buffer.from('x ping y', 'utf16le').toString('base64');
    assert.ok(run('F|wide|base64offset|contains', ['ping'], blob));
    assert.ok(!run('F|base64offset|contains', ['ping'], blob));
  });

  it('matches the exact encoding with base64', () => {
    assert.ok(run('F|base64', ['foobar'], 'Zm9vYmFy'));
    assert.ok(!run('F|base64', ['foobar'], 'Zm9vYmFyZm9v'));
  });

  it('flags a bare star as matching any present value', () => {
    const parsed = chain('F');
    assert.equal(compileValues(parsed, ['*'], PATH, { remaining: 100 }, false).matchesAnyPresent, true);
    assert.equal(compileValues(parsed, ['a*'], PATH, { remaining: 100 }, false).matchesAnyPresent, false);
  });
});

describe('compileValues: errors', () => {
  function failure(key: string, values: RuleValue[]): RuleParseError {
    try {
      compileValues(chain(key), values, PATH, { remaining: MAX_COMPILED_PATTERNS }, false);
    } catch (error) {
      assert.ok(error instanceof RuleParseError, String(error));
      return error;
    }
    assert.fail(`${key} with ${JSON.stringify(values)} should be rejected`);
  }

  it('rejects wildcards in values that get encoded', () => {
    assert.match(failure('F|base64', ['a*b']).message, /wildcards/);
    assert.match(failure('F|wide|base64offset|contains', ['a?b']).message, /wildcards/);
  });

  it('accepts escaped wildcards in encoded values', () => {
    assert.doesNotThrow(() => compileValues(chain('F|base64'), ['a\\*b'], PATH, { remaining: 10 }, false));
  });

  it('rejects base64offset values too short to be distinctive', () => {
    assert.match(failure('F|base64offset|contains', ['a']).message, /longer value/);
    assert.match(failure('F|base64offset|contains', ['']).message, /longer value/);
  });

  it('limits how many dashes windash expands', () => {
    assert.match(failure('F|windash', ['-a -b -c -d']).message, /at most 3 dashes/);
    assert.doesNotThrow(() => compileValues(chain('F|windash'), ['-a -b -c'], PATH, { remaining: 1000 }, false));
  });

  it('reports invalid regular expressions at the value', () => {
    const error = failure('F|re', ['fine', '(unclosed']);
    assert.match(error.message, /Invalid regular expression/);
    assert.equal(error.path, `${PATH}[1]`);
  });

  it('rejects regex source above the length limit', () => {
    assert.match(failure('F|re', ['a'.repeat(MAX_REGEX_LENGTH + 1)]).message, /limit is 2000/);
    assert.doesNotThrow(() => compileValues(chain('F|re'), ['a'.repeat(MAX_REGEX_LENGTH)], PATH, { remaining: 10 }, false));
  });

  it('reports invalid CIDR values and non-numeric comparisons', () => {
    assert.match(failure('F|cidr', ['10.0.0.1/8']).message, /host bits/);
    assert.match(failure('F|gt', ['abc']).message, /not a number/);
    assert.match(failure('F|lt', [true]).message, /not a number/);
  });

  it('stops a rule that would expand into an unreasonable number of patterns', () => {
    const budget = { remaining: 50 };
    const values = Array.from({ length: 10 }, () => '-a -b');
    assert.throws(
      () => compileValues(chain('F|windash|contains'), values, PATH, budget, false),
      (error: unknown) => error instanceof RuleParseError && /more than \d+ match patterns/.test(error.message),
    );
  });
});

describe('compileValues: regex, cidr and numeric tests', () => {
  it('searches regexes unanchored and case-sensitively unless flagged', () => {
    assert.ok(run('F|re', ['a.c'], 'xxabcxx'));
    assert.ok(!run('F|re', ['abc'], 'ABC'));
    assert.ok(run('F|re|i', ['abc'], 'ABC'));
    assert.ok(!run('F|re', ['^abc$'], 'xabc'));
    assert.ok(run('F|re|s', ['a.b'], 'a\nb'));
    assert.ok(!run('F|re', ['a.b'], 'a\nb'));
    assert.ok(run('F|re|m', ['^b$'], 'a\nb\nc'));
  });

  it('does not keep state between calls (no sticky lastIndex)', () => {
    const parsed = chain('F|re');
    const { tests } = compileValues(parsed, ['a'], PATH, { remaining: 10 }, false);
    const [test] = tests;
    assert.ok(test);
    for (let i = 0; i < 5; i++) assert.equal(test('a'), true);
  });

  it('matches cidr ranges', () => {
    assert.ok(run('F|cidr', ['10.0.0.0/8', '192.0.2.0/24'], '192.0.2.77'));
    assert.ok(!run('F|cidr', ['10.0.0.0/8'], '11.0.0.1'));
  });

  it('compares numbers numerically, including numeric strings', () => {
    assert.ok(run('F|gt', [100], '101'));
    assert.ok(run('F|gte', [100], '100'));
    assert.ok(!run('F|lt', [100], '100'));
    assert.ok(run('F|lte', ['1.5'], '1.5'));
    assert.ok(run('F|gt', [9], '10'));
    assert.ok(!run('F|gt', [1], 'not a number'));
    assert.ok(!run('F|gt', [1], ''));
  });
});

describe('parseNumeric', () => {
  it('accepts plain decimal numbers only', () => {
    assert.equal(parseNumeric('42'), 42);
    assert.equal(parseNumeric(' -1.5 '), -1.5);
    assert.equal(parseNumeric('1e3'), 1000);
    assert.equal(parseNumeric('.5'), 0.5);
    for (const bad of ['', ' ', '0x10', 'Infinity', 'NaN', '1,000', '1.2.3', '--1', 'abc']) {
      assert.equal(parseNumeric(bad), undefined, JSON.stringify(bad));
    }
  });
});
