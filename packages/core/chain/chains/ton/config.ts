import { toChainAmount } from '@vultisig/core-chain/amount/toChainAmount'
import { Chain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'

export const tonConfig = {
  baseFee: toChainAmount(0.01, chainFeeCoin[Chain.Ton].decimals),
  jettonAmount: toChainAmount(0.08, chainFeeCoin[Chain.Ton].decimals),
  // Deploying the recipient's jetton-wallet contract costs more than a
  // transfer to an already-active destination. TON's reference transfer uses
  // 0.1 TON, so keep that as the conservative first-recipient reservation.
  uninitializedJettonAmount: toChainAmount(0.1, chainFeeCoin[Chain.Ton].decimals),
}
