import { Chain } from '@vultisig/core-chain/Chain'
import { solanaConfig } from '@vultisig/core-chain/chains/solana/solanaConfig'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { GeneralSwapQuote } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import {
  JupiterAffiliateConfig,
  JupiterSwapConfig,
  jupiterSwapConfig,
} from '@vultisig/core-chain/swap/general/jupiter/config'
import { JupiterSwapEnabledChain } from '@vultisig/core-chain/swap/general/jupiter/JupiterSwapEnabledChains'
import {
  getSolanaAssociatedTokenAddress,
  injectSolanaAtaIfMissing,
} from '@vultisig/core-chain/swap/general/lifi/api/injectSolanaAtaIfMissing'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'

type Input = Record<TransferDirection, AccountCoin<JupiterSwapEnabledChain>> & {
  amount: bigint
  affiliateBps: number
  jupiterConfig?: JupiterAffiliateConfig
  slippageTolerance?: number
}

type JupiterQuoteResponse = {
  inputMint: string
  inAmount: string
  outputMint: string
  outAmount: string
  otherAmountThreshold: string
  swapMode: string
  slippageBps: number
  platformFee?: { amount: string; feeBps: number }
  priceImpactPct: string
  routePlan: Array<{
    swapInfo: {
      ammKey: string
      label?: string
      inputMint: string
      outputMint: string
      inAmount: string
      outAmount: string
      feeAmount: string
      feeMint: string
    }
    percent: number
  }>
}

type JupiterSwapResponse = {
  swapTransaction?: string
  prioritizationFeeLamports?: number
  error?: string
}

export const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112'

const toMint = (coin: AccountCoin<JupiterSwapEnabledChain>): string => coin.id?.trim() || SOL_NATIVE_MINT

const buildJupiterUrl = (config: JupiterSwapConfig, path: string, params?: URLSearchParams): string => {
  const base = config.baseUrl.replace(/\/+$/, '')
  return `${base}${path}${params ? `?${params.toString()}` : ''}`
}

export const getJupiterSwapQuote = async ({
  from,
  to,
  amount,
  affiliateBps,
  jupiterConfig,
  slippageTolerance,
}: Input): Promise<GeneralSwapQuote> => {
  if (amount <= 0n) {
    throw new Error('Jupiter swap amount must be greater than zero')
  }

  const config: JupiterSwapConfig = {
    ...jupiterSwapConfig,
    ...jupiterConfig,
  }

  const inputMint = toMint(from)
  const outputMint = toMint(to)

  if (inputMint === outputMint) {
    throw new Error('Jupiter swap input and output mint must differ')
  }

  const shouldApplyPlatformFee = affiliateBps > 0
  const slippageBps = slippageTolerance ?? config.defaultSlippageBps

  const quoteParams = new URLSearchParams(
    Object.entries({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: String(slippageBps),
      swapMode: 'ExactIn',
      platformFeeBps: shouldApplyPlatformFee ? String(affiliateBps) : undefined,
    }).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]]))
  )

  const quote = await queryUrl<JupiterQuoteResponse>(buildJupiterUrl(config, '/swap/v1/quote', quoteParams))
  const quotedPlatformFee = BigInt(quote.platformFee?.amount ?? 0)
  const shouldCreateFeeAccount = shouldApplyPlatformFee && quotedPlatformFee > 0n
  const feeAccount = shouldCreateFeeAccount
    ? (await getSolanaAssociatedTokenAddress(outputMint, config.feeOwner)).toBase58()
    : undefined

  const swapBody = {
    userPublicKey: from.address,
    quoteResponse: quote,
    wrapAndUnwrapSol: true,
    useSharedAccounts: true,
    asLegacyTransaction: false,
    dynamicComputeUnitLimit: true,
    feeAccount: shouldCreateFeeAccount ? feeAccount : undefined,
  }

  const swapResponse = await queryUrl<JupiterSwapResponse>(buildJupiterUrl(config, '/swap/v1/swap'), {
    body: Object.fromEntries(Object.entries(swapBody).filter(([, value]) => value !== undefined)),
  })

  if (swapResponse.error) {
    throw new Error(`Jupiter swap error: ${swapResponse.error}`)
  }

  if (!swapResponse.swapTransaction) {
    throw new Error('Jupiter swap response missing swapTransaction')
  }

  const { data, ataInjected } = shouldCreateFeeAccount
    ? await injectSolanaAtaIfMissing(swapResponse.swapTransaction, outputMint, config.feeOwner, from.address)
    : { data: swapResponse.swapTransaction, ataInjected: false }

  const ataRentBuffer = ataInjected ? BigInt(solanaConfig.ataRentLamports) : 0n

  return {
    dstAmount: quote.outAmount,
    provider: 'jupiter',
    routeProvider: quote.routePlan.map(route => route.swapInfo.label ?? route.swapInfo.ammKey).join(' + ') || undefined,
    tx: {
      solana: {
        data,
        networkFee: BigInt(solanaConfig.baseFee + (swapResponse.prioritizationFeeLamports ?? 0)) + ataRentBuffer,
        swapFee: {
          amount: quotedPlatformFee,
          decimals: to.decimals,
          chain: Chain.Solana,
          id: to.id,
        },
      },
    },
  }
}
