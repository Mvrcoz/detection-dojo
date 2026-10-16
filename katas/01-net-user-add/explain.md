# Verb over tool

`net.exe` is a normal administrative tool, so alerting on it would drown you. The behavior is
**creating** an account: the `user` sub-command together with `/add`. Every benign event here is
`net` doing something else (listing users, mapping a share, reading password policy).

- Real creations also come through `net1.exe`, so match both names.
- Matching `OriginalFileName` as well as `Image` survives a renamed copy of the tool.
- Command-line matching is case-insensitive in Sigma, so `/ADD` and `/add` are the same rule.

New local accounts are a classic persistence step (ATT&CK T1136.001). In production, pair this
with a list of accounts your provisioning system is expected to create.
