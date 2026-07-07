---
"@vultisig/sdk": patch
---

fix(cosmos): paginate token discovery so IBC-heavy wallets aren't truncated. cosmjs `getAllBalances` issues a single unpaginated query capped at the node default (100), dropping denoms past 100; discovery now walks the LCD balances pages with a fall-through to cosmjs.
