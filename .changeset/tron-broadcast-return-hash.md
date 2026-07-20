---
'@vultisig/core-chain': patch
---

Return the tx hash string (not the full RPC envelope object) from the Tron broadcast resolver, consistent with the other broadcast resolvers. The SDK's `BroadcastService` discards the broadcast resolver's return and derives the hash itself, so no consumer read the object — this is a shape-consistency fix.
