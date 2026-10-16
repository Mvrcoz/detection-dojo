/**
 * Reader for events/*.jsonl: one JSON object per line, blank lines ignored.
 *
 * The caller has already refused oversized files; here the per-file event count
 * and the per-line size are enforced before any line is handed to JSON.parse.
 * Problems are collected (not thrown) so `dojo validate-kata` can show an author
 * every bad line at once.
 */

import type { SigmaEvent } from '../sigma/types.ts';
import { MAX_EVENT_BYTES, MAX_EVENTS_PER_FILE, describeOverLimit } from './limits.ts';
import type { LabeledEvent } from './types.ts';

/** Stop listing individual problems after this many; the rest are summarised. */
const MAX_REPORTED_PROBLEMS = 10;

export interface ParsedEvents {
  events: LabeledEvent[];
  /** Human-readable problems, each starting with `<label> line N:` where a line is involved. */
  problems: string[];
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

/** The text of a JSON.parse failure without the (often huge) echo of the input. */
function syntaxMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return (message.split('\n')[0] ?? message).slice(0, 160);
}

/**
 * Split the optional `_dojo` annotation off an event. Returns an error message
 * when the annotation is malformed. The event the rule sees never contains it.
 */
function splitAnnotation(
  parsed: Record<string, unknown>,
): { event: SigmaEvent; note?: string; technique?: string } | { error: string } {
  if (!Object.hasOwn(parsed, '_dojo')) return { event: parsed };

  const { _dojo: annotation, ...event } = parsed;
  if (!isMapping(annotation)) {
    return { error: `"_dojo" must be an object with optional "note" and "technique" text (found ${kindOf(annotation)})` };
  }
  const result: { event: SigmaEvent; note?: string; technique?: string } = { event };
  for (const [key, value] of Object.entries(annotation)) {
    if (key !== 'note' && key !== 'technique') {
      return { error: `"_dojo" has an unknown key "${key}"; allowed keys are note and technique` };
    }
    if (typeof value !== 'string') {
      return { error: `"_dojo.${key}" must be text (found ${kindOf(value)})` };
    }
    result[key] = value;
  }
  return result;
}

/**
 * Parse the text of one events file (already UTF-8, BOM removed, LF line
 * endings; see readKataText). `label` names the file in messages, for example
 * `events/benign.jsonl`.
 */
export function parseEventsJsonl(text: string, label: string): ParsedEvents {
  const lines = text.split('\n');
  const nonBlank = lines.reduce((count, line) => (line.trim() === '' ? count : count + 1), 0);
  if (nonBlank > MAX_EVENTS_PER_FILE) {
    return {
      events: [],
      problems: [
        `${label} has ${nonBlank} events; the limit is ${MAX_EVENTS_PER_FILE} per file. Keep the strongest examples.`,
      ],
    };
  }

  const events: LabeledEvent[] = [];
  const problems: string[] = [];
  let unreported = 0;
  const report = (line: number, message: string): void => {
    if (problems.length < MAX_REPORTED_PROBLEMS) problems.push(`${label} line ${line}: ${message}`);
    else unreported += 1;
  };

  lines.forEach((source, index) => {
    if (source.trim() === '') return;
    const line = index + 1;

    const size = Buffer.byteLength(source, 'utf8');
    if (size > MAX_EVENT_BYTES) {
      report(line, `the event is ${describeOverLimit(size, MAX_EVENT_BYTES)} per event`);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (err) {
      report(line, `not valid JSON (${syntaxMessage(err)}). Each line must be one complete JSON object.`);
      return;
    }
    if (!isMapping(parsed)) {
      report(line, `each line must be a JSON object, but this one is ${kindOf(parsed)}`);
      return;
    }

    const split = splitAnnotation(parsed);
    if ('error' in split) {
      report(line, split.error);
      return;
    }
    const labeled: LabeledEvent = { event: split.event, line };
    if (split.note !== undefined) labeled.note = split.note;
    if (split.technique !== undefined) labeled.technique = split.technique;
    events.push(labeled);
  });

  if (unreported > 0) problems.push(`${label} has ${unreported} more problem${unreported === 1 ? '' : 's'} not listed here`);
  return { events, problems };
}
