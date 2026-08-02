import { fromBech32 } from '@cosmjs/encoding'
import { Chain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import {
  getThorchainInboundAddress,
  ThorchainInboundAddress,
} from '@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress'
import { getThorchainMimir } from '@vultisig/core-chain/chains/cosmos/thor/lp/validation'
import {
  getThorchainSecuredAssetCatalog,
  getThorchainSecuredAssetL1Asset,
  type ThorchainSecuredAssetCatalog,
} from '@vultisig/core-chain/chains/cosmos/thor/securedAssets'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { toNativeSwapAsset } from '@vultisig/core-chain/swap/native/asset/toNativeSwapAsset'
import { getNativeSwapChainId } from '@vultisig/core-chain/swap/native/NativeSwapChain'
import { NativeSwapQuote } from '@vultisig/core-chain/swap/native/NativeSwapQuote'
import { rebaseDecimalAmount } from '@vultisig/core-chain/swap/native/utils/nativeSwapAmountToCoinBaseUnit'

type IsSameUnderlyingInput = {
  from: AccountCoin
  to: AccountCoin
}

export const isSameUnderlyingThorchainSecuredAsset = ({ from, to }: IsSameUnderlyingInput): boolean => {
  if (from.chain === Chain.THORChain) return false
  const targetL1Asset = getThorchainSecuredAssetL1Asset(to)
  if (!targetL1Asset) return false

  try {
    return toNativeSwapAsset(from).toUpperCase() === targetL1Asset
  } catch {
    return false
  }
}

type GetThorchainSecuredAssetMintQuoteInput = IsSameUnderlyingInput & {
  amount: bigint
  destination: string
  fetchInboundAddresses?: () => Promise<ThorchainInboundAddress[]>
  fetchSecuredAssetCatalog?: () => Promise<ThorchainSecuredAssetCatalog>
  fetchMimir?: () => Promise<Record<string, number>>
  now?: () => number
}

const isMimirEnabled = (value: number | undefined): boolean => typeof value === 'number' && value > 0

const isValidThorchainAccountAddress = (value: string): boolean => {
  try {
    const { prefix, data } = fromBech32(value.trim())
    return prefix === 'thor' && data.length === 20
  } catch {
    return false
  }
}

/**
 * Builds the existing native-swap payload shape for a direct `SECURE+` mint.
 * The source deposit still uses the normal THORChain inbound/router path, but
 * its memo mints secured-asset shares instead of paying for a pool round trip
 * into the same underlying asset.
 */
export const getThorchainSecuredAssetMintQuote = async ({
  from,
  to,
  amount,
  destination,
  fetchInboundAddresses = getThorchainInboundAddress,
  fetchSecuredAssetCatalog = getThorchainSecuredAssetCatalog,
  fetchMimir = getThorchainMimir,
  now = Date.now,
}: GetThorchainSecuredAssetMintQuoteInput): Promise<NativeSwapQuote> => {
  if (!isSameUnderlyingThorchainSecuredAsset({ from, to })) {
    throw new Error('SECURE+ mint requires an L1 source and its matching THORChain secured asset')
  }
  if (!isValidThorchainAccountAddress(destination)) {
    throw new Error('SECURE+ mint requires a valid THORChain account destination')
  }

  const chainId = getNativeSwapChainId(from.chain)
  const [inboundAddresses, catalog, mimir] = await Promise.all([
    fetchInboundAddresses(),
    fetchSecuredAssetCatalog(),
    fetchMimir(),
  ])
  const inbound = inboundAddresses.find(entry => entry.chain.toUpperCase() === chainId)
  if (!inbound) {
    throw new Error(`THORChain inbound address is unavailable for ${from.chain}`)
  }
  if (!inbound.address.trim()) {
    throw new Error(`THORChain returned an empty inbound address for ${from.chain}`)
  }
  if (isChainOfKind(from.chain, 'evm') && from.id && !inbound.router.trim()) {
    throw new Error(`THORChain router is unavailable for ${from.chain} token deposits`)
  }
  if (
    inbound.halted ||
    isMimirEnabled(mimir.HALTSECUREDGLOBAL) ||
    isMimirEnabled(mimir[`HALTSECUREDDEPOSIT-${chainId}`])
  ) {
    throw new Error(`THORChain SECURE+ deposits are paused for ${from.chain}`)
  }

  let dustThreshold: bigint
  try {
    dustThreshold = BigInt(inbound.dust_threshold)
  } catch {
    throw new Error(`THORChain returned an invalid dust threshold for ${from.chain}`)
  }
  if (dustThreshold < 0n || amount < dustThreshold) {
    throw new Error(`SECURE+ mint amount is below the ${from.chain} inbound dust threshold`)
  }

  const securedAssetStatus = catalog.assets.find(asset => asset.id === to.id?.toLowerCase())
  if (catalog.source !== 'thorchain' || !securedAssetStatus?.supply || !securedAssetStatus.depth) {
    throw new Error('THORChain live secured-asset share status is unavailable')
  }

  const sourceAmount = rebaseDecimalAmount(amount, from.decimals, 8)
  const supply = BigInt(securedAssetStatus.supply)
  const depth = BigInt(securedAssetStatus.depth)
  const expectedAmountOut = supply === 0n || depth === 0n ? sourceAmount : (sourceAmount * supply) / depth
  if (expectedAmountOut <= 0n) {
    throw new Error('SECURE+ mint amount is below THORChain secured-asset precision')
  }

  const securedAsset = getThorchainSecuredAssetL1Asset(to)?.replace('.', '-')
  if (!securedAsset) {
    throw new Error('SECURE+ mint destination is not a THORChain secured asset')
  }

  return {
    swapChain: Chain.THORChain,
    expected_amount_out: expectedAmountOut.toString(),
    expiry: Math.floor(now() / 1000) + 15 * 60,
    fees: {
      affiliate: '0',
      asset: securedAsset,
      outbound: '0',
      total: '0',
      total_bps: 0,
    },
    inbound_address: inbound.address,
    memo: `SECURE+:${destination.trim()}`,
    notes: 'Direct THORChain secured-asset mint.',
    outbound_delay_blocks: 0,
    outbound_delay_seconds: 0,
    recommended_min_amount_in: dustThreshold.toString(),
    liquidity_tolerance_bps: 0,
    warning: 'Do not send funds after the expiry.',
    router: inbound.router || undefined,
    dust_threshold: dustThreshold.toString(),
  }
}
