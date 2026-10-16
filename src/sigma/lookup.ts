/**
 * Reading values out of events.
 *
 * Events are untrusted JSON-shaped data, so every read goes through
 * `Object.hasOwn`: a key such as `constructor` or `toString` must never
 * resolve to something inherited from `Object.prototype`, and `__proto__`
 * (which `JSON.parse` creates as an ordinary own key) is just another field.
 */

export type EventRecord = Record<string, unknown>;

/** A field name prepared once at compile time. */
export interface FieldPath {
  readonly name: string;
  /** The name split on dots; a single entry when the name is used verbatim. */
  readonly segments: readonly string[];
  /** `keys[start][end]` is the dotted key made of segments `start` up to (not including) `end`. */
  readonly keys: readonly (readonly string[])[];
}

/**
 * Per-event scratch state. Created once per `match()` call so that work shared
 * by several selections (case-insensitive key indexes, the flattened list of
 * values used by keyword searches) is done at most once per event.
 */
export interface EventContext {
  readonly event: EventRecord;
  caseInsensitiveKeys: WeakMap<object, Map<string, string>> | undefined;
  scalars: string[] | undefined;
  lowerScalars: string[] | undefined;
}

// A dotted field name with more segments than this is treated as one literal
// key. Resolution tries every way of splitting the name, which is exponential
// in the number of dots; no real log schema nests anywhere near this deep.
const MAX_PATH_SEGMENTS = 12;

// Keyword searches walk the whole event iteratively; this bound only protects
// against absurdly deep nesting (a 64 KiB event can legally nest 30,000 levels).
const MAX_EVENT_DEPTH = 100;

const EMPTY_EVENT: EventRecord = Object.freeze({});

export function isRecord(value: unknown): value is EventRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createContext(event: unknown): EventContext {
  return {
    event: isRecord(event) ? event : EMPTY_EVENT,
    caseInsensitiveKeys: undefined,
    scalars: undefined,
    lowerScalars: undefined,
  };
}

export function compileFieldPath(name: string): FieldPath {
  const parts = name.split('.');
  const verbatim = parts.length > MAX_PATH_SEGMENTS || parts.some((part) => part === '');
  const segments = verbatim ? [name] : parts;
  const keys = segments.map((_, start) => {
    const row: string[] = [];
    for (let end = start + 1; end <= segments.length; end++) row[end] = segments.slice(start, end).join('.');
    return row;
  });
  return { name, segments, keys };
}

/**
 * Canonical text of a scalar event value: numbers and booleans compare as
 * their JSON text (`443` equals `"443"`, `true` equals `"true"`). Anything
 * else (null, objects, arrays, undefined) has no scalar form.
 */
export function scalarToString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function findKey(node: EventRecord, key: string, ctx: EventContext, ignoreCase: boolean): string | undefined {
  if (!ignoreCase) return Object.hasOwn(node, key) ? key : undefined;

  const indexes = (ctx.caseInsensitiveKeys ??= new WeakMap());
  let index = indexes.get(node);
  if (index === undefined) {
    index = new Map();
    for (const actual of Object.keys(node)) {
      const lower = actual.toLowerCase();
      // If two keys differ only by case, the first one wins; the exact-case pass has already had its chance.
      if (!index.has(lower)) index.set(lower, actual);
    }
    indexes.set(node, index);
  }
  return index.get(key.toLowerCase());
}

function resolve(
  node: unknown,
  path: FieldPath,
  start: number,
  ctx: EventContext,
  ignoreCase: boolean,
): unknown {
  if (!isRecord(node)) return undefined;
  const row = path.keys[start];
  if (row === undefined) return undefined;

  // Longest key first: a flattened log such as {"process.name": "x"} must win
  // over a nested {"process": {"name": "y"}} that happens to share the prefix.
  for (let end = path.segments.length; end > start; end--) {
    const key = row[end];
    if (key === undefined) continue;
    const actual = findKey(node, key, ctx, ignoreCase);
    if (actual === undefined) continue;
    const child = node[actual];
    if (end === path.segments.length) {
      if (child !== undefined) return child;
    } else {
      const found = resolve(child, path, end, ctx, ignoreCase);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * Find a field's value: exact key, then dotted-path traversal into nested
 * objects, then the same two strategies ignoring key case. Returns undefined
 * when the field is absent; a present field holding JSON null returns null.
 */
export function lookupField(ctx: EventContext, path: FieldPath): unknown {
  const exact = resolve(ctx.event, path, 0, ctx, false);
  return exact !== undefined ? exact : resolve(ctx.event, path, 0, ctx, true);
}

/**
 * Every string / number / boolean value anywhere in the event, as text. This
 * is the haystack for keyword searches. Iterative so that hostile nesting
 * cannot overflow the call stack.
 */
export function eventScalars(ctx: EventContext): readonly string[] {
  if (ctx.scalars !== undefined) return ctx.scalars;

  const found: string[] = [];
  const pending: unknown[] = [ctx.event];
  const depths: number[] = [0];
  while (pending.length > 0) {
    const node = pending.pop();
    const depth = depths.pop() ?? 0;
    if (depth >= MAX_EVENT_DEPTH) continue;

    const children: unknown[] = Array.isArray(node) ? node : isRecord(node) ? Object.values(node) : [];
    for (const child of children) {
      const text = scalarToString(child);
      if (text !== undefined) {
        found.push(text);
      } else if (typeof child === 'object' && child !== null) {
        pending.push(child);
        depths.push(depth + 1);
      }
    }
  }
  ctx.scalars = found;
  return found;
}

/** `eventScalars`, lower-cased once for case-insensitive keyword searches. */
export function eventScalarsLowerCase(ctx: EventContext): readonly string[] {
  ctx.lowerScalars ??= eventScalars(ctx).map((text) => text.toLowerCase());
  return ctx.lowerScalars;
}

/**
 * The scalar values a field holds, as text: the value itself, or each scalar
 * element when the field is an array (nested arrays are flattened a few
 * levels deep). Objects contribute nothing.
 */
export function scalarsOf(value: unknown, out: string[] = [], depth = 0): string[] {
  const text = scalarToString(value);
  if (text !== undefined) {
    out.push(text);
  } else if (Array.isArray(value) && depth < 8) {
    for (const element of value) scalarsOf(element, out, depth + 1);
  }
  return out;
}
