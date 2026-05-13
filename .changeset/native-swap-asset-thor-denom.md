---
'@vultisig/core-chain': patch
---

Normalize THORChain/MayaChain native swap asset ids: single-segment denoms and simple `x/…` paths map to `THOR.<ticker>` / `MAYA.<ticker>`; secured `chain-symbol-0x…` denoms map to `CHAIN.SYMBOL` notation using the canonical `nativeSwapChainIds` mapping. Full `CHAIN.SYMBOL` strings and unrecognized complex denoms remain unchanged.
