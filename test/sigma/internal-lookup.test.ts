import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compileFieldPath,
  createContext,
  eventScalars,
  eventScalarsLowerCase,
  lookupField,
  scalarsOf,
  scalarToString,
} from '../../src/sigma/lookup.ts';

function lookup(event: unknown, field: string): unknown {
  return lookupField(createContext(event), compileFieldPath(field));
}

describe('lookupField', () => {
  it('finds top-level keys', () => {
    assert.equal(lookup({ Image: 'a.exe' }, 'Image'), 'a.exe');
    assert.equal(lookup({ EventID: 4688 }, 'EventID'), 4688);
  });

  it('returns undefined for absent fields and null for present-but-null fields', () => {
    assert.equal(lookup({ a: 1 }, 'b'), undefined);
    assert.equal(lookup({ a: null }, 'a'), null);
  });

  it('prefers an exact key that contains dots over traversal', () => {
    const event = { 'process.name': 'flat', process: { name: 'nested' } };
    assert.equal(lookup(event, 'process.name'), 'flat');
  });

  it('traverses nested objects with dotted paths', () => {
    const event = { process: { parent: { name: 'explorer.exe' } } };
    assert.equal(lookup(event, 'process.parent.name'), 'explorer.exe');
    assert.deepEqual(lookup(event, 'process.parent'), { name: 'explorer.exe' });
  });

  it('copes with dotted keys at any level of nesting', () => {
    assert.equal(lookup({ 'winlog.event_data': { 'Target.Name': 'x' } }, 'winlog.event_data.Target.Name'), 'x');
    assert.equal(lookup({ winlog: { 'event_data.Image': 'y' } }, 'winlog.event_data.Image'), 'y');
  });

  it('falls back to case-insensitive key matching', () => {
    assert.equal(lookup({ commandline: 'x' }, 'CommandLine'), 'x');
    assert.equal(lookup({ Process: { ParentImage: 'p' } }, 'process.parentimage'), 'p');
  });

  it('prefers an exact-case key to a case-insensitive one', () => {
    assert.equal(lookup({ image: 'lower', Image: 'exact' }, 'Image'), 'exact');
  });

  it('returns undefined when traversal hits a non-object', () => {
    assert.equal(lookup({ a: 'text' }, 'a.b'), undefined);
    assert.equal(lookup({ a: null }, 'a.b'), undefined);
    assert.equal(lookup({ a: [{ b: 1 }] }, 'a.b'), undefined);
  });

  it('returns arrays as-is for the caller to scan', () => {
    assert.deepEqual(lookup({ tags: ['a', 'b'] }, 'tags'), ['a', 'b']);
  });

  it('never resolves inherited properties', () => {
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      assert.equal(lookup({}, name), undefined, name);
      assert.equal(lookup({ other: 1 }, `other.${name}`), undefined, name);
    }
    assert.equal(lookup({}, 'constructor.name'), undefined);
    assert.equal(lookup(Object.create({ inherited: 'x' }), 'inherited'), undefined);
  });

  it('reads an own __proto__ key as ordinary data', () => {
    const event = JSON.parse('{"__proto__": {"polluted": "yes"}, "constructor": "own"}') as Record<string, unknown>;
    assert.deepEqual(lookup(event, '__proto__'), { polluted: 'yes' });
    assert.equal(lookup(event, '__proto__.polluted'), 'yes');
    assert.equal(lookup(event, 'constructor'), 'own');
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
  });

  it('tolerates non-object events', () => {
    for (const bad of [null, undefined, 5, 'str', [1, 2], true]) {
      assert.equal(lookup(bad, 'a'), undefined);
    }
  });

  it('treats very long dotted names as one literal key', () => {
    const name = Array.from({ length: 40 }, (_, i) => `k${i}`).join('.');
    assert.equal(lookup({ [name]: 'ok' }, name), 'ok');
    assert.equal(lookup({}, name), undefined);
  });

  it('handles names with empty segments as literal keys', () => {
    assert.equal(lookup({ 'a..b': 1 }, 'a..b'), 1);
    assert.equal(lookup({ '.a': 2 }, '.a'), 2);
  });
});

describe('scalarToString', () => {
  it('uses the JSON text of numbers and booleans', () => {
    assert.equal(scalarToString('x'), 'x');
    assert.equal(scalarToString(443), '443');
    assert.equal(scalarToString(1.5), '1.5');
    assert.equal(scalarToString(true), 'true');
    assert.equal(scalarToString(false), 'false');
  });

  it('has no scalar form for null, undefined, objects and arrays', () => {
    for (const value of [null, undefined, {}, [], 5n]) assert.equal(scalarToString(value), undefined);
  });
});

describe('scalarsOf', () => {
  it('returns scalars as text and flattens arrays', () => {
    assert.deepEqual(scalarsOf('a'), ['a']);
    assert.deepEqual(scalarsOf([1, 'b', [true, null, { x: 1 }]]), ['1', 'b', 'true']);
    assert.deepEqual(scalarsOf({ a: 1 }), []);
    assert.deepEqual(scalarsOf(null), []);
  });
});

describe('eventScalars', () => {
  it('collects every scalar value at any depth, including inside arrays', () => {
    const event = { a: 'one', b: { c: 2, d: [true, { e: 'deep' }] }, f: null };
    assert.deepEqual([...eventScalars(createContext(event))].sort(), ['2', 'deep', 'one', 'true']);
  });

  it('does not search keys', () => {
    assert.deepEqual(eventScalars(createContext({ secret: 'v' })), ['v']);
  });

  it('survives nesting far deeper than the call stack allows', () => {
    const depth = 50_000;
    const json = `${'{"a":'.repeat(depth)}"leaf"${'}'.repeat(depth)}`;
    let event: unknown;
    try {
      event = JSON.parse(json);
    } catch {
      // Some engines refuse to build such a structure; construct it by hand instead.
      let node: Record<string, unknown> = { a: 'leaf' };
      for (let i = 0; i < depth; i++) node = { a: node };
      event = node;
    }
    assert.doesNotThrow(() => eventScalars(createContext(event)));
    assert.doesNotThrow(() => lookup(event, 'a.a.a.a'));
  });

  it('is computed once per event and cached lower-case on demand', () => {
    const ctx = createContext({ a: 'MiXeD' });
    assert.equal(eventScalars(ctx), eventScalars(ctx));
    assert.deepEqual(eventScalarsLowerCase(ctx), ['mixed']);
    assert.deepEqual(eventScalars(ctx), ['MiXeD']);
  });
});
