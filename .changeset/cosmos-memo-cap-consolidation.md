---
"@vultisig/sdk": patch
---

Add cosmos `x/auth.MaxMemoCharacters` cap helpers (`getCosmosMemoMaxBytes`, `getCosmosMemoMaxBytesByChainId`, `isCosmosMemoWithinCap`, `COSMOS_MEMO_DEFAULT_MAX_BYTES`) as the single source of truth for cosmos memo-length limits, consolidating copies previously maintained in agent-backend-ts and mcp-ts. Bundled into `@vultisig/sdk` so consumers receive a new tarball.

Also points the Skip Go swap tool (`skipSwap.ts`) at `getCosmosMemoMaxBytesByChainId` instead of its own divergent memo-cap table, which under-capped `phoenix-1` and `cosmoshub-4` at 256 bytes instead of the correct 512.
