---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Zcash sends and THORChain/Maya ZEC swaps now sign version-5 transactions (ZIP-225 format, ZIP-244 sighash and txid). NU7 (mainnet block 3,543,405) rejects the version-4 transactions WalletCore builds, and version 5 is valid before and after activation. WalletCore still plans the transaction (UTXO selection, ZIP-317 fee, change, memo, branch id); only the pre-signing hashes and the signed bytes move off WalletCore. Inputs must be transparent P2PKH, memos are capped at 80 bytes, and a missing branch id, an output address WalletCore returns no lock script for, or a signature that does not verify throws before a transaction is produced. The returned txid is the ZIP-244 txid, which is not `sha256d` of the bytes. Every device in a keysign must run a build with this change: an older device computes v4 hashes and the keysign fails. SwapKit ZEC swaps are deposit-channel sends built by the same path, so they sign version 5 as well. New export: `tx/compile/zcash/zcashV5`.
