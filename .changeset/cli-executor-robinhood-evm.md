---
'@vultisig/cli': patch
---

The agent executor now treats Robinhood as an EVM chain. Its EVM predicate is derived from the shared chain-kind record instead of a hand-maintained list that had left Robinhood out, so an approve-then-swap envelope on Robinhood is signed in order instead of being rejected as non-EVM, and Robinhood sends get the same nonce locking, stale-nonce repair, gas re-bumping and broadcast nonce journaling as every other EVM chain.
