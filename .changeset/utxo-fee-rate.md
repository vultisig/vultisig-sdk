---
'@vultisig/sdk': minor
---

Add `sdk.gas.utxoFeeRate(chain)` — a read-only UTXO fee-rate primitive
returning `{ chain, feeRate, feeRateUnit: 'sat/vB' }` for Bitcoin, Litecoin,
Dogecoin, Bitcoin-Cash (THORChain) and Dash (MayaChain). Sourced from the
`inbound_addresses` `gas_rate`; throws on a halted chain or non-positive rate
rather than emitting a zero-fee envelope. Zcash is intentionally unsupported
(ZIP-317 conventional fees, not sat/vB). Also exported from the React Native
entrypoint.
