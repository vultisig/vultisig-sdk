import type { Chain } from '@core/chain/Chain'
import type { SignatureAlgorithm } from '@core/chain/signing/SignatureAlgorithm'
import type { WalletCore } from '@trustwallet/wallet-core'

/**
 * Chain signing information extracted from payload and walletCore
 */
export type ChainSigningInfo = {
  signatureAlgorithm: SignatureAlgorithm
  derivePath: string
  chainPath: string // Normalized derivation path without quotes
}

/**
 * Extract chain-specific signing information from payload
 *
 * This adapter encapsulates the chain-specific logic needed for signing,
 * including determining the signature algorithm and derivation path.
 *
 * @param payload - Signing payload containing chain information
 * @param walletCore - WalletCore instance for chain utilities
 * @returns Chain signing information
 */
export async function getChainSigningInfo(
  payload: { chain: Chain; derivePath?: string },
  walletCore: WalletCore
): Promise<ChainSigningInfo> {
  // Dynamic imports to avoid circular dependencies
  const { getChainKind } = await import('@core/chain/ChainKind')
  const { signatureAlgorithms } = await import(
    '@core/chain/signing/SignatureAlgorithm'
  )
  const { getCoinType } = await import('@core/chain/coin/coinType')

  const chain = payload.chain

  // Determine signature algorithm based on chain kind
  const chainKind = getChainKind(chain)
  const signatureAlgorithm = signatureAlgorithms[chainKind]

  // Get derivation path
  let derivePath: string
  if (payload.derivePath) {
    derivePath = payload.derivePath
  } else {
    const coinType = getCoinType({ walletCore, chain })
    derivePath = walletCore.CoinTypeExt.derivationPath(coinType)
  }

  // Normalize chain path (remove quotes for MPC library)
  const chainPath = derivePath.replaceAll("'", '')

  return {
    signatureAlgorithm,
    derivePath,
    chainPath,
  }
}
