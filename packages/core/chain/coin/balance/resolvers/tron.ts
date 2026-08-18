import { decodeTronBase58Address } from '@vultisig/core-chain/chains/tron/address'
import { tronRpcUrl } from '@vultisig/core-chain/chains/tron/config'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { CoinBalanceResolver } from '../resolver'

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
 * Decodes a Tron Base58Check address and returns the 20-byte EVM-compatible
 * address part as hex (network prefix stripped).
 *
 * Delegates checksum/prefix validation to the canonical shared decoder in
 * `chains/tron/address.ts` — also consumed by the SDK's Tron tx builder, so
 * mainnet (0x41) and Nile testnet (0xa0) addresses are accepted identically
 * on every first-party surface.
 */
export function base58CheckTronDecode(address: string): string {
  const decoded = decodeTronBase58Address(address)

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
