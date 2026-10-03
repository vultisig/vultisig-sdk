import { isNearImplicitAccountId } from './accountId'
import { getNearAccount, getNearFeeConfig, getNearFinalBlock } from './api'
import { getNearGasReservation, getNearMaxSendable, getNearStorageReserve } from './fees'
import { NearUnknownEntityError } from './rpc'

export type NearSendLimits = {
  amount: bigint
  gasReservation: bigint
  storageReserve: bigint
  maxSendable: bigint
}

/**
 * Everything a NEAR send must reserve before anything can move: the upfront gas at
 * the current final block and the balance backing the account's own storage.
 */
export const getNearSendLimits = async ({
  address,
  receiver,
}: {
  address: string
  receiver: string
}): Promise<NearSendLimits> => {
  const [account, block, fees] = await Promise.all([getNearAccount(address), getNearFinalBlock(), getNearFeeConfig()])

  if (!account) {
    throw new NearUnknownEntityError('account', `NEAR account ${address} does not exist`)
  }

  const { reserved } = getNearGasReservation({
    fees,
    gasPrice: block.gasPrice,
    senderIsReceiver: address === receiver,
    receiverIsImplicit: isNearImplicitAccountId(receiver),
  })

  const storageReserve = getNearStorageReserve({
    storageUsage: account.storageUsage,
    locked: account.locked,
    storageAmountPerByte: fees.storageAmountPerByte,
  })

  return {
    amount: account.amount,
    gasReservation: reserved,
    storageReserve,
    maxSendable: getNearMaxSendable({ amount: account.amount, gasReservation: reserved, storageReserve }),
  }
}
