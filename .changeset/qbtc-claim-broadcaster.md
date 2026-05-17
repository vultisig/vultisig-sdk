---
'@vultisig/core-chain': minor
---

qbtc: add required `broadcaster` field to `BuildMsgClaimWithProofInput` (proto field 9). Mirrors the chain-side signer rework in btcq-org/qbtc#171 — `claimer` is now payload-only (mint destination), while `broadcaster` is the cosmos tx signer. Callers must populate `broadcaster` (typically equal to `claimer` for wallet flows where the user's own MLDSA key signs the tx).
