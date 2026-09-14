import { decodeTronAddress } from '@vultisig/core-chain/chains/tron/address'
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
      Error?: string
      error?: string
    }>(`${tronRpcUrl}/wallet/getaccount`, {
      body: {
        address: input.address,
        visible: true,
      },
    })

    const gatewayError = data.Error ?? data.error
    if (gatewayError !== undefined) {
      throw new Error(`Tron RPC getaccount failed: ${gatewayError || 'unknown gateway error'}`)
    }

    // Never-funded accounts legitimately return {}. Activated accounts with
    // no TRX can also omit balance, so preserve zero only after checking errors.
    const balance = data.result?.balance ?? data.balance ?? '0'

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

/** Decode a Tron address to its 20-byte EVM hex representation without the network prefix. */
export function base58CheckTronDecode(address: string): string {
  return Buffer.from(decodeTronAddress(address).subarray(1)).toString('hex')
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
      if (!hexString) throw new Error(`Tron RPC ${method} returned an empty contract result`)
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
  const rpcEndpoint = 'https://api.trongrid.io/jsonrpc'

  const { error, result } = await queryUrl<{
    error?: { code?: number; message?: string }
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
    const code = error.code === undefined ? '' : ` (${error.code})`
    throw new Error(`Tron RPC ${method} failed${code}: ${error.message || 'unknown provider error'}`)
  }
  if (result !== undefined) return decode(result)
  throw new Error(`Tron RPC ${method} returned no result`)
}
