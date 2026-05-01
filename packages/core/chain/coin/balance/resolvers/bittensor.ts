import { blake2b } from '@noble/hashes/blake2b'
import { bytesToHex } from '@noble/hashes/utils'
import { bittensorRpcUrl } from '@vultisig/core-chain/chains/bittensor/client'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import bs58 from 'bs58'

import { CoinBalanceResolver } from '../resolver'

type RpcResponse<T> = {
  jsonrpc: string
  id: number
  result?: T
  error?: { code: number; message: string }
}

// System.Account storage key prefix: twox128("System") ++ twox128("Account")
const systemAccountPrefix =
  '0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9'

const ss58AddressByteLength = 35
const ss58PublicKeyOffset = 1
const ss58PublicKeyEnd = 33

const decodeSs58PublicKey = (address: string): Uint8Array => {
  const decoded = bs58.decode(address)
  if (decoded.length !== ss58AddressByteLength) {
    throw new Error(
      `Invalid SS58 address length: expected ${ss58AddressByteLength} bytes, got ${decoded.length}`
    )
  }
  return decoded.slice(ss58PublicKeyOffset, ss58PublicKeyEnd)
}

export const getBittensorCoinBalance: CoinBalanceResolver = async input => {
  const pubkey = decodeSs58PublicKey(input.address)
  const hash = bytesToHex(blake2b(pubkey, { dkLen: 16 }))
  const accountId = bytesToHex(pubkey)
  const storageKey = systemAccountPrefix + hash + accountId

  const response = await queryUrl<RpcResponse<string | null>>(bittensorRpcUrl, {
    body: {
      jsonrpc: '2.0',
      method: 'state_getStorage',
      params: [storageKey],
      id: 1,
    },
  })

  if (response.error) {
    throw new Error(
      `Bittensor balance RPC error: ${response.error.message ?? `code ${response.error.code}`}`
    )
  }

  const result = response.result
  if (!result) return BigInt(0)

  // Parse AccountInfo SCALE: nonce(4) + consumers(4) + providers(4) + sufficients(4) + free(16) + ...
  // free balance starts at byte offset 16 (after 4x u32), encoded as u128 LE
  const hex = result.startsWith('0x') ? result.slice(2) : result
  // Minimum expected length: 64 hex chars (32 bytes for 4x u32 + u128)
  if (hex.length < 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Unexpected storage response format: ${result}`)
  }
  const freeHex = hex.slice(32, 64) // bytes 16-31 = free balance (u128 LE)

  // Convert LE hex to BigInt
  const leBytes = freeHex.match(/.{2}/g)
  if (!leBytes) {
    throw new Error(`Failed to parse free balance hex: ${freeHex}`)
  }
  return BigInt('0x' + leBytes.reverse().join(''))
}
