# One goal, four tools

The attacker's goal is "make recovery impossible"; each tool is just a different way to say it.
Writing one **image + arguments** pair per tool, then combining the pairs, keeps each pair precise.
The condition uses parentheses so the tool and its arguments must belong together.

- `vssadmin delete shadows /for=C: /oldest` is routine disk cleanup by backup software. The attacker
  version removes **all** copies, so `/all` is the discriminator.
- `bcdedit ... recoveryenabled yes` re-enables recovery and is benign; the mirror image is not.
- Creating shadow copies (`wmic shadowcopy call create`) is the opposite of the attack.

Rules like this are worth keeping at high severity: very little legitimate software removes every
shadow copy, and the next step in an intrusion is usually encryption (ATT&CK T1490).
