---
'@vultisig/sdk': patch
---

Add `selectUtxoInputs`, an accumulative largest-first coin-selection layer for
UTXO sends (audit UTXO-01, HIGH). `buildUtxoSendTx`'s doc comment always said
"caller handles coin-selection", but no selection layer existed — callers
fetched every UTXO in the wallet and passed the full set through verbatim.
That overpaid fees for all N inputs, could false-positive "insufficient
funds" when fee(N) exceeded the balance even though a small subset would
cover the send, and linked every UTXO the wallet owns in one transaction.

`selectUtxoInputs` picks the smallest largest-first prefix of the candidate
UTXOs that covers `amount + fee(k)`, reusing `estimateUtxoTxFee` — the same
size/fee formula now extracted out of `buildUtxoSendTx` — so selection and
build always agree on the fee. Supports a `sendMax` mode that consumes every
UTXO for "send whole balance" flows. Covered across all 6 UTXO chains
(Bitcoin, Litecoin, Dogecoin, Dash, Bitcoin-Cash, Zcash) with golden-vector
tests for the trivial single-input case, multi-input accumulation, exact
cover, sub-dust change folding into fee, genuine insufficient-funds, and
send-max.
