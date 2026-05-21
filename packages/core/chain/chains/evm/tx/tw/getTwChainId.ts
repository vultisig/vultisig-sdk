import { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { hyperliquid } from '@vultisig/core-chain/chains/evm/chainInfo'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { sei } from 'viem/chains'

type Input = {
  walletCore: WalletCore
  chain: Chain
}

export const getTwChainId = ({ walletCore, chain }: Input) => {
  if (chain === Chain.MayaChain) {
    return 'mayachain-mainnet-v1'
  }

  if (chain === Chain.Hyperliquid) {
    return hyperliquid.id.toString()
  }

  if (chain === Chain.Sei) {
    return sei.id.toString()
  }

  const coinType = getCoinType({
    walletCore,
    chain,
  })

  return walletCore.CoinTypeExt.chainId(coinType)
}
