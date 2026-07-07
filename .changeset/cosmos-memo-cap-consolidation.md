---
"@vultisig/sdk": patch
---

Add cosmos `x/auth.MaxMemoCharacters` cap helpers (`getCosmosMemoMaxBytes`, `getCosmosMemoMaxBytesByChainId`, `isCosmosMemoWithinCap`, `COSMOS_MEMO_DEFAULT_MAX_BYTES`) as the single source of truth for cosmos memo-length limits, consolidating copies previously maintained in agent-backend-ts and mcp-ts. Bundled into `@vultisig/sdk` so consumers receive a new tarball.
