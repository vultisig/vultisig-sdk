/**
 * Transcribed from nearcore protocol 86 (2.13.4) runtime/runtime/src/config.rs `calculate_tx_cost` and verifier.rs.
 * `account_creation_charge` is absent on purpose: nearcore takes it from the receipt's gas refund, not upfront.
 */

/** NEP-448 zero-balance accounts reach this storage usage; `verifier.rs:40`. */
const NEAR_ZERO_BALANCE_STORAGE_LIMIT = 770n

/** `ParameterCost` as exposed by `transaction_costs` in the runtime config. */
export type NearParameterCost = {
  /** `send_sir`/`send_not_sir`: charged to convert the transaction into a receipt. */
  sendSir: bigint
  sendNotSir: bigint
  execution: bigint
}

export type NearFeeConfig = {
  actionReceiptCreation: NearParameterCost
  transfer: NearParameterCost
  createAccount: NearParameterCost
  addFullAccessKey: NearParameterCost
  /** Floor price for the gas attached to the receipt (`config.min_gas_purchase_price`). */
  minGasPurchasePrice: bigint
  storageAmountPerByte: bigint
}

export type NearGasReservation = {
  burntGas: bigint
  remainingGas: bigint
  burntPrice: bigint
  receiptPrice: bigint
  reserved: bigint
}

type GetNearGasReservationInput = {
  fees: NearFeeConfig
  gasPrice: bigint
  /** `sender_is_receiver` in nearcore: a self-send pays the cheaper variants. */
  senderIsReceiver: boolean
  receiverIsImplicit: boolean
}

const isNearZeroBalanceAccount = (storageUsage: bigint): boolean =>
  storageUsage <= NEAR_ZERO_BALANCE_STORAGE_LIMIT

const sendGas = (cost: NearParameterCost, senderIsReceiver: boolean): bigint =>
  senderIsReceiver ? cost.sendSir : cost.sendNotSir

export const getNearGasReservation = ({
  fees,
  gasPrice,
  senderIsReceiver,
  receiverIsImplicit,
}: GetNearGasReservationInput): NearGasReservation => {
  const creationSendGas = receiverIsImplicit
    ? sendGas(fees.createAccount, senderIsReceiver) + sendGas(fees.addFullAccessKey, senderIsReceiver)
    : 0n
  const creationExecGas = receiverIsImplicit ? fees.createAccount.execution + fees.addFullAccessKey.execution : 0n

  const burntGas =
    sendGas(fees.actionReceiptCreation, senderIsReceiver) + sendGas(fees.transfer, senderIsReceiver) + creationSendGas
  const remainingGas = fees.actionReceiptCreation.execution + fees.transfer.execution + creationExecGas

  // Conversion gas is burnt at the block price; the receipt's gas is purchased at
  // a price floored by `min_gas_purchase_price`, a factor of ten apart on mainnet.
  const burntPrice = gasPrice
  const receiptPrice = gasPrice > fees.minGasPurchasePrice ? gasPrice : fees.minGasPurchasePrice

  return {
    burntGas,
    remainingGas,
    burntPrice,
    receiptPrice,
    reserved: burntGas * burntPrice + remainingGas * receiptPrice,
  }
}

type GetNearStorageReserveInput = {
  storageUsage: bigint
  locked: bigint
  storageAmountPerByte: bigint
}

/**
 * Balance that must stay behind to back the account's own storage. `locked`
 * (staking) only relaxes this requirement — it never becomes spendable.
 */
export const getNearStorageReserve = ({
  storageUsage,
  locked,
  storageAmountPerByte,
}: GetNearStorageReserveInput): bigint => {
  if (isNearZeroBalanceAccount(storageUsage)) {
    return 0n
  }

  const required = storageAmountPerByte * storageUsage

  return required > locked ? required - locked : 0n
}

type GetNearMaxSendableInput = {
  amount: bigint
  gasReservation: bigint
  storageReserve: bigint
}

export const getNearMaxSendable = ({ amount, gasReservation, storageReserve }: GetNearMaxSendableInput): bigint => {
  const spendable = amount - gasReservation - storageReserve

  return spendable > 0n ? spendable : 0n
}

/** Everything a send of `requestedAmount` must leave in the account, per `verifier.rs:305-342`. */
export const getNearSendRequiredAmount = ({
  requestedAmount,
  gasReservation,
  storageReserve,
}: {
  requestedAmount: bigint
  gasReservation: bigint
  storageReserve: bigint
}): bigint => requestedAmount + gasReservation + storageReserve
