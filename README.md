# detection-dojo

**Learn detection engineering by doing it. Write a [Sigma](https://sigmahq.io) rule, and get graded offline on what it catches, what it wrongly flags, and which evasions slip past it.**

A rule that catches the attack but also fires on harmless look-alikes is a bad rule. Most tutorials never let you feel that. `detection-dojo` does: every kata is a small scenario with labeled, synthetic log events, and a local grader that tells you exactly which events your rule got wrong and *why they matter*.

- **Offline and private.** No accounts, no network calls, no telemetry. One runtime dependency (`yaml`).
- **Graded on three things, not one.** True positives, false positives against realistic benign look-alikes, and evasion variants (case tricks, renamed binaries, alternate switches).
- **Feedback that teaches.** Every benign event carries a note explaining why it is benign; every evasion variant names its technique.
- **15 katas across three tiers**, mapped to MITRE ATT&CK: Windows process, registry, service and file events, Linux, and AWS CloudTrail.
- **Fast loop.** `dojo watch` re-grades every time you save, and unlocks hints if you get stuck.
- **Built to be extended.** Adding a kata is one folder of YAML and JSONL, validated by `dojo validate-kata`.

## Try it

You need [Node.js](https://nodejs.org) 20 or newer and git.

```bash
git clone https://github.com/mvrcoz/detection-dojo.git
cd detection-dojo
npm install
npm run build
node dist/cli.js list
```

Then work through the first kata:

```bash
node dist/cli.js start 1            # writes net-user-add.yml and shows the scenario
node dist/cli.js watch 1 net-user-add.yml   # edit the file, save, and watch the score change
```

> Once the package is published to npm, this becomes `npx detection-dojo start 1`. The commands below use `dojo` as the short name.

## What a session looks like

`dojo list` shows the curriculum and your progress:

```text
  #   Kata                                             Tier          Type   ATT&CK                  Time  Status
  01  A new local account appears                      Starter       write  T1136.001             10 min  -
  02  A built-in tool quietly downloads a file         Starter       write  T1197                 12 min  -
  ...
  11  The rule everyone muted                          Boss          tune   T1059.001, T1027      30 min  -
  15  Minting keys for someone else                    Boss          write  T1098.001             35 min  -
```

`dojo show 1` gives you the story, the objective and one example of the attack. Then you write a rule. A lazy first attempt (`Image|endswith: '\net.exe'`) looks like this:

```text
  Kata 01 * A new local account appears
  Starter  *  T1136.001  *  write the rule

  x True positives    ########....  2/3  caught 67%, need 100%
  x False positives   ############  7/7  benign events matched, allowed 0%
  + Evasion variants  ########....  2/3  optional for this kata

   FAIL   2 of 3 checks failed.

  Missed attacks (the rule should have fired on these):
    line  3  net1 user admin$ P@ssw0rd! /add
             -> Called as net1.exe directly; the trailing $ makes the account
                less visible in some listings.

  False alarms (benign events the rule fired on):
    line  1  net user
             -> why it is benign: Lists local accounts. "user" without "/add"
                creates nothing.
    line  5  net use Z: \\fileserver.example.com\shared /persistent:no
             -> why it is benign: Maps a network drive. The word "use" is not
                "user".

  Evasion variants that slipped past:
    line  3  n.exe user dojo_three Pass123! /add
             -> technique: renamed binary (OriginalFileName still says net.exe)
```

You learn three things from that one screen: the tool name is not the signal, the verb is; `net1.exe` exists; and renamed binaries are why `OriginalFileName` matters. Fix the rule, save, and when everything passes you get a short write-up of what the exercise was really about.

## The curriculum

| # | Kata | Tier | ATT&CK | You will learn |
|---|---|---|---|---|
| 01 | A new local account appears | Starter | T1136.001 | Verb over tool; `all` modifier; renamed binaries |
| 02 | A built-in tool quietly downloads a file | Starter | T1197 | Which sub-commands move data |
| 03 | A built-in HTML app host runs remote script | Starter | T1218.005 | Where the code comes from; UNC paths |
| 04 | Someone is removing your safety net | Starter | T1490 | One goal, four tools; grouping with `or` |
| 05 | A scheduled task that runs from the wrong place | Starter | T1053.005 | Creation is cheap, the destination is the signal |
| 06 | A program that starts every time you log in | Intermediate | T1547.001 | Registry events; AppData\Local vs Roaming |
| 07 | A document that runs commands | Intermediate | T1204.002 | Parent-child rules and narrow exceptions |
| 08 | The DLL launcher that launches the wrong DLL | Intermediate | T1218.011 | Allow-list the locations, not the tool |
| 09 | A new service with a strange command line | Intermediate | T1543.003 | A different log source; reading ImagePath |
| 10 | Who is reading the memory of the login process? | Intermediate | T1003.001 | Access masks; exclusions are an attack surface |
| 11 | The rule everyone muted | Boss | T1059.001 | Tuning a noisy rule without losing detections |
| 12 | The right name in the wrong place | Boss | T1036.005 | Exact-path anchoring; masquerading |
| 13 | A web page that nobody deployed | Boss | T1505.003 | File events; extension matching; web shells |
| 14 | A shell that calls home | Boss | T1059.004 | Linux; several constructions, each kept tight |
| 15 | Minting keys for someone else | Boss | T1098.001 | Cloud logs; nested fields; `fieldref` |

All events are synthetic and inert: documentation IP ranges, `example.com`, fictional users, and command lines that cannot do harm.

## Commands

| Command | What it does |
|---|---|
| `dojo list [--tier N] [--tag T]` | Curriculum and your progress |
| `dojo show <kata> [--hint N] [--events]` | Scenario, objective, field names, one example, hints on request |
| `dojo start <kata> [--out FILE]` | Create your starter rule file |
| `dojo test <kata> <rule.yml> [--verbose] [--json]` | Grade once; exit code `0` pass, `1` fail, `2` error |
| `dojo watch <kata> <rule.yml>` | Re-grade on every save; hints unlock after repeated failures |
| `dojo lint <path...> [--kata ID] [--strict]` | Rule hygiene: missing metadata, over-broad matches, risky regexes |
| `dojo new <id> [--tier N] [--kind write\|tune]` | Scaffold a new kata (contributors) |
| `dojo validate-kata <dir>... \| --all` | Check a kata, including that its reference solution passes |

Katas can be referenced by number (`4`), id (`shadow-copy-deletion`) or folder name. Progress is stored in `~/.detection-dojo/progress.json` (override with `DOJO_HOME`).

`--json` prints a single JSON document on stdout, so `dojo test` works in CI for teams using it as an onboarding exercise.

## How grading works

For each kata, your rule is run against three labeled sets of events:

| Set | Your rule should | Measured as |
|---|---|---|
| **Attack events** | match all of them | true-positive rate |
| **Benign look-alikes** | match none of them | false-positive rate |
| **Evasion variants** | still match them (required on harder katas) | variants caught |

A kata passes when all three thresholds are met. Counts, not floating-point sums, decide the result, so it is exact.

Your rule runs inside a worker thread with a time limit, so a catastrophically slow regular expression is stopped and reported instead of freezing your terminal. Rules and katas are treated strictly as data: nothing in them is ever executed.

## Supported Sigma

`detection-dojo` implements a deliberate subset of the [Sigma specification](https://sigmahq.io/docs/basics/rules.html): selections as maps, lists of maps and keyword lists; wildcards; the modifiers `contains`, `startswith`, `endswith`, `all`, `cased`, `re` (with `i`, `m`, `s`), `cidr`, `base64`, `base64offset`, `utf16le`/`utf16be`/`utf16`/`wide`, `windash`, `exists`, `fieldref`, `lt`/`lte`/`gt`/`gte`; and conditions with `and`/`or`/`not`, parentheses, `1 of`, `all of` and `them`.

Aggregations (`count()`, `near`), `timeframe`, correlation rules and pipeline placeholders are **rejected with an explanation** rather than silently mis-evaluated. See [docs/WRITING_RULES.md](docs/WRITING_RULES.md) for a one-page cheat sheet and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) section 3 for the exact semantics.

The evaluator is covered by an independent conformance suite written from the specification before looking at the implementation. This is not a SIEM backend or a replacement for [pySigma](https://github.com/SigmaHQ/pySigma); it exists to teach.

## Contributing

The most useful contribution is a new kata. Each one is a folder of YAML and JSONL that `dojo validate-kata` checks for you, and a good one teaches a single idea through its benign look-alikes. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/KATA_FORMAT.md](docs/KATA_FORMAT.md). Ideas that would make strong katas: Kubernetes audit logs, Azure/Entra sign-in logs, DNS tunneling, macOS persistence, more Linux auditd.

Bugs and feature requests are welcome; please read [SECURITY.md](SECURITY.md) first if it is a security issue.

## Roadmap

- `dojo mutate`: automatically generate evasion variants for your own rule and report which ones survive
- Shareable result cards and an ATT&CK Navigator layer of the techniques you have covered
- A static browser playground
- `dojo init`: a detection-as-code repository scaffold with CI
- More katas, contributed by the community

## License

[MIT](LICENSE)
