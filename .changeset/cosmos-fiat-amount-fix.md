---
"@vultisig/sdk": patch
---

fix fiatToAmount throwing "EVM chains only" for Cosmos and other non-EVM token swaps. USD-denominated swap amounts now resolve correctly for TerraClassic (USTC/LUNC), Cosmos Hub (ATOM), Osmosis (IBC denoms), Solana SPL tokens, Polkadot asset-hub tokens, TON jettons, and any chain with entries in the knownTokens registry. Native Cosmos denoms (uluna, uatom, etc.) are also handled via cosmosFeeCoinDenom fallback.
