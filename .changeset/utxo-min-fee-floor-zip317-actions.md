---
'@vultisig/sdk': patch
---

fix(utxo): per-chain min-fee floor + canonical zcash zip-317 action count (UTXO-03/04)

`buildUtxoSendTx` only enforced a minimum fee for Zcash; every other UTXO chain
trusted the caller-supplied `feeRate` with no chain-aware floor. Dogecoin's
real min-relay-fee is ~100x Bitcoin's, so a BTC-reasonable rate could silently
underpay DOGE below relay and get the tx stuck. Added a per-chain minimum
relay fee rate (sourced from each chain's own Core `DEFAULT_MIN_RELAY_TX_FEE`)
that only raises a too-low `feeRate`, never lowers a legitimate one.

Also swapped the builder's local, input-only `zcashConventionalFee` for the
canonical `getZcashConventionalFee` (ZIP-317 `max(inputActions,
outputActions)`), which now accounts for OUTPUT bytes (change output + any
OP_RETURN memo) instead of only counting inputs — a large-memo send was
previously under-counting ZIP-317 actions and risking relay rejection.
