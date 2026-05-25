import { tronRpcUrl } from '@vultisig/core-chain/chains/tron/config'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import bs58check from 'bs58check'

import { CoinBalanceResolver } from '../resolver'

// bs58check v4 ships as ESM with a CJS-compat default export depending on
// the bundler. Resolve the decode function once at module load time.
type Bs58CheckMod = { decode?: (s: string) => Uint8Array; default?: { decode: (s: string) => Uint8Array } }
const _mod = bs58check as unknown as Bs58CheckMod
const _decode: (s: string) => Uint8Array = (_mod.decode ?? _mod.default?.decode) as (s: string) => Uint8Array

export const getTronCoinBalance: CoinBalanceResolver = async input => {
  if (isFeeCoin(input)) {
    try {
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

      return BigInt(balance ?? '0')
    } catch (error) {
      console.error('Error fetching TRX balance:', error)
      return BigInt('0')
    }
  } else {
    try {
      const hexAddress = base58CheckTronDecode(input.address)
      const hexContractAddress = base58CheckTronDecode(shouldBePresent(input.id))

      const balance = await fetchTRC20TokenBalance(`0x${hexContractAddress}`, `0x${hexAddress}`)

      return BigInt(balance ?? '0')
    } catch (error) {
      console.error('Error fetching TRC20 token balance:', error)
      return BigInt('0')
    }
  }
}

/**
 * Decodes a Tron Base58Check address and validates its checksum and network prefix.
 *
 * Tron addresses are Base58Check-encoded 21-byte payloads: one-byte network
 * prefix (0x41 on mainnet) followed by a 20-byte EVM-compatible address.
 * Using plain bs58 (no checksum) silently produces a wrong 20-byte value when
 * the input address is corrupted or mistyped, causing balance queries to hit
 * a completely different account and return 0 without any error.
 *
 * bs58check.decode verifies the 4-byte SHA-256d checksum and throws on
 * mismatch, so callers get an explicit error rather than silent misdirection.
 */
export function base58CheckTronDecode(address: string): string {
  if (!_decode) throw new Error('bs58check.decode unavailable')

  // Throws if the checksum is invalid - intentional.
  const decoded = _decode(address)

  // Tron mainnet prefix: 0x41 followed by 20-byte EVM address (21 bytes total).
  if (decoded.length !== 21 || decoded[0] !== 0x41) {
    throw new Error(
      `invalid tron address prefix: expected 0x41, got 0x${decoded[0]?.toString(16) ?? '??'} (length ${decoded.length})`
    )
  }

  // Return only the 20-byte EVM address part as hex (strip the 0x41 network prefix).
  return Buffer.from(decoded.subarray(1)).toString('hex')
}

async function fetchTRC20TokenBalance(contractAddress: string, walletAddress: string): Promise<bigint> {
  const paddedWalletAddress = '0000000000000000000000' + walletAddress.slice(2)

  const data = '0x70a08231' + paddedWalletAddress

  const fromAddress = '0x' + walletAddress.slice(4)
  const toAddress = '0x' + contractAddress.slice(4)

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
      return hexString ? BigInt(`0x${hexString}`) : 0n
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
