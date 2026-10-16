import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  base64,
  base64OffsetVariants,
  encodeUtf16,
  encodeUtf8,
  expandWindash,
  windashSites,
} from '../../src/sigma/encode.ts';

const variants = (text: string): string[] => base64OffsetVariants(encodeUtf8(text));

describe('base64offset', () => {
  it('reproduces the vectors of the pySigma reference implementation', () => {
    assert.deepEqual(variants('foobar'), ['Zm9vYmFy', 'Zvb2Jhc', 'mb29iYX']);
    // The example in the Sigma documentation for the modifier.
    assert.deepEqual(variants('/bin/bash'), ['L2Jpbi9iYXNo', '9iaW4vYmFza', 'vYmluL2Jhc2']);
  });

  it('keeps only the characters that depend on the value alone', () => {
    // Lengths 1, 2 and 3 exercise each (length + shift) % 3 end offset.
    assert.deepEqual(variants('foo'), ['Zm9v', 'Zvb', 'mb2']);
    assert.deepEqual(variants('fo'), ['Zm', 'Zv', 'mb']);
  });

  it('yields an empty variant for a one-byte value (callers must reject it)', () => {
    assert.deepEqual(variants('f'), ['Z', '', 'm']);
  });

  it('works on UTF-16 bytes for the wide modifier', () => {
    assert.deepEqual(base64OffsetVariants(encodeUtf16('ping', 'utf16le')), ['cABpAG4AZw', 'AAaQBuAGcA', 'wAGkAbgBnA']);
  });

  it('finds the value inside any larger base64 blob, at any alignment', () => {
    const needles = ['Write-Host', 'ping', 'IEX', 'mimikatz', 'caf\u00e9'];
    for (const needle of needles) {
      const found = variants(needle);
      for (let prefix = 0; prefix < 6; prefix++) {
        for (let suffix = 0; suffix < 4; suffix++) {
          const blob = base64(encodeUtf8(`${'x'.repeat(prefix)}${needle}${'y'.repeat(suffix)}`));
          assert.ok(
            found.some((variant) => blob.includes(variant)),
            `${needle} with ${prefix} prefix and ${suffix} suffix bytes is not found in ${blob}`,
          );
        }
      }
    }
  });
});

describe('UTF-16 encodings', () => {
  it('matches the examples of the specification', () => {
    const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
    assert.equal(hex(encodeUtf16('cmd', 'utf16le')), '63006d006400');
    assert.equal(hex(encodeUtf16('cmd', 'utf16be')), '0063006d0064');
    assert.equal(hex(encodeUtf16('cmd', 'utf16')), 'fffe63006d006400');
  });
});

describe('windash', () => {
  it('finds only dashes that start a word', () => {
    assert.deepEqual(windashSites('-param-name'), [0]);
    assert.deepEqual(windashSites('powershell -enc abc'), [11]);
    assert.deepEqual(windashSites('a - b'), []);
    assert.deepEqual(windashSites('c:\\x /c dir /s'), [5, 12]);
    assert.deepEqual(windashSites('no-dash-here'), []);
  });

  it('expands a leading dash into all five dash-like characters', () => {
    assert.deepEqual(expandWindash('-enc'), ['-enc', '/enc', '\u2013enc', '\u2014enc', '\u2015enc']);
  });

  it('expands every switch dash independently', () => {
    const expanded = expandWindash('x -a -b');
    assert.equal(expanded.length, 25);
    assert.ok(expanded.includes('x /a \u2014b'));
    assert.equal(new Set(expanded).size, 25);
  });

  it('leaves text without switch dashes untouched', () => {
    assert.deepEqual(expandWindash('plain text'), ['plain text']);
  });

  it('expands a slash switch too', () => {
    assert.ok(expandWindash('cmd /c').includes('cmd -c'));
  });
});
