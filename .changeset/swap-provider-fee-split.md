---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': patch
'@vultisig/sdk': minor
'@vultisig/cli': patch
---

Itemize the swap provider's own fee apart from the integrator's affiliate fee. LI.FI quotes now split the fixed fee by `feeSplit` and SwapKit quotes keep the `service` fee out of the `affiliate` one, so `evm.affiliateFee` and `solana.swapFee` / `transfer.swapFee` carry only the integrator's cut and the new optional `protocolFee` carries LI.FI's or SwapKit's. The keysign payload `swap_fee` still reports both together, so cosigning peers see the same total as before. `SwapFees` and `SwapFeesFiat` gain an optional `protocol` amount, which is included in `total`.
