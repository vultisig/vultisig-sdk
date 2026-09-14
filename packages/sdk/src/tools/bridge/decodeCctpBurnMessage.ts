/**
 * Decode a CCTP V1 `depositForBurn` message into its identifying fields
 * (architecture#1733).
 *
 * Ported from `agent-backend-ts`'s `decodeCctpBurnMessage` — the SDK's
 * `buildCctpClaim` used to treat the message as opaque bytes, encoding
 * `receiveMessage(message, attestation)` for whatever `destinationChain` the
 * caller stated without checking that the message/attestation pair actually
 * redeems that burn. A stale, mismatched, or wrong-chain message still
 * produced structurally valid (but semantically wrong, or guaranteed-revert)
 * claim calldata. Decoding the message lets a caller cross-check every field
 * that actually identifies the burn before building anything.
 *
 * Fail-closed: throws (never guesses) when the message doesn't decode
 * unambiguously as a V1 USDC burn message.
 */

/** Decoded identity of a single CCTP `depositForBurn` message. */
export type CctpBurnMessage = {
  /** CCTP message envelope version. Only version 0 (V1) is supported. */
  version: number
  /** Domain ID of the chain the burn happened on. */
  sourceDomain: number
  /** Domain ID of the chain this claim is meant to be submitted on. */
  destinationDomain: number
  /** Per-source-domain nonce. (sourceDomain, nonce) uniquely identifies the burn. */
  nonce: bigint
  /** MessageTransmitter-level sender — the source chain's TokenMessenger. */
  sender: `0x${string}`
  /** MessageTransmitter-level recipient — the destination chain's TokenMessenger. */
  recipient: `0x${string}`
  destinationCaller: `0x${string}`
  /** Burn-message body version. Only version 0 (V1) is supported. */
  bodyVersion: number
  /** ERC-20 token that was burned on the source chain. */
  burnToken: `0x${string}`
  /** Address that receives the minted USDC on the destination chain. */
  mintRecipient: `0x${string}`
  /** Raw burned amount, in the token's base units. */
  amount: bigint
  messageSender: `0x${string}`
}

const CCTP_MESSAGE_HEADER_BYTES = 116
const CCTP_BURN_BODY_BYTES = 132
// V1 depositForBurn messages are a fixed, deterministic length — header +
// burn body, no variable trailer. Any other length means either a different
// message kind (not a USDC burn) or a truncated/malformed message.
const CCTP_BURN_MESSAGE_BYTES = CCTP_MESSAGE_HEADER_BYTES + CCTP_BURN_BODY_BYTES

function readBigUint(hexBody: string, byteOffset: number, byteLength: number): bigint {
  const start = byteOffset * 2
  const end = start + byteLength * 2
  const slice = hexBody.slice(start, end)
  return slice === '' ? 0n : BigInt(`0x${slice}`)
}

// A message/body field is a left-zero-padded bytes32; an EVM address lives
// in the last 20 bytes (40 hex chars).
function readBytes32Address(hexBody: string, byteOffset: number): `0x${string}` {
  const start = byteOffset * 2
  const word = hexBody.slice(start, start + 64)
  return `0x${word.slice(24)}` as `0x${string}`
}

/**
 * Decode a CCTP V1 `depositForBurn` message into its identifying fields.
 *
 * @throws when the message isn't exactly the fixed V1 burn-message length,
 * or either version field isn't 0 (V1) — never guesses at a shape it can't
 * confirm.
 */
export function decodeCctpBurnMessage(messageHex: `0x${string}`): CctpBurnMessage {
  const hexBody = messageHex.slice(2)
  const byteLen = hexBody.length / 2
  if (byteLen !== CCTP_BURN_MESSAGE_BYTES) {
    throw new Error(
      `message is ${byteLen} bytes; expected exactly ${CCTP_BURN_MESSAGE_BYTES} bytes ` +
        `(${CCTP_MESSAGE_HEADER_BYTES}-byte CCTP header + ${CCTP_BURN_BODY_BYTES}-byte depositForBurn body) ` +
        `for a V1 USDC burn message — cannot identify this burn unambiguously`
    )
  }

  const version = Number(readBigUint(hexBody, 0, 4))
  if (version !== 0) {
    throw new Error(`unsupported CCTP message version ${version} (this deployment only decodes V1 = version 0)`)
  }
  const sourceDomain = Number(readBigUint(hexBody, 4, 4))
  const destinationDomain = Number(readBigUint(hexBody, 8, 4))
  const nonce = readBigUint(hexBody, 12, 8)
  const sender = readBytes32Address(hexBody, 20)
  const recipient = readBytes32Address(hexBody, 52)
  const destinationCaller = readBytes32Address(hexBody, 84)

  const bodyOffset = CCTP_MESSAGE_HEADER_BYTES
  const bodyVersion = Number(readBigUint(hexBody, bodyOffset, 4))
  if (bodyVersion !== 0) {
    throw new Error(
      `unsupported CCTP burn-message body version ${bodyVersion} (this deployment only decodes V1 = version 0)`
    )
  }
  const burnToken = readBytes32Address(hexBody, bodyOffset + 4)
  const mintRecipient = readBytes32Address(hexBody, bodyOffset + 36)
  const amount = readBigUint(hexBody, bodyOffset + 68, 32)
  const messageSender = readBytes32Address(hexBody, bodyOffset + 100)

  return {
    version,
    sourceDomain,
    destinationDomain,
    nonce,
    sender,
    recipient,
    destinationCaller,
    bodyVersion,
    burnToken,
    mintRecipient,
    amount,
    messageSender,
  }
}
