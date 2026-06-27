import { SwapFee } from '@vultisig/core-chain/swap/SwapFee'

import { CowSwapTokenBalance } from './cowswap/sign/buildCowSwapOrder'
import { CowSwapOrderKind } from './cowswap/types'
import { GeneralSwapProvider } from './GeneralSwapProvider'

export type GeneralSwapTx =
  | {
      evm: {
        from: string
        to: string
        data: string
        value: string
        gasLimit?: bigint
        affiliateFee?: SwapFee
      }
    }
  | {
      solana: {
        data: string
        networkFee: bigint
        swapFee: SwapFee
      }
    }
  | {
      transfer: {
        to: string
        amount: bigint
        memo?: string
        txType?: string
        txPayload?: Uint8Array
        inboundAddress?: string
        swapId?: string
      }
    }
  | {
      cowswap_order: {
        sellToken: string
        buyToken: string
        receiver: string
        sellAmount: string
        buyAmount: string
        validTo: number
        appData: string
        appDataHash: string
        feeAmount: string
        kind: CowSwapOrderKind
        partiallyFillable: boolean
        sellTokenBalance: CowSwapTokenBalance
        buyTokenBalance: CowSwapTokenBalance
        chainId: number
        apiBase: string
        /** Set to true when the sellToken supports EIP-2612 permit. When true
         * the signing flow should build and include a permit signature alongside
         * the order signature, avoiding a separate ERC-20 approve transaction. */
        permitRequired?: true
      }
    }

/**
 * Quote returned by an EVM/Solana general-purpose swap aggregator.
 *
 * Consumers building a "View on Explorer" link should call
 * `getSwapExplorerUrl({ provider, txHash, fromChain })` from
 * `@vultisig/core-chain/swap/utils/getSwapExplorerUrl` instead of routing
 * by hand — the helper covers the LI.FI / Helius scanners and falls back to
 * the source-chain explorer for `1inch` / `jupiter` / `kyber` / `swapkit` (none of which
 * expose a per-tx aggregator page).
 */
export type GeneralSwapQuote = {
  dstAmount: string
  provider: GeneralSwapProvider
  routeProvider?: string
  tx: GeneralSwapTx
}
