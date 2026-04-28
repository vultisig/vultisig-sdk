import { ripemd160 } from '@noble/hashes/ripemd160'
import { sha256 } from '@noble/hashes/sha256'

import { btcAddressTypeCircuit, QbtcClaimCircuit } from './BtcAddressType'
import { detectBtcAddressType } from './detectBtcAddressType'

const claimSuffix = 'qbtc-claim-v1'

/**
 * Domain-separation prefix for the ECDSA + Hash160 claim circuit
 * (`BTCPubKeyOwnershipCircuit` post btcq-org/qbtc#148). Covers P2PKH,
 * P2WPKH, P2SH-P2WPKH, and P2WSH. Must match `ClaimTagECDSAHash160` on the
 * chain side (`x/qbtc/zk/message.go`).
 */
const ecdsaHash160Tag = 'ecdsa-hash160:'

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
  if (
    compressedPubkey.length !== 33 ||
    (compressedPubkey[0] !== 0x02 && compressedPubkey[0] !== 0x03)
  ) {
    throw new Error(
      'compressedPubkey must be a 33-byte compressed secp256k1 key'
    )
  }

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
 * MessageHash = SHA256("ecdsa-hash160:" + addressHash + qbtcAddressHash + chainIdHash + "qbtc-claim-v1")
 * ```
 *
 * The domain-separation prefix must match `ClaimTagECDSAHash160` on the
 * chain (`x/qbtc/zk/message.go`). Schnorr/Taproot claims will use a
 * distinct tag once the chain defines one — see btcq-org/qbtc#148.
 */
export const computeClaimMessageHash = ({
  addressHash,
  qbtcAddressHash,
  chainIdHash,
  circuit,
}: ComputeClaimMessageHashInput): Uint8Array => {
  if (circuit === 'schnorr') {
    throw new Error(
      'Schnorr / Taproot claim circuit is not yet supported on the QBTC chain'
    )
  }

  if (addressHash.length !== 20) {
    throw new Error('addressHash must be 20 bytes for ecdsa-hash160')
  }
  if (qbtcAddressHash.length !== 32) {
    throw new Error('qbtcAddressHash must be 32 bytes')
  }
  if (chainIdHash.length !== 8) {
    throw new Error('chainIdHash must be 8 bytes')
  }

  const encoder = new TextEncoder()
  const prefix = encoder.encode(ecdsaHash160Tag)
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
