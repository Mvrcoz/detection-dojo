import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEventsJsonl } from '../../src/kata/jsonl.ts';
import { MAX_EVENT_BYTES, MAX_EVENTS_PER_FILE } from '../../src/kata/limits.ts';

const LABEL = 'events/test.jsonl';

describe('parseEventsJsonl', () => {
  it('reads one event per line and numbers lines from 1', () => {
    const { events, problems } = parseEventsJsonl('{"a":1}\n{"a":2}\n', LABEL);
    assert.deepEqual(problems, []);
    assert.deepEqual(events, [
      { event: { a: 1 }, line: 1 },
      { event: { a: 2 }, line: 2 },
    ]);
  });

  it('ignores blank and whitespace-only lines but keeps real line numbers', () => {
    const { events } = parseEventsJsonl('\n{"a":1}\n   \n\n{"a":2}', LABEL);
    assert.deepEqual(events.map((e) => e.line), [2, 5]);
  });

  it('returns no events for an empty file', () => {
    assert.deepEqual(parseEventsJsonl('', LABEL), { events: [], problems: [] });
  });

  it('splits the _dojo annotation off and removes it from the event the rule sees', () => {
    const text = '{"Image":"a.exe","_dojo":{"note":"why","technique":"how"}}\n{"Image":"b.exe","_dojo":{"note":"only a note"}}\n{"Image":"c.exe"}';
    const { events, problems } = parseEventsJsonl(text, LABEL);
    assert.deepEqual(problems, []);
    assert.deepEqual(events, [
      { event: { Image: 'a.exe' }, note: 'why', technique: 'how', line: 1 },
      { event: { Image: 'b.exe' }, note: 'only a note', line: 2 },
      { event: { Image: 'c.exe' }, line: 3 },
    ]);
    for (const { event } of events) assert.equal(Object.hasOwn(event, '_dojo'), false);
  });

  it('accepts an empty _dojo object', () => {
    const { events, problems } = parseEventsJsonl('{"a":1,"_dojo":{}}', LABEL);
    assert.deepEqual(problems, []);
    assert.deepEqual(events, [{ event: { a: 1 }, line: 1 }]);
  });

  it('keeps nested values, arrays and non-ASCII text intact', () => {
    const { events } = parseEventsJsonl('{"n":{"deep":[1,"two",null]},"s":"caf\\u00e9 \\u2603"}', LABEL);
    assert.deepEqual(events[0]?.event, { n: { deep: [1, 'two', null] }, s: 'café ☃' });
  });

  it('reports invalid JSON with the file and line, without echoing the whole line', () => {
    const { events, problems } = parseEventsJsonl('{"ok":1}\n{not json}\n{"ok":2}', LABEL);
    assert.equal(events.length, 2);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /^events\/test\.jsonl line 2: not valid JSON \(/);
    assert.match(problems[0] ?? '', /one complete JSON object/);
  });

  it('reports a truncated line (for example a merge-conflict leftover)', () => {
    const { problems } = parseEventsJsonl('{"a":1}\n<<<<<<< HEAD\n{"a":', LABEL);
    assert.equal(problems.length, 2);
    assert.match(problems[0] ?? '', /line 2: not valid JSON/);
    assert.match(problems[1] ?? '', /line 3: not valid JSON/);
  });

  it('requires every line to be a JSON object', () => {
    const { events, problems } = parseEventsJsonl('[1,2]\n"text"\n42\nnull\ntrue\n{"a":1}', LABEL);
    assert.equal(events.length, 1);
    assert.deepEqual(
      problems.map((p) => p.replace(/^.*line (\d+): each line must be a JSON object, but this one is /, '$1: ')),
      ['1: a list', '2: a string', '3: a number', '4: null', '5: a boolean'],
    );
  });

  it('rejects malformed _dojo annotations', () => {
    const cases: Array<[string, RegExp]> = [
      ['{"_dojo":"note"}', /"_dojo" must be an object/],
      ['{"_dojo":null}', /"_dojo" must be an object.*null/],
      ['{"_dojo":["x"]}', /"_dojo" must be an object.*a list/],
      ['{"_dojo":{"notes":"typo"}}', /unknown key "notes"; allowed keys are note and technique/],
      ['{"_dojo":{"note":5}}', /"_dojo\.note" must be text/],
      ['{"_dojo":{"technique":["a"]}}', /"_dojo\.technique" must be text/],
    ];
    for (const [line, pattern] of cases) {
      const { events, problems } = parseEventsJsonl(line, LABEL);
      assert.equal(events.length, 0, line);
      assert.equal(problems.length, 1, line);
      assert.match(problems[0] ?? '', pattern, line);
    }
  });

  it('refuses a file with more events than the limit before parsing any of them', () => {
    const lines = Array.from({ length: MAX_EVENTS_PER_FILE + 1 }, () => '{not even json}');
    const { events, problems } = parseEventsJsonl(lines.join('\n'), LABEL);
    assert.equal(events.length, 0);
    assert.equal(problems.length, 1, 'one size problem, not 501 syntax problems');
    assert.match(problems[0] ?? '', /has 501 events; the limit is 500 per file/);
  });

  it('accepts exactly the maximum number of events, ignoring blank lines', () => {
    const lines = Array.from({ length: MAX_EVENTS_PER_FILE }, (_, i) => `{"i":${i}}\n`);
    const { events, problems } = parseEventsJsonl(`\n\n${lines.join('\n')}`, LABEL);
    assert.deepEqual(problems, []);
    assert.equal(events.length, MAX_EVENTS_PER_FILE);
  });

  it('refuses an oversized event without parsing it, and keeps the other events', () => {
    const huge = `{"x":"${'a'.repeat(MAX_EVENT_BYTES)}"}`;
    const { events, problems } = parseEventsJsonl(`{"a":1}\n${huge}\n{"a":2}`, LABEL);
    assert.equal(events.length, 2);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /line 2: the event is 65544 bytes, over the 65536-byte limit per event/);
  });

  it('reports sizes in the units that make the overshoot readable', () => {
    const huge = `{"x":"${'a'.repeat(3 * MAX_EVENT_BYTES)}"}`;
    const { problems } = parseEventsJsonl(huge, LABEL);
    assert.match(problems[0] ?? '', /the event is 192\.0 KiB, over the 64\.0 KiB limit per event/);
  });

  it('measures the event limit in UTF-8 bytes, not characters', () => {
    const justUnder = `{"x":"${'é'.repeat((MAX_EVENT_BYTES - 10) / 2)}"}`; // 2 bytes per character
    assert.ok(Buffer.byteLength(justUnder) <= MAX_EVENT_BYTES);
    assert.deepEqual(parseEventsJsonl(justUnder, LABEL).problems, []);

    const justOver = `{"x":"${'é'.repeat(MAX_EVENT_BYTES / 2)}"}`; // fewer characters than bytes allowed, more bytes
    assert.ok(justOver.length < MAX_EVENT_BYTES);
    assert.equal(parseEventsJsonl(justOver, LABEL).problems.length, 1);
  });

  it('lists at most ten problems and counts the rest', () => {
    const text = Array.from({ length: 25 }, () => 'oops').join('\n');
    const { problems } = parseEventsJsonl(text, LABEL);
    assert.equal(problems.length, 11);
    assert.equal(problems[10], 'events/test.jsonl has 15 more problems not listed here');
  });

  it('does not let a __proto__ key in an event change prototypes', () => {
    const { events } = parseEventsJsonl('{"__proto__":{"polluted":true},"a":1}', LABEL);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    assert.equal(Object.getPrototypeOf(events[0]?.event), Object.prototype);
    assert.equal((events[0]?.event as Record<string, unknown>).polluted, undefined);
  });
});
