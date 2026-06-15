---
"@vultisig/sdk": patch
---

chore(deps): migrate @lifi/sdk v3 -> v4

@lifi/sdk v4 dropped the global mutable `createConfig` singleton in favour of
an explicit client object that every action (`getQuote`, ...) takes as its
first argument. Migrated `setupLifi` to build a v4 `createClient` and exposed
it via `getLifiClient()`; `getLifiSwapQuote` (core + RN override) now calls
`getQuote(client, params)`. Swap-quote behaviour, the per-call integrator tag,
and the affiliate-fee surface are unchanged. v4 also dropped its
`@solana/web3.js` transitive dep, so the now-dead `@lifi/sdk/@solana/web3.js`
yarn resolution was removed.
