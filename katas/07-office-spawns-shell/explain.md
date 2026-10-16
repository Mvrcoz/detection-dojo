# Relationships beat names

`cmd.exe` and `powershell.exe` are everywhere, so neither is a signal. The signal is **who started
them**. Documents are data; when an Office process spawns an interpreter, something inside the
document is executing (a macro, an embedded object, an exploit).

- Office helpers (`splwow64.exe` for printing, `WerFault.exe` after a crash, a browser for a clicked
  link) are children too, so the child list names interpreters rather than "anything".
- The add-in exception is written as a **filter on the exact script path**. Excluding `cmd.exe`
  from the rule would let attackers hide behind it; excluding one path does not.
- Renamed interpreters are still caught via `OriginalFileName`, and the parent test follows the
  program name, not its install folder, so 32-bit Office paths match too.

ATT&CK T1204.002 (user execution of a malicious file) and T1059 (command and scripting interpreters).
