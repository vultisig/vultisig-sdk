---
'@vultisig/core-mpc': patch
---

Reject negative TON signing amounts before byte encoding so native, dApp-supplied
TON messages, and Jetton helper amounts cannot silently truncate a `-`-prefixed
hex value.
