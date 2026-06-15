---
'@vultisig/cli': patch
---

Fix EIP-712 domain hashing for domains that omit standard fields. The agent executor's `sign_typed_data` hardcoded the `EIP712Domain` type to all four standard fields while skipping absent values during data encoding, producing non-canonical hashes for domains without `verifyingContract` (e.g. Polymarket's `ClobAuthDomain`) — CLOB rejected every auto-submitted order with `401 Invalid L1 Request headers`. The domain type is now derived from the fields actually present, matching viem/ethers canonical hashing (verified live against the Polymarket CLOB: L1 auth now accepted and L2 API credentials derived).
