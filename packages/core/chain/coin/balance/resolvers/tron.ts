import { tronRpcUrl } from '@vultisig/core-chain/chains/tron/config'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import bs58check from 'bs58check'

import { CoinBalanceResolver } from '../resolver'

// bs58check v4 ships as ESM with a CJS-compat default export depending on
// the bundler. Resolve the decode function once at module load time and
// throw immediately if unavailable — fail on startup, not mid-request.
type Bs58CheckMod = { decode?: (s: string) => Uint8Array; default?: { decode: (s: string) => Uint8Array } }
const _mod = bs58check as unknown as Bs58CheckMod
const _decode: (s: string) => Uint8Array = (() => {
  const fn = _mod.decode ?? _mod.default?.decode
  if (!fn) throw new Error('bs58check.decode unavailable — bundler did not resolve bs58check correctly')
  return fn
})()

// Tron network prefixes. 0x41 = mainnet, 0xa0 = Nile testnet.
const TRON_NETWORK_PREFIXES: readonly number[] = [0x41, 0xa0]

export const getTronCoinBalance: CoinBalanceResolver = async input => {
  if (isFeeCoin(input)) {
    const data = await queryUrl<{
      result?: { balance?: string }
      balance?: string
    }>(`${tronRpcUrl}/wallet/getaccount`, {
      body: {
        address: input.address,
        visible: true,
      },
    })

    const balance = data.result?.balance ?? data.balance ?? data.result?.balance?.toString() ?? '0'

    try {
      return BigInt(balance ?? '0')
    } catch (err) {
      console.error(`[tron] malformed TRX balance value: ${balance}`, err)
      throw new Error(`Tron RPC returned malformed TRX balance: ${balance}`)
    }
  } else {
    const hexAddress = base58CheckTronDecode(input.address)
    const hexContractAddress = base58CheckTronDecode(shouldBePresent(input.id))

    return fetchTRC20TokenBalance(`0x${hexContractAddress}`, `0x${hexAddress}`)
  }
}

/**
 * Decodes a Tron Base58Check address and validates its checksum and network prefix.
 *
 * Tron addresses are Base58Check-encoded 21-byte payloads: one-byte network
 * prefix (0x41 on mainnet, 0xa0 on Nile testnet) followed by a 20-byte
 * EVM-compatible address. Using plain bs58 (no checksum) silently produces a
 * wrong 20-byte value when the input address is corrupted or mistyped, causing
 * balance queries to hit a completely different account and return 0 without
 * any error.
 *
 * bs58check.decode verifies the 4-byte SHA-256d checksum and throws on
 * mismatch, so callers get an explicit error rather than silent misdirection.
 *
 * TODO: `packages/sdk/src/chains/tron/tx.ts:tronAddressToBytes` duplicates
 * this logic - consolidate once the SDK can import from core without circular
 * dep issues.
 */
export function base58CheckTronDecode(address: string): string {
  // Throws if the checksum is invalid - intentional.
  const decoded = _decode(address)

  // 21 bytes: 1-byte network prefix + 20-byte EVM address.
  if (decoded.length !== 21 || !TRON_NETWORK_PREFIXES.includes(decoded[0])) {
    throw new Error(
      `invalid tron address prefix: expected ${TRON_NETWORK_PREFIXES.map(p => `0x${p.toString(16)}`).join(' or ')}, got 0x${decoded[0]?.toString(16) ?? '??'} (length ${decoded.length})`
    )
  }

  // Return only the 20-byte EVM address part as hex (strip the network prefix).
  return Buffer.from(decoded.subarray(1)).toString('hex')
}

async function fetchTRC20TokenBalance(contractAddress: string, walletAddress: string): Promise<bigint> {
  // walletAddress is "0x" + 40-char EVM hex (base58CheckTronDecode output, prefix already stripped).
  // Pad to 64 chars (12 zero bytes + 20-byte addr) for the balanceOf(address) ABI param.
  const evmHex = walletAddress.slice(2) // 40-char hex, no prefix
  const paddedWalletAddress = '000000000000000000000000' + evmHex // 24 + 40 = 64 chars

  const data = '0x70a08231' + paddedWalletAddress

  const fromAddress = walletAddress // already "0x" + 40-char EVM hex
  const toAddress = contractAddress // already "0x" + 40-char EVM hex

  const params: any[] = [
    {
      from: fromAddress,
      to: toAddress,
      gas: '0x0',
      gasPrice: '0x0',
      value: '0x0',
      data: data,
    },
    'latest',
  ]

  return await intRpcCall('eth_call', params)
}

async function intRpcCall(method: string, params: any[]): Promise<bigint> {
  return await sendRPCRequest(method, params, (result: any) => {
    if (typeof result === 'number') {
      return BigInt(result)
    }

    if (typeof result === 'string') {
      const hexString = result.startsWith('0x') ? result.slice(2) : result
      if (!hexString) return 0n
      try {
        return BigInt(`0x${hexString}`)
      } catch (err) {
        console.error(`[tron] malformed RPC hex response: ${result}`, err)
        throw new Error(`Tron RPC returned malformed hex: ${result}`)
      }
    }

    throw {
      code: 500,
      message: 'Error converting the RPC result to number',
    }
  })
}

async function sendRPCRequest<T>(method: string, params: any[], decode: (result: any) => T): Promise<T> {
  const payload = {
    jsonrpc: '2.0',
    method: method,
    params: params,
    id: 1,
  }

  const rpcEndpoint = 'https://api.trongrid.io/jsonrpc'

  try {
    const { error, result } = await queryUrl<{
      error?: { message: string }
      result?: any
    }>(rpcEndpoint, {
      body: {
        jsonrpc: '2.0',
        method: method,
        params: params,
        id: 1,
      },
    })

    if (error) {
      return decode(error.message)
    } else if (result !== undefined) {
      return decode(result)
    } else {
      throw {
        code: 500,
        message: 'Unknown error',
      }
    }
  } catch (error) {
    console.error('RPC Request Payload:', payload)
    console.error('Error:', error)
    throw error
  }
}
