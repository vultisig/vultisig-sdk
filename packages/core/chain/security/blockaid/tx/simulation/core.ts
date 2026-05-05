import { Coin } from '../../../../coin/Coin'

export type BlockaidSolanaSimulationInfo =
  | {
      swap: {
        fromMint: string
        toMint: string
        fromAmount: bigint
        toAmount: bigint
        toAssetDecimal: number
      }
    }
  | {
      transfer: {
        fromMint: string
        fromAmount: bigint
      }
    }

export type BlockaidEvmBalanceChange = {
  direction: 'send' | 'receive'
  coin: Coin
  amount: bigint
  usdValue?: number
}

export type BlockaidEvmSimulationInfo = {
  changes: BlockaidEvmBalanceChange[]
} | null
