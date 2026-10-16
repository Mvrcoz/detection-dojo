import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCidr, parseIPv4, parseIPv6, type CidrRange } from '../../src/sigma/cidr.ts';

function range(text: string): CidrRange {
  const parsed = parseCidr(text);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.reason);
  return parsed.range;
}

describe('parseIPv4', () => {
  it('parses dotted quads', () => {
    assert.equal(parseIPv4('0.0.0.0'), 0);
    assert.equal(parseIPv4('192.0.2.1'), 0xc0000201);
    assert.equal(parseIPv4('255.255.255.255'), 0xffffffff);
  });

  it('rejects anything that is not strictly an address', () => {
    for (const bad of ['', '1.2.3', '1.2.3.4.5', '256.1.1.1', '01.2.3.4', '1.2.3.', ' 1.2.3.4', '1.2.3.4 ', 'a.b.c.d', '1.2.3.-4']) {
      assert.equal(parseIPv4(bad), undefined, JSON.stringify(bad));
    }
  });
});

describe('parseIPv6', () => {
  it('parses full, compressed and IPv4-tailed forms', () => {
    assert.equal(parseIPv6('::'), 0n);
    assert.equal(parseIPv6('::1'), 1n);
    assert.equal(parseIPv6('2001:db8::1'), 0x20010db8000000000000000000000001n);
    assert.equal(parseIPv6('2001:0db8:0000:0000:0000:0000:0000:0001'), 0x20010db8000000000000000000000001n);
    assert.equal(parseIPv6('::ffff:192.0.2.1'), 0xffffc0000201n);
    assert.equal(parseIPv6('1:2:3:4:5:6:7::'), 0x00010002000300040005000600070000n);
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['', ':', ':::', '1::2::3', '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', '12345::', 'g::1', '1:2:3:4:5:6:7:8::', ':1:2:3:4:5:6:7', '::1.2.3', '1.2.3.4']) {
      assert.equal(parseIPv6(bad), undefined, JSON.stringify(bad));
    }
  });
});

describe('IPv4 ranges', () => {
  it('matches addresses inside the range and not outside', () => {
    const net = range('10.0.0.0/8');
    assert.equal(net.family, 4);
    assert.ok(net.contains('10.0.0.1'));
    assert.ok(net.contains('10.255.255.255'));
    assert.ok(!net.contains('11.0.0.1'));
    assert.ok(!net.contains('9.255.255.255'));
  });

  it('handles prefixes that are not on an octet boundary', () => {
    const net = range('192.168.0.0/23');
    assert.ok(net.contains('192.168.1.255'));
    assert.ok(!net.contains('192.168.2.0'));
  });

  it('handles /0 and /32', () => {
    assert.ok(range('0.0.0.0/0').contains('203.0.113.9'));
    const host = range('198.51.100.7/32');
    assert.ok(host.contains('198.51.100.7'));
    assert.ok(!host.contains('198.51.100.8'));
  });

  it('treats a bare address as a single-host range', () => {
    const host = range('198.51.100.7');
    assert.ok(host.contains('198.51.100.7'));
    assert.ok(!host.contains('198.51.100.6'));
  });

  it('never matches values that are not IPv4 addresses', () => {
    const net = range('10.0.0.0/8');
    for (const value of ['', 'localhost', '10.0.0', '10.0.0.1/8', ' 10.0.0.1', '2001:db8::1', '010.0.0.1']) {
      assert.ok(!net.contains(value), JSON.stringify(value));
    }
  });
});

describe('IPv6 ranges', () => {
  it('matches addresses inside the range and not outside', () => {
    const net = range('2001:db8::/32');
    assert.equal(net.family, 6);
    assert.ok(net.contains('2001:db8::1'));
    assert.ok(net.contains('2001:0DB8:ffff:ffff:ffff:ffff:ffff:ffff'));
    assert.ok(!net.contains('2001:db9::1'));
    assert.ok(!net.contains('2001:db7:ffff::'));
  });

  it('handles prefixes that are not on a group boundary', () => {
    const net = range('2001:db8:8000::/33');
    assert.ok(net.contains('2001:db8:8000::1'));
    assert.ok(net.contains('2001:db8:ffff::1'));
    assert.ok(!net.contains('2001:db8:7fff::1'));
  });

  it('handles /0, /128 and a bare address', () => {
    assert.ok(range('::/0').contains('2001:db8::1'));
    assert.ok(range('2001:db8::5/128').contains('2001:db8::5'));
    assert.ok(!range('2001:db8::5').contains('2001:db8::6'));
  });

  it('ignores a zone suffix on the event address', () => {
    assert.ok(range('fe80::/10').contains('fe80::1%12'));
  });

  it('does not mix address families', () => {
    assert.ok(!range('::ffff:0:0/96').contains('192.0.2.1'));
    assert.ok(!range('192.0.2.0/24').contains('::ffff:192.0.2.1'));
  });
});

describe('invalid ranges', () => {
  it('explain what is wrong', () => {
    const cases: [string, RegExp][] = [
      ['10.0.0.1/8', /host bits set.*10\.0\.0\.0\/8/],
      ['10.0.0.0/33', /prefix length/],
      ['2001:db8::/129', /prefix length/],
      ['not-an-ip/8', /not a valid IPv4 or IPv6 address/],
      ['10.0.0.0/', /prefix length/],
      ['2001:db8::1/32', /host bits set/],
      ['10.0.0.0/255.0.0.0', /prefix length/],
    ];
    for (const [text, expected] of cases) {
      const parsed = parseCidr(text);
      assert.ok(!parsed.ok, text);
      assert.match(parsed.reason, expected, text);
    }
  });
});
