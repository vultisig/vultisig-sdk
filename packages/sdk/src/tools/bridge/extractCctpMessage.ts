/**
 * extractCctpMessageFromReceipt — decode the canonical `MessageSent(bytes)`
 * log from a CCTP burn tx receipt.
 *
 * `buildCctpBridge`'s burn leg (`depositForBurn`) emits a `MessageSent`
 * event on the source-chain MessageTransmitter. The raw `message` bytes
 * are required by {@link buildCctpClaim} on the destination chain, and
 * `keccak256(message)` is the `messageHash` the Circle attestation API
 * polls on. Without this helper, every consumer has to hand-roll the same
 * log decode + hash step that joins burn → attestation → claim.
 */

import { decodeEventLog, keccak256, toEventSelector } from 'viem'

const messageSentEventAbi = [
  {
    type: 'event',
    name: 'MessageSent',
    inputs: [{ name: 'message', type: 'bytes', indexed: false }],
  },
] as const

/** keccak256("MessageSent(bytes)") — CCTP's canonical event topic0. */
const messageSentTopic = toEventSelector(messageSentEventAbi[0])

/** A single EVM log, shaped like `viem`'s `Log` / an RPC `eth_getTransactionReceipt` log entry. */
export type CctpReceiptLog = {
  topics: readonly `0x${string}`[]
  data: `0x${string}`
}

/** A tx receipt (or bare log array) containing the CCTP burn's `MessageSent` event. */
export type CctpReceiptLike = { logs: readonly CctpReceiptLog[] } | readonly CctpReceiptLog[]

/** The raw message bytes + canonical hash extracted from a CCTP burn receipt. */
export type ExtractedCctpMessage = {
  /** Raw `message` bytes from `MessageSent` — passed to {@link buildCctpClaim} as `message`. */
  message: `0x${string}`
  /** `keccak256(message)` — the hash Circle's attestation API polls on. */
  messageHash: `0x${string}`
}

/**
 * Extract the CCTP `message` bytes + `messageHash` from a burn tx receipt
 * (or its raw `logs` array).
 *
 * @throws if no `MessageSent` log is present — the burn tx may not have
 * confirmed yet, or is not a CCTP `depositForBurn` receipt.
 */
export const extractCctpMessageFromReceipt = (receiptOrLogs: CctpReceiptLike): ExtractedCctpMessage => {
  const logs = Array.isArray(receiptOrLogs)
    ? receiptOrLogs
    : (receiptOrLogs as { logs: readonly CctpReceiptLog[] }).logs

  const messageSentLog = logs.find(log => log.topics[0]?.toLowerCase() === messageSentTopic.toLowerCase())
  if (!messageSentLog) {
    throw new Error(
      'no MessageSent event found in receipt logs — the burn tx may not have confirmed yet, or this is not a CCTP depositForBurn receipt'
    )
  }

  const normalizedTopics = messageSentLog.topics.map(t => t.toLowerCase()) as [`0x${string}`, ...`0x${string}`[]]
  const { args } = decodeEventLog({
    abi: messageSentEventAbi,
    topics: normalizedTopics,
    data: messageSentLog.data,
  })

  const message = args.message
  return { message, messageHash: keccak256(message) }
}
