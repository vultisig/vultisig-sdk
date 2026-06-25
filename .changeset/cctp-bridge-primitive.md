---
'@vultisig/sdk': minor
---

Add `sdk.bridge.cctp` — Circle CCTP USDC bridge + claim calldata builders.

`buildCctpBridge()` returns an unsigned 2-tx approve+depositForBurn sequence for bridging USDC cross-chain (Ethereum, Avalanche, Optimism, Arbitrum, Base, Polygon). `buildCctpClaim()` returns the unsigned `receiveMessage` mint tx for the destination chain. Pure crypto — builds unsigned calldata only, never signs or broadcasts. Includes a burn-address fund-safety guard on the bridge mintRecipient and a multiple-of-65-bytes attestation shape check on claim. Also exposes the CCTP contract registry (`cctpChains`, `getCctpChain`, `cctpSupportedChains`) and Circle attestation API base. Ports `build_cctp_bridge_usdc` / `build_cctp_claim_usdc` out of mcp-ts into the SDK.
