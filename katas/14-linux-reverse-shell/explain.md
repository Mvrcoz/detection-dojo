# One goal, several constructions, each kept tight

A reverse shell needs two things: an outbound connection and a shell wired into it. Each tool
spells that differently, so the rule has four small groups, and **each group requires both halves**:

- bash: `/dev/tcp` (the connection) **and** a redirect of the shell into it (`>&`, `<&`, `-i`). A bare
  `/dev/tcp` appears in harmless port checks.
- netcat: a netcat binary **and** an execute switch. `nc -l` (listen) and `nc -zv` (scan) are not shells.
- Python: `socket` + `connect` + a way to attach a shell (`dup2`, `pty.spawn`, `subprocess`).
  Merely importing `socket` is everyday code.
- socat: the binary plus `exec:`.

The variants show why you should not rely on exact spacing (`-i>&` with no space) or on a single
protocol (`/dev/udp/`). Long option names (`--exec`) matter too. The hosts and ports in the events
use reserved documentation addresses and never connect anywhere.

ATT&CK T1059.004, "Command and Scripting Interpreter: Unix Shell".
