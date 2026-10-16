/**
 * Size limits for everything the kata engine reads from disk. They are checked
 * before a file is read or parsed so a hostile or accidental giant file can
 * never exhaust memory (docs/ARCHITECTURE.md sections 4 and 7).
 */

const KIB = 1024;
const MIB = 1024 * KIB;

/** One events/*.jsonl file. */
export const MAX_EVENTS_FILE_BYTES = 2 * MIB;
/** Events in one events/*.jsonl file (blank lines do not count). */
export const MAX_EVENTS_PER_FILE = 500;
/** One JSONL line, measured in UTF-8 bytes. */
export const MAX_EVENT_BYTES = 64 * KIB;

/** kata.yml and explain.md are prose and small; this is generous. */
export const MAX_PROSE_FILE_BYTES = 64 * KIB;
/** starter.yml / solution.yml; mirrors the Sigma rule limit in docs/ARCHITECTURE.md 3.1. */
export const MAX_RULE_FILE_BYTES = 256 * KIB;

/** progress.json holds a few hundred bytes per kata; anything bigger is not ours. */
export const MAX_PROGRESS_FILE_BYTES = 1 * MIB;

function formatBytes(bytes: number): string {
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1)} MiB`;
  if (bytes >= KIB) return `${(bytes / KIB).toFixed(1)} KiB`;
  return `${bytes} bytes`;
}

/**
 * "3.2 MiB, over the 2.0 MiB limit". When rounding would make the two sizes read
 * the same (65558 bytes against a 65536-byte limit), exact byte counts are used.
 */
export function describeOverLimit(size: number, limit: number): string {
  const sizeText = formatBytes(size);
  const limitText = formatBytes(limit);
  if (sizeText === limitText) return `${size} bytes, over the ${limit}-byte limit`;
  return `${sizeText}, over the ${limitText} limit`;
}
