---
'@vultisig/sdk': patch
---

Carry the SwapKit provider fee, its coin context, and the route name to a swap co-signer. A SwapKit route on a non-EVM source chain travels as `SwapKitSwapPayload`, which had no fee field, so the peer's verify screen showed the network fee alone and a total that understated what the swap costs — the initiator, holding the live quote, showed both. The transfer branch now resolves the same affiliate/service fee the EVM branch does, `buildSwapKeysignPayload` writes it to the payload's new `swap_fee` group, and `getKeysignSwapProviderName` appends the payload's `sub_provider` so a joiner reads `SwapKit (NEAR)` where the initiator does. Requires the commondata fields added for it; senders that predate them leave the fee absent rather than reporting a zero. A fee amount the proxy returns malformed is now reported as an unresolvable fee shape rather than failing the whole route, which the display-fee guard always intended.
