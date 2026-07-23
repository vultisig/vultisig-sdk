---
"@vultisig/core-mpc": patch
---

Fix Tron TRC-20 transfers going OUT_OF_ENERGY. `getTrc20TransferFee` trusted `energy_used`/`energy_penalty` defaulting to 0 on unsuccessful `triggerconstantcontract` response shapes (empty body, indexing lag, or reverts, including live responses with `result.result === true` plus a revert message), silently producing a `feeLimit` of 0 downstream. It now rejects unsuccessful and non-positive estimates. The serialized `feeLimit` ceiling is based on the full simulated energy before staked-energy subtraction, padded by `+50%`, and capped at 100 TRX so concurrent staked-energy use during the 10-60s MPC ceremony cannot reduce the ceiling to zero. The user-displayed/max-send fee remains the unpadded expected burn after current staked energy is applied. The 280 sun/energy fallback (stale 2023 governance default) is also corrected to the live TronGrid value of 100 sun/energy and documented for unreachable, missing, or invalid chain-parameter responses.
