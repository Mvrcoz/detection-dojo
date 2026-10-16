## What does this change?

<!-- One or two sentences. Link the issue or kata proposal it belongs to (for example "Closes #12"). -->

## Type of change

- [ ] New kata
- [ ] Change to an existing kata
- [ ] Code change (CLI, Sigma evaluator, kata engine)
- [ ] Documentation or repository infrastructure

Fill in the checklist that matches. Delete the other one.

---

## Kata checklist

<!-- Details and examples for every item are in docs/KATA_FORMAT.md. -->

- [ ] `dojo validate-kata <dir>` passes with no errors, and I read any warnings.
- [ ] `dojo test <kata> --solution` passes, and my starter rule fails as it should (a skeleton for `write` katas, a noisy or weak rule for `tune` katas).
- [ ] Every event is synthetic and inert: RFC 5737 / RFC 3849 addresses, `example.com`-style names, fictional hosts and accounts, no real malware or payloads. Encoded commands decode to something harmless.
- [ ] Benign events have a `_dojo.note` that explains why each one is benign, and the benign set contains genuinely hard look-alikes (not only easy ones).
- [ ] Evasion variants have a `_dojo.technique` and are behavior a real attacker could actually use.
- [ ] `attack` ids are valid MITRE ATT&CK technique ids (for example `T1053.005`) and match the behavior in the scenario.
- [ ] Hints escalate from a nudge, to the technique, to a near-answer, and none of them gives the solution away.
- [ ] No copied rule text, scenario text or events from other projects or datasets. Everything is my own work.
- [ ] `author` in `kata.yml` is the name I want to be credited under.

## Code checklist

- [ ] `npm run typecheck`, `npm run build`, `npm test` and `npm run validate-katas` all pass.
- [ ] I added or updated tests for the behavior I changed (`node:test`, under `test/`).
- [ ] The change follows the conventions in `docs/ARCHITECTURE.md`: erasable TypeScript syntax only, relative imports end in `.ts`, no new dependencies, no network access, no `child_process`, no `eval`.
- [ ] Errors a user can cause are `DojoError`s with a friendly message and the right exit code.
- [ ] Paths are built with `node:path`, and the change works on Windows, macOS and Linux.
- [ ] If behavior in `docs/ARCHITECTURE.md`, `docs/KATA_FORMAT.md` or `docs/WRITING_RULES.md` changed, I updated that document in this PR.
- [ ] I added a line to `CHANGELOG.md` under "Unreleased" for anything a user would notice.
