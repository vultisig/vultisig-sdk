---
"@vultisig/core-mpc": patch
"@vultisig/sdk": patch
---

Sign TRON FreezeBalanceV2 / UnfreezeBalanceV2 with `fee_limit` set to the payload's `gasEstimation`, matching the iOS and Android signers, so desktop/extension co-signers hash the same pre-image as a mobile initiator in the same keysign ceremony (previously hardcoded to 0, producing divergent MPC preimages).
