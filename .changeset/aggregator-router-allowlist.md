---
'@vultisig/sdk': patch
---

fix(swap): validate aggregator router addresses at quote construction (AGG-02). 1inch/Kyber/LiFi/SwapKit's tx.to was trusted with no allowlist, and fed both the ERC-20 approval spender and the swap transaction's on-chain destination — a compromised/spoofed aggregator response could get both approved and swapped against. 1inch/Kyber now fail closed (throw) if the returned router isn't their live-confirmed address; LiFi/SwapKit log the destination (never throw, since they route through many different contracts by design) so a future allowlist has real usage data if a pattern emerges.
