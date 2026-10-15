# detection-dojo architecture

This document is the contract between modules. If code and this document disagree, fix one of them in the same change.

## 1. What this is

`detection-dojo` is an offline CLI that teaches detection engineering. A learner reads a scenario (`dojo show`), writes a [Sigma](https://sigmahq.io) rule, and `dojo test` / `dojo watch` grades it against a kata's labeled synthetic events:

- **true positives** the rule must catch,
- **benign look-alikes** the rule must stay quiet on,
- **evasion variants** of the attack that a robust rule should still catch.

Non-goals: converting Sigma to SIEM queries, replacing pySigma/sigma-cli, aggregation/correlation, running against real EVTX, shipping any real malware or exploit code.

## 2. Layout

```
src/
  cli.ts                    entry point (bin), argument parsing, dispatch, exit codes
  errors.ts                 DojoError hierarchy (shared)
  sigma/                    Sigma subset evaluator (no I/O besides YAML text in)
    types.ts                public types (contract)
    index.ts                public API: parseRuleYaml, compileRule, loadRule (+ re-exports types)
    ...                     parser, condition grammar, modifiers, matching (private)
  kata/                     kata format, loading, grading, progress
    types.ts                public types (contract)
    index.ts                public API (see section 5)
    ...                     loader, validator, grader, worker, progress (private)
  commands/                 one file per CLI command: list, show, start, test, watch, lint, new, validate-kata
  render/                   terminal rendering: color.ts, scorecard.ts, table.ts
katas/                      bundled curriculum (data, shipped in the npm package)
test/                       node:test suites (run directly as TypeScript on Node >= 22.18)
docs/                       ARCHITECTURE.md (this), KATA_FORMAT.md, WRITING_RULES.md
```

### Conventions (hard rules)

- TypeScript with **erasable syntax only** (`erasableSyntaxOnly`): no `enum`, no `namespace`, no constructor parameter properties. This lets `node` run `.ts` directly in dev/tests and `tsc` emit plain JS for publishing.
- Relative imports **must include the `.ts` extension** (`import { x } from './y.ts'`); `tsc` rewrites them to `.js` on build.
- Only runtime dependency: **`yaml`**. Everything else is Node built-ins (`node:util` `parseArgs`, `node:fs`, `node:worker_threads`, `node:test`, ...). Do not add dependencies without a strong reason written in the PR.
- Node >= 20 at runtime for the published build. Tests may use Node 22/24 features.
- Cross-platform: Windows, macOS, Linux. Use `node:path`, never hard-code `/` or `\`. Tolerate CRLF and a UTF-8 BOM in all input files.
- No network access, ever. No `child_process`. No `eval`/`new Function`. The tool never executes anything from rules or katas.
- Output must not depend on locale or timezone. Color/emoji only when stdout is a TTY and `NO_COLOR` is unset; `FORCE_COLOR=1` forces color; `DOJO_ASCII=1` forces ASCII symbols.
- Stable machine output: every command that prints results supports `--json` (a single JSON document on stdout, nothing else on stdout).
- Exit codes: `0` success / kata passed, `1` kata not passed (or lint errors), `2` usage or input error (unknown kata, unreadable file, bad rule). User-caused errors are `DojoError`s: print `error: <message>` to stderr, no stack trace. Unexpected errors print a stack trace and exit `70`.

## 3. Sigma evaluator semantics (subset of Sigma specification v2.x)

Reference: https://sigmahq.io/docs/basics/rules.html, /docs/basics/modifiers.html, /docs/basics/conditions.html and the sigma-specification repository. Where this document and the specification disagree, the specification wins, except for the deliberate limitations in 3.6.

### 3.1 Rule shape

`parseRuleYaml(text)` accepts one YAML document with at least `title` (string), `logsource` (map) and `detection` (map containing `condition`). A missing/invalid required key throws `RuleParseError` with a helpful `path`. Multi-document YAML, `action: global|reset|repeat`, correlation rules (`correlation:`), and `filter:` meta-rules throw `UnsupportedFeatureError`. Duplicate YAML keys are an error. Maximum rule text size: 256 KiB. `condition` may be a string or a list of strings (list = OR of the entries).

### 3.2 Selections

Every key under `detection` other than `condition` and `timeframe` is a named selection. A selection is one of:

1. **Map** of `field|modifiers: value-or-list`. All entries in the map must match (AND).
2. **List of maps**: matches if any map matches (OR).
3. **List of plain values (strings/numbers)** or a single plain value: a *keyword search* over the whole event (any string field value, recursively, matches).

A selection that is empty, or a map with no entries, is a `RuleParseError`.

### 3.3 Field values and matching

- A field with a **list of values** matches if **any** value matches (OR), unless the `all` modifier is present (then every value must match).
- **String comparison is case-insensitive** by default (Unicode case folding via `toLowerCase`), for plain equality, `contains`, `startswith`, `endswith`, wildcards.
- **Wildcards** in values: `*` = any run of characters (including none), `?` = exactly one character; `\*`, `\?`, `\\` are literals. Wildcards apply to plain equality and to `contains`/`startswith`/`endswith` values. A bare `*` as the whole value means "field exists and is non-null".
- `|contains`, `|startswith`, `|endswith` are substring/prefix/suffix tests (wildcards still honored inside the value).
- `|re` is a regular expression match using the JavaScript `RegExp` engine, **unanchored** (a search), case-**sensitive** unless `re|i`. Supported flag modifiers: `i`, `m`, `s`. An invalid regex is a `RuleParseError` raised at compile time. Regex source longer than 2000 characters is rejected.
- `|cidr` matches IPv4 and IPv6 addresses against CIDR ranges (field value must be a valid IP; non-IPs never match).
- `|base64` base64-encodes the value (UTF-8) before comparing; `|base64offset` expands to the three alignment variants (standard Sigma behavior); both are usually combined with `|contains`. `|utf16le`, `|utf16be`, `|utf16`, `|wide` transform the value to the named encoding *before* base64 (they are only valid in front of `base64`/`base64offset`).
- `|windash` expands `-`/`/`/en dash/em dash/horizontal bar variants of a leading dash in command-line switches, as in pySigma (`-enc` also matches `/enc`, `–enc`, ...).
- `|cased` makes the following match-type modifier (or plain equality) **case-sensitive** (`Image|cased|endswith`).
- `|exists` with value `true`/`false`: the field is present (key exists with a non-null value, empty string counts as present) / absent.
- `|lt`, `|lte`, `|gt`, `|gte`: numeric comparison (the field value must be a finite number or numeric string).
- `|fieldref`: the value names another field of the same event; matches if the two fields' values are equal (case-insensitive for strings). `|fieldref|startswith/contains/endswith` supported likewise.
- **Null**: a `null` value (`Field: null`) matches when the field is absent or null.
- **Non-string event values**: numbers/booleans are compared as their canonical string form (`443` equals `"443"`, `true` equals `"true"`). Arrays in the event: matches if **any** element matches. Nested objects: addressed by dotted path.
- **Field lookup**: exact key match first (so keys that literally contain dots work), then dotted-path traversal into nested objects, then a case-insensitive fallback for both. Missing field: the item does not match (except `null`/`exists: false`).
- Modifier order matters left to right as in the spec: value-transform modifiers (`base64`, `base64offset`, `windash`, utf16*), then the match-type modifier (`contains`...). Unknown modifiers, or an invalid combination, throw `UnsupportedFeatureError`/`RuleParseError` naming the modifier.

### 3.4 Conditions

Grammar, lowest to highest precedence: `or`, `and`, `not`, then atoms. Atoms: a selection name; `( expr )`; `1 of <pattern>`, `any of <pattern>`, `all of <pattern>` where `<pattern>` is `them` or a selection-name pattern with `*` wildcards (`selection_*`, `*_filter`). Keywords are case-insensitive. A pipe (`|`) in a condition means aggregation (see 3.6). Referencing an undefined selection is a `RuleParseError` at compile time naming it and listing the defined ones. An `of` pattern that matches no selection is a `RuleParseError`. A selection never referenced by the condition is a compile **warning** (`CompiledRule.warnings`), not an error.

### 3.5 Result

`CompiledRule.match(event)` returns `{ matched, selections }` where `selections` has a boolean for every defined selection (evaluated eagerly, even if the condition would short-circuit) so the UI can show learners which selection did or did not fire. `match` never throws for any JSON-shaped event.

### 3.6 Deliberate limitations (fail loudly)

`UnsupportedFeatureError` (never a silent wrong answer) for: aggregation (`| count() ...`, `| near`), `timeframe`, correlation rules, `|expand` placeholders, and any modifier not listed in 3.3 (for example `|lookup`). Each message must name the feature and say what to do instead (for example "aggregations need a SIEM; write the per-event part of the detection and note the threshold in `falsepositives`"). Plain YAML anchors/aliases are ordinary YAML and are allowed.

## 4. Kata on disk

```
katas/<NN>-<id>/
  kata.yml            metadata (KataMeta in src/kata/types.ts), strict: unknown keys are errors
  starter.yml         skeleton rule (write) or deliberately flawed rule (tune)
  solution.yml        reference rule; passes all thresholds
  explain.md          after-action write-up shown on pass
  events/
    positive.jsonl    events the rule MUST match           (>= 3)
    benign.jsonl      look-alikes it MUST NOT match         (>= 6)
    variants.jsonl    evasion variants (should match)       (>= 3 for tier 2 and 3, optional for tier 1)
```

- `NN` is zero-padded `number`; directory name must equal `<NN>-<id>`.
- JSONL: one JSON object per line; blank lines ignored; UTF-8 (BOM and CRLF tolerated); max 2 MiB per file and 500 events per file; each event max 64 KiB.
- Optional `_dojo` key on any event (object with optional string fields `note`, `technique`) is split off into `LabeledEvent.note/technique` and **removed from the event the rule sees**.
- All events are **synthetic and author-written**: no real malware, no real victim data, no real public IPs/domains (use RFC 5737 / RFC 3849 documentation ranges and `example.com`/`example.org`/`.test`), no real usernames, no copied third-party rule text or datasets. Command lines must be inert (for example, an encoded PowerShell payload decodes to `Write-Host 'dojo'`).
- Every positive/variant event in a kata must be matchable by `solution.yml`; every benign event must be matched by *no* sensible reference rule — the benign set should contain the genuinely hard look-alikes with a `note` explaining why each is benign.
- `validate-kata` semantic checks (in addition to schema/size checks): `solution.yml` passes the thresholds; for `write` katas `starter.yml` must **fail** (or not compile to a pass); for `tune` katas `starter.yml` must have `tpr == 1` and fail on `fpr` or variants; every `LabeledEvent.line` parses; no event is byte-identical across classes; `attack` ids match `^T\d{4}(\.\d{3})?$`; hints count 2..4; `scenario` and `objective` non-empty; `explain.md` non-empty.

### Kata resolution

`loadKata(query)` accepts the full dir name (`04-schtasks-persistence`), the id (`schtasks-persistence`), or the number (`4` / `04`). Anything else, and any query containing path separators or `..`, is `KataNotFoundError`. A directory path (absolute or existing relative) is accepted only through the explicit `loadKataFromDir(dir)` used by `validate-kata` and `new`.

### Katas root

`katasRoot()` returns `process.env.DOJO_KATAS_DIR` if set, else the bundled `katas/` directory located relative to the compiled/dev module (`../../katas` from `src/kata/` or `dist/kata/`).

## 5. Kata engine public API (`src/kata/index.ts`)

```ts
katasRoot(): string
listKatas(root?: string): KataSummary[]                       // sorted by number; throws KataFormatError naming the bad kata
loadKata(query: string, root?: string): Kata                  // KataNotFoundError / KataFormatError
loadKataFromDir(dir: string): Kata
validateKata(dir: string): { errors: string[]; warnings: string[] }   // schema + size + semantic checks (section 4)
gradeRule(kata: Kata, ruleYaml: string): GradeResult          // in-process; throws RuleParseError / UnsupportedFeatureError
gradeRuleIsolated(kata: Kata, ruleYaml: string, opts?: { timeoutMs?: number }): Promise<GradeResult>
   // runs gradeRule in a worker_thread, default timeout 5000 ms, terminates the worker and throws
   // GradeTimeoutError on timeout; errors thrown in the worker are re-thrown as the same DojoError subclass
loadProgress(): Progress                                      // missing/corrupt file => empty progress
recordResult(kataId: string, result: GradeResult): Progress   // atomic write (temp file + rename)
progressPath(): string                                        // <DOJO_HOME or ~/.detection-dojo>/progress.json
```

Worker file resolution must work both from `src/` (`.ts`, dev/tests) and from `dist/` (`.js`): derive the extension from `import.meta.url`.

### Grading (exact)

- `tp` = positives matched, `fn` = positives missed, `fp` = benign matched, `tn` = benign not matched.
- `tpr = tp / (tp + fn)` (1 if no positives), `fpr = fp / (fp + tn)` (0 if no benign), `precision = tp / (tp + fp)` (0 if both 0).
- `variantsCaught` = variants matched; threshold `min_variants_caught` of `'all'` means `variantsTotal`.
- `checks.tpr = tpr >= min_tpr`, `checks.fpr = fpr <= max_fpr`, `checks.variants = variantsCaught >= required`; `passed` is all three.
- Floating point: compare using counts (`tp/(tp+fn)`), never accumulated floats, to avoid off-by-epsilon failures.
- `gradeRule` evaluates every event; an unexpected exception from `match` on a single event is treated as "not matched" and recorded as a warning.

## 6. CLI

Binary names: `detection-dojo` and `dojo`. Global flags: `--json`, `--no-color`, `-h/--help`, `-v/--version`. `dojo` with no args prints a short welcome + the next step.

| Command | Purpose |
|---|---|
| `dojo list [--tier N] [--tag T] [--json]` | Curriculum table with learner progress (done / attempts). |
| `dojo show <kata> [--hint N] [--events]` | Scenario, objective, ATT&CK ids, logsource, the field names seen in the events and **one** sample positive event; `--hint N` reveals hint N (1-based); `--events` prints all positive events. Never prints benign events or the solution. |
| `dojo start <kata> [--out FILE] [--force]` | Writes the starter rule to `./<id>.yml` (or `--out`), refusing to overwrite without `--force`, then prints the scenario and the next command to run. |
| `dojo test <kata> <rule.yml> [--solution] [--json] [--verbose]` | Grade once. Prints the scorecard; on failure lists missed positives, false positives (with the `note` of each benign event) and missed variants (with `technique`), capped at 5 per list unless `--verbose`. On pass prints the explain.md and reveals the solution path hint. `--solution` grades the reference solution instead of a rule (used by CI). Records progress. |
| `dojo watch <kata> <rule.yml>` | Re-grade on every save (debounced 150 ms, handles editors that rename files), clears the screen between runs, and reveals hint N after N consecutive failing runs (hint 1 after the 2nd failure). Ctrl-C exits. |
| `dojo lint <path...> [--kata <id>] [--json] [--strict]` | Static hygiene check of rule files/directories (`.yml`/`.yaml`): errors (cannot compile, unsupported feature) and warnings (see 6.1). Exit 1 on errors (and on warnings with `--strict`). |
| `dojo new <id> [--tier N] [--kind write|tune] [--dir DIR]` | Scaffold a new kata directory with every required file filled with valid templates so a contributor can edit it. Refuses to overwrite. |
| `dojo validate-kata <dir>... \| --all [--json]` | Run `validateKata` on directories (`--all` = every kata under `katasRoot()`); exit 1 on any error. |

Anything not in this table is out of scope for v1 (`report`, `mutate`, `init` are later).

### 6.1 Lint rules

Errors: rule does not parse/compile; unsupported feature. Warnings (each with a stable id): `missing-id` (no UUID `id`), `missing-description`, `missing-falsepositives`, `missing-level`, `missing-attack-tag` (no `attack.tNNNN` tag), `unreferenced-selection`, `match-everything` (a value that is only `*` or `contains: ''`), `broad-short-contains` (a `contains` value shorter than 4 chars), `leading-wildcard-regex` (a `re` value starting with `.*` or ending with `.*`, pointless for unanchored search), `nested-quantifier-redos` (heuristic: `(a+)+`-style nested quantifiers), `logsource-mismatch` (with `--kata`: rule logsource differs from the kata's), `condition-only-negation` (the whole condition is a single negated term, e.g. `not filter`, which matches every event that is not the filter).

## 7. Safety rules

1. Rules and katas are **data**. Never evaluate, require, import or spawn anything derived from them.
2. Regexes from rules run only inside `gradeRuleIsolated` (worker with timeout) in the CLI. `lint` must not execute regexes against events.
3. Reading files: reject files above the size limits before parsing; never follow a path outside the requested file/directory; kata queries are validated (section 4) so `dojo test ..\..\x` cannot escape `katasRoot()`.
4. `dojo new`/`start` never overwrite existing files without `--force` (and `new` never accepts `--force`).
5. Progress file writes are atomic and failures to write progress never fail a grade (warn only).
6. Nothing writes outside the working directory, the explicit `--out`/`--dir`, or `DOJO_HOME`.

## 8. Testing

- `node:test` + `node:assert/strict`, files in `test/**/*.test.ts`, run with `npm test`.
- `test/sigma/`: conformance suite, one table-driven file per feature family (selections, wildcards, each modifier, conditions, errors, robustness/fuzz for arbitrary event shapes).
- `test/kata/`: loader, validator, grader on fixture katas under `test/fixtures/` (never on the real curriculum, so curriculum edits don't break unit tests).
- `test/curriculum.test.ts`: every bundled kata passes `validateKata` and its `solution.yml` passes via the real grader.
- `test/cli.test.ts`: spawn `node src/cli.ts` as a subprocess for end-to-end checks (exit codes, `--json` output, stdout/stderr separation, Windows path handling).
