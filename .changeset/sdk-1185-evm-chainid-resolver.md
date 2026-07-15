---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export the SDK's canonical EVM `getEvmChainId` and `getEvmChainByChainId` helpers from the root `@vultisig/sdk` surface, and switch the CLI executor's numeric `chain_id` resolver to use that canonical map instead of a stale local subset.

This fixes numeric `chain_id` resolution for newer EVM chains such as Mantle, Hyperliquid, and Sei when transaction envelopes reach the CLI with ids instead of chain names.
