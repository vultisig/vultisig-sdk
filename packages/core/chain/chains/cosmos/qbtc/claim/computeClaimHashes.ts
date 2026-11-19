import { sha256 } from '@noble/hashes/sha2.js'

import { BtcAddressType } from './BtcAddressType'
import { detectBtcAddressType } from './detectBtcAddressType'

/** Must match `ClaimMessageVersion` on the chain (`x/qbtc/zk/message.go`). */
const claimMessageVersion = 'qbtc-claim-v1'

const bitcoinSignedMessageMagic = 'Bitcoin Signed Message:\n'

// The chain recovers the claimed address's Hash160 from the compressed key,
// which only P2PKH and P2WPKH commit to directly.
const claimableAddressTypes: readonly BtcAddressType[] = ['p2pkh', 'p2wpkh']

const encodeCompactSize = (length: number): Uint8Array => {
  if (length < 0xfd) return Uint8Array.of(length)
  if (length <= 0xffff) return Uint8Array.of(0xfd, length & 0xff, length >> 8)
  throw new Error(`Bitcoin signed message too long: ${length} bytes`)
}

const encodeVarString = (text: string): Uint8Array => {
  const bytes = new TextEncoder().encode(text)
  const length = encodeCompactSize(bytes.length)
  const result = new Uint8Array(length.length + bytes.length)
  result.set(length)
  result.set(bytes, length.length)
  return result
}

/**
 * The BIP-137 digest a Bitcoin wallet's "Sign message" signs for `text`:
 * SHA256d(varstr("Bitcoin Signed Message:\n") || varstr(UTF-8 text)).
 */
export const getBitcoinSignedMessageDigest = (text: string): Uint8Array => {
  const magic = encodeVarString(bitcoinSignedMessageMagic)
  const message = encodeVarString(text)
  const preimage = new Uint8Array(magic.length + message.length)
  preimage.set(magic)
  preimage.set(message, magic.length)
  return sha256(sha256(preimage))
}

type ClaimMessageInput = {
  /** QBTC chain ID (e.g. "qbtc-1"). */
  chainId: string
  /** The Bitcoin address being claimed, exactly as stored on its UTXOs. */
  bitcoinAddress: string
  /** Destination QBTC address: the receiver when set, else the claimer. */
  qbtcAddress: string
}

/**
 * The one-line claim text a Bitcoin key signs as a BIP-137 message:
 *
 * ```
 * qbtc-claim-v1|<chain-id>|<bitcoin address>|<destination qbtc address>
 * ```
 *
 * The chain rebuilds it from on-chain data (`ClaimMessageText` in
 * `x/qbtc/zk/message.go`), so every field must match byte for byte.
 */
export const getClaimMessageText = ({ chainId, bitcoinAddress, qbtcAddress }: ClaimMessageInput): string =>
  [claimMessageVersion, chainId, bitcoinAddress, qbtcAddress].join('|')

/**
 * The 32-byte digest a QBTC claim signature covers: the BIP-137 "Bitcoin
 * Signed Message" digest of {@link getClaimMessageText}. A wallet's "Sign
 * message" signs the same digest, so an MPC signer signs this value directly.
 * Throws for address types the claim circuit cannot verify (anything but
 * P2PKH and P2WPKH).
 */
export const computeClaimMessageHash = (input: ClaimMessageInput): Uint8Array => {
  const addressType = detectBtcAddressType(input.bitcoinAddress)
  if (!claimableAddressTypes.includes(addressType)) {
    throw new Error(`QBTC claims support P2PKH and P2WPKH addresses only, got ${addressType}`)
  }

  return getBitcoinSignedMessageDigest(getClaimMessageText(input))
}
