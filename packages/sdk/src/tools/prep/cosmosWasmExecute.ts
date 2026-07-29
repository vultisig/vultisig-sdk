import type { CosmosMsgInput } from '../../types/cosmos'
import { CosmosMsgType } from '../../types/cosmos-msg'

export type CosmWasmExecuteFund = {
  denom: string
  amount: string
}

export type BuildCosmosWasmExecuteMsgParams = {
  sender: string
  contract: string
  msg: unknown
  funds?: readonly CosmWasmExecuteFund[]
}

const requireNonEmpty = (value: string, field: 'sender' | 'contract'): string => {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`invalid CosmWasm execute ${field}: value is required`)
  return trimmed
}

/**
 * Build the canonical generic Amino `MsgExecuteContract` envelope.
 *
 * This is pure transaction-shape preparation: callers remain responsible for
 * chain-specific address validation, account state, fees, signing, and
 * broadcasting. The `msg` value stays an object in the JSON envelope, matching
 * the CosmJS/WalletCore Amino convention used by `prepareSignAminoTx`.
 */
export const buildCosmosWasmExecuteMsg = ({
  sender,
  contract,
  msg,
  funds = [],
}: BuildCosmosWasmExecuteMsgParams): CosmosMsgInput => {
  if (msg === undefined || typeof msg === 'function' || typeof msg === 'symbol') {
    throw new Error('invalid CosmWasm execute msg: value must be JSON-serializable')
  }

  const value = JSON.stringify({
    sender: requireNonEmpty(sender, 'sender'),
    contract: requireNonEmpty(contract, 'contract'),
    msg,
    funds: funds.map(({ denom, amount }) => ({ denom, amount })),
  })

  return { type: CosmosMsgType.MsgExecuteContract, value }
}
