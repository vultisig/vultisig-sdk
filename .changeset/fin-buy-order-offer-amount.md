---
'@vultisig/rujira': patch
---

Fix FIN limit **buy** orders encoding the base quantity where the contract expects the offer amount. `placeOrder`/`buildPlaceOrder` put `params.amount` (base) into `OrderTarget[2]` while attaching `amount x price` (quote) as funds, so on a buy the two disagreed by a factor of `price`. FIN documents `OrderTarget` as a "target offer amount" and requires "funds sent must be equal to the net change of balances", so the contract read the msg value as quote units: buys below parity under-funded and reverted with `InsufficientFunds`, and buys above parity silently created an order far smaller than intended, refunding the excess. Both paths now use the single `calculateOfferAmount()` value for the msg and the funds. Sell orders are unaffected — the base quantity is already the offer amount.
