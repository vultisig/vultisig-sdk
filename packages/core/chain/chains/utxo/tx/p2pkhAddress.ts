import { Chain } from '@vultisig/core-chain/Chain'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { crypto as bitcoinCrypto } from 'bitcoinjs-lib'
import bs58check from 'bs58check'
import { Buffer } from 'buffer'

/**
 * UTXO chains whose vault address is a legacy pay-to-public-key-hash script.
 * Their SwapKit swaps arrive as PSBTs over P2PKH inputs, so the vault's own
 * script has to be derivable from its address without WalletCore.
 */
export const p2pkhAddressChains = [Chain.Dogecoin, Chain.BitcoinCash, Chain.Dash, Chain.Zcash] as const

export type P2pkhAddressChain = (typeof p2pkhAddressChains)[number]

export const isP2pkhAddressChain = (chain: Chain): chain is P2pkhAddressChain => isOneOf(chain, p2pkhAddressChains)

/** Mainnet base58check version prefix of each chain's P2PKH address. */
const p2pkhAddressPrefix: Record<P2pkhAddressChain, Buffer> = {
  [Chain.Dogecoin]: Buffer.from([0x1e]),
  [Chain.BitcoinCash]: Buffer.from([0x00]),
  [Chain.Dash]: Buffer.from([0x4c]),
  [Chain.Zcash]: Buffer.from([0x1c, 0xb8]),
}

// bs58check v4 ships as ESM with a CJS-compat default export depending on the
// bundler, so resolve the functions once at module load (see tron/address.ts).
type Bs58CheckMod = {
  decode?: (s: string) => Uint8Array
  encode?: (b: Uint8Array) => string
  default?: { decode: (s: string) => Uint8Array; encode: (b: Uint8Array) => string }
}
const bs58 = bs58check as unknown as Bs58CheckMod
const base58CheckDecode = bs58.decode ?? bs58.default?.decode
const base58CheckEncode = bs58.encode ?? bs58.default?.encode
if (!base58CheckDecode || !base58CheckEncode) {
  throw new Error('bs58check unavailable — bundler did not resolve bs58check correctly')
}

const keyHashLength = 20
const p2pkhScriptLength = 25

const cashAddrPrefix = 'bitcoincash'
const cashAddrCharset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const cashAddrGenerators = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n]

const cashAddrPolymod = (values: number[]): bigint => {
  let checksum = 1n
  for (const value of values) {
    const top = checksum >> 35n
    checksum = ((checksum & 0x07ffffffffn) << 5n) ^ BigInt(value)
    cashAddrGenerators.forEach((generator, bit) => {
      if (((top >> BigInt(bit)) & 1n) !== 0n) {
        checksum ^= generator
      }
    })
  }
  return checksum ^ 1n
}

const cashAddrPrefixValues = [...cashAddrPrefix].map(char => char.charCodeAt(0) & 0x1f)

const convertBits = (data: number[], from: number, to: number, pad: boolean): number[] => {
  let accumulator = 0
  let bits = 0
  const result: number[] = []
  const maxValue = (1 << to) - 1
  for (const value of data) {
    accumulator = (accumulator << from) | value
    bits += from
    while (bits >= to) {
      bits -= to
      result.push((accumulator >> bits) & maxValue)
    }
  }
  if (pad) {
    if (bits > 0) {
      result.push((accumulator << (to - bits)) & maxValue)
    }
  } else if (bits >= from || ((accumulator << (to - bits)) & maxValue) !== 0) {
    throw new Error('invalid CashAddr padding')
  }
  return result
}

const looksLikeCashAddr = (address: string): boolean =>
  address.toLowerCase().startsWith(`${cashAddrPrefix}:`) || /^[qp][a-z0-9]{41}$/i.test(address)

/** The 20-byte key hash of a P2PKH CashAddr, with or without its `bitcoincash:` prefix. */
const decodeCashAddrKeyHash = (address: string): Buffer => {
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
    throw new Error('mixed-case CashAddr')
  }
  const [prefix, payload] = address.toLowerCase().includes(':')
    ? address.toLowerCase().split(':')
    : [cashAddrPrefix, address.toLowerCase()]
  if (prefix !== cashAddrPrefix || !payload) {
    throw new Error('CashAddr is not a mainnet bitcoincash address')
  }
  const values = [...payload].map(char => cashAddrCharset.indexOf(char))
  if (values.length <= 8 || values.some(value => value < 0)) {
    throw new Error('invalid CashAddr payload')
  }
  if (cashAddrPolymod([...cashAddrPrefixValues, 0, ...values]) !== 0n) {
    throw new Error('invalid CashAddr checksum')
  }
  const bytes = convertBits(values.slice(0, -8), 5, 8, false)
  // Version byte 0x00: type 0 (P2PKH) with a 160-bit hash.
  if (bytes.length !== keyHashLength + 1 || bytes[0] !== 0x00) {
    throw new Error('CashAddr is not a 20-byte P2PKH address')
  }
  return Buffer.from(bytes.slice(1))
}

/** A bare (prefix-less) P2PKH CashAddr, the spelling the vault stores for its own Bitcoin Cash address. */
const encodeCashAddr = (keyHash: Buffer): string => {
  const payload = convertBits([0x00, ...keyHash], 8, 5, true)
  const checksum = cashAddrPolymod([...cashAddrPrefixValues, 0, ...payload, 0, 0, 0, 0, 0, 0, 0, 0])
  const checksumValues = Array.from({ length: 8 }, (_, index) => Number((checksum >> BigInt(5 * (7 - index))) & 0x1fn))
  return [...payload, ...checksumValues].map(value => cashAddrCharset[value]).join('')
}

type ChainAddressInput = {
  chain: P2pkhAddressChain
  address: string
}

/**
 * The 20-byte public key hash a mainnet P2PKH address pays to. Bitcoin Cash
 * accepts CashAddr (with or without `bitcoincash:`) as well as legacy base58;
 * every other chain is base58check under its own version prefix. Throws for
 * any other address, so a script derived from the result is always P2PKH.
 */
export const getP2pkhKeyHashForAddress = ({ chain, address }: ChainAddressInput): Buffer => {
  const trimmed = address.trim()
  try {
    if (chain === Chain.BitcoinCash && looksLikeCashAddr(trimmed)) {
      return decodeCashAddrKeyHash(trimmed)
    }
    const prefix = p2pkhAddressPrefix[chain]
    const decoded = Buffer.from(base58CheckDecode(trimmed))
    if (decoded.length !== prefix.length + keyHashLength || !decoded.subarray(0, prefix.length).equals(prefix)) {
      throw new Error('unexpected version prefix or length')
    }
    return decoded.subarray(prefix.length)
  } catch {
    throw new Error(`Invalid ${chain} P2PKH address: ${address}`)
  }
}

/** `OP_DUP OP_HASH160 <20-byte hash> OP_EQUALVERIFY OP_CHECKSIG`. */
export const buildP2pkhScript = (keyHash: Uint8Array): Buffer => {
  if (keyHash.length !== keyHashLength) {
    throw new Error(`P2PKH key hash must be ${keyHashLength} bytes`)
  }
  return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), Buffer.from(keyHash), Buffer.from([0x88, 0xac])])
}

/** The key hash of a P2PKH scriptPubKey, or `undefined` for any other script. */
export const getP2pkhScriptKeyHash = (scriptPubKey: Uint8Array): Buffer | undefined => {
  const script = Buffer.from(scriptPubKey)
  const isP2pkh =
    script.length === p2pkhScriptLength &&
    script[0] === 0x76 &&
    script[1] === 0xa9 &&
    script[2] === 0x14 &&
    script[23] === 0x88 &&
    script[24] === 0xac
  return isP2pkh ? script.subarray(3, 23) : undefined
}

/** The P2PKH scriptPubKey a mainnet address pays to. */
export const getP2pkhScriptForAddress = (input: ChainAddressInput): Buffer =>
  buildP2pkhScript(getP2pkhKeyHashForAddress(input))

type ChainKeyHashInput = {
  chain: P2pkhAddressChain
  keyHash: Uint8Array
}

/**
 * The mainnet address of a P2PKH key hash, in the spelling the vault uses for
 * its own address on that chain: bare CashAddr for Bitcoin Cash, base58check
 * elsewhere.
 */
export const encodeP2pkhAddress = ({ chain, keyHash }: ChainKeyHashInput): string => {
  if (keyHash.length !== keyHashLength) {
    throw new Error(`P2PKH key hash must be ${keyHashLength} bytes`)
  }
  if (chain === Chain.BitcoinCash) {
    return encodeCashAddr(Buffer.from(keyHash))
  }
  return base58CheckEncode(Buffer.concat([p2pkhAddressPrefix[chain], Buffer.from(keyHash)]))
}

/** HASH160 of a compressed secp256k1 public key: the key hash its P2PKH outputs lock to. */
export const getPublicKeyHash160 = (publicKey: Uint8Array): Buffer => Buffer.from(bitcoinCrypto.hash160(publicKey))
