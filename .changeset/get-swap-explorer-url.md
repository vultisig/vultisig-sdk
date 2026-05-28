---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

Add `getSwapExplorerUrl` helper for swap-provider tx links (#426).

Tx history surfaces (vultisig-windows, vultiagent-app, future RN SDK) now have a single source of truth for "View on Explorer" URLs that point to the swap **provider's** scanner — `scan.li.fi`, `orb.helius.dev` for LI.FI Solana settlement, `runescan.io` for THORChain, and the MayaChain explorer — instead of every consumer reimplementing the routing and most defaulting to the source-chain explorer (which hides cross-chain routes from users).

- New: `getSwapExplorerUrl({ provider, txHash, fromChain })` in `@vultisig/core-chain/swap/utils/getSwapExplorerUrl`
- New: `Vultisig.getSwapExplorerUrl(provider, txHash, fromChain)` static method for parity with `getTxExplorerUrl`
- For `1inch` / `kyber` / `swapkit`, falls back to the source-chain explorer (no public per-tx aggregator page)
- Mirrors iOS `ExplorerLinkBuilder.swift` and Android `ExplorerLinkRepository.getSwapProgressLink`
- Pure URL builder, no new deps
