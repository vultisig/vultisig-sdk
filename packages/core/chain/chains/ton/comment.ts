import { beginCell } from '@ton/core'

/** Every TON comment body opens with a 32-bit zero opcode, then the UTF-8 text. */
const commentOpcodeBits = 32

/** A TON cell holds 1023 bits of data. */
const cellBits = 1023

/** TEP-74 `transfer#0f8a7ea5`. */
const jettonTransferOpcode = 0xf8a7ea5

/**
 * `addr_std$10` is fixed width whatever account it names: 2 tag + 1 anycast +
 * 8 workchain + 256 hash.
 */
const addressBits = 267

/**
 * What the jetton transfer body spends on fields the comment has to share its
 * cell with but whose width never moves: both addresses, the `custom_payload`
 * Maybe bit, and the Either tag that selects the inline `forward_payload`.
 */
const jettonFixedFieldBits = addressBits * 2 + 1 + 1

/**
 * The longest UTF-8 comment a native TON transfer can carry.
 *
 * The comment is the message body's own cell, so everything after the opcode is
 * available: (1023 - 32) / 8.
 */
export const tonNativeCommentMaxBytes = Math.floor((cellBits - commentOpcodeBits) / 8)

export type TonJettonCommentContext = {
  /** Jetton amount in minimal units — the same value the transfer sends. */
  amount: bigint
  /** Whether the recipient is initialized; decides the forward amount (1 vs 0). */
  isActiveDestination: boolean
}

/**
 * The longest UTF-8 comment a jetton transfer can carry *for this amount*.
 *
 * A jetton comment is not a body of its own: it rides inline in the transfer
 * body's `forward_payload`, sharing one 1023-bit cell with the opcode, query id,
 * amount, both addresses and the forward amount. WalletCore emits only that
 * inline form — it never spills the payload into a referenced cell — so the cap
 * is whatever those fields leave behind, roughly 34–39 bytes. It SHRINKS as the
 * amount grows, because `VarUInteger 16` widens a byte at a time. A fixed byte
 * count is therefore always wrong for jettons.
 *
 * The amount-dependent widths are measured by encoding them rather than
 * predicted, so the answer cannot drift from the encoder it describes.
 */
export const getTonJettonCommentMaxBytes = ({ amount, isActiveDestination }: TonJettonCommentContext): number => {
  const variableFields = beginCell()
    .storeUint(jettonTransferOpcode, 32)
    .storeUint(0, 64) // query_id
    .storeCoins(amount)
    .storeCoins(isActiveDestination ? 1n : 0n) // forward_ton_amount

  const available = variableFields.availableBits - jettonFixedFieldBits - commentOpcodeBits

  return Math.max(0, Math.floor(available / 8))
}

export type TonCommentInput = {
  memo: string
  /** Jetton transfer context. Omit for a native TON transfer. */
  jetton?: TonJettonCommentContext
}

/**
 * The longest UTF-8 comment this transfer can carry, in bytes — a native cell's
 * 123, or the amount-dependent inline capacity of a jetton transfer.
 *
 * Exposed so a send form can cap or count down against the real limit instead
 * of discovering it at keysign.
 */
export const getTonCommentMaxBytes = ({ jetton }: Pick<TonCommentInput, 'jetton'>): number =>
  jetton ? getTonJettonCommentMaxBytes(jetton) : tonNativeCommentMaxBytes

/**
 * Rejects a TON comment that will not fit the cell it is destined for.
 *
 * Memos are load-bearing on TON — an exchange deposit without the right one
 * loses the funds — so this is the single place that decides whether a comment
 * is sendable. Run it before the user commits, not at keysign, where an
 * oversized jetton comment surfaces as a bare WalletCore "Internal error".
 */
export const validateTonComment = ({ memo, jetton }: TonCommentInput): void => {
  const byteLength = new TextEncoder().encode(memo).length
  const maxBytes = getTonCommentMaxBytes({ jetton })

  if (byteLength <= maxBytes) {
    return
  }

  throw new Error(
    jetton
      ? `TON memo must be at most ${maxBytes} bytes for this jetton amount (got ${byteLength}); the limit shrinks as the amount grows.`
      : `TON memo must be at most ${maxBytes} bytes (got ${byteLength}).`
  )
}
