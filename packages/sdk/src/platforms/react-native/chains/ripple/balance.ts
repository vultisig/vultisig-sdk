import { parseIssuedCurrencyValue, parseRippleTokenId, toXrplCurrencyCode } from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import type { CoinBalanceResolverInput } from '@vultisig/core-chain/coin/balance/resolver'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import {
  DEFAULT_XRP_RPC_URL,
  getXrpAccountLines,
  getXrpAccountState,
  getXrpReserveInfo,
} from './rpc'

export async function getRippleCoinBalance(input: CoinBalanceResolverInput): Promise<bigint> {
  if (isFeeCoin(input)) {
    const account = await getXrpAccountState(input.address, DEFAULT_XRP_RPC_URL, input.signal)
    if (!account.funded) return 0n

    const { reserveBaseDrops, reserveIncrementDrops } = await getXrpReserveInfo(DEFAULT_XRP_RPC_URL, input.signal)
    const totalBalance = BigInt(account.balanceDrops)
    const totalReserve = reserveBaseDrops + BigInt(account.ownerCount) * reserveIncrementDrops
    const spendableBalance = totalBalance - totalReserve

    return spendableBalance > 0n ? spendableBalance : 0n
  }

  const { currency, issuer } = parseRippleTokenId(shouldBePresent(input.id, 'Ripple token id'))
  const lines = await getXrpAccountLines(input.address, DEFAULT_XRP_RPC_URL, input.signal)
  const line = lines.find(
    ({ account, currency: lineCurrency }) =>
      account === issuer && toXrplCurrencyCode(lineCurrency) === toXrplCurrencyCode(currency)
  )

  if (!line) return 0n

  const balance = parseIssuedCurrencyValue(line.balance)
  return balance > 0n ? balance : 0n
}
