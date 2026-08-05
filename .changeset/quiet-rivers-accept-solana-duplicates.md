---
'@vultisig/sdk': patch
---

Align raw Solana duplicate-broadcast handling with the core and React Native resolvers by treating `AlreadyProcessed` as broadcast acceptance and leaving execution outcome checks to transaction status resolution.
