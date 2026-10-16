/**
 * "Did you mean ...?" support for error messages. Learners mistype selection
 * names and modifiers far more often than they hit a genuinely unsupported
 * feature, so a near-miss hint saves a round trip to the documentation.
 */

/**
 * Levenshtein distance between two strings, giving up early: once every cell
 * of a row exceeds `max` the real distance must too, so we return `max + 1`.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1);
      const value = Math.min(substitution, (previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1);
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length] ?? max + 1;
}

/** The closest candidate to `input` (case-insensitive), or undefined when nothing is close. */
export function didYouMean(input: string, candidates: readonly string[]): string | undefined {
  const needle = input.toLowerCase();
  // Short names tolerate fewer edits, otherwise every two-letter name "looks like" every other.
  const threshold = Math.min(3, Math.max(1, Math.floor(needle.length / 3)));
  let best: string | undefined;
  let bestDistance = threshold + 1;
  for (const candidate of candidates) {
    const distance = editDistance(needle, candidate.toLowerCase(), threshold);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
