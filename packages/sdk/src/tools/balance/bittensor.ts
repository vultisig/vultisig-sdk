/**
 * Bittensor (TAO) native balance read — pure crypto.
 *
 * Ports the read-only half of mcp-ts `lib/bittensor.ts`:
 *   - SS58 address validation (fund-safety: reject Polkadot/Kusama/etc.)
 *   - System.Account SCALE storage-key derivation
 *   - free-balance parse from the AccountInfo SCALE layout
 *
 * Bittensor is a Substrate chain not wired through any EVM/Cosmos rail, so the
 * balance read is a raw `state_getStorage` JSON-RPC call against the Finney
 * mainnet endpoints with cross-provider fallback. Read-only — never signs.
 */
import { blake2b } from '@noble/hashes/blake2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import bs58 from 'bs58'

import { fetchJson } from './rpc'

// Finney mainnet RPCs, tried in order on transport failure. A single hard-coded
// endpoint with no fallback previously zeroed all TAO balances on a provider
// blip — keep the multi-endpoint list.
export const BITTENSOR_RPCS: readonly string[] = [
  'https://entrypoint-finney.opentensor.ai', // official
  'https://lite.sub.latent.to', // community
  'https://bittensor-finney.api.onfinality.io/public', // onfinality public
]

const BITTENSOR_RPC_TIMEOUT_MS = 4_000

// 1 TAO = 1e9 RAO (9 decimals, not 10 like Polkadot).
export const TAO_DECIMALS = 9

export const BITTENSOR_BASE_FEE_RAO = '200000'
export const BITTENSOR_BASE_FEE_HUMAN = '0.0002 TAO'

// SS58 prefix for Bittensor (42). Addresses start with '5'.
const BITTENSOR_SS58_PREFIX = 42

// SS58 wire layout for a 32-byte AccountId: 1 prefix byte + 32 pubkey + 2 checksum.
const SS58_BYTE_LENGTH = 35
const SS58_PUBKEY_OFFSET = 1
const SS58_PUBKEY_END = 33
const SS58_CHECKSUM_PREFIX = new TextEncoder().encode('SS58PRE')

// System.Account storage key prefix: twox128("System") ++ twox128("Account").
const SYSTEM_ACCOUNT_PREFIX = '0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9'

// ---------------------------------------------------------------------------
// Address validation
// ---------------------------------------------------------------------------

/**
 * Validate that `addr` is a well-formed Bittensor SS58 address (prefix 42,
 * 32-byte AccountId, valid Blake2b SS58 checksum) and return the raw pubkey.
 *
 * FUND-SAFETY: Polkadot (prefix=0, starts with '1'), Kusama (prefix=2), Acala
 * (prefix=10), etc. all share the same 32-byte AccountId encoding. Without the
 * prefix gate a Polkadot address supplied to a Bittensor read would silently
 * resolve to the Bittensor account derived from those bytes — fund-confusion
 * UX. This is a pure-format check: it does not assert the account is funded.
 */
export function decodeBittensorAddress(addr: string): Uint8Array {
  if (!addr) {
    throw new Error('Bittensor address is empty. Provide a Bittensor SS58 address (prefix=42, starts with "5").')
  }

  let decoded: Uint8Array
  try {
    decoded = bs58.decode(addr)
  } catch (err) {
    throw new Error(
      `'${addr}' is not a valid base58 SS58 address. (${err instanceof Error ? err.message : String(err)})`,
      { cause: err }
    )
  }

  if (decoded.length !== SS58_BYTE_LENGTH) {
    throw new Error(`Invalid SS58 address length: expected ${SS58_BYTE_LENGTH} bytes, got ${decoded.length}.`)
  }

  const prefix = decoded[0]
  if (prefix !== BITTENSOR_SS58_PREFIX) {
    throw new Error(
      `Address ${addr} has SS58 prefix ${prefix}, not Bittensor's ${BITTENSOR_SS58_PREFIX}. ` +
        'Polkadot (prefix=0, starts with "1"), Kusama (prefix=2), Acala (prefix=10), and other ' +
        'Substrate addresses share the same 32-byte AccountId encoding — operating on one as if ' +
        'it were Bittensor would route to an account derived from those bytes on the wrong chain.'
    )
  }

  // SS58 checksum: blake2b-512 over "SS58PRE" ++ (prefix ++ pubkey), first 2 bytes.
  const body = decoded.subarray(0, SS58_PUBKEY_END)
  const checksum = decoded.subarray(SS58_PUBKEY_END)
  const hashInput = new Uint8Array(SS58_CHECKSUM_PREFIX.length + body.length)
  hashInput.set(SS58_CHECKSUM_PREFIX, 0)
  hashInput.set(body, SS58_CHECKSUM_PREFIX.length)
  const expected = blake2b(hashInput, { dkLen: 64 })
  if (checksum[0] !== expected[0] || checksum[1] !== expected[1]) {
    throw new Error(`Address ${addr} has an invalid SS58 checksum — it may be mistyped.`)
  }

  return decoded.subarray(SS58_PUBKEY_OFFSET, SS58_PUBKEY_END)
}

/**
 * Assert a Bittensor SS58 address is valid. Throws on mismatch. Thin wrapper
 * around {@link decodeBittensorAddress} for callers that only need the gate.
 */
export function assertBittensorAddress(addr: string): void {
  decodeBittensorAddress(addr)
}

// ---------------------------------------------------------------------------
// RPC helpers (read-only)
// ---------------------------------------------------------------------------

type RpcResponse<T> = {
  jsonrpc: string
  id: number
  result?: T
  error?: { code: number; message: string }
}

function shouldFallbackJsonRpcError(error: { code: number; message: string }): boolean {
  // Server-side JSON-RPC errors are often transient node failures; method/schema
  // errors are deterministic and stay authoritative.
  return error.code === -32603 || (error.code <= -32000 && error.code >= -32099)
}

async function withEndpointTimeout<T>(url: string, request: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Bittensor RPC endpoint timed out after ${BITTENSOR_RPC_TIMEOUT_MS}ms: ${url}`)),
          BITTENSOR_RPC_TIMEOUT_MS
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

// Try each Finney RPC in order; advance on transport failure or transient
// JSON-RPC server errors. Deterministic method/input errors return as-is.
async function bittensorFetch<T>(method: string, params: unknown[]): Promise<RpcResponse<T>> {
  let lastErr: unknown
  for (const url of BITTENSOR_RPCS) {
    try {
      const response = await withEndpointTimeout(
        url,
        fetchJson<RpcResponse<T>>(
          url,
          { jsonrpc: '2.0', method, params, id: 1 },
          { signal: AbortSignal.timeout(BITTENSOR_RPC_TIMEOUT_MS) }
        )
      )
      if (response.error && shouldFallbackJsonRpcError(response.error)) {
        lastErr = new Error(`JSON-RPC ${response.error.code}: ${response.error.message}`)
        continue
      }
      return response
    } catch (err) {
      lastErr = err
    }
  }
  throw new Error(
    `Bittensor RPC ${method} unreachable on all ${BITTENSOR_RPCS.length} endpoints: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  )
}

async function rpcNullable<T>(method: string, params: unknown[] = []): Promise<T | null> {
  const response = await bittensorFetch<T>(method, params)
  if (response.error) {
    throw new Error(`Bittensor RPC ${method} failed: ${response.error.message ?? `code ${response.error.code}`}`)
  }
  return response.result ?? null
}

// ---------------------------------------------------------------------------
// Account balance (System.Account SCALE storage read)
// ---------------------------------------------------------------------------

/**
 * Derive the System.Account SCALE storage key for a validated Bittensor pubkey.
 * Key = SYSTEM_ACCOUNT_PREFIX ++ blake2b_128(pubkey) ++ pubkey (Blake2_128Concat).
 */
function accountStorageKey(pubkey: Uint8Array): string {
  const hash = bytesToHex(blake2b(pubkey, { dkLen: 16 }))
  const accountId = bytesToHex(pubkey)
  return SYSTEM_ACCOUNT_PREFIX + hash + accountId
}

/**
 * Fetch the free TAO balance (in RAO, 1 TAO = 1e9 RAO) for a Bittensor SS58
 * address. Validates the address first (throws on a non-Bittensor address).
 * Returns 0n for a never-funded account (storage key absent).
 */
export async function getBittensorBalance(address: string): Promise<bigint> {
  const pubkey = decodeBittensorAddress(address)
  const storageKey = accountStorageKey(pubkey)

  const result = await rpcNullable<string>('state_getStorage', [storageKey])
  if (!result) return 0n

  // AccountInfo SCALE layout:
  //   nonce(4) + consumers(4) + providers(4) + sufficients(4) = 16-byte header
  //   free(16) + reserved(16) + frozen(16) + ...  (u128 LE each)
  const hex = result.startsWith('0x') ? result.slice(2) : result
  if (hex.length < 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Unexpected Bittensor storage response format: ${result}`)
  }
  // free balance = bytes 16-31 = hex chars 32-63 (u128 LE).
  const freeHex = hex.slice(32, 64)
  const leBytes = freeHex.match(/.{2}/g)
  if (!leBytes) {
    throw new Error(`Failed to parse free balance from hex: ${freeHex}`)
  }
  return BigInt('0x' + leBytes.reverse().join(''))
}
