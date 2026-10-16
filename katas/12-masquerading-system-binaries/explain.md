# Pair every name with its one correct path

Two details decide whether this rule is sound:

1. **Exact path, not folder prefix.** `startswith 'C:\Windows\System32\'` is tempting and wrong: a
   copy dropped in `System32\drivers\etc\` or `System32\wbem\` would be trusted. The anchored regex
   `^C:\Windows\System32\name.exe$` accepts exactly one path per name.
2. **Names are not interchangeable.** `explorer.exe` belongs to `C:\Windows\`; if one shared allow-list
   included both folders, `C:\Windows\System32\explorer.exe` would pass. Separate selections per
   expected location avoid that.

The pattern `\\name.exe$` also keeps look-alike names such as `svchost-monitor.exe` out of scope:
the backslash before the name and the end anchor must both match.

ATT&CK T1036.005, "Masquerading: Match Legitimate Name or Location". Adapt the paths if you run
Windows from another drive letter.
