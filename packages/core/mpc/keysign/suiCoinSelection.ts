import { SuiCoin } from '../types/vultisig/keysign/v1/blockchain_specific_pb'

export const suiNativeCoinType = '0x2::sui::SUI'

export const maxSuiInputCoinObjects = 255
export const suiGasCandidateObjectCount = 5

const normalizeSuiAddress = (address: string): string => {
  const lowered = address.toLowerCase()
  const hex = lowered.startsWith('0x') ? lowered.slice(2) : lowered
  const trimmed = hex.replace(/^0+/, '')
  return `0x${trimmed || '0'}`
}

export const normalizeSuiCoinType = (coinType: string): string => {
  const addressEnd = coinType.indexOf('::')
  if (addressEnd < 0) {
    return normalizeSuiAddress(coinType)
  }

  return `${normalizeSuiAddress(coinType.slice(0, addressEnd))}${coinType.slice(addressEnd)}`
}

export const isSameSuiCoinType = (lhs: string, rhs: string): boolean =>
  normalizeSuiCoinType(lhs) === normalizeSuiCoinType(rhs)

export const isNativeSuiCoin = ({ coinType }: Pick<SuiCoin, 'coinType'>): boolean =>
  isSameSuiCoinType(coinType, suiNativeCoinType)

export const getSuiCoinBalance = ({ balance }: Pick<SuiCoin, 'balance'>): bigint => {
  try {
    return BigInt(balance || '0')
  } catch {
    return 0n
  }
}

export const selectSuiInputCoins = (
  coins: readonly SuiCoin[],
  target: bigint,
  maxObjects = maxSuiInputCoinObjects
): SuiCoin[] => {
  const sorted = [...coins].sort((lhs, rhs) => {
    const lhsBalance = getSuiCoinBalance(lhs)
    const rhsBalance = getSuiCoinBalance(rhs)
    if (lhsBalance !== rhsBalance) {
      return lhsBalance > rhsBalance ? -1 : 1
    }

    return lhs.coinObjectId.localeCompare(rhs.coinObjectId)
  })

  const selected: SuiCoin[] = []
  let accumulated = 0n
  for (const coin of sorted) {
    if (selected.length > 0 && accumulated >= target) break
    if (selected.length >= maxObjects) break

    selected.push(coin)
    accumulated += getSuiCoinBalance(coin)
  }

  if (accumulated < target) {
    throw new Error(`Insufficient Sui coin balance to cover ${target.toString()}`)
  }

  return selected
}

export const selectSuiGasObject = (coins: readonly SuiCoin[], gasBudget: bigint): SuiCoin | undefined => {
  const nativeCoins = coins.filter(isNativeSuiCoin)
  if (nativeCoins.length === 0) return undefined

  const covering = nativeCoins.filter(coin => getSuiCoinBalance(coin) >= gasBudget)
  if (covering.length > 0) {
    return covering.sort((lhs, rhs) => {
      const lhsBalance = getSuiCoinBalance(lhs)
      const rhsBalance = getSuiCoinBalance(rhs)
      if (lhsBalance !== rhsBalance) {
        return lhsBalance < rhsBalance ? -1 : 1
      }

      return lhs.coinObjectId.localeCompare(rhs.coinObjectId)
    })[0]
  }

  throw new Error(`Insufficient SUI balance to cover gas budget ${gasBudget.toString()}`)
}

type SelectSuiPayloadCoinsInput = {
  coins: readonly SuiCoin[]
  isNativeToken: boolean
  coinType?: string
  amount: bigint
  gasBudget: bigint
}

export const selectSuiPayloadCoins = ({
  coins,
  isNativeToken,
  coinType,
  amount,
  gasBudget,
}: SelectSuiPayloadCoinsInput): SuiCoin[] => {
  const nativeCoins = coins.filter(isNativeSuiCoin)

  if (isNativeToken) {
    return selectSuiInputCoins(nativeCoins, amount + gasBudget)
  }

  const tokenType = coinType || suiNativeCoinType
  const tokenCoins = coins.filter(coin => isSameSuiCoinType(coin.coinType, tokenType))
  const selectedTokens = selectSuiInputCoins(tokenCoins, amount)
  const gasCandidates = [...nativeCoins]
    .sort((lhs, rhs) => {
      const lhsBalance = getSuiCoinBalance(lhs)
      const rhsBalance = getSuiCoinBalance(rhs)
      if (lhsBalance !== rhsBalance) {
        return lhsBalance > rhsBalance ? -1 : 1
      }

      return lhs.coinObjectId.localeCompare(rhs.coinObjectId)
    })
    .slice(0, suiGasCandidateObjectCount)

  return [...selectedTokens, ...gasCandidates]
}
