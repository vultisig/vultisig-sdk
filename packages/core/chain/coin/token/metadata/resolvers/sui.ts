import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { TokenMetadataResolver } from '../resolver'

/**
 * Resolves SUI coin metadata via the `suix_getCoinMetadata` JSON-RPC method.
 * The `id` is the fully-qualified coin type (e.g. `0x...::module::TYPE`).
 */
export const getSuiTokenMetadata: TokenMetadataResolver<OtherChain.Sui> = async ({ id }) => {
  const client = getSuiClient()

  const metadata = shouldBePresent(await client.getCoinMetadata({ coinType: id }), `SUI coin metadata for ${id}`)

  return {
    ticker: metadata.symbol,
    decimals: metadata.decimals,
    logo: metadata.iconUrl ?? undefined,
  }
}
