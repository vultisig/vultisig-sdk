---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

Let joining devices review a THORChain limit order instead of approving it as a generic send.

The limit-order builder attaches a swap payload only for ERC20 sources, so RUNE and native-gas-asset orders reached a co-signer as a transfer to an opaque address with an opaque memo — no buy asset, payout destination, or minimum received.

`getKeysignLimitSwapOrder` decodes those terms from `keysignPayload.memo`, which is present on every source branch. Reading the memo also makes the review trustworthy rather than merely present: the memo is the exact string THORChain executes, so terms derived from it cannot disagree with what gets signed, whereas a display field supplied by the initiating device can.

`parseLimitSwapMemo` is the underlying decoder, and `assertLimitSwapMemo` now delegates to it so the grammar has one implementation.

`buildLimitSwapKeysignPayload` now derives the ERC20 branch's `toAmountDecimal` from the memo's LIM rather than from the caller's `expectedToAmount`. That argument is now an optional cross-check: supplying a value that disagrees with the memo throws, which catches a caller that rescaled the LIM into the target coin's own decimals — a mistake that signs a correct order while showing a co-signer a wrong figure.
