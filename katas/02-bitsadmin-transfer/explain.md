# Detect the action, not the tool

`bitsadmin.exe` is deprecated but present everywhere, and most of its sub-commands are harmless
inspection. The three that matter are the ones that **move data** (`/transfer`, `/addfile`) or
**run something later** (`/setnotifycmdline`).

- `/create` alone only makes an empty job, so it stays benign. The malicious step comes next.
- A renamed copy still carries `OriginalFileName: bitsadmin.exe` in its PE metadata.
- Job names, priorities and URLs are attacker-chosen noise; do not key on them.

BITS jobs can also survive a reboot, which is why ATT&CK files this under T1197 (BITS Jobs) for both
defense evasion and persistence.
