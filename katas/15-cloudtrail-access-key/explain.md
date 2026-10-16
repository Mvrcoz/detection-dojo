# Compare fields, not strings

The attack is only visible by **comparing two fields in the same event**. Sigma's `fieldref` modifier
does exactly that: `requestParameters.userName|fieldref: userIdentity.userName` is true when the user
the key is *for* equals the user who made the call, which is ordinary self-service rotation.

- Without `exists: true`, a call that omits `userName` (the API then defaults to the caller) would
  look like a difference. With it, only explicit targets are considered.
- Assumed roles have no `userIdentity.userName`, so they never equal the target and are always
  reported. That is intended: roles creating keys for users deserve a human decision, which is why
  the rotation bot is allow-listed by its **full ARN prefix including the account id**.
- IAM names are case-insensitive, and Sigma string comparison is too, so `Alice` and `alice` are
  the same user.
- `alice` creating a key for `alice-admin` must fire: names that merely start the same are
  different principals.

ATT&CK T1098.001, "Account Manipulation: Additional Cloud Credentials". Note the events here carry no
real key material; CloudTrail does not log secrets, and neither do these examples.
