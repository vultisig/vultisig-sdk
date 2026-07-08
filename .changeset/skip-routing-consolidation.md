---
"@vultisig/sdk": patch
---

feat(swap): consolidate Skip Go routing-eligibility predicates into the SDK

Adds `isSkipRoutableChain`, `isTerraChain`, and `willRouteViaSkip` as tested
core functions under `@vultisig/core-chain/swap/skip/skipRouting`, re-exported
from the main `@vultisig/sdk` entry. Pure chain-topology predicates (no network
calls, no AI-specific logic) that give consumers one shared source of truth for
"does this from/to chain pair route through Skip Go?" instead of the
independently-maintained copies that can drift (the mcp-ts #384 bug class).
Purely additive — no existing export or behavior changed.
