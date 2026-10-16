# Security policy

detection-dojo reads rule files and kata folders that other people write, and a learner may open a kata they downloaded. Taking that seriously is part of the design, and reports that help us do it better are very welcome.

## Supported versions

The project is young. Security fixes go to the latest release line only.

| Version | Supported |
|---|---|
| 0.1.x | Yes |
| Anything older, or an unreleased commit | No |

## Reporting a vulnerability

Please report privately and do not open a public issue.

1. Open this repository's **Security** tab.
2. Choose **Report a vulnerability**. This creates a private GitHub security advisory that only you and the maintainers can see.
3. Describe the problem, and include:
   - the version (`dojo --version`) and your operating system and Node.js version,
   - the exact steps or the smallest rule, kata or command that reproduces it,
   - what you expected, what happened, and why you think it is a security problem.

If you cannot use private reporting, contact the maintainers through the email listed on the maintainer profile.

We aim to acknowledge a report within 7 days, to tell you whether we agree it is a vulnerability within 14 days, and to ship a fix, or explain why not, as soon as we reasonably can. We are volunteers, so these are goals rather than guarantees. We prefer coordinated disclosure: please give us a chance to release a fix before you publish details. With your permission we will credit you in the advisory and in the changelog, and we are happy to stay anonymous on your behalf instead.

There is no bug bounty.

## Scope

The central promise of the tool is that **it never executes anything that comes from a rule or a kata**. Rules and katas are data. There is no `eval`, no `child_process`, and no network access.

Reports are in scope when they show that this promise, or one of its neighbors, can be broken:

- **Code execution.** Any way for a crafted rule, kata, event file or command-line argument to make the tool run code or spawn a process.
- **Path traversal and file access.** A kata query, `--out`, `--dir`, symbolic link or junction that makes the tool read or write outside the folder it was told to use. This includes `dojo test`, `show`, `start`, `new`, `lint` and `validate-kata`, and the progress file.
- **Overwriting files.** Any case where `dojo new` or `dojo start` replaces an existing file without `--force`. (`dojo new` never accepts `--force`.)
- **ReDoS and resource exhaustion.** A regular expression, wildcard pattern, YAML document, JSON line or kata that makes the tool hang, crash or consume unbounded memory or time. Grading runs regular expressions in an isolated worker with a timeout, so a slow rule is expected to end in a timeout message. Reports about a way around that protection, or about a command that runs a rule's regular expression outside it, are exactly what we want.
- **Size and parser limits.** A way to get past the documented file, event and regular expression size limits.
- **Dependencies and packaging.** A vulnerable version of our one runtime dependency (`yaml`) that actually affects us, or a published package that contains files it should not.
- **Supply chain.** A weakness in our CI or release workflows that could let someone tamper with a published package.

Low-severity findings are welcome too. If you are unsure, report it.

## Out of scope

- **Disagreements about kata content.** A benign event you consider malicious, a wrong ATT&CK mapping, a hint that is unclear, a scenario that is inaccurate. These are ordinary bugs: please open a normal issue with the **Kata content** option.
- **Limits of the Sigma subset.** Aggregations, correlation and the other unsupported features fail loudly by design. Missing Sigma features are feature requests, not vulnerabilities.
- **Attack-like strings in katas.** Katas contain command lines and file names that look malicious. They are synthetic, inert text and are never executed. A report that a kata "contains malware" needs an example of a real payload to be treated as one.
- **Trusted local configuration.** The `DOJO_HOME` and `DOJO_KATAS_DIR` environment variables, and the files a user deliberately points the tool at, are trusted by definition. A report that needs an attacker to already control the user's environment or account is out of scope.
- **Issues in other software.** Vulnerabilities in Node.js, npm, GitHub or Sigma tooling should go to their own maintainers.
- **Social engineering and physical attacks**, and automated scanner output with no demonstrated impact.
