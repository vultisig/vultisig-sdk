import { getNearAccount, getNearFeeConfig } from '@vultisig/core-chain/chains/near/api'
import { getNearSendRequiredAmount, getNearStorageReserve } from '@vultisig/core-chain/chains/near/fees'
import { NearUnknownEntityError } from '@vultisig/core-chain/chains/near/rpc'
import { NEAR_MAX_U128, parseNearUint } from '@vultisig/core-chain/chains/near/uint'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'

import { KeysignPayload } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { getBlockchainSpecificValue } from '../chainSpecific/KeysignChainSpecific'
import { BuildKeysignPayloadError } from '../error'

type AssertNearSendAffordableInput = {
  keysignPayload: KeysignPayload
  balance: bigint
  coin: Pick<AccountCoin, 'address' | 'ticker' | 'decimals'>
}

/**
 * Throws `not-enough-funds` unless the balance covers the amount, the frozen gas
 * reservation and the storage reserve. NEAR never clamps: a smaller transfer than
 * the user asked for is not signed, so MAX passes an already-reduced amount.
 */
export const assertNearSendAffordable = async ({ keysignPayload, balance, coin }: AssertNearSendAffordableInput) => {
  const { gasFee } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'nearSpecific')
  const [account, { storageAmountPerByte }] = await Promise.all([getNearAccount(coin.address), getNearFeeConfig()])

  if (!account) {
    throw new NearUnknownEntityError('account', `NEAR account ${coin.address} does not exist`)
  }

  const storageReserve = getNearStorageReserve({
    storageUsage: account.storageUsage,
    locked: account.locked,
    storageAmountPerByte,
  })

  const required = getNearSendRequiredAmount({
    requestedAmount: BigInt(keysignPayload.toAmount),
    gasReservation: parseNearUint(gasFee, 'gas fee', NEAR_MAX_U128),
    storageReserve,
  })

  if (required > balance) {
    throw new BuildKeysignPayloadError(
      'not-enough-funds',
      'Not enough NEAR: the amount plus the gas reservation and storage reserve exceeds the available balance',
      { required, available: balance, ticker: coin.ticker, decimals: coin.decimals, includesNetworkCosts: true }
    )
  }
}
