---
'@vultisig/core-mpc': patch
---

Fix Tron TRC-20 transfers going OUT_OF_ENERGY. `getTrc20TransferFee` trusted `energy_used`/`energy_penalty` defaulting to 0 on any `triggerconstantcontract` response shape (empty body, indexing lag, reverted simulation) with no check that TronGrid actually returned a successful estimate, silently producing a `feeLimit` of 0 downstream. It now throws when `result.result !== true` instead of returning a bogus zero fee. It also stopped returning the exact energy-burn estimate as `feeLimit` - that field is a spending ceiling, not an expected cost, so a `+50%` margin (capped at 100 TRX, matching the existing send-service ceiling) now absorbs pricing/energy drift during the 10-60s MPC signing ceremony. The 280 sun/energy fallback (stale 2023 governance default) is also corrected to the live TronGrid value of 100 sun/energy.
