---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

Secured assets can be used in limit swaps. Three independent defects stood between them and a placeable order, each hidden behind the one in front of it — which is why this looked like an unimplemented feature rather than a set of bugs.

**The memo builder rejected the notation.** `buildLimitSwapMemo` validated both legs through `assertValidPoolId`, the shared THORChain *pool-id* grammar, which only understands dotted `CHAIN.ASSET`. Every secured denom was refused — while `getThorchainMemoAsset` was already emitting exactly that spelling, its own docstring conceding the memo builder would not accept the value it returned. A limit swap now asks its own, narrower question instead of borrowing the LP paths' validator, so widening it changes nothing for them. Synth (`BTC/BTC`) and trade (`ETH~ETH`) assets stay unsupported: a different custody model whose behaviour through the advanced swap queue has not been established, and they now say so rather than failing as malformed pool ids.

That validator's answer is not cosmetic — it decides the memo's byte budget and which chain the payout address is validated against. A secured asset is custodied on THORChain wherever it originates, so both answer THORChain. Reading its home chain instead sized a deposit against the wrong budget and rejected the only correct payout address.

**The placement builder recognised only RUNE as a deposit.** It branched on `areEqualCoins(fromCoin, chainFeeCoin[THORChain])`, so a secured source — on THORChain, but not RUNE — took the transfer branch and looked up a THORChain Asgard inbound. There is none, so it refused outright. Every THORChain-held source now deposits.

**The deposit referenced an asset no vault holds.** This is the one that reached the chain and cost a fee: a secured-BTC order broadcast successfully and was rejected on-chain with `insufficient funds`, depositing `THOR.BTC` against a `btc-btc` balance. The cosmos resolver already knew how to build a secured deposit asset, but derived it exclusively from `swapPayload.fromCoin` — and a limit order carries no swap payload on the THORChain branch, so it fell through to a chain-prefix + ticker construction. It now keys off the coin the deposit actually spends, reading the denom from whichever field the coin shape carries it in (`contractAddress` on a swap payload's coin, `id` on the payload's own), since that mismatch is what let the previous version typecheck while reading nothing.

This affected every secured denom, not just BTC. Market swaps were unaffected throughout, because they do carry a swap payload — which is why it stayed hidden. THORChain-native tokens (`tcy`, `x/…`) and RUNE are unchanged; they are not secured assets, and tests pin that they keep the `THOR.TICKER` form.
