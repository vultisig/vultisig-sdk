---
'@vultisig/sdk': minor
---

Add `buildTronTxFromRawData(rawDataHex)` to sign yield.xyz Tron actions whose `raw_data` is already encoded upstream (FreezeBalanceV2, UnfreezeBalanceV2, VoteWitnessContract, …). Hashes the raw_data bytes with SHA-256, takes the MPC signature, and wraps the final `Transaction { raw_data, signature }` envelope — same `{signingHashHex, unsignedRawHex, finalize(sig)}` contract as `buildTronSendTx`. Includes strict hex-character validation so malformed input fails fast instead of silently producing a wrong signing payload.
