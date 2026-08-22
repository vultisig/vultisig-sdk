---
'@vultisig/sdk': patch
---

Add a canonical ERC-20 approval transaction builder for backend and MCP consumers. The new helper normalizes human/base-unit/max/revoke amounts, validates token and spender bytecode, applies an optional owner-balance approval bound, and returns the backend-compatible unsigned approval envelope plus normalized approval metadata.
