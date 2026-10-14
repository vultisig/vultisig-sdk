import { parseNonNegativeBigInt } from '@vultisig/lib-utils/bigint/parseNonNegativeBigInt'
import bs58 from 'bs58'
import { Buffer } from 'buffer'

import { NearFeeConfig, NearParameterCost } from './fees'
import { callNearRpc, callNearRpcText, getNearRpcErrorName, parseNearRpcResponse, toNearRpcError } from './rpc'

/** Exact non-negative integer from a JSON field that may arrive as a string or a number. */
const parseNearExactInteger = (value: unknown, label: string): bigint => {
  if (typeof value === 'bigint') {
    return value
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`NEAR ${label} is not an exact non-negative integer: ${String(value)}`)
    }

    return BigInt(value)
  }

  if (typeof value === 'string') {
    return parseNonNegativeBigInt(value)
  }

  throw new Error(`NEAR ${label} is not an exact non-negative integer: ${JSON.stringify(value)}`)
}

export type NearAccountView = {
  amount: bigint
  locked: bigint
  storageUsage: bigint
}

type RawNearAccountView = {
  amount?: unknown
  locked?: unknown
  storage_usage?: unknown
}

/** `null` when the node answered UNKNOWN_ACCOUNT, which is a valid balance of zero. */
export const getNearAccount = async (accountId: string): Promise<NearAccountView | null> => {
  let view: RawNearAccountView | undefined

  try {
    view = await callNearRpc<RawNearAccountView>('query', {
      request_type: 'view_account',
      finality: 'final',
      account_id: accountId,
    })
  } catch (error) {
    if (getNearRpcErrorName(error) === 'UNKNOWN_ACCOUNT') {
      return null
    }
    throw error
  }

  if (!view) {
    throw new Error('NEAR view_account returned neither a result nor an error')
  }

  return {
    amount: parseNearExactInteger(view.amount, 'account amount'),
    locked: parseNearExactInteger(view.locked, 'account locked amount'),
    storageUsage: parseNearExactInteger(view.storage_usage, 'account storage usage'),
  }
}

export type NearAccessKeyView = {
  nonce: bigint
  isFullAccess: boolean
}

/**
 * `null` when the account holds no such key (the node answers with a `result.error` string).
 * Read at `optimistic`, since a `final` nonce lags and a quick second send would reuse it, and
 * from the raw body, since `JSON.parse` rounds a u64 nonce above 2^53.
 */
export const getNearAccessKey = async (accountId: string, hexPublicKey: string): Promise<NearAccessKeyView | null> => {
  const publicKey = `ed25519:${bs58.encode(Buffer.from(hexPublicKey, 'hex'))}`

  const raw = await callNearRpcText('query', {
    request_type: 'view_access_key',
    finality: 'optimistic',
    account_id: accountId,
    public_key: publicKey,
  })

  const { result: view, error } = parseNearRpcResponse<{ error?: unknown; nonce?: unknown; permission?: unknown }>(
    'query',
    raw.replace(/"nonce":\s*(\d+)/, '"nonce":"$1"')
  )

  if (error) {
    throw toNearRpcError('query', error)
  }

  if (!view) {
    throw new Error('NEAR view_access_key returned neither a result nor an error')
  }

  if (typeof view.error === 'string') {
    return null
  }

  return {
    nonce: parseNearExactInteger(view.nonce, 'access key nonce'),
    isFullAccess: view.permission === 'FullAccess',
  }
}

export type NearFinalBlockView = {
  hash: string
  gasPrice: bigint
  height: bigint
  protocolVersion: number
}

type RawNearFinalBlockView = {
  header?: { hash?: unknown; gas_price?: unknown; height?: unknown; latest_protocol_version?: unknown }
}

/**
 * The `final` block supplies both frozen signing inputs — its hash and the gas
 * price the reservation is priced at. A transaction is included in a later block,
 * so this is a reservation at the current price, not a guarantee.
 */
export const getNearFinalBlock = async (): Promise<NearFinalBlockView> => {
  const response = await callNearRpc<RawNearFinalBlockView>('block', { finality: 'final' })
  const header = response.header

  if (!header || typeof header.hash !== 'string') {
    throw new Error('NEAR block response is missing its header hash')
  }

  if (bs58.decode(header.hash).length !== 32) {
    throw new Error(`NEAR block hash is not 32 bytes: ${header.hash}`)
  }

  return {
    hash: header.hash,
    gasPrice: parseNearExactInteger(header.gas_price, 'block gas price'),
    height: parseNearExactInteger(header.height, 'block height'),
    protocolVersion: Number(parseNearExactInteger(header.latest_protocol_version, 'protocol version')),
  }
}

const parseParameterCost = (value: unknown, label: string): NearParameterCost => {
  const cost = value as { send_sir?: unknown; send_not_sir?: unknown; execution?: unknown } | undefined
  if (!cost) {
    throw new Error(`NEAR runtime config is missing transaction_costs.${label}`)
  }

  return {
    sendSir: parseNearExactInteger(cost.send_sir, `${label} send_sir`),
    sendNotSir: parseNearExactInteger(cost.send_not_sir, `${label} send_not_sir`),
    execution: parseNearExactInteger(cost.execution, `${label} execution`),
  }
}

type RawNearProtocolConfig = {
  runtime_config?: {
    min_gas_purchase_price?: unknown
    storage_amount_per_byte?: unknown
    transaction_costs?: {
      action_creation_config?: {
        transfer_cost?: unknown
        create_account_cost?: unknown
        add_key_cost?: { full_access_cost?: unknown }
      }
      action_receipt_creation_config?: unknown
    }
  }
}

export const getNearFeeConfig = async (): Promise<NearFeeConfig> => {
  const response = await callNearRpc<RawNearProtocolConfig>('EXPERIMENTAL_protocol_config', { finality: 'final' })
  const runtimeConfig = response.runtime_config
  const transactionCosts = runtimeConfig?.transaction_costs

  if (!runtimeConfig || !transactionCosts) {
    throw new Error('NEAR protocol config response is missing its runtime_config')
  }

  return {
    actionReceiptCreation: parseParameterCost(transactionCosts.action_receipt_creation_config, 'receipt creation'),
    transfer: parseParameterCost(transactionCosts.action_creation_config?.transfer_cost, 'transfer'),
    createAccount: parseParameterCost(transactionCosts.action_creation_config?.create_account_cost, 'create account'),
    addFullAccessKey: parseParameterCost(
      transactionCosts.action_creation_config?.add_key_cost?.full_access_cost,
      'add full access key'
    ),
    minGasPurchasePrice: parseNearExactInteger(runtimeConfig.min_gas_purchase_price, 'min_gas_purchase_price'),
    storageAmountPerByte: parseNearExactInteger(runtimeConfig.storage_amount_per_byte, 'storage_amount_per_byte'),
  }
}
