---
'@vultisig/sdk': minor
---

Add `sdk.token.resolveContract` — on-chain token metadata probe (symbol /
decimals / name) for a contract or mint address, for long-tail tokens that
registry search misses. Supports ERC-20 (every EVM chain), CW20 (TerraClassic /
Terra / Osmosis / Kujira) and SPL (Solana). Reads metadata directly over RPC and
fails closed (never fabricates a symbol or decimals) when the address is not a
recognized token contract / mint. `packages/sdk/src/**` is outside the bundled-
changeset CI guard, so this changeset is added manually to publish the new
surface to consumers.
