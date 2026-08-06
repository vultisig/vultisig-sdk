import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { TokenMetadataResolver } from '../resolver'

/**
 * Resolves SUI coin metadata through the unified client's `getCoinMetadata`.
 * The `id` is the fully-qualified coin type (e.g. `0x...::module::TYPE`).
 */
export const getSuiTokenMetadata: TokenMetadataResolver<OtherChain.Sui> = async ({ id }) => {
  const client = getSuiClient()

  const { coinMetadata } = await client.getCoinMetadata({ coinType: id })

  const metadata = shouldBePresent(coinMetadata, `SUI coin metadata for ${id}`)

  return {
    ticker: metadata.symbol,
    decimals: metadata.decimals,
    // gRPC/GraphQL return an EMPTY STRING for an absent icon where JSON-RPC
    // returned null, so `??` would leak `''` through as a logo URL.
    logo: metadata.iconUrl || undefined,
  }
}
