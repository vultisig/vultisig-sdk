import { toChainAmount } from '@vultisig/core-chain/amount/toChainAmount'
import { Chain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'

export const tonConfig = {
  baseFee: toChainAmount(0.01, chainFeeCoin[Chain.Ton].decimals),
  jettonAmount: toChainAmount(0.08, chainFeeCoin[Chain.Ton].decimals),
  // A first-time (not-yet-active) recipient jetton wallet has to be deployed
  // as part of the transfer, which burns materially more gas than a transfer
  // into an already-deployed jetton wallet. The flat `jettonAmount` floor
  // above is sized for the latter only; using it for a new-wallet deploy
  // under-funds the tx and TON bounces/rejects it (sdk#1465).
  jettonAmountNewWallet: toChainAmount(0.15, chainFeeCoin[Chain.Ton].decimals),
}
