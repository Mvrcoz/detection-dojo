# Contributing to detection-dojo

Thank you for helping people learn detection engineering. There are three good ways to contribute, and the first one is the most valuable:

1. **Write a kata.** A new scenario with sharp true positives, hard benign look-alikes and evasion variants is worth more to learners than any amount of code.
2. **Improve the engine.** Fix a bug in the Sigma evaluator or the CLI, or make an error message kinder.
3. **Improve the docs.** Anything that confused you is a candidate.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, read [SECURITY.md](SECURITY.md) first and do not open a public issue.

## Contents

- [Development setup](#development-setup)
- [Repository map](#repository-map)
- [Running things](#running-things)
- [Adding a kata, step by step](#adding-a-kata-step-by-step)
- [The good first kata path](#the-good-first-kata-path)
- [Code conventions](#code-conventions)
- [Pull requests and review](#pull-requests-and-review)
- [How we credit kata authors](#how-we-credit-kata-authors)
- [Releasing (maintainers)](#releasing-maintainers)

## Development setup

You need two things: **Node.js 22.18 or newer**, and npm, which comes with it.

- **Why 22.18?** Node runs TypeScript directly (type stripping) from 22.18 without flags. The tests and `npm run dojo` use that, so there is no compile step while you work.
- **Why does the package say Node 20?** The published package is compiled JavaScript and supports Node 20 and newer (`engines` in `package.json`). CI builds it and runs the built CLI on Node 20, so code under `src/` must not use APIs newer than Node 20. Test code may use newer ones.

Fork the repository on GitHub, clone your fork, and install:

```
cd detection-dojo
npm ci
npm run typecheck
npm test
npm run validate-katas
```

If those four commands pass, your environment is ready. The project has one runtime dependency (`yaml`) and no build tooling beyond TypeScript.

The repository stores LF line endings (see `.gitattributes`), also on Windows. If your editor insists on CRLF, let Git normalize it; the tool itself accepts both.

## Repository map

```
src/
  cli.ts                    entry point (bin), argument parsing, dispatch, exit codes
  errors.ts                 the DojoError hierarchy shared by every module
  sigma/                    the Sigma subset evaluator (no I/O besides YAML text in)
  kata/                     kata format, loading, validation, grading, progress
  commands/                 one file per CLI command
  render/                   terminal rendering: color, scorecard, tables
katas/                      the bundled curriculum (data, shipped in the npm package)
test/                       node:test suites, run directly as TypeScript
docs/
  ARCHITECTURE.md           the contract between modules; read it before changing code
  KATA_FORMAT.md            the on-disk kata format and "Design a great kata"
  WRITING_RULES.md          the learner's cheat sheet for the supported Sigma subset
.github/                    CI, release workflow, issue forms, PR template, Dependabot
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the contract. If code and that document disagree, fix one of them in the same pull request.

## Running things

In a clone, the CLI is `npm run dojo -- <command>`. The docs write commands as `dojo <command>`; substitute accordingly. For example `dojo list` becomes `npm run dojo -- list`.

| I want to... | Run |
|---|---|
| Run every test | `npm test` |
| Run one test file | `node --test test/cli.test.ts` |
| Typecheck | `npm run typecheck` |
| Build the package into `dist/` | `npm run build` |
| Try the built CLI (this is what Node 20 users get) | `node dist/cli.js list` |
| Validate every bundled kata | `npm run validate-katas` |
| Check what `npm publish` would ship | `npm run build`, then `npm pack --dry-run --json \| node .github/scripts/check-package-contents.mjs` |

Learner progress is written to `~/.detection-dojo/progress.json`. Keep experiments out of it by pointing `DOJO_HOME` somewhere disposable; `.dojo-home/` is already git-ignored:

```
# bash, zsh
DOJO_HOME=.dojo-home npm run dojo -- list

# PowerShell
$env:DOJO_HOME = ".dojo-home"; npm run dojo -- list
```

`DOJO_KATAS_DIR` points the tool at a different folder of katas, which is handy for trying a kata collection outside `katas/`.

### What CI runs

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request to `main`:

- **`test`**: Ubuntu, Windows and macOS on Node 22 and 24. `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, `npm run validate-katas`.
- **`node20-dist`**: builds the package, runs the built CLI on Node 20 (`list` and `validate-kata --all`), and checks that the tarball contains `dist/` and `katas/` but not `src/` or `test/`.

A kata pull request needs no special workflow: `validate-katas` is its check. Run the same commands locally and CI should be green on the first try.

## Adding a kata, step by step

Read [docs/KATA_FORMAT.md](docs/KATA_FORMAT.md) first. Its second half, "Design a great kata", is the part that decides whether your kata teaches anything. Commands below use the `dojo` spelling; see [Running things](#running-things).

1. **Propose it.** Open a **Kata proposal** issue with the ATT&CK technique, scenario, logsource and why it teaches something new. This is optional for a small kata, but it spares you a rewrite if the idea overlaps an existing one. Run `dojo list` first.
2. **Scaffold it.**

   ```
   dojo new <id> [--tier N] [--kind write|tune] [--dir DIR]
   ```

   This creates a kata folder with every required file filled with valid placeholder content, and refuses to overwrite anything. The folder must end up at `katas/<NN>-<id>/`, where `NN` is the next unused number. Open `kata.yml` and check that `number` agrees with the folder name.
3. **Fill in `kata.yml`.** Title, ATT&CK ids, tags, logsource, scenario, objective, two to four escalating hints, thresholds, estimated minutes, and your name in `author`.
4. **Write the events** in `events/`: at least 3 positives and 6 benign look-alikes, plus at least 3 evasion variants for tier 2 and 3. Give every benign event a `_dojo.note` that explains why it is benign, and every variant a `_dojo.technique`. All data must be synthetic and inert.
5. **Write `solution.yml`**, then `starter.yml` (a skeleton for `write` katas, a flawed rule for `tune` katas), then `explain.md`.
6. **Validate it.**

   ```
   dojo validate-kata katas/<NN>-<id>
   ```

   Fix every error, and read every warning. If the solution fails, `dojo test <id> --solution --verbose` shows which events it gets wrong.
7. **Play it as a learner.** Run `dojo show <id>`, start from the starter with `dojo start <id> --out my-rules/try.yml` (create the git-ignored `my-rules/` folder first), write the laziest rule you can think of, and run `dojo test <id> my-rules/try.yml`. If the lazy rule passes, the benign set is too easy. If the feedback does not teach, improve the notes.
8. **Lint your solution.** `dojo lint katas/<NN>-<id>/solution.yml --kata <id> --strict` should be clean: the reference rule sets the example.
9. **Run the whole suite.** `npm test` and `npm run validate-katas`.
10. **Open the pull request** and tick the kata checklist in the template. Send one kata per pull request.

## The good first kata path

New to the project, or new to detection engineering? Start here.

1. **Pick a small, visible behavior.** A single command or registry value whose telling detail is easy to point at: a built-in tool downloading a file, a command that clears an event log, a command that creates a local account. These are ideas, not a promise that they are still free; check `dojo list` for what exists.
2. **Aim for tier 1.** One idea, one or two selections. Variants are optional at tier 1, though a couple are a good stretch.
3. **Build the smallest valid kata.** Three positives that differ from each other, six benign look-alikes with honest notes, two hints, default thresholds.
4. **Say so early.** Open a kata proposal issue (or a draft pull request) and mention that it is your first kata. A maintainer will look at the scenario and the benign events before you polish anything, because those are the hard part.
5. **Expect a conversation.** Most first katas need one or two rounds on the benign set. That is normal, and it is where the learning happens.

Issues that are a good fit for newcomers carry the `good first issue` label.

## Code conventions

The binding list lives in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) section 2. In short:

- **Erasable TypeScript only.** No `enum`, no `namespace`, no constructor parameter properties. This is what lets Node run `.ts` directly and `tsc` emit plain JavaScript.
- **Relative imports end in `.ts`**: `import { x } from './y.ts'`. The build rewrites them.
- **No new dependencies.** The only runtime dependency is `yaml`. Use Node built-ins (`node:util`, `node:fs`, `node:path`, `node:worker_threads`, `node:test`). If you believe a dependency is justified, write the reason in the pull request.
- **Never execute data.** No network access, no `child_process`, no `eval` or `new Function`. Rules and katas are data; nothing derived from them is ever run. Regular expressions from rules run only inside the isolated grader with a timeout.
- **Cross-platform.** Build paths with `node:path`. Tolerate CRLF and a UTF-8 byte order mark in every input file.
- **Deterministic output.** Nothing may depend on locale or timezone. Color and symbols only on a TTY with `NO_COLOR` unset (`FORCE_COLOR=1` and `DOJO_ASCII=1` override).
- **Stable machine output.** Every command that prints results supports `--json`: one JSON document on stdout, nothing else.
- **Exit codes.** `0` success or kata passed, `1` kata not passed or lint errors, `2` usage or input error, `70` unexpected error. A problem a user can cause is a `DojoError` from `src/errors.ts`: print `error: <message>` to stderr, with no stack trace.
- **Write for the learner.** Error messages say what happened, why, and what to try next, in plain words. Names should be clear enough to need no comment.
- **Comments explain why, not what.** Delete dead code instead of commenting it out, and do not leave unfinished-work markers behind; open an issue for the idea instead.
- **Test what you change.** Tests use `node:test` and `node:assert/strict` under `test/`. Sigma behavior belongs in a table-driven conformance file for its feature family. Kata engine tests run on fixtures under `test/fixtures/`, never on the real curriculum. End-to-end tests spawn the CLI as a subprocess.

## Pull requests and review

- **Keep a pull request to one concern**: one kata, or one fix. It makes review quicker and revert safer.
- **CI must be green** on all three operating systems and both Node versions, plus the Node 20 job.
- **Fill in the template.** It has a kata checklist and a code checklist; delete the one that does not apply.
- **Expect review in rounds.** Maintainers are volunteers. We aim to give a first response within about a week. If a pull request has been quiet for longer, a polite nudge is welcome.

What reviewers look for in a **kata**:

- The kata teaches one clear idea, and the scenario does not give the answer away.
- The benign set contains genuinely hard look-alikes, and each has a note that explains why it is benign.
- Variants are behavior an attacker could really use, and each one names its technique.
- ATT&CK ids match the behavior, hints escalate, and `explain.md` is accurate.
- Everything is synthetic and inert, and nothing is copied from other projects, datasets or rule repositories.

What reviewers look for in **code**:

- A test that fails without the change.
- The conventions above, and an update to the docs if behavior changed.
- Friendly errors for anything a user can cause.

Write commit messages in the imperative mood (`Add netsh firewall kata`, `Fix wildcard escape at end of value`). Prefixes such as `feat:` and `fix:` are welcome but not required.

By submitting a contribution you agree that it is licensed under the project's [MIT license](LICENSE).

## How we credit kata authors

A kata is authored work, and it is credited as such.

- **`author` in `kata.yml`.** Put the name you want to be known by: a real name, a handle, or a team. It stays with the kata. If a maintainer substantially reworks your kata before it merges, they are added next to you (`Your Name, Maintainer Name`), never in place of you.
- **The changelog.** Each release's notes in [CHANGELOG.md](CHANGELOG.md) list the katas that shipped in it, with their authors.
- **Git history.** Your commits keep your authorship. We do not rewrite them.

## Releasing (maintainers)

1. Move the "Unreleased" notes in `CHANGELOG.md` under a new version heading with the date, and add the new katas with their authors.
2. Set `version` in `package.json` to the same version.
3. Merge to `main`, then tag the merge commit `v<version>` (for example `v0.1.0`) and push the tag.

[`.github/workflows/release.yml`](.github/workflows/release.yml) then builds, tests and publishes to npm with provenance. It fails before publishing if the tag and `package.json` disagree or if the version is a prerelease. Publishing needs an npm token stored as the `NPM_TOKEN` repository secret, and `package.json` needs a `repository` field that matches this repository, because npm verifies provenance against it.
