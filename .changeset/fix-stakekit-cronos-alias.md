---
'@vultisig/sdk': patch
---

Add `cronoschain`/`cronos chain` to the StakeKit network alias map, mapping to StakeKit's `cronos` slug. The SDK's own canonical `Chain.CronosChain` identifier previously round-tripped wrong through `sdk.defi.stakekit.search()`/`balances()` — the literal string `cronoschain` was sent to StakeKit, an unknown slug, silently returning an empty result instead of the user's actual Cronos holdings.
