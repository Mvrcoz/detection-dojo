# Two halves of one idea

The **key** tells you the value will run at logon. The **value** tells you whether what it runs
deserves suspicion. Neither is enough alone: every installer writes to Run keys, and plenty of
software stores paths in the registry.

- OneDrive, Teams and Discord run from `AppData\Local`. A broad `\AppData\` pattern would flag
  them all, so the rule names the folders attackers actually stage in (`Roaming`, `Temp`,
  `Users\Public`) plus scripting hosts.
- `Wow6432Node`, `RunOnce` and `Policies\Explorer\Run` are the same trick in different keys. Using
  `contains` on the shared tail covers them all.
- A value in an unrelated key that happens to hold an AppData path (the vendor settings event) must
  not fire, which is why the key test is required.

This is ATT&CK T1547.001, "Registry Run Keys / Startup Folder".
