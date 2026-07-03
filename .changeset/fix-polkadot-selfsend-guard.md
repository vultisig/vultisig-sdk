---
"@vultisig/sdk": patch
---

fix(polkadot): reject an invalid destination instead of self-sending. `resolvePolkadotToAddress` (Polkadot + Bittensor) fell back to the sender's own address on a missing/invalid `toAddress`, so the signed extrinsic could diverge from the approved pre-sign card; it now throws.
