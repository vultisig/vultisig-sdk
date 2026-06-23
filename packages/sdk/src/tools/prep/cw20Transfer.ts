import { bech32 } from 'bech32'

import type { CosmosMsgInput } from '../../types/cosmos'
import { CosmosMsgType } from '../../types/cosmos-msg'

/**
 * Pure-crypto builder for an UNSIGNED CosmWasm CW-20 token transfer message.
 *
 * Ported from mcp-ts `src/tools/send/build-cw20-transfer.ts`, stripped of all
 * orchestration (LCD account fetch, blockaid scan-request envelope, ToolDef
 * plumbing). This function does ZERO network I/O and NEVER signs or broadcasts.
 * It validates the addresses + amount, then emits the canonical
 * `MsgExecuteContract` amino message carrying
 * `execute_msg = JSON.stringify({ transfer: { recipient, amount } })`.
 *
 * The returned `msg` is shaped as a {@link CosmosMsgInput} so callers can feed
 * it straight into `prepareSignAminoTxFromKeys` (or a vault's SignAmino path) to
 * obtain a `KeysignPayload`. Account-number / sequence / fee / chain-id are the
 * caller's responsibility — those are chain-state, not crypto, and stay in the
 * orchestration layer where they can be fetched fresh.
 *
 * Fund-safety invariants preserved from the mcp-ts source:
 *   - `recipient` is the *human recipient*, NOT the contract — siblings, the
 *     SDK proto, and the app all expect the recipient in the transfer body.
 *   - `contract` is the CW-20 wasm contract being executed.
 *   - validator HRPs (`...valoper1...` / `...valcons1...`) are rejected before
 *     a generic prefix mismatch, so funds are never routed at a validator key.
 *   - native bank denoms (e.g. `uluna`, `uusd`) are rejected — those are bank
 *     sends, not CW-20 executes; routing them here would build an unsignable /
 *     wrong-path tx.
 *   - `execute_msg` is JSON-STRINGIFIED to match the SDK protobuf field
 *     (`WasmExecuteContractPayload.execute_msg: string`); an object there leaks
 *     an unsignable shape.
 *
 * @example
 * ```ts
 * const { msg, executeMsg } = buildCw20TransferMsg({
 *   bech32Prefix: 'osmo',
 *   contract: 'osmo1...',
 *   recipient: 'osmo1...',
 *   amount: '1000000',
 *   sender: 'osmo1...',
 * })
 * // feed `msg` into prepareSignAminoTxFromKeys(identity, { chain, coin, msgs: [msg], fee })
 * ```
 */

const VALIDATOR_HRP_SUFFIXES = ['valoper', 'valcons'] as const

const isValidatorHrp = (prefix: string): boolean => VALIDATOR_HRP_SUFFIXES.some(suffix => prefix.endsWith(suffix))

export type BuildCw20TransferMsgParams = {
  /** bech32 prefix for the target chain (e.g. 'osmo', 'kujira', 'terra'). */
  bech32Prefix: string
  /** CW-20 wasm contract address being executed. */
  contract: string
  /** Human recipient address (NOT the contract). */
  recipient: string
  /** Amount in token base units — positive integer decimal string. */
  amount: string
  /** Sender address; written into the amino `sender` field. */
  sender: string
  /**
   * Native bank denoms to reject for this chain (e.g. ['uluna', 'uusd']).
   * Routing a native denom through CW-20 builds a wrong-path tx — reject it.
   */
  nativeDenoms?: readonly string[]
}

export type BuildCw20TransferMsgResult = {
  /**
   * `MsgExecuteContract` amino message, ready to pass to a SignAmino builder.
   * `value` is JSON-stringified per the cosmos amino convention.
   */
  msg: CosmosMsgInput
  /** The validated recipient (re-emitted so callers don't re-decode). */
  recipient: string
  /** The validated contract address. */
  contract: string
  /** The validated sender address. */
  sender: string
  /** The validated amount (base-unit integer string). */
  amount: string
  /** The stringified `{ transfer: { recipient, amount } }` payload. */
  executeMsg: string
}

const validateCosmosAddress = (
  value: string,
  field: 'contract' | 'recipient' | 'sender',
  bech32Prefix: string
): string => {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`invalid ${field}: address is required`)
  }

  let decoded: ReturnType<typeof bech32.decode>
  try {
    decoded = bech32.decode(trimmed)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`invalid ${field}: malformed bech32 encoding (${message})`)
  }

  // Fund-safety: contract / recipient / sender are all account-style bech32
  // (a CW-20 contract or a wallet), never a validator key. Reject a
  // `...valoper1...` / `...valcons1...` before the generic prefix mismatch.
  if (isValidatorHrp(decoded.prefix)) {
    throw new Error(`invalid ${field}: validator address (${decoded.prefix}) is not a valid CW-20 ${field}`)
  }
  if (decoded.prefix !== bech32Prefix) {
    throw new Error(`invalid ${field}: expected ${bech32Prefix} prefix, got ${decoded.prefix}`)
  }

  let payload: number[]
  try {
    payload = bech32.fromWords(decoded.words)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`invalid ${field}: malformed bech32 data (${message})`)
  }

  if (payload.length !== 20 && payload.length !== 32) {
    throw new Error(`invalid ${field}: expected 20- or 32-byte payload, got ${payload.length}`)
  }

  return trimmed
}

const validateBaseUnitAmount = (value: string): string => {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`invalid amount: expected a positive integer base-unit string, got "${value}"`)
  }
  if (BigInt(trimmed) <= 0n) {
    throw new Error('invalid amount: must be greater than zero')
  }
  // Return the trimmed string UNCHANGED for byte-parity with mcp-ts's shared
  // `validateBaseUnitAmount` (src/lib/validateBaseUnitAmount.ts). The amount is
  // embedded verbatim into the signed `execute_msg` JSON, so stripping leading
  // zeros here ("01000"->"1000") would produce a different signed wire payload
  // than the mcp-ts source for the same input — keep it identical.
  return trimmed
}

/**
 * Build the unsigned CW-20 transfer `MsgExecuteContract` amino message.
 *
 * PURE CRYPTO — no network I/O, no signing, no broadcasting.
 */
export const buildCw20TransferMsg = (params: BuildCw20TransferMsgParams): BuildCw20TransferMsgResult => {
  const { bech32Prefix } = params

  // Reject known native bank denoms early — no CW-20 contract exists for them,
  // and the contract-address field would be a native denom string, not bech32.
  const nativeDenoms = params.nativeDenoms ?? []
  const rawContract = params.contract.trim().toLowerCase()
  if (nativeDenoms.some(denom => denom.toLowerCase() === rawContract)) {
    throw new Error(
      `native_denom_use_cosmos_send: "${params.contract}" is a native bank denom, not a CW-20 contract. Use a native cosmos send instead.`
    )
  }

  const contract = validateCosmosAddress(params.contract, 'contract', bech32Prefix)
  const recipient = validateCosmosAddress(params.recipient, 'recipient', bech32Prefix)
  const sender = validateCosmosAddress(params.sender, 'sender', bech32Prefix)
  const amount = validateBaseUnitAmount(params.amount)

  // Stringified inner CW-20 execute msg — `{transfer:{recipient,amount}}`.
  const executeMsg = JSON.stringify({ transfer: { recipient, amount } })

  // Amino `MsgExecuteContract` value. `msg` here is the CW-20 execute object;
  // `funds: []` (a pure transfer carries no attached coins).
  const value = JSON.stringify({
    sender,
    contract,
    msg: { transfer: { recipient, amount } },
    funds: [],
  })

  return {
    msg: { type: CosmosMsgType.MsgExecuteContract, value },
    recipient,
    contract,
    sender,
    amount,
    executeMsg,
  }
}
