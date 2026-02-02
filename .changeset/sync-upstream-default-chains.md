---
"@vultisig/sdk": patch
---

Sync upstream changes and use core's defaultChains

- Import `defaultChains` from core instead of defining locally in SDK
- Default chains now: Bitcoin, Ethereum, THORChain, Solana, BSC
- Upstream: Added thor.ruji and thor.rune token metadata
- Upstream: Fixed commVault serialization for empty chain keys
- Upstream: Enhanced formatAmount with suffix support
