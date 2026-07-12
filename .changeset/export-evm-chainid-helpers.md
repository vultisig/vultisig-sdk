---
'@vultisig/sdk': patch
---

Export the EVM chainId ↔ chain helpers (`getEvmChainId`, `getEvmChainByChainId`)
from the SDK's public API.

The SDK already owned the per-chain EVM chainId table (`evmChainId` in
`chains/evm/chainInfo.ts`), but it wasn't part of the public export surface, so
the app and agent-backend-ts each hand-maintained their own copies — the exact
drift class behind the Hyperliquid 998 (testnet) vs 999 (mainnet) client↔server
chainId bug. Consumers can now import the single source of truth. Native tickers
were already exported via `chainFeeCoin`, so no additional ticker export is
needed.
