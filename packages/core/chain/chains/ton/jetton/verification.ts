import { tonAddressToRawKey } from '@vultisig/core-chain/chains/ton/address'
import { getJettonMastersMetadata } from '@vultisig/core-chain/chains/ton/api'
import { TokenVerification } from '@vultisig/core-chain/coin/tokenVerification'
import { attempt } from '@vultisig/lib-utils/attempt'

import { normalizeJettonSymbol } from './symbol'
import { getTonVerifiedJettonRegistry, TonVerifiedJettonRegistry } from './verifiedRegistry'

type ResolveTonJettonVerificationInput = {
  /** Jetton master address, raw or user-friendly. */
  address: string
  symbol?: string
  name?: string
  /** Toncenter's own scam flag for the master, when known. */
  isFlaggedScam?: boolean
  registry: TonVerifiedJettonRegistry
}

/**
 * Classifies a jetton against the verified registry. A listed address is
 * `verified` whatever it calls itself. An unlisted jetton is `scam` when the
 * indexer flags it or when its symbol or name collapses (see
 * `normalizeJettonSymbol`) onto a verified jetton's symbol or name — the
 * fake-USDT pattern, where the counterfeit is only distinguishable by address.
 * Anything else is `unverified`.
 */
export const resolveTonJettonVerification = ({
  address,
  symbol,
  name,
  isFlaggedScam,
  registry,
}: ResolveTonJettonVerificationInput): TokenVerification => {
  if (registry.byAddress[tonAddressToRawKey(address)]) return 'verified'

  if (isFlaggedScam) return 'scam'

  const impersonates = [symbol, name].some(label => {
    const skeleton = label ? normalizeJettonSymbol(label) : ''

    return !!skeleton && (registry.symbols.has(skeleton) || registry.names.has(skeleton))
  })

  return impersonates ? 'scam' : 'unverified'
}

type GetTonJettonVerificationInput = {
  /** Jetton master address, raw or user-friendly. */
  id: string
  /** Ticker already known locally, used when Toncenter has no symbol for the master. */
  ticker?: string
}

/**
 * Verification tier for one jetton, for token rows and approval cards. Reads the
 * master's on-chain symbol and name from Toncenter so a counterfeit is judged by
 * what it actually claims to be, not by the ticker stored locally; falls back to
 * that ticker when the lookup fails, so the label still renders offline.
 */
export const getTonJettonVerification = async ({
  id,
  ticker,
}: GetTonJettonVerificationInput): Promise<TokenVerification> => {
  const [registry, metadata] = await Promise.all([
    getTonVerifiedJettonRegistry(),
    attempt(getJettonMastersMetadata([id])),
  ])

  const master = 'data' in metadata ? metadata.data?.[tonAddressToRawKey(id)] : undefined

  return resolveTonJettonVerification({
    address: id,
    symbol: master?.symbol ?? ticker,
    name: master?.name,
    isFlaggedScam: master?.isFlaggedScam,
    registry,
  })
}
