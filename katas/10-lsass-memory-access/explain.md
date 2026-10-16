# Exclusions are an attack surface

Every allow-list entry is somewhere an attacker can hide. The weakest possible entry is a bare file
name (`SourceImage|endswith: '\svchost.exe'`): any dumper copied to `C:\Users\Public\svchost.exe`
inherits the trust. The rule above compares **full paths**, so `C:\Windows\Temp\svchost.exe`
stays visible.

- `GrantedAccess` is a bitmask. `0x1010` and `0x1038` allow reading memory; routine callers
  use narrower masks such as `0x1000` or `0x1400`, which the selection leaves out by itself.
- Comparison is case-insensitive, so `0x1FFFFF` matches the same as `0x1fffff`.
- `not 1 of filter_*` keeps each exclusion in its own named filter, so it is obvious what was
  excluded and why.

ATT&CK T1003.001, "OS Credential Dumping: LSASS Memory".
