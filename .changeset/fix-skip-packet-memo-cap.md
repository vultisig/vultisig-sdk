---
'@vultisig/sdk': minor
---

Measure the ICS-20 packet memo when checking a Skip cosmos leg against its chain's `MaxMemoCharacters` cap. The SDK previously measured only the transaction-level `cosmos_tx.memo` and documented the inner packet memo as unbounded, which is not true for Terra Classic (columbus-5). A Skip PFM leg carries an empty top-level memo with the payload inside `MsgTransfer`, so the old check read 0 bytes and admitted a route the chain rejects at broadcast with sdk error code 12 - after the signing ceremony. Adds `isCosmosPacketMemoEnforcingChainId` next to the existing memo-cap canonicals so backend, app and CLI consume one rule set.
