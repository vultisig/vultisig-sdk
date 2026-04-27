// SS58 decode + blake2b are intentionally implemented with bs58 + @noble/hashes
// rather than @polkadot/util-crypto: the latter pulls a BN.js dep that double-bundles
// in browser/extension builds and crashes at module init with
// "Cannot assign to read only property 'toString'" — same root cause as the
// Bittensor revert that originally broke this resolver.
import { blake2b } from '@noble/hashes/blake2b'
import { bytesToHex } from '@noble/hashes/utils'
import { polkadotRpcUrl } from '@vultisig/core-chain/chains/polkadot/client'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import bs58 from 'bs58'

import { CoinBalanceResolver } from '../resolver'

type RpcResponse<T> = {
  jsonrpc: string
  id: number
  result?: T
  error?: { code: number; message: string }
}

// twox128("System") ++ twox128("Account") — well-known Substrate storage prefix
const systemAccountPrefix = '0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9'

const polkadotSs58Prefix = 0
const ss58AddressByteLength = 35
const ss58ChecksumPreamble = new TextEncoder().encode('SS58PRE')

const decodePolkadotPublicKey = (address: string): Uint8Array => {
  const decoded = bs58.decode(address)
  if (decoded.length !== ss58AddressByteLength) {
    throw new Error(`Invalid SS58 address length: expected ${ss58AddressByteLength} bytes, got ${decoded.length}`)
  }
  // Reject other Substrate networks (Kusama=2, generic=42, etc.) — they decode
  // to the same length and would silently resolve to a 0 DOT balance, which
  // looks indistinguishable from fund loss.
  if (decoded[0] !== polkadotSs58Prefix) {
    throw new Error(`Not a Polkadot address: SS58 network prefix ${decoded[0]}, expected ${polkadotSs58Prefix}`)
  }
  // SS58 checksum: blake2b-512("SS58PRE" || prefix || pubkey)[0..2] == trailing 2 bytes.
  // Catches single-character typos that would otherwise yield a valid-shaped pubkey
  // and a 0 balance.
  const payload = decoded.subarray(0, 33)
  const checksum = decoded.subarray(33)
  const checksumInput = new Uint8Array(ss58ChecksumPreamble.length + payload.length)
  checksumInput.set(ss58ChecksumPreamble)
  checksumInput.set(payload, ss58ChecksumPreamble.length)
  const expected = blake2b(checksumInput, { dkLen: 64 })
  if (expected[0] !== checksum[0] || expected[1] !== checksum[1]) {
    throw new Error('Invalid SS58 checksum')
  }
  return payload.subarray(1)
}

export const getPolkadotCoinBalance: CoinBalanceResolver = async input => {
  const pubkey = decodePolkadotPublicKey(input.address)
  const hash = bytesToHex(blake2b(pubkey, { dkLen: 16 }))
  const accountId = bytesToHex(pubkey)
  const storageKey = systemAccountPrefix + hash + accountId

  const response = await queryUrl<RpcResponse<string | null>>(polkadotRpcUrl, {
    body: {
      jsonrpc: '2.0',
      method: 'state_getStorage',
      params: [storageKey],
      id: 1,
    },
  })

  if (response.error) {
    throw new Error(`Polkadot balance RPC error: ${response.error.message ?? `code ${response.error.code}`}`)
  }

  const result = response.result
  if (!result) return BigInt(0)

  // SCALE AccountInfo layout (frame_system + pallet_balances v47):
  //   nonce(u32) + consumers(u32) + providers(u32) + sufficients(u32)
  //   + AccountData { free(u128), reserved(u128), frozen(u128), flags(u128) }
  // free is always at byte offset 16, length 16, encoded LE — stable across the
  // misc_frozen/fee_frozen → frozen/flags migration, since `free` is always the
  // first AccountData field.
  const hex = result.startsWith('0x') ? result.slice(2) : result
  if (hex.length < 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Unexpected storage response format: ${result}`)
  }
  const freeHex = hex.slice(32, 64)

  const leBytes = freeHex.match(/.{2}/g)
  if (!leBytes) {
    throw new Error(`Failed to parse free balance hex: ${freeHex}`)
  }
  return BigInt('0x' + leBytes.reverse().join(''))
}
