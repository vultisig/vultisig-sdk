/**
 * buildCctpClaim — build the destination-chain unsigned transaction to
 * claim (mint) USDC after a CCTP bridge.
 *
 * Ported from mcp-ts `build_cctp_claim_usdc`. Pure crypto: encodes a
 * single `receiveMessage(bytes message, bytes attestation)` call on the
 * destination MessageTransmitter and returns it unsigned. NEVER signs or
 * broadcasts.
 *
 * The caller passes:
 *   - the raw message bytes from the source-chain `MessageSent` event
 *   - the attestation bytes from Circle's attestation API
 */

import { encodeFunctionData, getAddress } from 'viem'

import { type CctpChainConfig, cctpSupportedChains, getCctpChain } from './cctp'

const messageTransmitterAbi = [
  {
    name: 'receiveMessage',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'message', type: 'bytes' },
      { name: 'attestation', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

/** Parameters for {@link buildCctpClaim}. */
export type BuildCctpClaimParams = {
  /** Destination EVM chain name where USDC will be minted. */
  destinationChain: string
  /** Raw message bytes from the source-chain `MessageSent` event (0x hex). */
  message: string
  /** Attestation bytes from Circle's attestation API (0x hex). */
  attestation: string
}

/** Unsigned CCTP claim (mint) envelope returned by {@link buildCctpClaim}. */
export type CctpClaimResult = {
  /** Destination chain name. */
  chain: string
  /** Decimal destination-chain EVM chain id. */
  chainId: number
  /** Single unsigned tx calling `receiveMessage` on the MessageTransmitter. */
  tx: {
    to: `0x${string}`
    value: '0'
    data: `0x${string}`
  }
  /** Checksummed MessageTransmitter contract address. */
  messageTransmitter: `0x${string}`
}

/**
 * Normalize a hex-bytes input: trims, ensures a `0x` prefix, validates
 * even length + hex-only characters. Exported for unit tests.
 *
 * @throws if empty, odd-length, or non-hex.
 */
export const normalizeHexBytes = (input: string, fieldName: string): `0x${string}` => {
  let s = input.trim()
  if (s === '') {
    throw new Error(`${fieldName} is empty`)
  }
  if (!s.startsWith('0x')) {
    s = '0x' + s
  }
  if (s.length % 2 !== 0) {
    throw new Error(`${fieldName} has odd hex length (${s.length} chars); expected 0x + even-length hex`)
  }
  if (!/^0x[0-9a-fA-F]+$/.test(s)) {
    throw new Error(`${fieldName} is not valid hex: contains non-hex characters`)
  }
  return s as `0x${string}`
}

/**
 * Build the unsigned destination-chain claim transaction. Encodes
 * `receiveMessage(message, attestation)` on the destination
 * MessageTransmitter.
 *
 * @throws on unsupported chains, malformed hex, or an attestation whose
 * byte length is not a non-zero multiple of 65 (Circle attestations are
 * n*65 bytes; anything else is malformed and would revert on-chain).
 *
 * @example
 * ```ts
 * const env = buildCctpClaim({
 *   destinationChain: 'Arbitrum',
 *   message: '0x...',      // from the source MessageSent event
 *   attestation: '0x...',  // from Circle's attestation API
 * })
 * // env.tx.to === MessageTransmitter on Arbitrum
 * ```
 */
export const buildCctpClaim = (params: BuildCctpClaimParams): CctpClaimResult => {
  const dstChainName = params.destinationChain.trim()
  const dstCctp: CctpChainConfig | undefined = getCctpChain(dstChainName)
  if (!dstCctp) {
    throw new Error(
      `destination chain ${JSON.stringify(dstChainName)} is not supported by CCTP. Supported: ${cctpSupportedChains.join(', ')}`
    )
  }

  const messageHex = normalizeHexBytes(params.message, 'message')
  const attestationHex = normalizeHexBytes(params.attestation, 'attestation')

  // Circle's CCTP attestations are n*65 bytes (V1 = 1*65 single ECDSA
  // signature; V2 multi-sig = N copies of 65 bytes back-to-back). An
  // attestation whose byte length is not a non-zero multiple of 65 is
  // malformed and would produce a guaranteed-revert claim tx on-chain.
  // The multiple-of-65 invariant is version-stable (covers V1 + V2).
  const attestationBytes = (attestationHex.length - 2) / 2
  if (attestationBytes === 0 || attestationBytes % 65 !== 0) {
    throw new Error(
      `invalid attestation byte length ${attestationBytes}: Circle attestations are n*65 bytes ` +
        `(V1 = 1*65 single signature, V2 = n*65 multi-sig). ${attestationBytes} is not a non-zero ` +
        `multiple of 65 — this attestation is malformed and would produce a guaranteed-revert claim tx.`
    )
  }

  const calldata = encodeFunctionData({
    abi: messageTransmitterAbi,
    functionName: 'receiveMessage',
    args: [messageHex, attestationHex],
  })

  return {
    chain: dstChainName,
    chainId: dstCctp.evmChainId,
    tx: {
      to: getAddress(dstCctp.messageTransmitter),
      value: '0',
      data: calldata,
    },
    messageTransmitter: getAddress(dstCctp.messageTransmitter),
  }
}
