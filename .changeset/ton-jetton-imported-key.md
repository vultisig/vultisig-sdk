---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Use the imported TON public key when preparing Jetton transfers and reject imported vaults without a TON key instead of falling back to the root EdDSA key.
