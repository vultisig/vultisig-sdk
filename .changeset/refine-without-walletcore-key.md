---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

`buildSendKeysignPayload` now runs `refineKeysignAmount` and `refineKeysignUtxo` on the `hexPublicKeyOverride` path (`publicKey: null`, e.g. QBTC / MLDSA-only signing), which previously skipped both silently. A QBTC send there is now re-capped to `min(toAmount, balance - fee)` and refused with `not-enough-funds` when the balance cannot cover the fee, matching how native sends on account-based chains such as ETH and SOL are already refined (UTXO and TON keep their own handling). Neither refinement reads the WalletCore key, so `publicKey` is now optional on `refineKeysignAmount`, `refineKeysignUtxo`, `getFeeAmount` and the UTXO signing-input resolver; existing callers that pass it are unaffected.
