import {
  Address,
  beginCell,
  Cell,
  external,
  internal,
  loadMessage,
  loadStateInit,
  MessageRelaxed,
  OutActionSendMsg,
  SendMode,
  StateInit,
  storeMessage,
  storeOutList,
} from '@ton/core'
import { attempt } from '@vultisig/lib-utils/attempt'

import { tonPayloadToBase64 } from '../messageBody/decode'
import { getTonMessageBounceable } from '../messageBounce'
import { tonV5R1WalletId } from '../walletV5R1'

/** W5 `internal_signed` request opcode: the ASCII bytes of "sint". */
export const tonV5R1InternalSignedOpcode = 0x73696e74

/** How many bytes an Ed25519 signature takes at the tail of the request. */
const signatureBytes = 64

/**
 * The send mode every message of a relayed request carries. Numerically the
 * same as the W5 external mode (`PAY_FEES_SEPARATELY | IGNORE_ACTION_PHASE_ERRORS`):
 * the contract only demands the ignore-errors bit for external requests, but
 * keeping one mode for both paths means a relayed transfer behaves exactly like
 * a direct one, and the status resolver already reads the action phase to
 * catch a skipped transfer.
 */
export const tonGaslessSendMode = SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS

/** One outgoing message of a relayed request, in the shape the keysign payload stores it. */
export type TonGaslessRequestMessage = {
  to: string
  /** Nanotons, decimal string. */
  amount: string
  /** Single-cell BOC, base64 or hex. */
  payload?: string | null
  stateInit?: string | null
}

const cellFromPayload = (payload: string | null | undefined): Cell | undefined => {
  const normalized = tonPayloadToBase64(payload)
  return normalized ? Cell.fromBase64(normalized) : undefined
}

/**
 * The internal message a quoted entry describes. The bounce flag comes from
 * the destination's own address tag, the way a TonConnect message's does, so
 * every co-signer derives the same bit.
 */
export const toTonGaslessInternalMessage = ({
  to,
  amount,
  payload,
  stateInit,
}: TonGaslessRequestMessage): MessageRelaxed => {
  const stateInitCell = cellFromPayload(stateInit)

  return internal({
    to: Address.parse(to),
    value: BigInt(amount),
    bounce: getTonMessageBounceable(to, !!stateInitCell),
    init: stateInitCell ? loadStateInit(stateInitCell.beginParse()) : undefined,
    body: cellFromPayload(payload),
  })
}

type BuildTonGaslessSigningCellInput = {
  walletId?: number
  validUntil: number
  seqno: number
  messages: TonGaslessRequestMessage[]
}

/**
 * The W5 `internal_signed` request without its signature — the cell whose hash
 * the vault signs:
 *
 *   0x73696e74(32) || wallet_id(int32) || valid_until(32) || seqno(32) ||
 *   Maybe ^OutList(send actions) || 0 (no extended actions)
 *
 * Same layout as `signed_external` apart from the opcode, so the relay can
 * only deliver it as an internal message; sent as an external message the
 * contract refuses it.
 */
export const buildTonGaslessSigningCell = ({
  walletId = tonV5R1WalletId,
  validUntil,
  seqno,
  messages,
}: BuildTonGaslessSigningCellInput): Cell => {
  if (messages.length === 0 || messages.length > 255) {
    throw new Error(`A W5 request carries between 1 and 255 messages, got ${messages.length}`)
  }

  const actions: OutActionSendMsg[] = messages.map(message => ({
    type: 'sendMsg',
    mode: tonGaslessSendMode,
    outMsg: toTonGaslessInternalMessage(message),
  }))

  return beginCell()
    .storeUint(tonV5R1InternalSignedOpcode, 32)
    .storeInt(walletId, 32)
    .storeUint(validUntil, 32)
    .storeUint(seqno, 32)
    .storeMaybeRef(beginCell().store(storeOutList(actions)).endCell())
    .storeBit(false)
    .endCell()
}

type AttachTonGaslessSignatureInput = {
  signingCell: Cell
  signature: Uint8Array
}

/** The request body the relay forwards: the signed cell with the signature appended, as W5 expects it. */
export const attachTonGaslessSignature = ({ signingCell, signature }: AttachTonGaslessSignatureInput): Cell => {
  if (signature.length !== signatureBytes) {
    throw new Error(`TON signature must be ${signatureBytes} bytes, got ${signature.length}`)
  }

  return beginCell().storeSlice(signingCell.asSlice()).storeBuffer(Buffer.from(signature)).endCell()
}

type BuildTonGaslessExternalMessageInput = {
  walletAddress: string
  body: Cell
  /** Attached on the wallet's first request so the relay can deploy the contract in the same transaction. */
  stateInit?: StateInit
}

/**
 * The envelope the relay accepts: an external message addressed to the
 * wallet, carrying the signed request. The relay does not broadcast it as
 * such — it unwraps the body and sends it to the wallet inside an internal
 * message it pays for.
 */
export const buildTonGaslessExternalMessage = ({
  walletAddress,
  body,
  stateInit,
}: BuildTonGaslessExternalMessageInput): Cell =>
  beginCell()
    .store(storeMessage(external({ to: Address.parse(walletAddress), init: stateInit, body })))
    .endCell()

/**
 * Whether a base64 BOC is a relayed W5 request rather than a message the
 * network takes directly. A W5 wallet only honours the `internal_signed`
 * opcode from an internal message, so a broadcaster seeing it has to go
 * through the relay.
 */
export const isTonGaslessRequest = (bocBase64: string): boolean => {
  const result = attempt(() => {
    const [cell] = Cell.fromBoc(Buffer.from(bocBase64, 'base64'))
    const body = loadMessage(cell.beginParse()).body.beginParse()

    return body.remainingBits >= 32 && body.preloadUint(32) === tonV5R1InternalSignedOpcode
  })

  return 'data' in result && result.data === true
}
