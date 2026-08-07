---
'@vultisig/sdk': patch
---

Align raw Solana duplicate-broadcast handling with the core and React Native resolvers by accepting `AlreadyProcessed` when status is pending or unavailable while still rejecting explicit on-chain failures.
