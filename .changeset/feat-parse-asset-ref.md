---
'@vultisig/sdk': minor
---

Add `parseAssetRef` and `splitAssetRef` — canonical parsers for the SDK's own `chain[:token]` text contract. Consumers were hand-splitting it (`clients/mcp`'s `parseChainToken` did `input.split(':')` and read `parts[1]`), which failed silently in three ways: `'eth:usdc:extra'` discarded the tail and resolved as a valid ref for a different asset, `'eth:'` produced an empty ticker that flowed downstream as a named token, and neither half was trimmed. Both new helpers fail closed. `splitAssetRef` validates grammar + ticker format without resolving the chain, for consumers (like the MCP client) that must resolve chains against their own scoped set rather than the SDK's global registry; `parseAssetRef` composes it with `parseChain`. `clients/mcp` now uses `splitAssetRef`.
