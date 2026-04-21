---
'@vultisig/sdk': patch
---

fix(sdk/vault): wrap invalid-receiver error in VaultError

`getMaxSendAmount` now throws `VaultError(InvalidConfig)` instead of a generic `Error` when the receiver address fails validation. Matches how the rest of `VaultBase`'s address validation surfaces errors, so consumers checking `error.code` or `instanceof VaultError` catch it correctly.
