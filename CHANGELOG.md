# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The first public release, planned as 0.1.0. When it ships, this heading becomes `## [0.1.0] - <date>`.

### Added

- Sigma evaluator for a deliberate subset of the specification. Selections as maps, lists of maps and keyword lists. Case-insensitive matching with `*` and `?` wildcards. Modifiers `contains`, `startswith`, `endswith`, `all`, `re` (with `i`, `m`, `s`), `cased`, `cidr`, `base64`, `base64offset`, `utf16le`, `utf16be`, `utf16`, `wide`, `windash`, `exists`, `lt`, `lte`, `gt`, `gte` and `fieldref`. Conditions with `and`, `or`, `not`, parentheses, and `1 of`, `any of` and `all of` patterns.
- Clear failures for what the subset leaves out: aggregations, `timeframe`, correlation rules, `|expand` and unknown modifiers each stop with a message that names the feature and says what to do instead.
- Kata engine: a strict on-disk format with size limits, loading by folder name, id or number, semantic validation, and grading on true positives, benign look-alikes and evasion variants. Regular expressions run in an isolated worker with a timeout. Learner progress is stored atomically.
- `dojo` and `detection-dojo` command line with `list`, `show`, `start`, `test`, `watch`, `lint`, `new` and `validate-kata`. Every command that prints results supports `--json`. Exit codes are `0` passed, `1` not passed, `2` usage or input error.
- `dojo lint` hygiene checks for rules, with stable warning ids.
- The bundled curriculum of katas under `katas/`. List it with `dojo list`. Every kata records its author in `kata.yml`.
- Documentation: `docs/ARCHITECTURE.md`, `docs/KATA_FORMAT.md` (format and "Design a great kata" guide), `docs/WRITING_RULES.md` (learner cheat sheet), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` and `SECURITY.md`.
- GitHub infrastructure: CI on Ubuntu, Windows and macOS with Node 22 and 24, plus a job that runs the built package on Node 20 and checks the tarball contents; a release workflow that publishes to npm with provenance; issue forms for bugs and kata proposals; a pull request template with kata and code checklists; weekly grouped Dependabot updates.
