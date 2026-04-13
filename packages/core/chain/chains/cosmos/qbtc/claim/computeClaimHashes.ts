import { ripemd160 } from '@noble/hashes/legacy.js'
import { sha256 } from '@noble/hashes/sha2.js'

import { btcAddressTypeCircuit, QbtcClaimCircuit } from './BtcAddressType'
import { detectBtcAddressType } from './detectBtcAddressType'

const claimSuffix = 'qbtc-claim-v1'

/** Hash160 = RIPEMD160(SHA256(data)), the standard Bitcoin hash. */
const hash160 = (data: Uint8Array): Uint8Array => ripemd160(sha256(data))

/**
 * Computes the address hash for QBTC claiming.
 * - ECDSA types: Hash160(compressedPubkey) — 20 bytes
 * - Taproot (Schnorr): x-only pubkey (last 32 bytes of 33-byte compressed key)
 */
export const computeAddressHash = ({
  compressedPubkey,
  circuit,
}: {
  compressedPubkey: Uint8Array
  circuit: QbtcClaimCircuit
}): Uint8Array => {
  if (circuit === 'schnorr') {
    return compressedPubkey.slice(1, 33)
  }
  return hash160(compressedPubkey)
}

/** Computes SHA256 of the QBTC bech32 address string. */
export const computeQbtcAddressHash = (qbtcAddress: string): Uint8Array =>
  sha256(new TextEncoder().encode(qbtcAddress))

/** Computes the first 8 bytes of SHA256 of the chain ID. */
export const computeChainIdHash = (chainId: string): Uint8Array =>
  sha256(new TextEncoder().encode(chainId)).slice(0, 8)

type ComputeClaimMessageHashInput = {
  addressHash: Uint8Array
  qbtcAddressHash: Uint8Array
  chainIdHash: Uint8Array
  circuit: QbtcClaimCircuit
}

/**
 * Computes the final MessageHash for the QBTC claim.
 *
 * ```
 * MessageHash = SHA256(prefix + addressHash + qbtcAddressHash + chainIdHash + "qbtc-claim-v1")
 * ```
 *
 * Where prefix is `"ecdsa:"` or `"schnorr:"` depending on the BTC address type.
 */
export const computeClaimMessageHash = ({
  addressHash,
  qbtcAddressHash,
  chainIdHash,
  circuit,
}: ComputeClaimMessageHashInput): Uint8Array => {
  const encoder = new TextEncoder()
  const prefix = encoder.encode(`${circuit}:`)
  const suffix = encoder.encode(claimSuffix)

  const message = new Uint8Array(
    prefix.length +
      addressHash.length +
      qbtcAddressHash.length +
      chainIdHash.length +
      suffix.length
  )

  let offset = 0
  message.set(prefix, offset)
  offset += prefix.length
  message.set(addressHash, offset)
  offset += addressHash.length
  message.set(qbtcAddressHash, offset)
  offset += qbtcAddressHash.length
  message.set(chainIdHash, offset)
  offset += chainIdHash.length
  message.set(suffix, offset)

  return sha256(message)
}

type ComputeAllClaimHashesInput = {
  btcAddress: string
  compressedPubkey: Uint8Array
  qbtcAddress: string
  chainId: string
}

type ClaimHashes = {
  messageHash: Uint8Array
  addressHash: Uint8Array
  qbtcAddressHash: Uint8Array
  circuit: QbtcClaimCircuit
}

/**
 * Convenience function that computes all hashes needed for a QBTC claim
 * in a single call.
 */
export const computeAllClaimHashes = ({
  btcAddress,
  compressedPubkey,
  qbtcAddress,
  chainId,
}: ComputeAllClaimHashesInput): ClaimHashes => {
  const addressType = detectBtcAddressType(btcAddress)
  const circuit = btcAddressTypeCircuit[addressType]

  const addressHash = computeAddressHash({ compressedPubkey, circuit })
  const qbtcAddressHash = computeQbtcAddressHash(qbtcAddress)
  const chainIdHash = computeChainIdHash(chainId)

  const messageHash = computeClaimMessageHash({
    addressHash,
    qbtcAddressHash,
    chainIdHash,
    circuit,
  })

  return { messageHash, addressHash, qbtcAddressHash, circuit }
}
