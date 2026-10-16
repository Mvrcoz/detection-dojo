# Writing Sigma rules in the dojo

A cheat sheet for the Sigma subset that `dojo` grades. dojo checks a rule against one event at a time, offline. Where it behaves differently from the [Sigma specification](https://sigmahq.io/docs/basics/rules.html), the difference is on this page. The precise rules are in [ARCHITECTURE.md](ARCHITECTURE.md) section 3.

## A rule in one screen

```yaml
title: Windows Firewall Disabled With netsh      # required
id: 3f6c1a52-8a47-4d0e-9b63-5e1d7c2b9a04          # a fresh UUID per rule
status: experimental
description: Detects netsh turning the Windows Firewall off.
tags:
  - attack.defense-evasion
  - attack.t1562.004
logsource:                                       # required
  product: windows
  category: process_creation
detection:                                       # required, and needs a condition
  selection_process:
    - Image|endswith: '\netsh.exe'               # list of maps = OR
    - OriginalFileName: 'netsh.exe'
  selection_firewall_off:
    CommandLine|contains: 'state off'
  condition: all of selection_*
falsepositives:
  - An administrator briefly disabling the firewall
level: high
```

Only `title`, `logsource` and `detection` (with a `condition`) are required to grade. `id`, `description`, `falsepositives`, `level` and an `attack.tNNNN` tag are hygiene that `dojo lint` reminds you about.

Use **single quotes** around values with backslashes. In YAML double quotes a backslash starts an escape sequence.

## Selections

Every key under `detection` except `condition` is a named selection:

| Shape | Looks like | Matches when |
|---|---|---|
| Map | `Image\|endswith: '\a.exe'` and `CommandLine\|contains: 'x'` as two entries | **every** entry matches (AND) |
| List of maps | a YAML list of maps | **any** map matches (OR) |
| Keywords | a list of plain strings, no field name | any string value anywhere in the event **contains** one of them |

A field with a list of values matches if **any** value matches. Add the `all` modifier to require every value: `CommandLine|contains|all: ['-nop', '-w hidden']`.

## Modifiers

Write them after the field name, separated by pipes: `Field|modifier|modifier`. Value transforms come first, then the match type, then `all`.

| Modifier | Meaning | Example |
|---|---|---|
| *(none)* | equals the whole value | `OriginalFileName: 'netsh.exe'` |
| `contains` | substring | `CommandLine\|contains: 'state off'` |
| `startswith` | prefix | `Image\|startswith: 'C:\Users\'` |
| `endswith` | suffix | `Image\|endswith: '\cmd.exe'` |
| `all` | every listed value must match | `CommandLine\|contains\|all: ['-nop', '-enc']` |
| `re` | regular expression (JavaScript), unanchored | `CommandLine\|re: 'net(1)? user'` |
| `re\|i`, `re\|m`, `re\|s` | regex flags (ignore case, multiline, dotall) | `CommandLine\|re\|i: 'FROMBASE64'` |
| `cased` | case-**sensitive** match | `Image\|cased\|endswith: '\CMD.EXE'` |
| `cidr` | IPv4 or IPv6 address inside a range | `DestinationIp\|cidr: '198.51.100.0/24'` |
| `windash` | also match `/`, en dash, em dash and horizontal bar for a dash | `CommandLine\|windash\|contains: ' -enc'` |
| `base64` | base64-encode the value, then compare | `CommandLine\|base64\|contains: 'dojo'` |
| `base64offset` | the three base64 alignments of the value | `CommandLine\|base64offset\|contains: 'Write-Host'` |
| `utf16le`, `utf16be`, `utf16`, `wide` | encode as UTF-16 before base64 (only in front of `base64` or `base64offset`) | `CommandLine\|utf16le\|base64offset\|contains: 'Write-Host'` |
| `exists` | the field is present (`true`) or absent (`false`) | `ParentImage\|exists: false` |
| `lt`, `lte`, `gt`, `gte` | numeric comparison | `DestinationPort\|gte: 1024` |
| `fieldref` | compare with another field of the same event | `Image\|fieldref: ParentImage` |

How values behave:

- **Case is ignored** for strings by default. Use `cased` when case matters.
- **Wildcards:** `*` is any run of characters (even none) and `?` is exactly one. They work in plain values and in `contains`, `startswith` and `endswith`. `\*`, `\?` and `\\` are literals. A bare `*` as the whole value means the field exists and is not null.
- **Backslash before a wildcard:** to match "anything under `C:\Windows\`", double the backslash: `'C:\Windows\\*'`. A single `\*` is a literal star.
- **`null`** (`Field: null`) matches when the field is absent or null.
- **Numbers and booleans** are compared as text: `DestinationPort: 443` matches `443` and `"443"`.
- **Arrays** in an event match if any element matches. Nested objects are addressed with a dotted path, `process.command_line`.
- **Field names** match exactly first, then as a dotted path, then ignoring case. Missing fields never match, except for `null` and `exists: false`.

## Conditions

`condition` combines the selection names. From loosest to tightest: `or`, `and`, `not`, then parentheses and atoms. The keywords are not case-sensitive.

| Condition | Matches when |
|---|---|
| `selection` | that selection matches |
| `selection and not filter` | the selection matches and the filter does not |
| `selection_process and (selection_a or selection_b)` | the process test matches and at least one of the two others does |
| `1 of selection_*` | at least one selection whose name starts with `selection_` matches (`any of` means the same) |
| `all of selection_*` | every selection whose name starts with `selection_` matches |
| `1 of them` | at least one selection in the whole rule matches |

- A list of conditions is an OR of its entries.
- Using a name you did not define is an error, and the message lists the names you did define.
- A selection no condition uses is a warning (`unreferenced-selection`), not an error.

## Not supported, and why

dojo fails loudly with a message that names the feature, rather than grading something it silently ignored.

| Feature | Why | What to do instead |
|---|---|---|
| Aggregations: `\| count() > 5`, `\| near` | They need to remember other events, and dojo grades each event alone | Write the per-event part of the detection. Note the threshold in `falsepositives`. |
| `timeframe` | It only means something together with an aggregation | Leave it out. |
| Correlation rules (`correlation:`) | They span several events or rules | Write one rule for the event that matters most. |
| `\|expand` placeholders | They are filled in from your environment by a deployment pipeline, which dojo does not have | Write the concrete value or a wildcard. |
| `filter:` meta-rules | They modify other rules, and there is only one rule per file | Add a filter selection and `and not filter` to the rule itself. |
| Several documents in one file, `action: global`, `reset` or `repeat` | One rule per file keeps grading unambiguous | Split them into separate files. |
| Any modifier not listed above, such as `\|lookup` or `\|neq` | An unknown modifier cannot be graded honestly | Use a listed modifier. Instead of `neq`, put the value in its own selection and write `and not` that selection. |

Also enforced: a rule file may be at most 256 KiB, a regular expression at most 2000 characters, and duplicate YAML keys are an error. Plain YAML anchors and aliases work.

## Five common mistakes

**1. Matching the wrong field.** Looking for an argument in `Image` (the path) when it lives in `CommandLine`, or testing `ParentImage` when you meant the process itself. `dojo show <kata>` lists the field names in the events and prints a sample. Read it before you write a selection.

**2. `contains` on a short string.** `CommandLine|contains: '-e'` also matches `-exclude`, `-extract` and every other switch that starts with an e. `dojo lint` warns about values shorter than four characters (`broad-short-contains`). Use a longer anchor, or `windash` with a distinctive word.

**3. Forgetting that case is ignored by default.** Listing `PowerShell`, `powershell` and `POWERSHELL` is three times the work for the same match. The opposite trap is a regular expression: `re` is case-sensitive unless you write `re|i`.

**4. Matching the attacker's tool name instead of the behavior.** `Image|endswith: '\evil-tool.exe'` is defeated by renaming the file. Match what the process does (its arguments), or what the binary really is (`OriginalFileName`).

**5. Matching one spelling.** `-enc` alone misses `-EncodedCommand`, `/enc` and an en dash. Use `windash`, list the real aliases, and prefer `endswith: '\netsh.exe'` over a full path so `C:\Windows\SysWOW64\netsh.exe` still matches.

## Handy commands

```
dojo lint my-rule.yml --kata <id>        # catch hygiene problems before grading
dojo test <kata> my-rule.yml --verbose   # the full list of misses and false positives
dojo watch <kata> my-rule.yml            # re-grade every time you save
```
