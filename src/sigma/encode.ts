/**
 * Value-transforming modifiers that work on raw text or bytes: UTF-16, base64,
 * base64offset and windash. Kept free of Sigma-rule concepts so the
 * algorithms can be tested against the pySigma reference behaviour directly.
 */
import { Buffer } from 'node:buffer';

export type Utf16Flavor = 'utf16le' | 'utf16be' | 'utf16';

export function encodeUtf8(text: string): Uint8Array {
  return Buffer.from(text, 'utf8');
}

/**
 * Encode text as UTF-16. `utf16` prepends the little-endian byte order mark
 * (FF FE), matching the Sigma specification's example for that modifier.
 */
export function encodeUtf16(text: string, flavor: Utf16Flavor): Uint8Array {
  const littleEndian = Buffer.from(text, 'utf16le');
  if (flavor === 'utf16le') return littleEndian;
  if (flavor === 'utf16be') return littleEndian.swap16();
  return Buffer.concat([Buffer.from([0xff, 0xfe]), littleEndian]);
}

export function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

// A byte offset of 0, 1 or 2 inside the encoded blob shifts how the value's
// bytes line up with base64's 3-byte groups. Prepending that many padding
// bytes reproduces each alignment; then only the characters that depend
// solely on the value's own bytes are kept (the edge characters also hold
// bits of the unknown neighbouring bytes). The tables are the ones pySigma
// uses, so rules behave the same here as when converted for a SIEM.
const START_OFFSETS = [0, 2, 3] as const;
const END_OFFSETS = [undefined, -3, -2] as const;

/**
 * The three base64 renderings of `bytes` that can appear inside a larger
 * base64 string, depending on the value's position modulo 3.
 */
export function base64OffsetVariants(bytes: Uint8Array): string[] {
  const variants: string[] = [];
  for (let shift = 0; shift < 3; shift++) {
    const padded = Buffer.concat([Buffer.alloc(shift, 0x20), bytes]);
    const end = END_OFFSETS[(bytes.length + shift) % 3];
    variants.push(padded.toString('base64').slice(START_OFFSETS[shift], end));
  }
  return variants;
}

/** The dash-like characters Windows tools accept for a switch prefix. */
export const WINDASH_CHARACTERS: readonly string[] = ['-', '/', '–', '—', '―'];

/**
 * pySigma refuses to expand more than three dashes in one value: the number of
 * variants grows as 5^n, and a rule needing more should be split up.
 */
export const WINDASH_MAX_SITES = 3;

const WORD_CHARACTER = /^[\p{L}\p{N}_]$/u;

function isWordCharacter(char: string | undefined): boolean {
  return char !== undefined && WORD_CHARACTER.test(char);
}

/**
 * Indexes of the dashes that windash expands: a `-` or `/` that starts a
 * word and is not glued to the end of the previous one (pySigma's regex
 * `\B[-/]\b`). In `-param-name` only the leading dash is a switch prefix; the
 * hyphen inside `param-name` is left alone.
 */
export function windashSites(text: string): number[] {
  const sites: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if ((char === '-' || char === '/') && !isWordCharacter(text[i - 1]) && isWordCharacter(text[i + 1])) {
      sites.push(i);
    }
  }
  return sites;
}

/** Every combination of replacing each windash site with each dash-like character. */
export function expandWindash(text: string): string[] {
  let results = [''];
  let last = 0;
  for (const site of windashSites(text)) {
    const between = text.slice(last, site);
    const next: string[] = [];
    for (const prefix of results) {
      for (const dash of WINDASH_CHARACTERS) next.push(prefix + between + dash);
    }
    results = next;
    last = site + 1;
  }
  return results.map((result) => result + text.slice(last));
}
