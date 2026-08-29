---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
---

fix(ton): send swap deposits bounceable so a rejected deposit is refunded

TON transfers were marked bounceable only when the destination string started with `E`. Swap providers hand back deposit addresses in the `UQ…` (non-bounceable) form, so every TON swap deposit went out non-bounceable — and a router or escrow contract that rejects a message (expired quote, paused pool, closed route) *absorbs* a non-bounceable transfer instead of returning it. The funds were gone.

Swap deposits are now always sent bounceable. The prefix check is replaced by a real read of the address's bounce tag, so raw `0:hex` destinations — which declare no bounceability at all and which the prefix check silently treated as non-bounceable — default to bounceable, the safe side for anything that might be a contract. Sends to an undeployed account stay non-bounceable, since such an account cannot accept a bounceable message, and an explicit `UQ…` destination is still honoured.

Adds `getTonAddressBounceability` to `@vultisig/core-chain/chains/ton/address`.
