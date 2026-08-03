---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

Limit-order cancellation, end to end: a full-form memo asset, a cancel keysign payload builder, and cancel-aware review for co-signers.

The primitives shipped earlier could describe a cancellation but not send one, and a device joining the ceremony could not read one at all. These are the three pieces that close that.

`getThorchainCancelMemoAsset` emits the spelling a cancel requires — the same notation as the placement path, minus the abbreviation. That difference is the entire point: `ModifyLimitSwapMemo` is the one inbound memo type `processOneTxIn` does not route through `fuzzyAssetMatch`, so a placement's six-character contract suffix would address a bucket holding no order. `buildCancelLimitSwapMemo` already refused abbreviated assets, which meant there was previously no supported way to produce an input it would accept for a token leg. Both spellings now share one converter and one set of validation rules, so they cannot drift apart in anything but the abbreviation. `getThorchainMemoAssetChain` resolves a memo asset back to its home chain across every flavour, including the secured denoms that a `.`-split would fail to resolve at all.

`buildLimitSwapCancelKeysignPayload` turns that memo into a signable transaction, branching on where the order was funded: a THORChain source becomes a `MsgDeposit` carrying no value, and an L1 source a transfer to the live Asgard inbound with derived dust attached solely so Bifrost observes it. The signing asset is the funding chain's **gas** asset, never the order's own — a cancel moves no tokens, and a token here would build an ERC20 transfer that drops the memo entirely. Every gate fails closed: a retarget (`m=<` with a non-zero final field) is refused rather than signed as a cancellation, a memo that overflows the source chain's budget is refused rather than truncated into one matching nothing, and the destination is taken from a live inbound view rather than a cache.

The `EnableAdvSwapQueue` mimir is deliberately *not* re-checked here, unlike at placement. That gate protects a new order from executing as an unprotected market swap, a risk a cancel does not carry; refusing to close an already-resting position because the queue stopped accepting new ones would strand it for the remainder of its TTL with no way out.

`getKeysignLimitSwapCancel` and `parseCancelLimitSwapMemo` give a joining device the order being closed, decoded from the memo. A cancel carries no swap payload on any branch, so a co-signer keying off one previously saw a dust transfer to an opaque address — worse than uninformative, since a trivial amount reads as harmless while the transaction closes a position. As with placement, the terms come from the memo because the memo is the instruction THORChain executes, so what a reviewer sees cannot disagree with what gets signed. A retarget is reported as not-a-cancellation rather than mislabelled, and the reproduced bucket key travels alongside so a reviewer holding the vault's open orders can tell whether the cancel is unambiguous.
