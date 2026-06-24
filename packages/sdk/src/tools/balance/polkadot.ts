// Polkadot native DOT + Assets-pallet (USDT/USDC/...) balance reads.
//
// Ported from mcp-ts `src/tools/balance/polkadot-balance.ts` (the `get_dot_balance`
// tool) into the SDK as the canonical `sdk.balance.polkadot(...)` primitive, per the
// tools-to-sdk consolidation. This is PURE CRYPTO: SS58 decode + SCALE parse + raw
// state_getStorage RPC reads. It NEVER signs or broadcasts.
//
// Unlike the bare-bigint core resolver (`getPolkadotCoinBalance`, which only extracts
// `free` for native DOT), this primitive surfaces the full pallet_balances breakdown
// (free / reserved / frozen / total / spendable + nonce) so callers can distinguish
// spendable balance from locked stake/identity deposits — matching the mcp-ts tool's
// contract.
//
// Implementation deliberately uses @noble/hashes (blake2b) + bs58 rather than
// @polkadot/util-crypto / @polkadot/api: the latter pull a BN.js dep that double-bundles
// in browser/extension/RN builds and crashes at module init with
// "Cannot assign to read only property 'toString'". Same RN-safe choice the core
// resolver (resolvers/polkadot.ts) already made.

import { blake2b } from '@noble/hashes/blake2b'
import { bytesToHex } from '@noble/hashes/utils'
import { assetHubRpcUrl, polkadotRpcUrl } from '@vultisig/core-chain/chains/polkadot/client'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import bs58 from 'bs58'

// 1 DOT = 1e10 Planck. Same on relay chain + Asset Hub.
export const DOT_DECIMALS = 10

const polkadotSs58Prefix = 0
const ss58AddressByteLength = 35
const ss58ChecksumPreamble = new TextEncoder().encode('SS58PRE')

// twox128("System") ++ twox128("Account") — well-known Substrate storage prefix.
const systemAccountPrefix = '0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9'

// twox128("Assets") ++ twox128("Account") — pallet_assets.Account on Asset Hub.
const assetsAccountPrefix = '0x682a59d51ab9e48a8c8cc418ff9708d2b99d880ec681799c0cf30e8886371da9'

type RpcResponse<T> = {
  jsonrpc: string
  id: number
  result?: T
  error?: { code: number; message: string }
}

/** Result of a native DOT balance read — full pallet_balances breakdown, raw + human. */
export type PolkadotNativeBalance = {
  address: string
  /** free balance, raw Planck (u128). */
  freePlanck: string
  /** free balance, human DOT string (trailing zeros trimmed). */
  freeDot: string
  /** reserved (deposits/bonded), raw Planck. */
  reservedPlanck: string
  reservedDot: string
  /** frozen (locks: staking, vesting, governance), raw Planck. */
  frozenPlanck: string
  frozenDot: string
  /** total = free + reserved, raw Planck. */
  totalPlanck: string
  totalDot: string
  /** spendable = max(free - frozen, 0), raw Planck. */
  spendablePlanck: string
  spendableDot: string
  /** account nonce (number of extrinsics sent). */
  nonce: number
}

/** Result of an Assets-pallet (Asset Hub) asset balance read. */
export type PolkadotAssetBalance = {
  address: string
  /** pallet_assets integer asset_id (e.g. 1984 = USDT, 1337 = USDC). */
  assetId: string
  /** raw u128 balance, base units. */
  balanceRaw: string
}

/**
 * SS58-decode a Polkadot address to its 32-byte AccountId public key, hard-gating
 * the network prefix + checksum.
 *
 * Substrate chains (Bittensor prefix=42 → `5xxx`, Kusama prefix=2, Acala prefix=10, ...)
 * share the same 32-byte AccountId encoding under different SS58 prefixes. Without this
 * gate, a Bittensor `5xxx` would silently resolve to the Polkadot balance of the
 * account derived from those bytes — fund-confusion UX, indistinguishable from a 0 / lost
 * balance. The checksum check additionally catches single-character typos.
 */
const decodePolkadotPublicKey = (address: string): Uint8Array => {
  // Reject EVM hex up front for a clear error (bs58 would throw an opaque alphabet error).
  if (/^0x[0-9a-fA-F]+$/.test(address)) {
    throw new Error(
      `Not a Polkadot address: ${address} looks like an EVM/hex address. ` +
        `Polkadot uses SS58 encoding (prefix=${polkadotSs58Prefix}), not 0x-prefixed hex.`
    )
  }

  const decoded = bs58.decode(address)
  if (decoded.length !== ss58AddressByteLength) {
    throw new Error(`Invalid SS58 address length: expected ${ss58AddressByteLength} bytes, got ${decoded.length}`)
  }
  if (decoded[0] !== polkadotSs58Prefix) {
    throw new Error(`Not a Polkadot address: SS58 network prefix ${decoded[0]}, expected ${polkadotSs58Prefix}`)
  }
  // SS58 checksum: blake2b-512("SS58PRE" || prefix || pubkey)[0..2] == trailing 2 bytes.
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

/** Format a raw Planck u128 as a human DOT string, trimming trailing fractional zeros. */
export const formatDot = (rawPlanck: bigint): string => {
  const divisor = 10n ** BigInt(DOT_DECIMALS)
  const whole = rawPlanck / divisor
  const frac = rawPlanck % divisor
  if (frac === 0n) return whole.toString()
  return `${whole}.${frac.toString().padStart(DOT_DECIMALS, '0').replace(/0+$/, '')}`
}

/** Read a little-endian u128 (16 bytes) out of a hex string at a byte offset. */
const readU128LE = (hex: string, byteOffset: number): bigint => {
  const start = byteOffset * 2
  const slice = hex.slice(start, start + 32)
  if (slice.length !== 32) {
    throw new Error(`Unexpected AccountInfo storage response: too short at offset ${byteOffset}`)
  }
  const leBytes = slice.match(/.{2}/g)
  if (!leBytes) {
    throw new Error(`Failed to parse u128 hex at offset ${byteOffset}: ${slice}`)
  }
  return BigInt('0x' + leBytes.reverse().join(''))
}

/**
 * Read native DOT balance for a Polkadot SS58 address, with the full
 * pallet_balances breakdown (free / reserved / frozen / total / spendable + nonce).
 *
 * SCALE AccountInfo layout (frame_system + pallet_balances v47):
 *   nonce(u32) consumers(u32) providers(u32) sufficients(u32)
 *   AccountData { free(u128) reserved(u128) frozen(u128) flags(u128) }
 * Field byte offsets (after the 16-byte u32 header): free@16, reserved@32, frozen@48.
 */
export const getPolkadotNativeBalance = async (address: string): Promise<PolkadotNativeBalance> => {
  const pubkey = decodePolkadotPublicKey(address)

  const hash = bytesToHex(blake2b(pubkey, { dkLen: 16 }))
  const accountId = bytesToHex(pubkey)
  const storageKey = systemAccountPrefix + hash + accountId

  const response = await queryUrl<RpcResponse<string | null>>(polkadotRpcUrl, {
    body: { jsonrpc: '2.0', method: 'state_getStorage', params: [storageKey], id: 1 },
  })

  if (response.error) {
    throw new Error(`Polkadot balance RPC error: ${response.error.message ?? `code ${response.error.code}`}`)
  }

  // Null result → account doesn't exist on-chain → all-zero balance.
  const result = response.result
  if (!result) {
    const z = '0'
    return {
      address,
      freePlanck: z,
      freeDot: z,
      reservedPlanck: z,
      reservedDot: z,
      frozenPlanck: z,
      frozenDot: z,
      totalPlanck: z,
      totalDot: z,
      spendablePlanck: z,
      spendableDot: z,
      nonce: 0,
    }
  }

  const hex = result.startsWith('0x') ? result.slice(2) : result
  // Need at least the u32 header (16 bytes) + free+reserved+frozen (3×16 bytes) = 64 bytes.
  if (hex.length < 128 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Unexpected AccountInfo storage response format: ${result}`)
  }

  // nonce is the first u32 (4 bytes LE) of the header.
  const nonceBytes = hex.slice(0, 8).match(/.{2}/g)
  const nonce = nonceBytes ? Number(BigInt('0x' + nonceBytes.reverse().join(''))) : 0

  const free = readU128LE(hex, 16)
  const reserved = readU128LE(hex, 32)
  const frozen = readU128LE(hex, 48)
  const total = free + reserved
  // Spendable = free - frozen (locks/staking deposits don't reduce free but DO reduce
  // what's transferable). Clamp to 0 — frozen can briefly exceed free during reaping.
  const spendable = free > frozen ? free - frozen : 0n

  return {
    address,
    freePlanck: free.toString(),
    freeDot: formatDot(free),
    reservedPlanck: reserved.toString(),
    reservedDot: formatDot(reserved),
    frozenPlanck: frozen.toString(),
    frozenDot: formatDot(frozen),
    totalPlanck: total.toString(),
    totalDot: formatDot(total),
    spendablePlanck: spendable.toString(),
    spendableDot: formatDot(spendable),
    nonce,
  }
}

/**
 * Read an Assets-pallet asset balance (USDT id=1984, USDC id=1337, ...) for a Polkadot
 * SS58 address on Asset Hub.
 *
 * Storage key: assetsAccountPrefix
 *   + blake2_128_concat(le_u32(assetId))   — 16-byte hash + 4-byte raw
 *   + blake2_128_concat(accountId_32bytes) — 16-byte hash + 32-byte raw
 * Response is SCALE-encoded AssetAccount; the first 16 bytes are the u128 balance LE.
 */
export const getPolkadotAssetBalance = async (address: string, assetIdStr: string): Promise<PolkadotAssetBalance> => {
  const pubkey = decodePolkadotPublicKey(address)

  const assetId = Number(assetIdStr)
  if (!Number.isInteger(assetId) || assetId < 0 || assetId > 0xffffffff) {
    throw new Error(`Invalid Polkadot asset_id: ${assetIdStr}`)
  }

  const assetIdLE = new Uint8Array(4)
  new DataView(assetIdLE.buffer).setUint32(0, assetId, true)

  const assetIdHashHex = bytesToHex(blake2b(assetIdLE, { dkLen: 16 }))
  const assetIdHex = bytesToHex(assetIdLE)
  const accountHashHex = bytesToHex(blake2b(pubkey, { dkLen: 16 }))
  const accountHex = bytesToHex(pubkey)

  const storageKey = assetsAccountPrefix + assetIdHashHex + assetIdHex + accountHashHex + accountHex

  const response = await queryUrl<RpcResponse<string | null>>(assetHubRpcUrl, {
    body: { jsonrpc: '2.0', method: 'state_getStorage', params: [storageKey], id: 1 },
  })

  if (response.error) {
    throw new Error(`Asset Hub pallet_assets RPC error: ${response.error.message ?? `code ${response.error.code}`}`)
  }

  const result = response.result
  // Null → no entry for this asset → balance 0.
  if (!result) {
    return { address, assetId: assetIdStr, balanceRaw: '0' }
  }

  // AssetAccount SCALE layout: balance(u128=16 bytes LE) + status(u8) + reason + extra.
  // Return raw u128 regardless of status (Liquid/Frozen/Blocked) — freeze checks are a
  // spend-path concern; balance display should reflect total holdings.
  const hex = result.startsWith('0x') ? result.slice(2) : result
  if (hex.length < 32 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Asset Hub pallet_assets: unexpected storage response: ${result}`)
  }
  const balance = readU128LE(hex, 0)

  return { address, assetId: assetIdStr, balanceRaw: balance.toString() }
}

/**
 * `sdk.balance.polkadot(...)` — native DOT balance, or an Assets-pallet asset balance
 * when `assetId` is provided.
 *
 *   await balancePolkadot({ address })                 // native DOT breakdown
 *   await balancePolkadot({ address, assetId: '1984' }) // USDT on Asset Hub
 */
export function balancePolkadot(params: { address: string }): Promise<PolkadotNativeBalance>
export function balancePolkadot(params: { address: string; assetId: string }): Promise<PolkadotAssetBalance>
export function balancePolkadot(params: {
  address: string
  assetId?: string
}): Promise<PolkadotNativeBalance | PolkadotAssetBalance> {
  const { address, assetId } = params
  if (!address) {
    throw new Error('balancePolkadot: address is required')
  }
  return assetId ? getPolkadotAssetBalance(address, assetId) : getPolkadotNativeBalance(address)
}
