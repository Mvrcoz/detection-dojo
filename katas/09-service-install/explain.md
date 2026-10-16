# Read the command Windows will run

A service is a command line that Windows promises to run as SYSTEM. So the rule inspects exactly
that command line:

- `%COMSPEC% /c ...` and `cmd.exe /c ...` turn a service into a one-shot command runner, which
  is how several remote-execution tools work.
- `\ADMIN$\` paths mean the binary was copied over an administrative share a moment before.
- Windows Defender legitimately runs from `C:\ProgramData\Microsoft\Windows Defender\Platform\...`,
  so `ProgramData` is **not** in the list. Choosing patterns is choosing which false positives you
  accept.
- Drivers appear here as well (`\SystemRoot\System32\drivers\x.sys`), and a service-state event
  (7036) shares the log but is not an installation. Matching EventID and provider keeps both quiet.

ATT&CK T1543.003, "Create or Modify System Process: Windows Service".
