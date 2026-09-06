import { OtherChain } from '@vultisig/core-chain/Chain'
import { tonAddressToBounceable } from '@vultisig/core-chain/chains/ton/address'
import { getOwnerJettonWallets } from '@vultisig/core-chain/chains/ton/api'
import { resolveTonJettonVerification } from '@vultisig/core-chain/chains/ton/jetton/verification'
import { getTonVerifiedJettonRegistry } from '@vultisig/core-chain/chains/ton/jetton/verifiedRegistry'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { FindCoinsResolver } from '@vultisig/core-chain/coin/find/resolver'
import { knownTokensIndex } from '@vultisig/core-chain/coin/knownTokens'
import { without } from '@vultisig/lib-utils/array/without'

const defaultJettonDecimals = 9

/**
 * Discovers the jettons held at `address` that pass verification.
 *
 * Only `verified` jettons are returned. TON wallets are carpet-bombed with
 * airdropped counterfeits (fake USDT above all) and spam, and auto-adding those
 * to a vault would put a "USDT" balance on the home screen that the user never
 * received. Unverified and scam jettons can still be added by hand, where the
 * UI labels them. Toncenter's indexer metadata rides along in the wallet
 * listing, so no per-jetton call is needed; curated metadata wins for jettons
 * we ship ourselves.
 */
export const findTonCoins: FindCoinsResolver<OtherChain.Ton> = async ({ address, chain }) => {
  const [{ wallets, masters, userFriendlyAddresses }, registry] = await Promise.all([
    getOwnerJettonWallets(address),
    getTonVerifiedJettonRegistry(),
  ])

  const coins = wallets.map(({ jettonMasterAddress, balance }): AccountCoin<OtherChain.Ton> | undefined => {
    if (balance <= 0n) return

    const master = masters[jettonMasterAddress]
    const verification = resolveTonJettonVerification({
      address: jettonMasterAddress,
      symbol: master?.symbol,
      name: master?.name,
      isFlaggedScam: master?.isFlaggedScam,
      registry,
    })
    if (verification !== 'verified') return

    const id = tonAddressToBounceable(userFriendlyAddresses[jettonMasterAddress] ?? jettonMasterAddress)

    const known = knownTokensIndex[chain][id.toLowerCase()]
    if (known) {
      return { ...known, chain, id, address }
    }

    const verified = registry.byAddress[jettonMasterAddress]
    if (!verified) return

    const ticker = master?.symbol ?? verified.symbol
    if (!ticker) return

    const priceProviderId = verified.priceProviderId

    return {
      chain,
      id,
      address,
      ticker,
      decimals: master?.decimals ?? verified.decimals ?? defaultJettonDecimals,
      logo: master?.logo ?? verified.logo,
      ...(priceProviderId === undefined ? {} : { priceProviderId }),
    }
  })

  return without(coins, undefined)
}
