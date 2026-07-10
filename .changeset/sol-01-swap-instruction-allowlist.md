---
'@vultisig/sdk': patch
---

Assert every Solana swap instruction targets an allow-listed program before
handing the transaction to MPC signing (audit SOL-01, MEDIUM). Both Jupiter
integration points — `getJupiterSwapQuote` (recipes/general-swap path) and
`buildJupiterSwapTx` (SDK code-as-action tool) — deserialized a proxy-supplied
`VersionedTransaction` and forwarded it to signing with no check that each
instruction's `programIdIndex` resolves to an expected program. A compromised
Jupiter proxy could otherwise splice in an arbitrary instruction (e.g. a
drain transfer) that the user would effectively blind-sign.

Add `assertSafeSolanaSwapInstructions` (`@vultisig/core-chain/chains/solana/assertSafeSolanaSwapInstructions`):
resolves every top-level instruction's program against static account keys
and, for v0 messages, address-lookup-table-resolved keys, and throws
`SOL_SWAP_UNEXPECTED_PROGRAM` on the first unrecognized one. The allow-list
(Jupiter v6 router, Compute Budget, System, SPL Token, Token-2022,
Associated-Token-Account) was captured empirically by decoding real
`/swap` responses from Jupiter's public API across a single-hop route, a
3-hop route, a Token-2022 output mint, and a platform-fee-included swap.
Wired into both Jupiter call sites, guarding the raw provider response
before any local mutation (fee-ATA prepend) and regardless of whether an
affiliate fee is charged on the swap.
