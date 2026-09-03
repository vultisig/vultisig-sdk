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
 *   - the source chain the burn happened on
 *   - the raw message bytes from the source-chain `MessageSent` event
 *   - the attestation bytes from Circle's attestation API
 *
 * ## Burn-identity binding (architecture#1733)
 *
 * `destinationChain` alone tells the encoder nothing about whether this
 * specific message/attestation pair actually redeems the burn the caller
 * thinks it does — a stale, cross-wired, or wrong-chain message would
 * previously sail through and produce a structurally valid (but
 * semantically wrong, or guaranteed-revert) claim tx. Ported from
 * `agent-backend-ts`'s `build_cctp_claim_usdc` handler: the message is
 * decoded (`decodeCctpBurnMessage`) and every field that actually
 * identifies the burn is cross-checked against the stated
 * `sourceChain`/`destinationChain` BEFORE any calldata is encoded — source
 * domain, destination domain, the canonical TokenMessenger on each side,
 * the burned token, and (fail-closed, not a warning — a CCTP mint
 * recipient is immutable in the message, so a burn address there is
 * unrecoverable regardless of whether the claim is built) the mint
 * recipient.
 */

import { assertSafeDestination } from '@vultisig/core-chain/security/dangerousAddresses'
import { encodeFunctionData, getAddress } from 'viem'

import { type CctpChainConfig, cctpSupportedChains, getCctpChain, getCctpChainNameByDomain } from './cctp'
import { type CctpBurnMessage, decodeCctpBurnMessage } from './decodeCctpBurnMessage'

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
  /** Source EVM chain the USDC was burned on (where `depositForBurn` was called). */
  sourceChain: string
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
  /**
   * The decoded, cross-checked burn identity this claim redeems — ground
   * truth read from the message itself, not caller-asserted. Lets a caller
   * show the user what this claim actually mints and to whom, not just the
   * destination chain name.
   */
  burn: CctpBurnMessage
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
 * Build the unsigned destination-chain claim transaction. Decodes the burn
 * message and cross-checks it against `sourceChain`/`destinationChain`
 * before encoding `receiveMessage(message, attestation)` on the destination
 * MessageTransmitter.
 *
 * @throws on unsupported chains, malformed hex, an attestation whose byte
 * length is not a non-zero multiple of 65 (Circle attestations are n*65
 * bytes; anything else is malformed and would revert on-chain), an
 * undecodable message, a message whose decoded identity doesn't match the
 * stated source/destination chain or registered contracts, or a mint
 * recipient that's a known burn/dead address.
 *
 * @example
 * ```ts
 * const env = buildCctpClaim({
 *   sourceChain: 'Ethereum',
 *   destinationChain: 'Arbitrum',
 *   message: '0x...',      // from the source MessageSent event
 *   attestation: '0x...',  // from Circle's attestation API
 * })
 * // env.tx.to === MessageTransmitter on Arbitrum
 * ```
 */
export const buildCctpClaim = (params: BuildCctpClaimParams): CctpClaimResult => {
  const srcChainName = params.sourceChain.trim()
  const srcCctp: CctpChainConfig | undefined = getCctpChain(srcChainName)
  if (!srcCctp) {
    throw new Error(
      `source chain ${JSON.stringify(srcChainName)} is not supported by CCTP. Supported: ${cctpSupportedChains.join(', ')}`
    )
  }

  const dstChainName = params.destinationChain.trim()
  const dstCctp: CctpChainConfig | undefined = getCctpChain(dstChainName)
  if (!dstCctp) {
    throw new Error(
      `destination chain ${JSON.stringify(dstChainName)} is not supported by CCTP. Supported: ${cctpSupportedChains.join(', ')}`
    )
  }

  const messageHex = normalizeHexBytes(params.message, 'message')
  const attestationHex = normalizeHexBytes(params.attestation, 'attestation')

  let burn: CctpBurnMessage
  try {
    burn = decodeCctpBurnMessage(messageHex)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`cannot identify the burn this claim redeems: ${msg}`)
  }

  if (burn.sourceDomain !== srcCctp.domain) {
    const actualSrcChain = getCctpChainNameByDomain(burn.sourceDomain) ?? `domain ${burn.sourceDomain}`
    throw new Error(
      `message source domain mismatch: stated sourceChain is ${srcChainName} (domain ${srcCctp.domain}) ` +
        `but the message actually originates from ${actualSrcChain} — refusing to build a claim against ` +
        `a burn that doesn't match the stated source chain.`
    )
  }

  if (burn.destinationDomain !== dstCctp.domain) {
    const actualDstChain = getCctpChainNameByDomain(burn.destinationDomain) ?? `domain ${burn.destinationDomain}`
    throw new Error(
      `message destination domain mismatch: requested destinationChain is ${dstChainName} (domain ${dstCctp.domain}) ` +
        `but the message is only claimable on ${actualDstChain} — refusing to build a claim that would ` +
        `revert on ${dstChainName} (or worse, target the wrong chain).`
    )
  }

  if (burn.sender.toLowerCase() !== srcCctp.tokenMessenger.toLowerCase()) {
    throw new Error(
      `message sender ${burn.sender} does not match ${srcChainName}'s registered TokenMessenger ` +
        `(${srcCctp.tokenMessenger}) — this message was not emitted by Circle's canonical contract on the ` +
        `stated source chain, refusing to build a claim against it.`
    )
  }

  if (burn.recipient.toLowerCase() !== dstCctp.tokenMessenger.toLowerCase()) {
    throw new Error(
      `message recipient ${burn.recipient} does not match ${dstChainName}'s registered TokenMessenger ` +
        `(${dstCctp.tokenMessenger}) — this message does not target the destination chain's canonical ` +
        `contract, refusing to build a claim against it.`
    )
  }

  if (burn.burnToken.toLowerCase() !== srcCctp.usdc.toLowerCase()) {
    throw new Error(
      `burned token ${burn.burnToken} is not ${srcChainName}'s registered USDC (${srcCctp.usdc}) — ` +
        `this only claims USDC burns, refusing to build a claim for a different token.`
    )
  }

  // The burn message names its OWN mint recipient — a message+attestation
  // pair minting to a burn/dead address would otherwise produce a claim
  // indistinguishable from a legitimate one at the signing surface. No
  // false-block risk: the USDC is ALREADY burned on the source chain by the
  // time a claim exists, and `receiveMessage` mints to the recipient
  // encoded in the immutable message — refusing costs nothing recoverable.
  try {
    assertSafeDestination(dstChainName, burn.mintRecipient)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `${msg} This burn message mints to ${burn.mintRecipient} on ${dstChainName}, so claiming it would ` +
        `permanently strand the bridged USDC and cost you the claim gas for nothing. Refusing to build it — ` +
        `re-check where this message and attestation came from.`
    )
  }

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
    chain: dstCctp.chain,
    chainId: dstCctp.evmChainId,
    tx: {
      to: getAddress(dstCctp.messageTransmitter),
      value: '0',
      data: calldata,
    },
    messageTransmitter: getAddress(dstCctp.messageTransmitter),
    burn,
  }
}
