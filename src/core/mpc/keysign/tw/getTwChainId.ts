import { Chain } from '../../../chain/Chain'
import { getCoinType } from '../../../chain/coin/coinType'
import { WalletCore } from '@trustwallet/wallet-core'

type Input = {
  walletCore: WalletCore
  chain: Chain
}

export const getTwChainId = ({ walletCore, chain }: Input) => {
  if (chain === Chain.MayaChain) {
    return 'mayachain-mainnet-v1'
  }

  const coinType = getCoinType({
    walletCore,
    chain,
  })

  return walletCore.CoinTypeExt.chainId(coinType)
}
