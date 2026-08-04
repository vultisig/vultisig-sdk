---
'@vultisig/sdk': patch
---

Wire `assertSafeDestination` into `prepareSendTxFromKeys` so every send that goes through the keys path (vault-CLI, agent-backend) is guarded against known-dangerous contract addresses. Adds an own-token-contract guard that rejects sends to the token's own contract address, which is a common drain-wallet vector. Mirrors the existing destination guard on the vault path.
