---
'@vultisig/sdk': patch
---

Route CCTP chain lookups through the SDK's canonical chain normalizer. `getCctpChain` was a raw object index, so `"base"` returned `undefined` while every other SDK helper accepts it, and callers had to pre-normalize for this one family. The CCTP builders now resolve the chain before the same-chain guard (so `('base', 'Base')` is still rejected rather than building a bridge from a chain to itself) and stamp the canonical chain name into the emitted envelope regardless of how the caller spelled it.
