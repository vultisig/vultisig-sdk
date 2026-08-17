---
'@vultisig/sdk': minor
---

Check the ICS-20 packet memo against its own per-chain cap when validating a Skip cosmos leg. The SDK previously measured only the transaction-level `cosmos_tx.memo` and documented the inner packet memo as unbounded, so an oversized packet memo was admitted and failed at broadcast with sdk error code 12 after signing. The packet memo is capped separately and far more permissively than the outer memo (columbus-5: 1024 bytes vs 256), so it must not be measured against the outer cap - doing so rejects healthy routes whose packet memos legitimately run 698-1001 bytes. Adds `getCosmosPacketMemoMaxBytesByChainId` next to the existing memo-cap canonicals, and reports which field overflowed via `memo_field`.
