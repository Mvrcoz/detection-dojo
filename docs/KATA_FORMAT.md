# Kata format and authoring guide

This document is for people who write katas.

- **[Part 1](#part-1-the-format)** specifies exactly what a kata is on disk. The loader and `dojo validate-kata` enforce it.
- **[Part 2](#part-2-design-a-great-kata)** is a practical guide to designing a kata that is worth a learner's time.

Commands are written as `dojo <command>`. In a clone of the repository, run them as `npm run dojo -- <command>`, for example `npm run dojo -- validate-kata --all`.

If this document disagrees with the code or with [ARCHITECTURE.md](ARCHITECTURE.md), the code and ARCHITECTURE.md win. Please open an issue so this page can be fixed.

---

# Part 1: The format

## Layout

```
katas/<NN>-<id>/
  kata.yml            metadata (strict: unknown keys are errors)
  starter.yml         skeleton rule (write katas) or deliberately flawed rule (tune katas)
  solution.yml        reference rule that passes every threshold
  explain.md          after-action write-up shown when the learner passes
  events/
    positive.jsonl    events the rule MUST match           (at least 3)
    benign.jsonl      look-alikes it MUST NOT match         (at least 6)
    variants.jsonl    evasion variants it should still match (at least 3 for tier 2 and 3, optional for tier 1)
```

`<NN>` is the kata's `number` padded to at least two digits and `<id>` is its `id`. The folder name must be exactly `<NN>-<id>`, for example `07-netsh-firewall-disable`. Numbers and ids are unique across the curriculum.

Other rules for everything inside a kata folder:

- Text files must be valid UTF-8. A byte order mark and CRLF line endings are tolerated; the repository itself stores LF.
- Symbolic links and Windows junctions are refused. A kata is self-contained.
- Any file or folder that is not listed above produces a warning and is ignored.
- `variants.jsonl` may be missing; every other file is required.

What each file is for, and what the learner gets to see:

| File | Purpose | Learner sees |
|---|---|---|
| `kata.yml` | Title, scenario, objective, hints, thresholds | Most fields through `dojo list` and `dojo show`. Hints appear one at a time (`dojo show <kata> --hint N`). |
| `starter.yml` | Where the learner starts | Written to `./<id>.yml` by `dojo start`. |
| `solution.yml` | The reference answer | Never printed by `dojo show`. CI grades it with `dojo test <kata> --solution`. |
| `explain.md` | After-action review | Printed when the learner passes. |
| `events/positive.jsonl` | What must be caught | One sample event in `dojo show`; all of them with `--events`. Missed ones are listed after a failed run. |
| `events/benign.jsonl` | What must be ignored | Never printed up front. When a rule wrongly matches one, its `note` is shown. |
| `events/variants.jsonl` | Evasions of the attack | When a rule misses one, its `technique` is shown. |

## kata.yml

The file is a YAML mapping. Unknown keys and duplicate keys are errors, and every problem in the file is reported at once so you can fix them in one pass.

| Key | Required | Type and rules |
|---|---|---|
| `number` | yes | Whole number from 1 to 999. Position in the curriculum. |
| `id` | yes | Lowercase slug matching `^[a-z0-9][a-z0-9-]{1,50}$`. Learners type it: `dojo show netsh-firewall-disable`. |
| `title` | yes | Non-empty text shown in `dojo list`. |
| `tier` | yes | `1`, `2` or `3`. See [Pick thresholds](#pick-thresholds). |
| `kind` | yes | `write` (author a rule from a skeleton) or `tune` (fix a noisy or weak starter rule). |
| `attack` | yes | List of MITRE ATT&CK technique ids, each matching `^T\d{4}(\.\d{3})?$`, for example `T1053` or `T1053.005`. |
| `tags` | no | List of short lowercase labels. `dojo list --tag` filters on them. Defaults to none. |
| `logsource` | yes | Non-empty mapping with Sigma logsource keys: `product`, `category`, `service`, `definition`. Values are text. |
| `scenario` | yes | Non-empty Markdown narrative shown by `dojo show`. |
| `objective` | yes | Non-empty. One or two sentences: what the rule must detect. |
| `hints` | yes | List of 2 to 4 non-empty strings, gentlest first. |
| `thresholds` | no | Mapping, see below. Each key inside it is optional. |
| `estimated_minutes` | yes | Whole number from 1 to 480. |
| `author` | yes | Non-empty text. The name you want to be credited under. |

`thresholds`:

| Key | Default | Meaning |
|---|---|---|
| `min_tpr` | `1` | Minimum fraction of positive events the rule must match, from 0 to 1. |
| `max_fpr` | `0` | Maximum fraction of benign events the rule may match, from 0 to 1. |
| `min_variants_caught` | `0` | How many evasion variants must be caught: a whole number, or the word `all`. |

A rule passes when all three checks hold. Comparisons use event counts (`tp / (tp + fn) >= min_tpr`), never accumulated floating point, so a threshold of exactly `1` or `0` is reliable. Write all three thresholds out explicitly even when you want the defaults: it makes the intent of the kata visible in review.

## Event files

Each `events/*.jsonl` file holds one JSON object per line. Blank lines are ignored.

| Limit | Value |
|---|---|
| Size of one file | 2 MiB |
| Events in one file | 500 |
| Size of one event (one line) | 64 KiB |

JSON Lines has no comments and an event cannot span lines, so explanations go in the `_dojo` annotation below. Backslashes must be doubled inside JSON strings: write `C:\\Windows\\System32\\netsh.exe` to get `C:\Windows\System32\netsh.exe`.

Events look like the telemetry the logsource really produces. Rules read them with the field lookup described in [ARCHITECTURE.md](ARCHITECTURE.md) section 3.3: exact key first, then a dotted path into nested objects, then a case-insensitive fallback. Flat events are the norm.

### The `_dojo` annotation

Any event may carry a `_dojo` key. It is an object with two optional text fields and nothing else; any other key inside it is an error.

| Field | Used for |
|---|---|
| `note` | Why this event matters. Shown to a learner who got it wrong. |
| `technique` | For evasion variants: the evasion technique, such as `renamed binary`. Shown when a learner misses the variant. |

The engine splits `_dojo` off before grading, so **the rule never sees it**. A rule that references `_dojo` fields matches nothing.

The schema makes both fields optional, and `dojo validate-kata` only warns when a benign event has no `note` or a variant has no `technique`. Review is stricter: every benign event needs a `note` that explains why it is benign, and every variant needs a `technique`.

## Rule and prose files

`starter.yml` and `solution.yml` are ordinary Sigma rules in the subset described in [WRITING_RULES.md](WRITING_RULES.md). Each is at most 256 KiB and must compile. `kata.yml` and `explain.md` are at most 64 KiB.

- **`write` katas.** The starter is a skeleton that matches nothing useful. It must fail the thresholds.
- **`tune` katas.** The starter is a plausible rule that catches every positive (`tpr == 1`) but fails on false positives or on variants. The learner's job is the fix.
- **The solution** is the reference answer, so write it the way you want learners to write rules: a UUID `id`, a `description`, `falsepositives`, a `level`, and `attack.tNNNN` tags. Check it with `dojo lint <path> --kata <id> --strict`.
- **`explain.md`** is shown on a pass. See [Write the explanation](#write-the-explanation).

## What validate-kata checks

`dojo validate-kata <dir>` (or `--all`) reports errors and warnings. Any error makes it exit `1`. Warnings never fail the command, but a pull request with warnings needs a good reason for each.

**Errors**

- A file is missing, over its size limit, not valid UTF-8, or a symbolic link.
- `kata.yml` does not match the table above, or the folder is not named `<NN>-<id>`.
- A JSONL line is not a JSON object, or its `_dojo` has the wrong shape.
- Fewer than 3 positives, fewer than 6 benign events, or (tiers 2 and 3) fewer than 3 variants.
- `min_variants_caught` is a number larger than the number of variants, so no rule could pass.
- `starter.yml`, `solution.yml` or `explain.md` is empty.
- An event is identical in two classes (for example the same event as a positive and as a benign event). Key order does not matter.
- `solution.yml` does not compile, or does not pass the thresholds.
- `write` kata: `starter.yml` already passes the thresholds. A starter that does not compile yet is fine.
- `tune` kata: `starter.yml` does not compile, misses a positive (`tpr` must be `1`), or already passes the false-positive and variant thresholds.

**Warnings**

- A benign event has no `_dojo.note`, or a variant has no `_dojo.technique`.
- `attack` is empty.
- An event repeats another event in the same class.
- `solution.yml` passes but still misses a positive or a variant, or matches a benign event. The reference rule should be perfect even when the thresholds are forgiving.
- `solution.yml` compiles with warnings, such as a selection that no condition uses.
- The kata folder or `events/` contains a file that is not part of the format.

Two things cannot be automated, and reviewers look for them: every positive and variant must be something a sensible rule can match, and every benign event must be something no sensible reference rule would match.

When `validate-kata` fails on the solution, `dojo test <kata> --solution --verbose` shows which events it misses or wrongly matches.

## Worked example

This kata is an illustration. It is not shipped in `katas/`, and the events in it are written for this page. Names, paths and dates are fictional.

### `kata.yml`

```yaml
number: 7
id: netsh-firewall-disable
title: Firewall switched off from the command line
tier: 2
kind: write
attack:
  - T1562.004
tags:
  - windows
  - defense-evasion
  - netsh
logsource:
  product: windows
  category: process_creation
scenario: |
  An analyst reviewing a workstation notices that inbound connections now
  reach services that should have been blocked. Nothing was installed and no
  alert fired: the Windows Firewall was simply turned off.

  You have Sysmon process-creation events. Every time someone starts
  `netsh.exe`, one event records the image path, the original file name taken
  from the binary's own metadata, and the full command line.

  Administrators run `netsh` all day to inspect and tune the firewall, so
  alerting on the tool alone would bury the SOC in noise. Write a rule that
  fires when the firewall is being *disabled* and stays quiet when it is
  inspected, re-enabled, backed up or given a new rule.
objective: Detect netsh turning off the Windows Firewall, including the legacy syntax and a renamed copy of netsh.exe.
hints:
  - Look at the sample event from `dojo show`. Which field says what the process is, and which says what it was asked to do?
  - Administrators use netsh for the firewall all day. What appears on the command line only when the firewall is being turned off?
  - You need two ideas, each in its own selection. One identifies the process (by its path, and by the name inside the binary). The other looks for the words that switch the firewall off, in both the current and the legacy syntax.
thresholds:
  min_tpr: 1
  max_fpr: 0
  min_variants_caught: all
estimated_minutes: 25
author: Jordan Example
```

### `events/positive.jsonl` (3 lines in the full file; two shown)

```jsonl
{"EventID":1,"UtcTime":"2026-03-02 09:14:07.318","Computer":"WS-DOJO-01","User":"DOJO\\user01","Image":"C:\\Windows\\System32\\netsh.exe","OriginalFileName":"netsh.exe","CommandLine":"netsh advfirewall set allprofiles state off","ParentImage":"C:\\Windows\\System32\\cmd.exe","IntegrityLevel":"High","_dojo":{"note":"The textbook command: every firewall profile switched off in one line."}}
{"EventID":1,"UtcTime":"2026-03-02 09:35:10.057","Computer":"SRV-DOJO-01","User":"DOJO\\user02","Image":"C:\\Windows\\SysWOW64\\netsh.exe","OriginalFileName":"netsh.exe","CommandLine":"\"C:\\Windows\\SysWOW64\\netsh.exe\" advfirewall set domainprofile state off","ParentImage":"C:\\Windows\\System32\\wscript.exe","IntegrityLevel":"High","_dojo":{"note":"32-bit netsh with a quoted full path, started by a script host."}}
```

### `events/benign.jsonl` (6 lines in the full file; three shown)

```jsonl
{"EventID":1,"UtcTime":"2026-03-02 10:02:31.114","Computer":"WS-DOJO-01","User":"DOJO\\user01","Image":"C:\\Windows\\System32\\netsh.exe","OriginalFileName":"netsh.exe","CommandLine":"netsh advfirewall set allprofiles state on","ParentImage":"C:\\Windows\\System32\\cmd.exe","IntegrityLevel":"High","_dojo":{"note":"Same binary and same subcommand as the attack, one word different. Turning the firewall ON is hardening, not evasion."}}
{"EventID":1,"UtcTime":"2026-03-02 10:11:48.206","Computer":"WS-DOJO-03","User":"DOJO\\svc-backup","Image":"C:\\Program Files\\Example Backup\\agent.exe","OriginalFileName":"agent.exe","CommandLine":"agent.exe --scheduler state off --quiet","ParentImage":"C:\\Windows\\System32\\services.exe","IntegrityLevel":"System","_dojo":{"note":"Contains the words 'state off' but it is a backup agent pausing its own scheduler. Proves the rule must test the process, not only the arguments."}}
{"EventID":1,"UtcTime":"2026-03-02 10:17:55.388","Computer":"WS-DOJO-02","User":"DOJO\\user01","Image":"C:\\Windows\\System32\\netsh.exe","OriginalFileName":"netsh.exe","CommandLine":"netsh advfirewall show allprofiles state","ParentImage":"C:\\Windows\\System32\\cmd.exe","IntegrityLevel":"Medium","_dojo":{"note":"Asks what the state is. It contains the word 'state' but changes nothing."}}
```

### `events/variants.jsonl` (3 lines in the full file; all shown)

```jsonl
{"EventID":1,"UtcTime":"2026-03-02 11:03:21.447","Computer":"WS-DOJO-01","User":"DOJO\\user01","Image":"C:\\Windows\\System32\\NETSH.EXE","OriginalFileName":"netsh.exe","CommandLine":"NETSH.EXE ADVFIREWALL SET ALLPROFILES STATE OFF","ParentImage":"C:\\Windows\\System32\\cmd.exe","IntegrityLevel":"High","_dojo":{"technique":"upper case","note":"Case changes nothing for the operating system. It only fools rules that match case-sensitively."}}
{"EventID":1,"UtcTime":"2026-03-02 11:08:36.870","Computer":"WS-DOJO-02","User":"DOJO\\user02","Image":"C:\\Users\\Public\\fwtool.exe","OriginalFileName":"netsh.exe","CommandLine":"fwtool.exe advfirewall set allprofiles state off","ParentImage":"C:\\Windows\\System32\\cmd.exe","IntegrityLevel":"High","_dojo":{"technique":"renamed binary","note":"A copy of netsh.exe under another name. The path no longer says netsh, but the original file name does."}}
{"EventID":1,"UtcTime":"2026-03-02 11:12:02.215","Computer":"WS-DOJO-03","User":"DOJO\\user01","Image":"C:\\Windows\\System32\\netsh.exe","OriginalFileName":"netsh.exe","CommandLine":"netsh firewall set opmode mode=DISABLE","ParentImage":"C:\\Windows\\System32\\cmd.exe","IntegrityLevel":"High","_dojo":{"technique":"legacy syntax","note":"The pre-Vista firewall context is deprecated but still accepted, and 'mode=' is an optional spelling."}}
```

### `starter.yml` (a `write` kata: it must fail)

```yaml
title: Name the behavior, not the tool
status: experimental
description: Replace this with one sentence about what your rule detects.
logsource:
  product: windows
  category: process_creation
detection:
  selection:
    Image|endswith: '\replace-me.exe'
  condition: selection
falsepositives:
  - Describe the legitimate activity that could trigger this rule.
level: medium
```

### `solution.yml` (it must pass every threshold)

```yaml
title: Windows Firewall Disabled With netsh
id: 3f6c1a52-8a47-4d0e-9b63-5e1d7c2b9a04
status: experimental
description: Detects netsh turning the Windows Firewall off, in the current (advfirewall) and legacy (firewall) syntax, including a renamed copy of netsh.exe.
author: Jordan Example
date: 2026-10-15
tags:
  - attack.defense-evasion
  - attack.t1562.004
logsource:
  product: windows
  category: process_creation
detection:
  selection_process:
    - Image|endswith: '\netsh.exe'
    - OriginalFileName: 'netsh.exe'
  selection_firewall_off:
    CommandLine|contains:
      - 'state off'
      - 'opmode*disable'
  condition: all of selection_*
falsepositives:
  - An administrator or installer briefly disabling the firewall during maintenance
level: high
```

Why it works against the events above:

- `selection_process` is a list of maps, so it is an OR: the path ends in `\netsh.exe`, **or** the original file name is `netsh.exe`. The second branch is what catches `fwtool.exe`.
- `selection_firewall_off` needs `state off` (current syntax) or `opmode`, anything, `disable` (legacy syntax, with or without `mode=`). Matching is case-insensitive, so the upper-case variant needs nothing extra.
- `condition: all of selection_*` requires both ideas. The backup agent matches only the second selection, and `state on`, `add rule`, `show` and `export` match only the first, so none of them fire.

### `explain.md` (excerpt)

```markdown
# What your rule does

The rule needs two facts to be true at once: the process is `netsh.exe`, and its
command line asks for the firewall to be turned off.

# Why the benign events are benign

- `state on`, `add rule`, `show` and `export` are everyday administration. They
  change or read a rule and leave the firewall enabled.
- A backup agent that mentions `state off` for its own scheduler is not `netsh`.
  Matching the words alone would page someone for it.
```

---

# Part 2: Design a great kata

A kata is a small argument: "here is an attack, here is the telling detail, here is the trap". The best ones are won by understanding, not by trial and error. These sections follow the order you will work in.

## Pick a technique

Good techniques for a kata have these properties:

1. **One event shows it.** dojo grades one event at a time. Anything that needs counting, a time window, or joining two events (brute force, beaconing, "A followed by B") cannot be graded. See the unsupported list in [WRITING_RULES.md](WRITING_RULES.md). If the heart of the detection is a threshold, pick a different technique, or teach the per-event part and say so in `explain.md`.
2. **There is a behavior, not only a tool name.** A learner who can win by matching one filename has learned nothing. Look for the argument, the path, the parent, the registry value or the file extension that makes it an attack.
3. **There are real look-alikes.** If you cannot think of six harmless events that share tokens with the attack, the kata will be too easy. If every harmless variant is byte-for-byte identical to the attack in every field, it is not detectable from one event; choose another technique.
4. **It teaches one transferable idea.** Finish this sentence: "After this kata the learner knows how to ___." If you need an "and", you have two katas. Good ideas are small and reusable: match the original file name instead of the path, `|windash` for flag spellings, a filter selection with `not`, `1 of selection_*`, `|base64offset|contains`, `|cidr`.
5. **It is not already covered.** Run `dojo list` and check open kata proposals.

Pick the most specific ATT&CK sub-technique that matches the behavior you teach, and list more than one id only when the scenario really spans them. Name the `id` after the behavior (`netsh-firewall-disable`), not after a tool or a technique number.

How tiers are used:

| Tier | What the learner practices |
|---|---|
| 1 | One idea, one or two selections. Gentle benign events. A first rule. |
| 2 | Hard look-alikes and evasion variants. Lists, filters, case and path handling. |
| 3 | Several ideas combined: encodings, regular expressions, `fieldref`, `cidr`, nested conditions. |

For a **`tune` kata**, start from the rule a busy analyst would really write first. The starter must catch every positive but fail on noise or on evasions. The lesson is the fix, so make sure the failure output points at it: each false positive's `note` should lead the learner to the field that distinguishes it.

## Write a scenario that teaches one idea

The scenario is shown first, before any code. Keep it to 80 to 200 words in three beats:

1. **Situation.** What happened, in plain language and concrete terms. "Inbound connections now reach services that should have been blocked."
2. **Data.** Which log the learner has and which fields matter. Name the logsource and the fields, so nobody has to guess.
3. **Tension.** Why the obvious rule fails. "Administrators run `netsh` all day." This sentence is what makes the kata worth doing.

Rules of thumb:

- Describe behavior, not a tool brand, and never name the answer.
- Do not mention field values the solution depends on. The hints do that, later and gradually.
- Assume the text is printed as plain text in a terminal: short paragraphs, `inline code`, simple lists. No tables, images or HTML.
- Fictional everything: no real companies, people or incidents.
- `objective` is the testable promise. Everything it claims must be checkable in the events. If it says "including renamed binaries", there must be a renamed-binary variant.

## Choose positive events

Three is the minimum, not the goal. Each positive should be a different realistic way the behavior appears, so the learner has to generalize: vary the parent process, the argument set, the path, the user and the integrity level. Three copies of the same command teach nothing. Use `note` to say what is distinctive about each one.

Use field names that real rules use for the logsource, so the skill transfers to rule repositories the learner will meet later:

| Logsource | Fields commonly used |
|---|---|
| Windows `process_creation` | `Image`, `OriginalFileName`, `CommandLine`, `ParentImage`, `ParentCommandLine`, `User`, `IntegrityLevel`, `CurrentDirectory` |
| Windows `file_event` | `TargetFilename`, `Image` |
| Windows `registry_set` | `TargetObject`, `Details`, `Image` |
| Windows `network_connection` | `DestinationIp`, `DestinationPort`, `DestinationHostname`, `Initiated`, `Image` |
| Windows `dns_query` | `QueryName`, `QueryResults`, `Image` |
| Windows `image_load` | `ImageLoaded`, `Image`, `Signed` |
| Linux `process_creation` | `Image`, `CommandLine`, `ParentImage`, `User` |

Include the fields real telemetry would carry (`UtcTime`, `Computer`, `User`) so events feel real. Never add a field real telemetry would not have, such as `is_malicious`: the rule must be winnable from realistic data.

## Choose hard benign look-alikes

This is where katas earn their keep. A benign event is only useful if a lazy rule would match it.

Good sources of look-alikes:

- **Same tool, safe arguments.** The firewall turned on, queried or exported.
- **Same arguments, different tool.** A backup agent with `state off` on its command line.
- **Substring traps.** A path or file that contains the keyword by accident. A file named `mynetsh.exe` punishes `endswith: 'netsh.exe'` and rewards `endswith: '\netsh.exe'`.
- **Legitimate software that does the surprising thing.** Installers, management agents, backup tools, build systems.
- **Same behavior in a sanctioned context**, but only when a field in the event tells them apart (parent, user, path). That is a tier 3 lesson in context filtering.

Tests every benign set should pass:

- **The lazy-rule test.** Write the laziest rule that still catches every positive, usually a bare tool name. It should fail at least two benign events. If it does not, the set is too easy.
- **The fairness test.** Show a colleague one positive and the benign event next to it. They must be able to tell which is which from the fields alone. If they cannot, the event does not belong, however realistic it is.
- **The analyst test.** Would a reasonable analyst escalate this event? Then it is not benign. Remove it.

Write notes in the shape "Looks like the attack because X. Benign because Y." in one or two sentences. A learner reads the note right after being wrong, so be specific and kind: explain the distinguishing fact, never say "obviously".

Six is the minimum. Eight to twelve feels right. Do not pad with unrelated noise such as a Notepad launch; one or two background events are plenty.

## Design evasion variants

A variant is the same attack, expressed so that a naive rule misses it. Variants teach robustness, and they are the main difference between a tier 1 and a tier 2 kata.

| Evasion | Example | What a robust rule must do |
|---|---|---|
| Case changes | `NETSH.EXE ADVFIREWALL ...` | Nothing: matching is case-insensitive by default. Useful to teach that learners need not list case variants, and that `re` without `\|i` is case-sensitive. |
| Caret insertion | `cmd.exe /c wh^oami` | `cmd.exe` consumes carets, so the obfuscated text survives only in the `cmd.exe` process's own command line. The child process shows the clean text. Put the variant on the shell's event, or on both. |
| Quote insertion | `pi""ng -n 4 192.0.2.10` | For external programs the quotes usually stay in the child's command line. A literal `contains` misses it; a pattern that allows optional quotes catches it. It does not work for `cmd` built-ins such as `echo`. |
| Renamed binary | `C:\Users\Public\fwtool.exe` with `OriginalFileName: netsh.exe` | Match `OriginalFileName` (or another PE metadata field), not only the path. |
| Alternate path forms | `C:\Windows\System32\..\System32\netsh.exe`, `\\?\C:\Windows\System32\netsh.exe`, 8.3 short names such as `C:\PROGRA~1\...` | Use `endswith` on the file name instead of equality on the full path. These forms usually survive in `CommandLine` and `ParentCommandLine`; logging agents tend to normalize `Image`, so do not rely on odd forms there. |
| Argument reordering | `powershell.exe -EncodedCommand <b64> -NoProfile` | Do not assume flag order. Use `contains\|all` instead of one long literal. Only use this where the tool really accepts any order. |
| Flag aliases | `-e`, `-ec`, `-enc` and `-EncodedCommand` | List each real alias, or use a regular expression. Verify every alias on a real system. |
| Alternate switch prefix | `/enc` in place of `-enc` | `\|windash` covers `-` and `/`. |
| Unicode dashes | `powershell.exe \u2013NoProfile \u2013EncodedCommand ...` (en dash) | `\|windash` also covers en dash, em dash and horizontal bar. Only valid for tools that accept them, which PowerShell does. |
| Whitespace | `state  off` (two spaces), tabs | A regular expression, or a wildcard such as `state*off`. |
| Legacy or alternate syntax | `netsh firewall set opmode disable` | Read the tool's documentation, and list every form. |

Rules for variants:

1. **It must really work.** Each variant is something an attacker's shell would actually execute. Do not invent syntax. Test it on a lab machine you own, or quote documentation. This applies to carets and quotes in particular: they behave differently for built-ins and external programs.
2. **One change at a time.** Change one thing relative to a positive, so a missed variant tells the learner exactly which idea they lack.
3. **Different ideas, not the same idea three times.** Three case variants teach one lesson.
4. **Name the technique.** `technique` is a short lowercase phrase: `upper case`, `renamed binary`, `caret insertion`, `unicode dash`. It is printed when the learner misses the variant, so it should name what to think about, not how to fix it.
5. **A variant is not a benign event.** If a sensible rule cannot tell it from a benign event by any field, drop it.
6. **Write Unicode as escapes.** In JSONL, write `\u2013` rather than the literal character. Look-alike characters are invisible in a pull request diff, and an escape makes the evasion reviewable.
7. **The reference solution must catch every variant** when `min_variants_caught` is `all`. Run `dojo test <kata> --solution` to see.

## Pick thresholds

Start from the defaults and move them only with a reason.

| Tier | `min_tpr` | `max_fpr` | `min_variants_caught` | Typical data |
|---|---|---|---|---|
| 1 | `1` | `0` | `0` (variants optional) | 3 positives, 6 to 8 benign |
| 2 | `1` | `0` | `all`, or all but one | 3 to 5 positives, 8 or more benign, 3 or more variants |
| 3 | `1` | `0` | `all` | More of everything, with several evasion ideas |

- **Prefer fixing the data over loosening a threshold.** If the solution cannot pass `max_fpr: 0` because one benign event is ambiguous, remove or sharpen that event.
- **`min_tpr` below `1`** is rarely right. If one positive is a stretch goal, make it a variant and require one fewer.
- **`max_fpr` above `0`** only makes sense with enough benign events that the rate means something. One false positive in six is 17 percent, in twelve it is 8 percent. Choose the number of events with this granularity in mind.
- **`min_variants_caught` as a number** lets you keep a stretch variant that a short explanation can discuss, without failing learners who catch the rest. Use `all` when every variant is a lesson the learner should be able to apply.
- Set `estimated_minutes` to the time a learner needs on a first attempt. Roughly 10 to 20 for tier 1, 20 to 35 for tier 2, 30 to 60 for tier 3.

## Write hints that escalate

A kata has two to four hints, gentlest first. Learners reveal them with `dojo show <kata> --hint N`, and `dojo watch` reveals them on its own as a learner keeps failing, starting with hint 1 after the second failing run. Each hint should be worth more than the last:

1. **Nudge.** Where to look. Which events, which fields. No vocabulary the learner does not have yet.
2. **Technique.** The concept that separates attack from noise, in plain language.
3. **Near-answer.** The structure of the solution: how many selections, which fields, which modifiers. Still no finished rule and no exact values.
4. **(Optional) almost the solution**, for tier 3 only.

The hints of the worked example follow this ladder. The first points at fields, the second names the telling difference, the third describes two selections and what each tests.

Rules:

- Every hint stands alone. A learner may read hint 3 without having read hint 2.
- Hints never print the solution and never describe the benign events. Spoiling the traps spoils the kata.
- Where possible, teach a Sigma skill in the hint (`contains|all`, a list of maps for OR, `1 of selection_*`).

## Write the explanation

`explain.md` is the reward for passing. It is read by someone who has just succeeded, so it can afford to be thorough. A good structure:

- **What your rule does.** Two or three sentences in the reader's own terms.
- **Why the benign events are benign.** One line per trap.
- **The evasions.** What each variant teaches and how the solution handles it.
- **Going further.** What a production rule would add that dojo cannot grade: context, baselines, correlation. This is the right place for ideas that need history.

Aim for 150 to 400 words. Link to the ATT&CK technique page if you like; the tool itself never fetches anything. Write it yourself: do not copy text from blog posts, vendor reports or other rule repositories.

## Keep the data inert and synthetic

Every event is **written by you**, is **safe to read**, and **points nowhere real**.

- **Addresses.** Use the documentation ranges: IPv4 `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` (RFC 5737) and IPv6 `2001:db8::/32` (RFC 3849). A kata about internal versus external traffic may add RFC 1918 addresses for the inside, and documentation ranges for the outside.
- **Names.** Use `example.com`, `example.org`, `example.net` or the reserved suffixes `.test`, `.invalid` and `.example`. Never a real domain, URL, e-mail address or share.
- **Hosts and accounts.** Obviously fictional: `WS-DOJO-01`, `SRV-DOJO-01`, `DOJO\user01`, `svc-dojo`. No real people, employers or customers.
- **Payloads.** No shellcode, no working exploit strings, no real malware, no real command-and-control infrastructure, no hashes of real samples. Encoded commands must decode to something harmless. For example, this decodes to `Write-Host 'dojo'`:

  ```
  VwByAGkAdABlAC0ASABvAHMAdAAgACcAZABvAGoAbwAnAA==
  ```

  Make your own with `node -e "console.log(Buffer.from(\"Write-Host 'dojo'\", 'utf16le').toString('base64'))"`.
- **Command lines.** They are data and dojo never runs them, but design them as if a learner might paste one into a lab shell. Prefer `whoami`, `echo`, `calc.exe` and loopback pings. Where the real attack command is itself destructive, such as deleting shadow copies or clearing a log, keep the real syntax (the kata needs it) but point it at a clearly fake target when the syntax allows: a drive letter that does not exist, a log called `DojoLab`.
- **Tool names are fine as plain strings.** `mimikatz.exe` in an `Image` field is text, and it is the very mistake a kata about behavior should punish. The prohibition is on working payloads, not on names.
- **Hashes.** Omit hash fields unless the kata is about hashes. If you need one, hash a file you made up, never a known sample.
- **Identifiers.** Use fresh random GUIDs and fictional timestamps. Generate a GUID with `node -e "console.log(crypto.randomUUID())"`.
- **Originality.** Write events and rules from the tool's documentation and from the ATT&CK description of the technique. Do not paste from public log datasets, blog posts, vendor reports or other rule repositories. Rules published elsewhere carry their own license terms (SigmaHQ uses the Detection Rule License), so every kata here stays original work.

## Check your work

From the root of a clone, with your kata at `katas/<NN>-<id>/`:

```
dojo new <id> --tier 2 --kind write      # scaffold, then edit every file
dojo validate-kata katas/<NN>-<id>       # schema, sizes and semantic checks
dojo test <id> --solution                # the reference solution passes
mkdir my-rules                           # git-ignored scratch folder for your trial rules
dojo start <id> --out my-rules/try.yml   # the starter, as a learner would get it
dojo test <id> my-rules/try.yml          # the starter fails, as it should
dojo lint katas/<NN>-<id>/solution.yml --kata <id> --strict
dojo show <id>                           # read the kata the way a learner will
dojo show <id> --hint 1                  # and each hint in turn
npm test
npm run validate-katas
```

`dojo new` creates a folder with valid placeholder files for every part of the kata. Before you build on it, confirm that `number` is the next unused number in `katas/` and that the folder is named `<NN>-<id>`. Then play your own kata: write a naive rule and make sure the failure output teaches something. When it does, open a pull request and tick the kata checklist in the template.
