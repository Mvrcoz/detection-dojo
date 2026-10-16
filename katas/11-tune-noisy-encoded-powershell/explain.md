# From noisy to useful

The starter's mistake was matching a **prefix**. PowerShell parameters share first letters
(`-ExecutionPolicy`, `-ErrorAction`, `-Encoding`, `-Exclude`), so " -e" says almost nothing. Two ideas
make the rule precise:

1. **Spell out the real switch space.** `-e`, `-ec`, `-en`, `-enc`, `-EncodedCommand` all work, so the
   regex accepts `e`, `ec`, or `en` followed by letters.
2. **Require what only an encoded command has**: a long Base64-looking argument. `-Encoding utf8`
   fails that test, `-ep bypass` fails the switch test.

The dash is not always `-`. Windows PowerShell accepts `/` and several typographic dashes as switch
prefixes, which attackers use to slip past rules that look for a plain hyphen.

Finally, the management agents. Excluding them by **full parent path** keeps the exception narrow: a
filter on "cmd.exe" or "any parent called CcmExec.exe" would be an invitation. Always write down what
you excluded and why; tomorrow's you will want to know.
