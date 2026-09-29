import { Chain } from '@vultisig/core-chain/Chain'
import bs58check from 'bs58check'
import { Buffer } from 'buffer'

const cashAlphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const cashGenerators = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n]

const cashPolymod = (values: number[]): bigint => {
  let checksum = 1n
  for (const value of values) {
    const top = checksum >> 35n
    checksum = ((checksum & 0x07ffffffffn) << 5n) ^ BigInt(value)
    cashGenerators.forEach((generator, bit) => {
      if ((top & (1n << BigInt(bit))) !== 0n) checksum ^= generator
    })
  }
  return checksum ^ 1n
}

const decodeCashAddress = (address: string): Buffer => {
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
    throw new Error('mixed-case CashAddr')
  }
  const normalized = address.toLowerCase()
  const parts = normalized.split(':')
  if (parts.length > 2 || (parts.length === 2 && parts[0] !== 'bitcoincash')) {
    throw new Error('invalid CashAddr prefix')
  }
  const payload = parts.at(-1) ?? ''
  const values = [...payload].map(char => cashAlphabet.indexOf(char))
  if (values.length < 9 || values.some(value => value < 0)) throw new Error('invalid CashAddr payload')

  const prefix = [...'bitcoincash'].map(char => char.charCodeAt(0) & 31)
  if (cashPolymod([...prefix, 0, ...values]) !== 0n) throw new Error('invalid CashAddr checksum')

  const data = values.slice(0, -8)
  let accumulator = 0
  let bits = 0
  const bytes: number[] = []
  for (const value of data) {
    accumulator = (accumulator << 5) | value
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((accumulator >> bits) & 0xff)
    }
  }
  if (bits >= 5 || ((accumulator << (8 - bits)) & 0xff) !== 0) throw new Error('invalid CashAddr padding')
  if (bytes.length !== 21 || bytes[0] !== 0) throw new Error('CashAddr is not a 20-byte P2PKH address')
  return Buffer.from(bytes.slice(1))
}

/** Resolve only mainnet P2PKH addresses accepted by the SwapKit legacy PSBT signer. */
export const p2pkhScriptForAddress = (chain: Chain, address: string): Buffer => {
  let hash: Buffer
  try {
    if (chain === Chain.BitcoinCash && (address.includes(':') || /^[qp][a-z0-9]{40,}$/iu.test(address))) {
      hash = decodeCashAddress(address)
    } else {
      const decoded = Buffer.from(bs58check.decode(address))
      const prefix: Record<string, number[]> = {
        [Chain.Dogecoin]: [0x1e],
        [Chain.BitcoinCash]: [0x00],
        [Chain.Zcash]: [0x1c, 0xb8],
      }
      const expected = prefix[chain]
      if (
        !expected ||
        decoded.length !== expected.length + 20 ||
        !decoded.subarray(0, expected.length).equals(Buffer.from(expected))
      ) {
        throw new Error('invalid P2PKH prefix or length')
      }
      hash = decoded.subarray(expected.length)
    }
  } catch {
    throw new Error(`Invalid ${chain} P2PKH address: ${address}`)
  }
  return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), hash, Buffer.from([0x88, 0xac])])
}
