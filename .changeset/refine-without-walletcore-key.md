---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

`buildSendKeysignPayload` now runs `refineKeysignAmount` and `refineKeysignUtxo` on the `hexPublicKeyOverride` path (`publicKey: null`, e.g. QBTC / MLDSA-only signing), which previously skipped both silently. A native MAX send there is re-capped to `min(toAmount, balance - fee)` and refused with `not-enough-funds` when the balance cannot cover the fee, as on every other chain. Neither refinement reads the WalletCore key, so `publicKey` is now optional on `refineKeysignAmount`, `refineKeysignUtxo`, `getFeeAmount` and the UTXO signing-input resolver; existing callers that pass it are unaffected.
