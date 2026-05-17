---
'@vultisig/core-chain': major
---

qbtc: add required `broadcaster` field to `BuildMsgClaimWithProofInput` (proto field 9). Mirrors the chain-side signer rework in btcq-org/qbtc#171 - `claimer` is now payload-only (mint destination), while `broadcaster` is the cosmos tx signer. Callers must populate `broadcaster` (typically equal to `claimer` for wallet flows where the user's own MLDSA key signs the tx).

BREAKING CHANGE: `BuildMsgClaimWithProofInput` now requires a new `broadcaster: string` field. Existing callers will fail at TypeScript compile-time (or runtime if TS is bypassed) until updated. For wallet flows pass `broadcaster === claimer`.
