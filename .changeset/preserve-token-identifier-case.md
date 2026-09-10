---
"@vultisig/core-chain": patch
"@vultisig/sdk": patch
---

Preserve case-sensitive non-EVM token identifiers in curated lookups, discovery, and token-transfer guards. EVM addresses remain case-insensitive. Consumers of knownTokensIndex must use canonical non-EVM keys without lowercasing them; the shared getKnownToken helper applies the chain-specific matching rule.
