/**
 * IPv4 / IPv6 address parsing and CIDR range tests for the `|cidr` modifier.
 *
 * Node's `net` module can validate addresses but has no range arithmetic, so
 * the small amount of bit work lives here, which also keeps the semantics
 * (strict parsing, no leading zeros, same address family only) explicit.
 */

/** Parse dotted-quad IPv4 into an unsigned 32-bit number; undefined when it is not strictly valid. */
export function parseIPv4(text: string): number | undefined {
  const octets = text.split('.');
  if (octets.length !== 4) return undefined;
  let value = 0;
  for (const octet of octets) {
    // No leading zeros: "010" is octal in some tools, so it is ambiguous and rejected.
    if (!/^(?:0|[1-9]\d{0,2})$/.test(octet)) return undefined;
    const n = Number(octet);
    if (n > 255) return undefined;
    value = value * 256 + n;
  }
  return value;
}

const HEX_GROUP = /^[0-9a-fA-F]{1,4}$/;

function parseGroups(text: string): number[] | undefined {
  if (text === '') return [];
  const groups: number[] = [];
  for (const group of text.split(':')) {
    if (!HEX_GROUP.test(group)) return undefined;
    groups.push(Number.parseInt(group, 16));
  }
  return groups;
}

/** Parse IPv6 text (including `::` compression and an embedded IPv4 tail) into a 128-bit value. */
export function parseIPv6(text: string): bigint | undefined {
  // The longest legal form is 45 characters: eight groups, or six plus an IPv4 tail.
  if (text.length < 2 || text.length > 45 || !text.includes(':')) return undefined;

  let body = text;
  if (body.includes('.')) {
    const split = body.lastIndexOf(':');
    const tail = parseIPv4(body.slice(split + 1));
    if (tail === undefined) return undefined;
    body = `${body.slice(0, split + 1)}${(tail >>> 16).toString(16)}:${(tail & 0xffff).toString(16)}`;
  }

  const halves = body.split('::');
  if (halves.length > 2) return undefined;
  const head = parseGroups(halves[0] ?? '');
  if (head === undefined) return undefined;

  let groups: number[];
  if (halves.length === 1) {
    if (head.length !== 8) return undefined;
    groups = head;
  } else {
    const tail = parseGroups(halves[1] ?? '');
    // "::" must stand for at least one all-zero group.
    if (tail === undefined || head.length + tail.length > 7) return undefined;
    groups = [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
  }

  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  return value;
}

/** A compiled CIDR range: tests event values (text) for membership. */
export interface CidrRange {
  readonly family: 4 | 6;
  /** True when `ip` is a valid address of this range's family and lies inside the range. */
  contains(ip: string): boolean;
}

export type CidrParseResult =
  | { readonly ok: true; readonly range: CidrRange }
  | { readonly ok: false; readonly reason: string };

function formatIPv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

function ipv4Range(address: number, prefix: number, text: string): CidrParseResult {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (address & mask) >>> 0;
  if (network !== address) {
    return {
      ok: false,
      reason: `'${text}' has host bits set; the network address for /${prefix} is ${formatIPv4(network)}/${prefix}`,
    };
  }
  return {
    ok: true,
    range: {
      family: 4,
      contains(ip) {
        const candidate = parseIPv4(ip);
        return candidate !== undefined && ((candidate & mask) >>> 0) === network;
      },
    },
  };
}

function ipv6Range(address: bigint, prefix: number, text: string): CidrParseResult {
  const shift = BigInt(128 - prefix);
  const network = address >> shift;
  if (network << shift !== address) {
    return { ok: false, reason: `'${text}' has host bits set; write the network address for /${prefix} instead` };
  }
  return {
    ok: true,
    range: {
      family: 6,
      contains(ip) {
        // Log sources print link-local addresses with a zone ("fe80::1%12"); the zone is not part of the address.
        const zone = ip.indexOf('%');
        const candidate = parseIPv6(zone === -1 ? ip : ip.slice(0, zone));
        return candidate !== undefined && candidate >> shift === network;
      },
    },
  };
}

/**
 * Parse `10.0.0.0/8`, `2001:db8::/32` or a bare address (a single-host range).
 * Host bits must be zero, as in Python's `ipaddress`, which pySigma uses: a
 * value like `10.1.2.3/8` is almost always a mistake, so we say so rather
 * than quietly widening or narrowing it.
 */
export function parseCidr(text: string): CidrParseResult {
  const trimmed = text.trim();
  const slash = trimmed.indexOf('/');
  const addressText = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const prefixText = slash === -1 ? undefined : trimmed.slice(slash + 1);

  const v4 = parseIPv4(addressText);
  const v6 = v4 === undefined ? parseIPv6(addressText) : undefined;
  if (v4 === undefined && v6 === undefined) {
    return { ok: false, reason: `'${addressText}' is not a valid IPv4 or IPv6 address` };
  }
  const bits = v4 !== undefined ? 32 : 128;

  let prefix = bits;
  if (prefixText !== undefined) {
    if (!/^\d{1,3}$/.test(prefixText) || Number(prefixText) > bits) {
      return {
        ok: false,
        reason: `'/${prefixText}' is not a valid prefix length for an IPv${bits === 32 ? 4 : 6} address (0 to ${bits})`,
      };
    }
    prefix = Number(prefixText);
  }

  return v4 !== undefined ? ipv4Range(v4, prefix, trimmed) : ipv6Range(v6 ?? 0n, prefix, trimmed);
}
